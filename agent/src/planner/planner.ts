/**
 * Goal planner. Turns a prompt into inputs, outcome-based milestones,
 * completion criteria, and approval rules. Missing inputs produce clarification
 * questions instead of a plan.
 *
 * OWNER: planner/verifier subagent.
 */
import type { ModelGateway, PlanRequest, PlanResult, Planner, RepairRequest } from "../core/contracts.js";
import { PlannerOutputSchema, type ClarifyQuestion, type PlannerOutput } from "../schemas/domain.js";
import { summarizeObservation } from "./observationDigest.js";
import {
  PLANNER_REPAIR_SYSTEM_PROMPT,
  PLANNER_SYSTEM_PROMPT,
  buildPlanUserMessage,
  buildRepairUserMessage,
} from "./prompts.js";

export interface GoalPlannerOptions {
  gateway: ModelGateway;
  /** Opt-in local debugging: receives the full planner output. */
  logger?: (line: string) => void;
}

/** Planning is a large generative call; allow the model room to reason. */
const PLANNER_TIMEOUT_MS = 120_000;

/** Fallback question when a model returns needs_input without questions. */
const FALLBACK_QUESTION: ClarifyQuestion = {
  key: "details",
  question: "Please provide the missing details needed to complete this task.",
};

export class GoalPlanner implements Planner {
  constructor(private readonly options: GoalPlannerOptions) {}

  async plan(req: PlanRequest): Promise<PlanResult> {
    const result = await this.options.gateway.chatJSON({
      system: PLANNER_SYSTEM_PROMPT,
      user: buildPlanUserMessage(req),
      schemaName: "task_plan",
      schema: PlannerOutputSchema,
      temperature: 0,
      timeoutMs: PLANNER_TIMEOUT_MS,
    });
    this.options.logger?.(
      `[planner] task_plan output\n${JSON.stringify(result.data, null, 2)}`,
    );
    const mapped = this.toPlanResult(result.data);
    if (mapped.kind === "clarify") {
      this.options.logger?.(
        `[planner] needs input: ${mapped.questions.map((q) => `${q.key}: ${q.question}`).join(" | ")}`,
      );
    }
    return mapped;
  }

  async repair(req: RepairRequest): Promise<PlanResult> {
    const digest = summarizeObservation(req.observation);
    const result = await this.options.gateway.chatJSON({
      system: PLANNER_REPAIR_SYSTEM_PROMPT,
      user: buildRepairUserMessage(req, digest),
      schemaName: "task_plan_repair",
      schema: PlannerOutputSchema,
      temperature: 0,
      timeoutMs: PLANNER_TIMEOUT_MS,
    });
    this.options.logger?.(
      `[planner] task_plan_repair output\n${JSON.stringify(result.data, null, 2)}`,
    );
    return this.toPlanResult(result.data);
  }

  /** Maps and defensively re-validates the model output into a PlanResult. */
  private toPlanResult(output: PlannerOutput): PlanResult {
    const parsed = PlannerOutputSchema.safeParse(output);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue && issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      throw new Error(`Planner returned invalid output: ${path}${issue?.message ?? "schema validation failed"}`);
    }

    const value = parsed.data;
    if (value.status === "ready" && value.plan) {
      return { kind: "plan", plan: value.plan };
    }

    // needs_input, or an inconsistent "ready" without a plan: ask for input.
    const questions = value.questions.length > 0 ? value.questions : [FALLBACK_QUESTION];
    return { kind: "clarify", questions };
  }
}
