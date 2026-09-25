/**
 * Maps orchestrator events to the Mac-facing control event union.
 *
 * Approval round-trips are handled by the control server's approval gate, so
 * `approval_requested`/`approval_resolved` map to null here to avoid duplicates.
 */
import type { PageElement, PageObservation } from "@remora/protocol";
import type { ControlEvent, ControlTarget } from "@remora/protocol/control";
import type { OrchestratorEvent } from "../core/contracts.js";

export interface MapperContext {
  lastObservation?: PageObservation;
}

function elementFor(ref: string | undefined, ctx: MapperContext): PageElement | undefined {
  if (!ref) return undefined;
  return ctx.lastObservation?.elements.find((element) => element.ref === ref);
}

function targetFor(
  element: PageElement | undefined,
  url: string | undefined,
): ControlTarget | null {
  if (!element) return null;
  return {
    ref: element.ref,
    role: element.role,
    name: element.name,
    url: url ?? null,
    rect: element.rect ?? null,
  };
}

export function describeJevAction(event: Extract<OrchestratorEvent, { type: "proposal" }>): string {
  const { proposal } = event;
  switch (proposal.kind) {
    case "click":
      return `click ${proposal.ref}`;
    case "type_text":
      return `type ${proposal.inputKey} into ${proposal.ref}`;
    case "select":
      return `select "${proposal.option}" in ${proposal.ref}`;
    case "scroll":
      return `scroll ${proposal.direction}`;
    case "wait":
      return "wait";
    case "milestone_done":
      return "milestone done";
    case "blocked":
      return `blocked: ${proposal.reason}`;
  }
}

export function describeBrowserAction(
  event: Extract<OrchestratorEvent, { type: "action_executed" }>,
): string {
  const { action } = event;
  switch (action.kind) {
    case "click":
      return `click ${action.ref}`;
    case "type":
      return `type ${action.value.length} chars into ${action.ref}`;
    case "select":
      return `select "${action.option}" in ${action.ref}`;
    case "scroll":
      return `scroll ${action.direction}`;
    case "wait":
      return `wait ${action.ms} ms`;
  }
}

/** Returns null for events the control server handles itself. */
export function mapOrchestratorEvent(
  event: OrchestratorEvent,
  ctx: MapperContext,
): ControlEvent | null {
  switch (event.type) {
    case "status":
      return { type: "status", status: event.status, detail: event.detail ?? null };

    case "plan":
      return {
        type: "plan",
        goal: event.plan.goal,
        milestones: event.plan.milestones.map((milestone) => ({
          id: milestone.id,
          goal: milestone.goal,
          completion: milestone.completion,
        })),
      };

    case "milestone_started":
      return {
        type: "milestone",
        id: event.milestone.id,
        index: event.index,
        total: event.total,
        goal: event.milestone.goal,
      };

    case "observation": {
      ctx.lastObservation = event.observation;
      return {
        type: "observation",
        url: event.observation.tab.url,
        title: event.observation.tab.title,
        elementCount: event.observation.elements.length,
        snapshotId: event.observation.snapshotId,
        target: null,
      };
    }

    case "proposal": {
      const element = elementFor(
        "ref" in event.proposal ? event.proposal.ref : undefined,
        ctx,
      );
      return {
        type: "proposal",
        actionKind: event.proposal.kind,
        summary: describeJevAction(event),
        confidence: event.proposal.confidence,
        target: targetFor(element, ctx.lastObservation?.tab.url),
      };
    }

    case "guard":
      return {
        type: "guard",
        decision: event.decision,
        risk: event.risk,
        reason: event.reason,
      };

    case "action_executed":
      return {
        type: "action",
        actionKind: event.action.kind,
        summary: describeBrowserAction(event),
        status: event.outcome.status,
        effect: event.outcome.effect ?? null,
      };

    case "verification":
      return {
        type: "verification",
        scope: event.scope,
        judgment: event.verification.judgment,
        summary: event.verification.summary ?? null,
        feedback: event.verification.feedback ?? null,
      };

    case "usage":
      return {
        type: "usage",
        model: event.usage.model,
        inputTokens: event.usage.inputTokens,
        outputTokens: event.usage.outputTokens,
        costUsd: event.usage.costUsd,
      };

    case "error":
      return { type: "error", code: event.code, message: event.message };

    case "clarification":
    case "approval_requested":
    case "approval_resolved":
    case "finished":
      return null;
  }
}
