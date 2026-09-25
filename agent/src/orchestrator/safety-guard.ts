import type { BrowserAction, PageElement } from "@remora/protocol";
import type { GuardDecision, GuardInput, SafetyGuard } from "../core/contracts.js";
import type { ApprovalRule, RiskLevel } from "../schemas/domain.js";

const DESTRUCTIVE_NAME =
  /\b(delete|remove|terminate|destroy|drop|disable|revoke|deactivate|close account)\b/i;
const MUTATE_NAME =
  /\b(create|submit|save|confirm|apply|launch|start|enable|publish|send|deploy|update|modify|put|post|run|invoke|sign)\b/i;
const SENSITIVE_NAME =
  /pass(word)?|secret|token|api[-_ ]?key|access[-_ ]?key|private[-_ ]?key|otp|mfa|cvv|cvc|credential/i;

function actionTargetRef(action: BrowserAction): string | null {
  return "ref" in action && typeof action.ref === "string" ? action.ref : null;
}

function ruleMatches(
  rule: ApprovalRule,
  action: BrowserAction,
  element: PageElement | undefined,
  url: string,
): boolean {
  const when = rule.when;
  if (!when) return true;
  if (when.actionKinds && !when.actionKinds.includes(action.kind)) return false;
  if (when.targetRole !== undefined) {
    if (!element || element.role !== when.targetRole) return false;
  }
  if (when.targetNamePattern !== undefined) {
    if (!element) return false;
    let re: RegExp;
    try {
      re = new RegExp(when.targetNamePattern, "i");
    } catch {
      return false;
    }
    if (!re.test(element.name)) return false;
  }
  if (when.pageUrlPattern !== undefined) {
    let re: RegExp;
    try {
      re = new RegExp(when.pageUrlPattern, "i");
    } catch {
      return false;
    }
    if (!re.test(url)) return false;
  }
  return true;
}

/**
 * Default safety guard.
 *
 * Order of checks: stale/unsafe targets -> sensitive inputs -> destructive
 * actions (always blocked in v0) -> explicit planner approval rules ->
 * heuristic risk classification.
 */
export class DefaultSafetyGuard implements SafetyGuard {
  check({ action, observation, plan }: GuardInput): GuardDecision {
    const ref = actionTargetRef(action);
    let element: PageElement | undefined;
    if (ref !== null) {
      element = observation.elements.find((e) => e.ref === ref);
      if (!element) {
        return {
          decision: "block",
          risk: "read",
          reason: `Target ${ref} is not part of the current page observation (stale or unknown ref).`,
        };
      }
    }

    if (element) {
      if (!element.visible) {
        return {
          decision: "block",
          risk: "read",
          reason: `Target "${element.name}" is not visible.`,
        };
      }
      if (!element.enabled) {
        return {
          decision: "block",
          risk: "read",
          reason: `Target "${element.name}" is disabled.`,
        };
      }
      if (
        element.sensitive &&
        (action.kind === "type" || action.kind === "select")
      ) {
        return {
          decision: "block",
          risk: "draft",
          reason: `Target "${element.name}" is a sensitive field; credential entry is handed back to the user in v0.`,
        };
      }
      if (action.kind === "type" && element.inputType === "password") {
        return {
          decision: "block",
          risk: "draft",
          reason: `Target "${element.name}" is a password field.`,
        };
      }
    }

    // Explicit planner rules take precedence over heuristics.
    for (const rule of plan.approvalRules) {
      if (!ruleMatches(rule, action, element, observation.tab.url)) continue;
      if (rule.risk === "destructive") {
        return {
          decision: "block",
          risk: "destructive",
          reason: `Blocked by approval rule "${rule.description}" (destructive actions are disabled in v0).`,
          rule,
        };
      }
      if (rule.risk === "mutate") {
        return {
          decision: "require_approval",
          risk: "mutate",
          reason: rule.description,
          rule,
        };
      }
      return { decision: "allow", risk: rule.risk, reason: rule.description, rule };
    }

    const name = element?.name ?? "";
    if (element && DESTRUCTIVE_NAME.test(name)) {
      return {
        decision: "block",
        risk: "destructive",
        reason: `"${name}" looks destructive; destructive actions are disabled in v0.`,
      };
    }

    let risk: RiskLevel = "read";
    if (action.kind === "type" || action.kind === "select") risk = "draft";
    if (action.kind === "click" && element && MUTATE_NAME.test(name)) risk = "mutate";

    if (risk === "mutate") {
      return {
        decision: "require_approval",
        risk,
        reason: `Clicking "${name}" may change remote state.`,
      };
    }

    if (SENSITIVE_NAME.test(name) && (action.kind === "type" || action.kind === "click")) {
      return {
        decision: "block",
        risk: "draft",
        reason: `"${name}" looks credential-related; handled by the user in v0.`,
      };
    }

    return { decision: "allow", risk, reason: "No mutating or destructive effect detected." };
  }
}
