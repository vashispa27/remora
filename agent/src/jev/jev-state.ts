/**
 * Bounded JEV state construction.
 *
 * Turns a `JevContext` into the small, deterministic object that is sent to the
 * OpenRouter Decisions API as `state`. Everything here is deliberately lossy:
 * element counts, string lengths, recent actions, and sensitive values are all
 * capped or redacted before the model sees them.
 *
 * OWNER: JEV subagent.
 */
import type { PageElement, PageObservation } from "@remora/protocol";
import type { JevContext, RecentAction } from "../core/contracts.js";

export const DEFAULT_MAX_ELEMENTS = 80;
export const DEFAULT_MAX_STRING = 160;
export const DEFAULT_MAX_TEXT_SUMMARY = 600;
export const DEFAULT_MAX_RECENT_ACTIONS = 8;

/** The compact element shape sent to JEV. */
export interface ElementDigest {
  ref: string;
  role: string;
  name: string;
  value?: string;
  text?: string;
  enabled: boolean;
  visible: boolean;
  editable: boolean;
  checked?: boolean;
  selected?: boolean;
}

export interface ElementDigestOptions {
  /** Defaults to 80. */
  maxElements?: number;
  /** Per-string cap. Defaults to 160. */
  maxString?: number;
}

export interface JevRecentAction {
  actionKind: string;
  targetRef?: string;
  targetName?: string;
  inputKey?: string;
  option?: string;
  status: string;
  effect?: string;
}

export interface JevState {
  goal: string;
  inputs: Record<string, string>;
  milestone: { goal: string; completion: string[] };
  completedMilestones: string[];
  page: { url: string; title: string; textSummary: string };
  elements: ElementDigest[];
  recentActions: JevRecentAction[];
  verifierFeedback?: string;
}

export interface BuildJevStateOptions extends ElementDigestOptions {
  /** Cap on the heading/alert digest. Defaults to 600. */
  maxTextSummary?: number;
  /** How many recent actions to keep. Defaults to 8. */
  maxRecentActions?: number;
}

/**
 * Roles that must survive the element cap: the ones the tactical policy can
 * actually act on or reason about.
 */
const REQUIRED_ROLES = new Set([
  "textbox",
  "combobox",
  "checkbox",
  "radio",
  "button",
  "link",
  "heading",
  "status",
]);

const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "combobox",
  "listbox",
  "checkbox",
  "radio",
  "switch",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "option",
  "slider",
  "spinbutton",
  "treeitem",
  "gridcell",
]);

const SENSITIVE_KEY =
  /(pass(word|phrase)?|secret|token|api[_-]?key|apikey|credential|mfa|otp|one[_-]?time|ssn|social[_-]?security|cvv|cvc|card[_-]?number|private[_-]?key|pin)/i;

/** Collapses whitespace and truncates to `max` characters. */
export function clip(value: string, max: number = DEFAULT_MAX_STRING): string {
  if (typeof value !== "string") return "";
  const s = value.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  if (max <= 1) return s.slice(0, Math.max(0, max));
  return `${s.slice(0, max - 1)}…`;
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

/** Keeps input keys but replaces the value of sensitive fields. */
export function redactInputs(inputs: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(inputs)) {
    out[key] = isSensitiveKey(key) ? "[redacted]" : clip(value);
  }
  return out;
}

function tierOf(element: PageElement): number {
  if (element.editable || INTERACTIVE_ROLES.has(element.role) || REQUIRED_ROLES.has(element.role)) {
    return 0;
  }
  if (element.role === "heading" || element.role === "status" || element.role === "alert") return 1;
  return 2;
}

function toDigest(element: PageElement, maxString: number): ElementDigest {
  const name = clip(element.name ?? "", maxString);
  const digest: ElementDigest = {
    ref: element.ref,
    role: clip(element.role || "generic", 40) || "generic",
    name,
    enabled: element.enabled,
    visible: element.visible,
    editable: element.editable,
  };

  const rawValue = element.sensitive || element.valueRedacted ? undefined : (element.value ?? undefined);
  if (rawValue !== undefined && rawValue !== "") {
    const value = clip(rawValue, maxString);
    if (value) digest.value = value;
  }

  const rawText = element.text ?? undefined;
  if (rawText !== undefined && rawText !== "") {
    const text = clip(rawText, maxString);
    // Drop text when it merely repeats the accessible name.
    if (text && normalize(text) !== normalize(name)) digest.text = text;
  }

  if (element.checked !== null && element.checked !== undefined) digest.checked = element.checked;
  if (element.selected !== null && element.selected !== undefined) digest.selected = element.selected;
  return digest;
}

/**
 * Bounded, prioritized element list. Visible-or-enabled elements only; the cap
 * is applied after sorting so interactive/editable elements and headings/status
 * win over generic content. Required roles are tier 0, so they are never
 * dropped before anything else.
 */
export function elementDigest(
  observation: PageObservation,
  opts: ElementDigestOptions = {},
): ElementDigest[] {
  const maxElements = Math.max(1, Math.floor(opts.maxElements ?? DEFAULT_MAX_ELEMENTS));
  const maxString = Math.max(16, Math.floor(opts.maxString ?? DEFAULT_MAX_STRING));
  return observation.elements
    .filter((element) => element.visible || element.enabled)
    .map((element, index) => ({ element, index, tier: tierOf(element) }))
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .slice(0, maxElements)
    .map(({ element }) => toDigest(element, maxString));
}

function buildTextSummary(observation: PageObservation, max: number): string {
  const parts: string[] = [];
  for (const element of observation.elements) {
    if (!element.visible) continue;
    if (
      element.role !== "heading" &&
      element.role !== "status" &&
      element.role !== "alert" &&
      element.role !== "banner"
    ) {
      continue;
    }
    const label = clip(element.name || element.text || "", 120);
    if (!label) continue;
    parts.push(`${element.role}: ${label}`);
    if (parts.length >= 12) break;
  }
  let summary = parts.join(" | ");
  if (observation.truncated.omittedCount > 0) {
    summary += ` | (+${observation.truncated.omittedCount} more elements not shown)`;
  }
  return clip(summary, max);
}

function summarizeRecentActions(
  actions: RecentAction[],
  limit: number,
  maxString: number,
): JevRecentAction[] {
  return actions.slice(-limit).map((action) => {
    const out: JevRecentAction = {
      actionKind: clip(action.actionKind, 40),
      status: clip(action.status, 40),
    };
    if (action.targetRef) out.targetRef = clip(action.targetRef, 40);
    if (action.targetName) out.targetName = clip(action.targetName, 120);
    if (action.inputKey) out.inputKey = clip(action.inputKey, 80);
    if (action.option) out.option = clip(action.option, 120);
    if (action.effect) out.effect = clip(action.effect, 200);
    return out;
  });
}

/** Builds the bounded `state` object for a JEV decision request. */
export function buildJevState(ctx: JevContext, opts: BuildJevStateOptions = {}): JevState {
  const maxString = Math.max(16, Math.floor(opts.maxString ?? DEFAULT_MAX_STRING));
  const maxElements = Math.max(1, Math.floor(opts.maxElements ?? DEFAULT_MAX_ELEMENTS));
  const maxTextSummary = Math.max(80, Math.floor(opts.maxTextSummary ?? DEFAULT_MAX_TEXT_SUMMARY));
  const maxRecentActions = Math.max(0, Math.floor(opts.maxRecentActions ?? DEFAULT_MAX_RECENT_ACTIONS));

  const state: JevState = {
    goal: clip(ctx.goal, 500),
    inputs: redactInputs(ctx.inputs),
    milestone: {
      goal: clip(ctx.milestone.goal, 300),
      completion: ctx.milestone.completion.map((criterion) => clip(criterion, 200)),
    },
    completedMilestones: ctx.completedMilestones.slice(-8).map((item) => clip(item, 200)),
    page: {
      url: clip(ctx.observation.tab.url, 400),
      title: clip(ctx.observation.tab.title, 200),
      textSummary: buildTextSummary(ctx.observation, maxTextSummary),
    },
    elements: elementDigest(ctx.observation, { maxElements, maxString }),
    recentActions: summarizeRecentActions(ctx.recentActions, maxRecentActions, maxString),
  };

  if (ctx.verifierFeedback && ctx.verifierFeedback.trim() !== "") {
    state.verifierFeedback = clip(ctx.verifierFeedback, 800);
  }
  return state;
}
