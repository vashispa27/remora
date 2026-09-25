/**
 * Domain schemas owned by the agent. These describe the task plan, JEV action
 * proposals, verifier judgments, and run status. Model IDs are never embedded
 * here; everything model-facing is strict JSON Schema generated from these
 * zod schemas.
 */
import { z } from "zod";

export const RiskLevel = z.enum(["read", "draft", "mutate", "destructive"]);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const ActionKind = z.enum(["click", "type", "select", "scroll", "wait"]);
export type ActionKind = z.infer<typeof ActionKind>;

export const MilestoneSchema = z.object({
  id: z.string().min(1),
  goal: z.string().min(1),
  completion: z.array(z.string().min(1)).min(1),
});
export type Milestone = z.infer<typeof MilestoneSchema>;

export const ApprovalRuleSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  risk: RiskLevel,
  when: z
    .object({
      actionKinds: z.array(ActionKind).optional(),
      targetNamePattern: z.string().optional(),
      targetRole: z.string().optional(),
      pageUrlPattern: z.string().optional(),
    })
    .optional(),
});
export type ApprovalRule = z.infer<typeof ApprovalRuleSchema>;

export const TaskPlanSchema = z.object({
  goal: z.string().min(1),
  inputs: z.record(z.string(), z.string()),
  milestones: z.array(MilestoneSchema).min(1),
  finalCriteria: z.array(z.string().min(1)),
  approvalRules: z.array(ApprovalRuleSchema),
});
export type TaskPlan = z.infer<typeof TaskPlanSchema>;

export const ClarifyQuestionSchema = z.object({
  key: z.string().min(1),
  question: z.string().min(1),
});
export type ClarifyQuestion = z.infer<typeof ClarifyQuestionSchema>;

/** Raw shape the planner model must return (converted to JSON Schema). */
export const PlannerOutputSchema = z.object({
  status: z.enum(["ready", "needs_input"]),
  questions: z.array(ClarifyQuestionSchema),
  plan: TaskPlanSchema.nullable(),
});
export type PlannerOutput = z.infer<typeof PlannerOutputSchema>;

export const JevBaseFields = {
  confidence: z.number().min(0).max(1),
  probabilities: z.record(z.string(), z.number().min(0).max(1)).nullable(),
  rationale: z.string().nullable(),
};

export const JevActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("click"), ref: z.string(), ...JevBaseFields }),
  z.object({
    kind: z.literal("type_text"),
    ref: z.string(),
    inputKey: z.string(),
    ...JevBaseFields,
  }),
  z.object({ kind: z.literal("select"), ref: z.string(), option: z.string(), ...JevBaseFields }),
  z.object({ kind: z.literal("scroll"), direction: z.enum(["up", "down"]), ...JevBaseFields }),
  z.object({ kind: z.literal("wait"), ...JevBaseFields }),
  z.object({ kind: z.literal("milestone_done"), ...JevBaseFields }),
  z.object({ kind: z.literal("blocked"), reason: z.string(), ...JevBaseFields }),
]);
export type JevAction = z.infer<typeof JevActionSchema>;

export const VerificationSchema = z.object({
  judgment: z.enum(["SATISFIED", "NOT_SATISFIED", "PENDING", "AMBIGUOUS"]),
  citations: z.array(
    z.object({
      ref: z.string().nullable(),
      fact: z.string().min(1),
    }),
  ),
  feedback: z.string().nullable(),
  summary: z.string().nullable(),
});
export type Verification = z.infer<typeof VerificationSchema>;

export const RunStatus = z.enum([
  "planning",
  "needs_input",
  "running",
  "awaiting_approval",
  "replanning",
  "completed",
  "failed",
  "cancelled",
]);
export type RunStatus = z.infer<typeof RunStatus>;
