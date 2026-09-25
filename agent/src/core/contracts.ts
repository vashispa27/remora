/**
 * Agent-internal contracts. The orchestrator only depends on these interfaces;
 * real and fake implementations are interchangeable. Nothing here mentions a
 * concrete model, endpoint, or transport.
 */
import type { z } from "zod";
import type { BrowserAction, PageObservation, PageObserveRequestPayload, ProtocolErrorCode, ActionStatus } from "@remora/protocol";
import type {
  ClarifyQuestion,
  JevAction,
  Milestone,
  RiskLevel,
  RunStatus,
  TaskPlan,
  Verification,
  ApprovalRule,
} from "../schemas/domain.js";

// ---------------------------------------------------------------------------
// Model gateway
// ---------------------------------------------------------------------------

export interface ModelUsage {
  kind: "chat" | "decisions";
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

export interface ChatJsonRequest<T> {
  /** Defaults to the configured chat model. */
  model?: string;
  system: string;
  user: string;
  schemaName: string;
  schema: z.ZodType<T>;
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface ModelCallResult<T> {
  data: T;
  usage: ModelUsage;
}

export type DecisionQuestion =
  | { type: "noul"; instructions: string; criteria?: { true: string; false: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> | string[] }
  | { type: "score"; instructions: string; criteria: string[] };

export interface DecisionRequest {
  model?: string;
  state: unknown;
  questions: Record<string, DecisionQuestion>;
  timeoutMs?: number;
}

export type DecisionAnswer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; confidence?: number; probabilities?: Record<string, number> }
  | {
      type: "score";
      score: number;
      confidence?: number;
      probabilities?: Record<string, number>;
      legend?: Record<string, string>;
    };

export interface DecisionResponse {
  model: string;
  provider?: string;
  id?: string;
  answers: Record<string, DecisionAnswer>;
  usage: ModelUsage;
  raw?: unknown;
}

export interface ModelGateway {
  readonly chatModelId: string;
  readonly jevModelId: string;
  chatJSON<T>(req: ChatJsonRequest<T>): Promise<ModelCallResult<T>>;
  decide(req: DecisionRequest): Promise<DecisionResponse>;
  /** Returns and clears usage records accumulated since the last call. */
  drainUsage(): ModelUsage[];
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

export interface PlanRequest {
  prompt: string;
  /** Optional retrieved documentation snippets. Planning context only. */
  retrievalContext?: string[];
}

export type PlanResult =
  | { kind: "plan"; plan: TaskPlan }
  | { kind: "clarify"; questions: ClarifyQuestion[] };

export interface RepairRequest {
  plan: TaskPlan;
  activeMilestoneId: string;
  reason: string;
  observation: PageObservation;
}

export interface Planner {
  plan(req: PlanRequest): Promise<PlanResult>;
  /** Replans remaining milestones after JEV reports BLOCKED. */
  repair(req: RepairRequest): Promise<PlanResult>;
}

// ---------------------------------------------------------------------------
// JEV action selector
// ---------------------------------------------------------------------------

export interface RecentAction {
  stepId: string;
  actionKind: string;
  targetRef?: string;
  targetName?: string;
  inputKey?: string;
  option?: string;
  status: ActionStatus | "rejected" | "approval_denied";
  effect?: string;
}

export interface JevContext {
  goal: string;
  inputs: Record<string, string>;
  milestone: Milestone;
  completedMilestones: string[];
  observation: PageObservation;
  recentActions: RecentAction[];
  verifierFeedback?: string;
}

export interface JevSelection {
  action: JevAction;
  usage: ModelUsage | null;
}

export interface JevSelector {
  select(ctx: JevContext): Promise<JevSelection>;
}

// ---------------------------------------------------------------------------
// Verifier
// ---------------------------------------------------------------------------

export interface MilestoneVerificationRequest {
  plan: TaskPlan;
  milestone: Milestone;
  observation: PageObservation;
  completedMilestones: string[];
}

export interface FinalVerificationRequest {
  plan: TaskPlan;
  observations: PageObservation[];
  completedMilestones: string[];
}

export interface Verifier {
  verifyMilestone(req: MilestoneVerificationRequest): Promise<Verification>;
  verifyFinal(req: FinalVerificationRequest): Promise<Verification>;
}

// ---------------------------------------------------------------------------
// Browser channel
// ---------------------------------------------------------------------------

export interface ExecuteActionRequest {
  runId: string;
  stepId: string;
  snapshotId: string;
  action: BrowserAction;
  timeoutMs?: number;
}

export interface ActionOutcome {
  status: ActionStatus;
  effect?: string;
  error?: { code: ProtocolErrorCode; message: string; retryable?: boolean };
  observation?: PageObservation;
}

export interface BrowserChannel {
  observe(opts?: PageObserveRequestPayload): Promise<PageObservation>;
  execute(req: ExecuteActionRequest): Promise<ActionOutcome>;
  cancel(runId: string): Promise<void>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Approval gate
// ---------------------------------------------------------------------------

export interface ApprovalTarget {
  ref: string;
  role: string;
  name: string;
  /** Viewport-relative rect of the target, when known. */
  rect?: { x: number; y: number; width: number; height: number };
}

export interface ApprovalRequest {
  runId: string;
  stepId: string;
  plan: TaskPlan;
  milestone: Milestone;
  action: BrowserAction;
  target?: ApprovalTarget;
  risk: RiskLevel;
  inputs: Record<string, string>;
  reason: string;
  expectedEffect?: string;
  rule?: ApprovalRule;
  /** URL of the page the action applies to, when known. */
  url?: string;
}

export type ApprovalDecision = { approved: true } | { approved: false; reason?: string };

export interface ApprovalGate {
  request(req: ApprovalRequest): Promise<ApprovalDecision>;
}

// ---------------------------------------------------------------------------
// Events and run result
// ---------------------------------------------------------------------------

export type OrchestratorEvent =
  | { type: "status"; status: RunStatus; detail?: string }
  | { type: "plan"; plan: TaskPlan }
  | { type: "clarification"; questions: ClarifyQuestion[] }
  | { type: "milestone_started"; milestone: Milestone; index: number; total: number }
  | { type: "observation"; observation: PageObservation }
  | { type: "proposal"; stepId: string; proposal: JevAction }
  | { type: "verification"; scope: "milestone" | "final"; verification: Verification }
  | { type: "guard"; decision: "allow" | "require_approval" | "block"; reason: string; risk: RiskLevel }
  | { type: "approval_requested"; request: ApprovalRequest }
  | { type: "approval_resolved"; decision: ApprovalDecision }
  | { type: "action_executed"; stepId: string; action: BrowserAction; outcome: ActionOutcome }
  | { type: "usage"; usage: ModelUsage }
  | { type: "error"; code: string; message: string }
  | { type: "finished"; status: Exclude<RunStatus, "planning" | "running" | "awaiting_approval" | "replanning">; summary: string; errorCode?: string };

export type EventSink = (event: OrchestratorEvent) => void;

export interface RunOptions {
  prompt: string;
  retrievalContext?: string[];
  approvalGate: ApprovalGate;
  events?: EventSink;
  signal?: AbortSignal;
}

export interface RunResult {
  status: "completed" | "failed" | "cancelled" | "needs_input";
  summary: string;
  plan?: TaskPlan;
  questions?: ClarifyQuestion[];
  milestonesCompleted: string[];
  trace: OrchestratorEvent[];
  usage: ModelUsage[];
  errorCode?: string;
}

export interface Orchestrator {
  run(options: RunOptions): Promise<RunResult>;
  cancel(reason?: string): void;
}

// ---------------------------------------------------------------------------
// Safety guard
// ---------------------------------------------------------------------------

export interface GuardInput {
  action: BrowserAction;
  observation: PageObservation;
  plan: TaskPlan;
  milestone: Milestone;
  inputs: Record<string, string>;
}

export interface GuardDecision {
  decision: "allow" | "require_approval" | "block";
  risk: RiskLevel;
  reason: string;
  rule?: ApprovalRule;
}

export interface SafetyGuard {
  check(input: GuardInput): GuardDecision;
}
