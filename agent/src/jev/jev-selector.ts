/**
 * JEV tactical policy. Builds dynamic typed questions (choice/noul/score) from
 * the current observation and turns the Decisions API answers into one
 * validated JevAction.
 *
 * The selector is fail-closed: any answer that cannot be validated triggers one
 * retry with a shortened state and repeated option IDs, and a second failure
 * returns a `blocked` action rather than a guess.
 *
 * OWNER: JEV subagent.
 */
import type {
  DecisionQuestion,
  DecisionResponse,
  JevContext,
  JevSelection,
  JevSelector,
  ModelGateway,
  ModelUsage,
} from "../core/contracts.js";
import type { JevAction } from "../schemas/domain.js";
import { buildJevState, clip, type BuildJevStateOptions, type JevState } from "./jev-state.js";
import { buildJevQuestions, type JevQuestionMeta } from "./jev-questions.js";
import { validateAnswers, type ValidatedSelection } from "./jev-validate.js";

export { buildJevState, elementDigest } from "./jev-state.js";
export type { BuildJevStateOptions, ElementDigest, ElementDigestOptions, JevState } from "./jev-state.js";

export interface JevSelectorOptions {
  gateway: ModelGateway;
  /** Below this confidence the proposal is treated as low confidence by the loop. */
  confidenceThreshold?: number;
  /** Upper bound on element choices sent to JEV. */
  maxElements?: number;
  /** Opt-in local debugging: receives questions, answers, and the mapped action. */
  logger?: (line: string) => void;
}

const DEFAULT_MAX_ELEMENTS = 80;
const RETRY_MAX_ELEMENTS = 25;

interface PreparedAttempt {
  state: JevState;
  questions: Record<string, DecisionQuestion>;
  meta: JevQuestionMeta;
}

export class JevQuestionSelector implements JevSelector {
  constructor(private readonly options: JevSelectorOptions) {}

  get confidenceThreshold(): number {
    return this.options.confidenceThreshold ?? 0.55;
  }

  get maxElements(): number {
    return this.options.maxElements ?? DEFAULT_MAX_ELEMENTS;
  }

  async select(ctx: JevContext): Promise<JevSelection> {
    const first = this.prepare(ctx, this.maxElements, false);
    this.options.logger?.(
      `[jev] milestone=${ctx.milestone.id} elements=${ctx.observation.elements.length} questions:\n` +
        clip(JSON.stringify(first.questions, null, 2), 4_000),
    );
    let response = await this.decide(first);
    this.options.logger?.(
      `[jev] answers:\n${clip(JSON.stringify(response.answers, null, 2), 4_000)}`,
    );
    let validation = validateAnswers(response.answers, first.meta, ctx);

    if (!validation.ok) {
      this.options.logger?.(
        `[jev] invalid selection (${validation.reason}); retrying with reduced state`,
      );
      const retry = this.prepare(ctx, RETRY_MAX_ELEMENTS, true);
      response = await this.decide(retry);
      this.options.logger?.(
        `[jev] retry answers:\n${clip(JSON.stringify(response.answers, null, 2), 4_000)}`,
      );
      validation = validateAnswers(response.answers, retry.meta, ctx);
      if (!validation.ok) {
        const reason = `JEV returned an invalid selection: ${validation.reason}`;
        this.options.logger?.(`[jev] blocked: ${reason}`);
        return { action: blockedAction(reason), usage: null };
      }
    }

    const action = toAction(validation.value, ctx);
    this.options.logger?.(`[jev] mapped action: ${JSON.stringify(action)}`);
    return { action, usage: normalizeUsage(response.usage) };
  }

  private prepare(ctx: JevContext, maxElements: number, retry: boolean): PreparedAttempt {
    const stateOptions: BuildJevStateOptions = { maxElements };
    const state = buildJevState(ctx, stateOptions);
    const { questions, meta } = buildJevQuestions(ctx, state, { retry, maxElements });
    return { state, questions, meta };
  }

  private decide(attempt: PreparedAttempt): Promise<DecisionResponse> {
    return this.options.gateway.decide({
      state: attempt.state,
      questions: attempt.questions,
      model: this.options.gateway.jevModelId,
    });
  }
}

function blockedAction(reason: string): JevAction {
  return { kind: "blocked", reason, confidence: 0, probabilities: null, rationale: null };
}

function blockedReason(ctx: JevContext): string {
  const base = "JEV reported blocked: no safe action can advance the active milestone";
  if (ctx.verifierFeedback && ctx.verifierFeedback.trim() !== "") {
    return `${base}. Verifier feedback: ${clip(ctx.verifierFeedback, 200)}`;
  }
  return base;
}

function buildRationale(selection: ValidatedSelection): string {
  const parts = [`JEV chose operation ${selection.operation}`];
  if (selection.targetRef) parts.push(`on target ${selection.targetRef}`);
  if (selection.inputKey) parts.push(`with input key ${selection.inputKey}`);
  if (selection.option) parts.push(`option ${selection.option}`);
  if (selection.direction) parts.push(`direction ${selection.direction}`);
  return `${parts.join(" ")}.`;
}

function toAction(selection: ValidatedSelection, ctx: JevContext): JevAction {
  const { confidence, probabilities } = selection;
  switch (selection.operation) {
    case "click":
      return {
        kind: "click",
        ref: selection.targetRef ?? "",
        confidence,
        probabilities,
        rationale: buildRationale(selection),
      };
    case "type_text":
      return {
        kind: "type_text",
        ref: selection.targetRef ?? "",
        inputKey: selection.inputKey ?? "",
        confidence,
        probabilities,
        rationale: buildRationale(selection),
      };
    case "select":
      return {
        kind: "select",
        ref: selection.targetRef ?? "",
        option: selection.option ?? "",
        confidence,
        probabilities,
        rationale: buildRationale(selection),
      };
    case "scroll":
      return {
        kind: "scroll",
        direction: selection.direction ?? "down",
        confidence,
        probabilities,
        rationale: buildRationale(selection),
      };
    case "wait":
      return { kind: "wait", confidence, probabilities, rationale: buildRationale(selection) };
    case "milestone_done":
      return { kind: "milestone_done", confidence, probabilities, rationale: buildRationale(selection) };
    case "blocked":
    default:
      return {
        kind: "blocked",
        reason: blockedReason(ctx),
        confidence,
        probabilities,
        rationale: null,
      };
  }
}

function normalizeUsage(usage: ModelUsage): ModelUsage {
  return {
    kind: "decisions",
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUsd: usage.costUsd,
  };
}
