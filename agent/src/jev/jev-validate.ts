/**
 * Answer validation for JEV decisions.
 *
 * The Decisions API is typed but not guaranteed: it can omit an answer, return
 * the wrong answer type, or pick an option that was never offered. Every answer
 * is parsed with zod and then checked against the option sets that were actually
 * sent, so the selector can retry once and otherwise fail closed.
 *
 * OWNER: JEV subagent.
 */
import { z } from "zod";
import type { DecisionAnswer, JevContext } from "../core/contracts.js";

export const NoulAnswerSchema = z.object({
  type: z.literal("noul"),
  noul: z.number(),
});
export type NoulAnswer = z.infer<typeof NoulAnswerSchema>;

export const ChoiceAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
  probabilities: z.record(z.string(), z.number().min(0).max(1)).optional(),
});
export type ChoiceAnswer = z.infer<typeof ChoiceAnswerSchema>;

export const ScoreAnswerSchema = z.object({
  type: z.literal("score"),
  score: z.number(),
  confidence: z.number().min(0).max(1).optional(),
  probabilities: z.record(z.string(), z.number().min(0).max(1)).optional(),
  legend: z.record(z.string(), z.string()).optional(),
});
export type ScoreAnswer = z.infer<typeof ScoreAnswerSchema>;

export const DecisionAnswerSchema = z.discriminatedUnion("type", [
  NoulAnswerSchema,
  ChoiceAnswerSchema,
  ScoreAnswerSchema,
]);

/** Option sets the questions offered; answers must be members. */
export interface ValidationMeta {
  operations: string[];
  clickTargets: string[];
  editableTargets: string[];
  comboboxTargets: string[];
  inputKeys: string[];
  selectOptions: string[];
  scrollDirections: string[];
}

export interface ValidatedSelection {
  operation: string;
  confidence: number;
  probabilities: Record<string, number> | null;
  targetRef?: string;
  inputKey?: string;
  option?: string;
  direction?: "up" | "down";
}

export type ValidationResult =
  | { ok: true; value: ValidatedSelection }
  | { ok: false; reason: string };

type ChoiceRead = { ok: true; answer: ChoiceAnswer } | { ok: false; reason: string };

function readChoice(answers: Record<string, DecisionAnswer>, questionId: string): ChoiceRead {
  const raw = answers[questionId];
  if (raw === undefined) {
    return { ok: false, reason: `missing ${questionId} answer` };
  }
  const parsed = ChoiceAnswerSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: `malformed ${questionId} answer` };
  }
  return { ok: true, answer: parsed.data };
}

/**
 * Validates the full answer set for one request. Returns the normalized
 * selection or a short, model-independent reason for the retry/block path.
 */
export function validateAnswers(
  answers: Record<string, DecisionAnswer>,
  meta: ValidationMeta,
  ctx: JevContext,
): ValidationResult {
  const operationRead = readChoice(answers, "operation");
  if (!operationRead.ok) return { ok: false, reason: operationRead.reason };

  const operation = operationRead.answer.choice;
  if (!meta.operations.includes(operation)) {
    return { ok: false, reason: `operation "${operation}" was not offered` };
  }

  const base: ValidatedSelection = {
    operation,
    confidence: operationRead.answer.confidence ?? 1,
    probabilities: operationRead.answer.probabilities ?? null,
  };

  switch (operation) {
    case "click": {
      const target = readChoice(answers, "target");
      if (!target.ok) return { ok: false, reason: target.reason };
      const ref = target.answer.choice;
      if (!meta.clickTargets.includes(ref)) {
        return { ok: false, reason: `target "${ref}" is not a clickable ref` };
      }
      return { ok: true, value: { ...base, targetRef: ref } };
    }
    case "type_text": {
      const target = readChoice(answers, "target");
      if (!target.ok) return { ok: false, reason: target.reason };
      const ref = target.answer.choice;
      if (!meta.editableTargets.includes(ref)) {
        return { ok: false, reason: `target "${ref}" is not an editable ref` };
      }
      const inputKeyRead = readChoice(answers, "input_key");
      if (!inputKeyRead.ok) return { ok: false, reason: inputKeyRead.reason };
      const inputKey = inputKeyRead.answer.choice;
      if (!Object.prototype.hasOwnProperty.call(ctx.inputs, inputKey)) {
        return { ok: false, reason: `input key "${inputKey}" is not provided` };
      }
      if (!meta.inputKeys.includes(inputKey)) {
        return { ok: false, reason: `input key "${inputKey}" was not offered` };
      }
      return { ok: true, value: { ...base, targetRef: ref, inputKey } };
    }
    case "select": {
      const target = readChoice(answers, "target");
      if (!target.ok) return { ok: false, reason: target.reason };
      const ref = target.answer.choice;
      if (!meta.comboboxTargets.includes(ref)) {
        return { ok: false, reason: `target "${ref}" is not a combobox ref` };
      }
      const optionRead = readChoice(answers, "select_option");
      if (!optionRead.ok) return { ok: false, reason: optionRead.reason };
      const option = optionRead.answer.choice;
      if (!meta.selectOptions.includes(option)) {
        return { ok: false, reason: `option "${option}" was not offered` };
      }
      return { ok: true, value: { ...base, targetRef: ref, option } };
    }
    case "scroll": {
      const directionRead = readChoice(answers, "scroll_direction");
      if (!directionRead.ok) return { ok: false, reason: directionRead.reason };
      const direction = directionRead.answer.choice;
      if (direction !== "up" && direction !== "down") {
        return { ok: false, reason: `direction "${direction}" is not up or down` };
      }
      if (!meta.scrollDirections.includes(direction)) {
        return { ok: false, reason: `direction "${direction}" was not offered` };
      }
      return { ok: true, value: { ...base, direction } };
    }
    case "wait":
    case "milestone_done":
    case "blocked":
      return { ok: true, value: base };
    default:
      return { ok: false, reason: `unknown operation "${operation}"` };
  }
}
