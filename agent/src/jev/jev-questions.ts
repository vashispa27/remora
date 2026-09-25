/**
 * Dynamic JEV question construction.
 *
 * Builds the typed `choice` questions sent alongside the bounded state. The
 * operation set is derived from what the observation actually makes possible;
 * the target / input_key / select_option / scroll_direction questions are only
 * emitted when the corresponding operation is on the table.
 *
 * All questions are answered independently and in parallel by the Decisions
 * API, so no question may rely on the answer to another.
 *
 * OWNER: JEV subagent.
 */
import type { DecisionQuestion, JevContext } from "../core/contracts.js";
import { DEFAULT_MAX_ELEMENTS, clip, type ElementDigest, type JevState } from "./jev-state.js";

const CLICK_ROLES = new Set([
  "button",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "option",
  "checkbox",
  "radio",
  "switch",
  "treeitem",
  "combobox",
  "listbox",
]);

const LONG_CONTENT_ROLES = new Set(["row", "listitem", "cell", "gridcell", "article", "table"]);

const ELEMENT_OPS = new Set(["click", "type_text", "select"]);

const LOADING = /loading|please wait|in progress|creating|updating|deleting|provisioning|initializing|pending|starting/i;

export interface JevQuestionMeta {
  /** Operation ids actually offered. */
  operations: string[];
  clickTargets: string[];
  editableTargets: string[];
  comboboxTargets: string[];
  inputKeys: string[];
  selectOptions: string[];
  scrollDirections: string[];
}

export interface JevQuestionsResult {
  questions: Record<string, DecisionQuestion>;
  meta: JevQuestionMeta;
}

export interface JevQuestionBuildOptions {
  /** Retry requests repeat the allowed option IDs inside each instruction. */
  retry?: boolean;
  maxElements?: number;
}

interface OperationPlan {
  operations: string[];
  targets: Map<string, string>;
  clickTargets: ElementDigest[];
  editableTargets: ElementDigest[];
  comboboxTargets: ElementDigest[];
  inputKeys: string[];
  inputDescriptions: Map<string, string>;
  selectOptions: string[];
  selectOptionDescriptions: Map<string, string>;
  scrollDirections: string[];
}

const OPERATION_INSTRUCTIONS =
  "You are selecting the single next browser action that best advances the active milestone. " +
  "Read state.goal, state.milestone, state.inputs, state.page, state.elements, state.recentActions and " +
  "state.verifierFeedback. All questions are answered independently and in parallel, so never rely on the " +
  "answer to another question. Choose exactly one operation id from the criteria below. Prefer the operation " +
  "that makes concrete progress toward state.milestone.completion, and choose blocked only when no safe " +
  "operation can advance the milestone.";

const OPERATION_CRITERIA: Record<string, string> = {
  click:
    "click one visible and enabled element that advances the flow, such as navigation, opening a panel, or committing a form",
  type_text:
    "type a value into an editable field; the value is supplied by the orchestrator from state.inputs and must be selected with the input_key question",
  select:
    "choose an option on a visible and enabled combobox; the option must be selected with the select_option question",
  scroll:
    "scroll the page to reveal relevant elements that may be off-screen because the page is a long list or table",
  wait: "wait because the page appears to be loading or in a transitional state",
  milestone_done:
    "every completion criterion listed in state.milestone.completion is already satisfied on the current page",
  blocked: "no safe action can advance the milestone; state the reason in the rationale",
};

const TARGET_INSTRUCTIONS =
  "Choose exactly one element ref for the element-taking operation selected in the operation question. " +
  "Only the refs listed in these criteria are allowed; they are drawn from state.elements and are visible and " +
  "enabled. All questions are answered independently. If none of the listed refs can serve the operation, " +
  "choose blocked in the operation question instead.";

const INPUT_KEY_INSTRUCTIONS =
  "Choose exactly one input key. The value itself is supplied by the orchestrator from state.inputs; do not " +
  "invent or output a value. All questions are answered independently.";

const SELECT_OPTION_INSTRUCTIONS =
  "Choose exactly one option label for the select operation. The label must later be matched against the " +
  "chosen target's option list. All questions are answered independently.";

const SCROLL_DIRECTION_INSTRUCTIONS =
  "Choose exactly one scroll direction for the scroll operation. All questions are answered independently.";

function humanize(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
}

/** True when `text` mentions `key`, allowing camelCase/snake_case expansion. */
function mentions(text: string, key: string): boolean {
  const phrase = humanize(key);
  if (phrase && text.includes(phrase)) return true;
  const words = phrase.split(/\s+/).filter((word) => word.length > 2);
  return words.length > 0 && words.every((word) => text.includes(word));
}

function milestoneNeedsInput(ctx: JevContext, editableTargets: ElementDigest[]): boolean {
  const keys = Object.keys(ctx.inputs);
  if (keys.length === 0) return false;
  const milestoneText = `${ctx.milestone.goal} ${ctx.milestone.completion.join(" ")}`.toLowerCase();
  if (keys.some((key) => mentions(milestoneText, key))) return true;
  // Fallback: an empty editable field whose label matches an input key.
  return editableTargets.some((element) => {
    const label = `${element.name} ${element.text ?? ""}`.toLowerCase();
    const matches = keys.some((key) => mentions(label, key));
    const empty = !element.value || element.value.trim() === "";
    return matches && empty;
  });
}

function collectSelectOptions(elements: ElementDigest[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string): void => {
    const label = clip(raw, 80);
    if (!label) return;
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(label);
  };

  for (const element of elements) {
    if (!element.visible && !element.enabled) continue;
    if (element.role === "option") push(element.name || element.text || element.value || "");
  }
  // Fallback when the snapshotter does not surface option children: derive
  // candidate labels from the combobox value/text.
  for (const element of elements) {
    if (element.role !== "combobox" && element.role !== "listbox") continue;
    if (element.value) push(element.value);
    if (element.text) {
      for (const part of element.text.split(/[,;|·•]|\s{2,}|\n/)) push(part);
    }
  }
  return out.slice(0, 30);
}

function detectScrollRelevant(
  ctx: JevContext,
  elements: ElementDigest[],
  maxElements: number | undefined,
): boolean {
  const truncated = ctx.observation.truncated;
  if (truncated.omittedCount > 0 || truncated.nodeLimitReached || truncated.textLimitReached) {
    return true;
  }
  if (elements.filter((element) => LONG_CONTENT_ROLES.has(element.role)).length >= 6) return true;
  const cap = maxElements ?? DEFAULT_MAX_ELEMENTS;
  if (elements.length >= cap && ctx.observation.elements.length > elements.length) return true;
  return false;
}

function detectWaitRelevant(ctx: JevContext, elements: ElementDigest[]): boolean {
  if (elements.some((element) => element.role === "progressbar")) return true;
  if (LOADING.test(`${ctx.observation.tab.title} ${ctx.observation.tab.url}`)) return true;
  return elements.some(
    (element) =>
      (element.role === "status" || element.role === "alert") &&
      LOADING.test(`${element.name} ${element.text ?? ""}`),
  );
}

function describeElement(element: ElementDigest, operation: string): string {
  const role = element.role || "element";
  const name = element.name || element.text || "(unnamed)";
  const purpose =
    operation === "click"
      ? "clickable element that can advance the flow"
      : operation === "type_text"
        ? "accepts text input"
        : "selectable combobox";
  const bits: string[] = [];
  if (element.editable) bits.push("editable");
  if (element.checked === true) bits.push("checked");
  if (element.selected === true) bits.push("selected");
  if (element.value) bits.push(`current "${clip(element.value, 60)}"`);
  const suffix = bits.length > 0 ? ` (${bits.join(", ")})` : "";
  return `${role} "${clip(name, 80)}" — ${purpose}${suffix}`;
}

function describeInputKey(ctx: JevContext, key: string): string {
  const criterion = ctx.milestone.completion.find((item) => mentions(item.toLowerCase(), key));
  if (criterion) return `value for "${clip(criterion, 120)}"`;
  return `value "${key}" required by milestone "${clip(ctx.milestone.goal, 120)}"`;
}

function describeSelectOption(label: string, comboboxTargets: ElementDigest[]): string {
  if (comboboxTargets.length === 1) {
    const combobox = comboboxTargets[0];
    return `option of ${combobox.ref} (${clip(combobox.name || combobox.role, 60)})`;
  }
  return `option "${clip(label, 60)}" on the chosen combobox`;
}

function planOperations(
  ctx: JevContext,
  elements: ElementDigest[],
  opts: JevQuestionBuildOptions,
): OperationPlan {
  const live = elements.filter((element) => element.visible && element.enabled);
  const clickTargets = live.filter((element) => CLICK_ROLES.has(element.role));
  const editableTargets = live.filter((element) => element.editable);
  const comboboxTargets = live.filter(
    (element) => element.role === "combobox" || element.role === "listbox",
  );

  const inputKeys = Object.keys(ctx.inputs);
  const typeTextPossible =
    editableTargets.length > 0 && inputKeys.length > 0 && milestoneNeedsInput(ctx, editableTargets);

  const selectOptions = collectSelectOptions(elements);
  const selectPossible = comboboxTargets.length > 0 && selectOptions.length > 0;

  const scrollRelevant = detectScrollRelevant(ctx, elements, opts.maxElements);
  const waitRelevant = detectWaitRelevant(ctx, elements);

  const operations: string[] = [];
  if (clickTargets.length > 0) operations.push("click");
  if (typeTextPossible) operations.push("type_text");
  if (selectPossible) operations.push("select");
  if (scrollRelevant) operations.push("scroll");
  if (waitRelevant) operations.push("wait");
  operations.push("milestone_done");
  operations.push("blocked");

  const targets = new Map<string, string>();
  if (operations.includes("click")) {
    for (const element of clickTargets) {
      if (!targets.has(element.ref)) targets.set(element.ref, describeElement(element, "click"));
    }
  }
  if (operations.includes("type_text")) {
    for (const element of editableTargets) {
      if (!targets.has(element.ref)) targets.set(element.ref, describeElement(element, "type_text"));
    }
  }
  if (operations.includes("select")) {
    for (const element of comboboxTargets) {
      if (!targets.has(element.ref)) targets.set(element.ref, describeElement(element, "select"));
    }
  }

  const inputDescriptions = new Map<string, string>();
  for (const key of inputKeys) inputDescriptions.set(key, describeInputKey(ctx, key));

  const selectOptionDescriptions = new Map<string, string>();
  for (const label of selectOptions) {
    selectOptionDescriptions.set(label, describeSelectOption(label, comboboxTargets));
  }

  return {
    operations,
    targets,
    clickTargets,
    editableTargets,
    comboboxTargets,
    inputKeys,
    inputDescriptions,
    selectOptions,
    selectOptionDescriptions,
    scrollDirections: ["up", "down"],
  };
}

function applyAllowedIds(questions: Record<string, DecisionQuestion>): void {
  for (const [id, question] of Object.entries(questions)) {
    const criteria = question.criteria;
    if (!criteria) continue;
    const ids = Array.isArray(criteria) ? criteria : Object.keys(criteria);
    question.instructions = `${question.instructions} Allowed option IDs for ${id}: ${ids.join(", ")}.`;
  }
}

/**
 * Builds the question record and the validation metadata for one decision
 * request. The metadata is what `validateAnswers` checks the answers against.
 */
export function buildJevQuestions(
  ctx: JevContext,
  state: JevState,
  opts: JevQuestionBuildOptions = {},
): JevQuestionsResult {
  const plan = planOperations(ctx, state.elements, opts);
  const questions: Record<string, DecisionQuestion> = {};

  const operationCriteria: Record<string, string> = {};
  for (const operation of plan.operations) {
    operationCriteria[operation] = OPERATION_CRITERIA[operation] ?? operation;
  }
  questions.operation = { type: "choice", instructions: OPERATION_INSTRUCTIONS, criteria: operationCriteria };

  if (plan.targets.size > 0 && plan.operations.some((operation) => ELEMENT_OPS.has(operation))) {
    const targetCriteria: Record<string, string> = {};
    for (const [ref, description] of plan.targets) targetCriteria[ref] = description;
    questions.target = { type: "choice", instructions: TARGET_INSTRUCTIONS, criteria: targetCriteria };
  }

  if (plan.inputKeys.length > 0 && plan.operations.includes("type_text")) {
    const inputCriteria: Record<string, string> = {};
    for (const [key, description] of plan.inputDescriptions) inputCriteria[key] = description;
    questions.input_key = { type: "choice", instructions: INPUT_KEY_INSTRUCTIONS, criteria: inputCriteria };
  }

  if (plan.selectOptions.length > 0 && plan.operations.includes("select")) {
    const optionCriteria: Record<string, string> = {};
    for (const [label, description] of plan.selectOptionDescriptions) optionCriteria[label] = description;
    questions.select_option = {
      type: "choice",
      instructions: SELECT_OPTION_INSTRUCTIONS,
      criteria: optionCriteria,
    };
  }

  if (plan.operations.includes("scroll")) {
    questions.scroll_direction = {
      type: "choice",
      instructions: SCROLL_DIRECTION_INSTRUCTIONS,
      criteria: {
        up: "scroll up toward the top of the page",
        down: "scroll down toward the bottom of the page",
      },
    };
  }

  if (opts.retry) applyAllowedIds(questions);

  return {
    questions,
    meta: {
      operations: plan.operations,
      clickTargets: plan.clickTargets.map((element) => element.ref),
      editableTargets: plan.editableTargets.map((element) => element.ref),
      comboboxTargets: plan.comboboxTargets.map((element) => element.ref),
      inputKeys: plan.inputKeys,
      selectOptions: plan.selectOptions,
      scrollDirections: plan.scrollDirections,
    },
  };
}
