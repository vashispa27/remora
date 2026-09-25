import { newId } from "@remora/protocol";
import type { BrowserAction, PageElement, PageObservation } from "@remora/protocol";
import type { AgentConfig } from "../config.js";
import type {
  ActionOutcome,
  ApprovalRequest,
  BrowserChannel,
  EventSink,
  JevSelector,
  ModelGateway,
  ModelUsage,
  Orchestrator,
  OrchestratorEvent,
  Planner,
  RecentAction,
  RunOptions,
  RunResult,
  SafetyGuard,
  Verifier,
} from "../core/contracts.js";
import type { JevAction, Milestone, TaskPlan } from "../schemas/domain.js";
import { DefaultSafetyGuard } from "./safety-guard.js";

export interface OrchestratorDeps {
  config: AgentConfig;
  gateway: ModelGateway;
  planner: Planner;
  jev: JevSelector;
  verifier: Verifier;
  browser: BrowserChannel;
  guard?: SafetyGuard;
  logger?: (line: string) => void;
}

class RunFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RunFailure";
  }
}

class RunCancelled extends Error {
  constructor(message = "Run cancelled") {
    super(message);
    this.name = "RunCancelled";
  }
}

const MAX_RECENT_ACTIONS = 12;
const MAX_KEPT_OBSERVATIONS = 6;

export class DefaultOrchestrator implements Orchestrator {
  private readonly config: AgentConfig;
  private readonly gateway: ModelGateway;
  private readonly planner: Planner;
  private readonly jev: JevSelector;
  private readonly verifier: Verifier;
  private readonly browser: BrowserChannel;
  private readonly guard: SafetyGuard;
  private readonly logger: (line: string) => void;
  private readonly controller = new AbortController();

  constructor(deps: OrchestratorDeps) {
    this.config = deps.config;
    this.gateway = deps.gateway;
    this.planner = deps.planner;
    this.jev = deps.jev;
    this.verifier = deps.verifier;
    this.browser = deps.browser;
    this.guard = deps.guard ?? new DefaultSafetyGuard();
    this.logger = deps.logger ?? (() => {});
  }

  cancel(reason = "Cancelled by user"): void {
    this.controller.abort(new RunCancelled(reason));
  }

  async run(options: RunOptions): Promise<RunResult> {
    const trace: OrchestratorEvent[] = [];
    const usage: ModelUsage[] = [];
    const emit = (event: OrchestratorEvent): void => {
      trace.push(event);
      options.events?.(event);
    };
    const collectUsage = (): void => {
      const drained = this.gateway.drainUsage();
      for (const u of drained) {
        usage.push(u);
        emit({ type: "usage", usage: u });
      }
    };

    const aborted = new Promise<never>((_, reject) => {
      const onAbort = (): void => reject(new RunCancelled());
      if (options.signal) {
        if (options.signal.aborted) onAbort();
        else options.signal.addEventListener("abort", onAbort, { once: true });
      }
      if (this.controller.signal.aborted) onAbort();
      else this.controller.signal.addEventListener("abort", onAbort, { once: true });
    });

    const finish = (result: RunResult): RunResult => {
      emit({
        type: "finished",
        status: result.status,
        summary: result.summary,
        errorCode: result.errorCode,
      });
      return { ...result, trace, usage };
    };

    try {
      const result = await Promise.race([this.executeRun(options, emit, usage, collectUsage), aborted]);
      return finish(result);
    } catch (error) {
      if (error instanceof RunCancelled || (error instanceof Error && error.name === "AbortError")) {
        return finish({
          status: "cancelled",
          summary: "Run cancelled.",
          milestonesCompleted: this.completedSnapshot,
          trace,
          usage,
        });
      }
      const code = error instanceof RunFailure ? error.code : "INTERNAL_ERROR";
      const message = error instanceof Error ? error.message : String(error);
      emit({ type: "error", code, message });
      this.logger(`[error] ${code}: ${message}`);
      return finish({
        status: "failed",
        summary: message,
        milestonesCompleted: this.completedSnapshot,
        trace,
        usage,
        errorCode: code,
      });
    }
  }

  private completedSnapshot: string[] = [];

  private async executeRun(
    options: RunOptions,
    emit: EventSink,
    usage: ModelUsage[],
    collectUsage: () => void,
  ): Promise<RunResult> {
    const { limits, observation: observationLimits } = this.config;
    const runId = newId();

    const throwIfCancelled = (): void => {
      if (this.controller.signal.aborted || options.signal?.aborted) {
        throw new RunCancelled();
      }
    };

    emit({ type: "status", status: "planning" });
    this.logger("[loop] planning");
    const planResult = await this.planner.plan({
      prompt: options.prompt,
      retrievalContext: options.retrievalContext,
    });
    collectUsage();
    throwIfCancelled();

    if (planResult.kind === "clarify") {
      emit({ type: "status", status: "needs_input" });
      emit({ type: "clarification", questions: planResult.questions });
      return {
        status: "needs_input",
        summary: "Planner needs more input before a plan can be created.",
        questions: planResult.questions,
        milestonesCompleted: [],
        trace: [],
        usage,
      };
    }

    let plan: TaskPlan = planResult.plan;
    emit({ type: "plan", plan });
    this.logger(`[loop] plan: ${plan.goal} (${plan.milestones.length} milestones)`);

    const completed: string[] = [];
    const observations: PageObservation[] = [];
    const recentActions: RecentAction[] = [];
    let totalSteps = 0;

    for (let index = 0; index < plan.milestones.length; index += 1) {
      let milestone = plan.milestones[index];
      emit({
        type: "milestone_started",
        milestone,
        index: index + 1,
        total: plan.milestones.length,
      });
      this.logger(`[loop] milestone ${milestone.id}: ${milestone.goal}`);

      let milestoneSteps = 0;
      let repairs = 0;
      let feedback: string | undefined;
      let lastSignature: string | undefined;
      let progressSignature: string | undefined;
      let repeated = 0;
      let advanced = false;

      while (!advanced) {
        throwIfCancelled();
        if (milestoneSteps >= limits.maxStepsPerMilestone) {
          throw new RunFailure(
            "BUDGET_EXCEEDED",
            `Milestone ${milestone.id} exceeded ${limits.maxStepsPerMilestone} steps.`,
          );
        }
        if (totalSteps >= limits.maxTotalSteps) {
          throw new RunFailure("BUDGET_EXCEEDED", `Run exceeded ${limits.maxTotalSteps} total steps.`);
        }
        milestoneSteps += 1;
        totalSteps += 1;

        const observation = await this.browser.observe({
          maxElements: observationLimits.maxElements,
          maxTextLength: observationLimits.maxTextLength,
        });
        throwIfCancelled();
        observations.push(observation);
        if (observations.length > MAX_KEPT_OBSERVATIONS) observations.shift();
        emit({ type: "observation", observation });

        const selection = await this.jev.select({
          goal: plan.goal,
          inputs: plan.inputs,
          milestone,
          completedMilestones: completed,
          observation,
          recentActions,
          verifierFeedback: feedback,
        });
        collectUsage();
        throwIfCancelled();
        const proposal = selection.action;
        const stepId = newId();
        emit({ type: "proposal", stepId, proposal });
        this.logger(
          `[jev] ${proposal.kind}` +
            (proposal.kind === "click" || proposal.kind === "type_text" || proposal.kind === "select"
              ? ` ${proposal.ref}` +
                (proposal.kind === "type_text" ? ` inputKey=${proposal.inputKey}` : "") +
                (proposal.kind === "select" ? ` option=${proposal.option}` : "")
              : "") +
            ` confidence=${proposal.confidence.toFixed(2)}`,
        );

        if (proposal.kind === "milestone_done") {
          const verification = await this.verifier.verifyMilestone({
            plan,
            milestone,
            observation,
            completedMilestones: completed,
          });
          collectUsage();
          throwIfCancelled();
          emit({ type: "verification", scope: "milestone", verification });
          if (verification.judgment === "SATISFIED") {
            completed.push(`${milestone.id}: ${milestone.goal}`);
            this.completedSnapshot = [...completed];
            this.logger(`[verify] ${milestone.id} SATISFIED`);
            advanced = true;
            break;
          }
          feedback = verification.feedback ?? "Verifier did not confirm milestone completion.";
          this.logger(`[verify] ${milestone.id} ${verification.judgment}: ${feedback}`);
          if (progressSignature === `verify:${milestone.id}:${feedback}`) {
            repeated += 1;
          } else {
            progressSignature = `verify:${milestone.id}:${feedback}`;
            repeated = 0;
          }
          if (repeated >= 1) {
            throw new RunFailure(
              "NO_PROGRESS",
              `Verifier rejected milestone ${milestone.id} twice with the same feedback: ${feedback}`,
            );
          }
          continue;
        }

        if (proposal.kind === "blocked" || proposal.confidence < limits.confidenceThreshold) {
          const reason =
            proposal.kind === "blocked"
              ? proposal.reason
              : `JEV confidence ${proposal.confidence.toFixed(2)} is below threshold ${limits.confidenceThreshold}`;
          this.logger(`[jev] blocked: ${reason}`);
          if (repairs >= limits.maxRepairAttempts) {
            throw new RunFailure("BLOCKED", `Agent is blocked: ${reason}`);
          }
          repairs += 1;
          emit({ type: "status", status: "replanning", detail: reason });
          const repaired = await this.planner.repair({
            plan,
            activeMilestoneId: milestone.id,
            reason,
            observation,
          });
          collectUsage();
          throwIfCancelled();
          if (repaired.kind === "clarify") {
            emit({ type: "clarification", questions: repaired.questions });
            return {
              status: "needs_input",
              summary: `Planner needs input to recover: ${reason}`,
              plan,
              questions: repaired.questions,
              milestonesCompleted: completed,
              trace: [],
              usage,
            };
          }
          plan = repaired.plan;
          emit({ type: "plan", plan });
          milestone = plan.milestones.find((m) => m.id === milestone.id) ?? plan.milestones[index];
          if (!milestone) {
            throw new RunFailure("BLOCKED", `Repaired plan no longer contains an active milestone.`);
          }
          milestoneSteps = 0;
          feedback = `Previous attempt was blocked: ${reason}. Continue with the repaired plan.`;
          lastSignature = undefined;
          progressSignature = undefined;
          repeated = 0;
          continue;
        }

        const browserAction = this.toBrowserAction(proposal, plan);
        const targetRef = "ref" in browserAction ? browserAction.ref : undefined;
        const targetElement =
          targetRef !== undefined ? this.findElement(observation, targetRef) : undefined;

        const guardDecision = this.guard.check({
          action: browserAction,
          observation,
          plan,
          milestone,
          inputs: plan.inputs,
        });
        emit({
          type: "guard",
          decision: guardDecision.decision,
          reason: guardDecision.reason,
          risk: guardDecision.risk,
        });
        if (guardDecision.decision === "block") {
          throw new RunFailure("POLICY_BLOCKED", guardDecision.reason);
        }

        let action = browserAction;
        let snapshotId = observation.snapshotId;

        if (guardDecision.decision === "require_approval") {
          emit({ type: "status", status: "awaiting_approval" });
          const request: ApprovalRequest = {
            runId,
            stepId,
            plan,
            milestone,
            action: browserAction,
            target: targetElement
              ? {
                  ref: targetElement.ref,
                  role: targetElement.role,
                  name: targetElement.name,
                  rect: targetElement.rect,
                }
              : undefined,
            risk: guardDecision.risk,
            inputs: plan.inputs,
            reason: guardDecision.reason,
            rule: guardDecision.rule,
            url: observation.tab.url,
          };
          emit({ type: "approval_requested", request });
          const decision = await options.approvalGate.request(request);
          throwIfCancelled();
          emit({ type: "approval_resolved", decision });
          if (!decision.approved) {
            throw new RunFailure(
              "APPROVAL_DENIED",
              `User declined the ${guardDecision.risk} action: ${decision.reason ?? "no reason given"}.`,
            );
          }

          // Re-observe after approval before executing once (Task 9). Re-resolve
          // the target semantically; never act on the pre-approval snapshot.
          const fresh = await this.browser.observe({
            maxElements: observationLimits.maxElements,
            maxTextLength: observationLimits.maxTextLength,
          });
          throwIfCancelled();
          observations.push(fresh);
          emit({ type: "observation", observation: fresh });
          if (targetElement) {
            const matches = fresh.elements.filter(
              (e) =>
                e.role === targetElement.role &&
                e.name === targetElement.name &&
                e.visible &&
                e.enabled,
            );
            if (matches.length !== 1) {
              throw new RunFailure(
                "ELEMENT_AMBIGUOUS",
                `After approval, target "${targetElement.name}" matched ${matches.length} elements; refusing to act.`,
              );
            }
            action = this.withRef(browserAction, matches[0].ref);
          }
          snapshotId = fresh.snapshotId;
          emit({ type: "status", status: "running" });
        }

        const outcome = await this.browser.execute({
          runId,
          stepId,
          snapshotId,
          action,
          timeoutMs: limits.actionTimeoutMs,
        });
        throwIfCancelled();
        emit({ type: "action_executed", stepId, action, outcome });
        this.logger(`[action] ${this.describeOutcome(action, outcome)}`);

        recentActions.push({
          stepId,
          actionKind: action.kind,
          targetRef: "ref" in action ? action.ref : undefined,
          targetName: targetElement?.name,
          inputKey: proposal.kind === "type_text" ? proposal.inputKey : undefined,
          option: action.kind === "select" ? action.option : undefined,
          status: outcome.status,
          effect: outcome.effect,
        });
        if (recentActions.length > MAX_RECENT_ACTIONS) recentActions.shift();

        if (outcome.status === "uncertain" && guardDecision.risk === "mutate") {
          throw new RunFailure(
            "ACTION_RESULT_UNCERTAIN",
            `A mutating action returned an uncertain result. Remora will not retry it automatically. ${outcome.error?.message ?? ""}`,
          );
        }

        const signature = JSON.stringify(action);
        if (signature === lastSignature) repeated += 1;
        else {
          lastSignature = signature;
          repeated = 0;
        }
        if (repeated >= 2) {
          throw new RunFailure(
            "NO_PROGRESS",
            `The same action (${action.kind}) was proposed repeatedly without progress.`,
          );
        }

        if (outcome.status === "failed") {
          feedback = `Action failed: ${outcome.error?.message ?? "unknown failure"}. Try a different approach.`;
        } else {
          feedback = undefined;
        }
      }
    }

    emit({ type: "status", status: "running", detail: "final verification" });
    const finalVerification = await this.verifier.verifyFinal({
      plan,
      observations,
      completedMilestones: completed,
    });
    collectUsage();
    throwIfCancelled();
    emit({ type: "verification", scope: "final", verification: finalVerification });
    if (finalVerification.judgment !== "SATISFIED") {
      throw new RunFailure(
        "VERIFICATION_FAILED",
        finalVerification.feedback ??
          `Final verification returned ${finalVerification.judgment}.`,
      );
    }

    emit({ type: "status", status: "completed" });
    this.completedSnapshot = [...completed];
    return {
      status: "completed",
      summary: `Completed: ${plan.goal}`,
      plan,
      milestonesCompleted: completed,
      trace: [],
      usage,
    };
  }

  private toBrowserAction(proposal: JevAction, plan: TaskPlan): BrowserAction {
    switch (proposal.kind) {
      case "click":
        return { kind: "click", ref: proposal.ref };
      case "type_text": {
        const value = plan.inputs[proposal.inputKey];
        if (value === undefined || value === "") {
          throw new RunFailure(
            "INPUT_MISSING",
            `JEV requested input "${proposal.inputKey}" but the plan has no value for it.`,
          );
        }
        return { kind: "type", ref: proposal.ref, value };
      }
      case "select":
        return { kind: "select", ref: proposal.ref, option: proposal.option };
      case "scroll":
        return { kind: "scroll", direction: proposal.direction };
      case "wait":
        return { kind: "wait", ms: 500 };
      default:
        throw new RunFailure("INTERNAL_ERROR", `Cannot execute JEV action "${proposal.kind}".`);
    }
  }

  private withRef(action: BrowserAction, ref: string): BrowserAction {
    switch (action.kind) {
      case "click":
        return { kind: "click", ref };
      case "type":
        return { ...action, ref };
      case "select":
        return { ...action, ref };
      case "scroll":
        return { ...action, ref };
      default:
        return action;
    }
  }

  private findElement(observation: PageObservation, ref: string): PageElement | undefined {
    return observation.elements.find((e) => e.ref === ref);
  }

  private describeOutcome(action: BrowserAction, outcome: ActionOutcome): string {
    const target = "ref" in action ? ` ${action.ref}` : "";
    const effect = outcome.effect ? ` — ${outcome.effect}` : "";
    return `${action.kind}${target} -> ${outcome.status}${effect}`;
  }
}
