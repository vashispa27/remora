/**
 * Verifier prompts. Evidence rules live here so every verification call is
 * consistent and auditable.
 *
 * OWNER: planner/verifier subagent.
 */
import type { FinalVerificationRequest, MilestoneVerificationRequest } from "../core/contracts.js";

const VERIFIER_RULES = `Judgments:
- SATISFIED: every completion criterion is directly supported by visible facts in the observation.
- NOT_SATISFIED: the page is stable and one or more completion criteria are clearly unmet.
- PENDING: the page appears to be mid-update (a loading indicator, a disabled submitting control, or a transient state). Check again rather than deciding.
- AMBIGUOUS: the evidence conflicts, is insufficient, or cannot be confirmed from the observation.

Evidence rules:
- Judge ONLY the provided observation. Never rely on the agent's intent, recent actions, the milestone goal wording, or what should logically have happened.
- Every SATISFIED or NOT_SATISFIED judgment must cite at least one element ref and a concrete fact (element name, value, text, or URL).
- When the judgment is not SATISFIED, feedback must name exactly which completion criteria are unmet.
- Values marked sensitive are redacted as [redacted]. Never invent a value for a redacted field and never treat a redaction as a match on its own.
- Return only JSON matching the provided schema.`;

export const MILESTONE_VERIFIER_SYSTEM_PROMPT = `You are Remora's verifier. Decide whether a browser milestone's completion criteria are met using ONLY the currently observed page evidence.

${VERIFIER_RULES}`;

export const FINAL_VERIFIER_SYSTEM_PROMPT = `You are Remora's verifier performing final task verification. Decide whether the whole task's criteria are met using ONLY the collected page observations. Criteria include the plan's final criteria and every milestone's completion criteria.

${VERIFIER_RULES}`;

function renderCompleted(completedMilestones: string[]): string {
  if (completedMilestones.length === 0) return "(none yet)";
  return completedMilestones.map((entry) => `- ${entry}`).join("\n");
}

/** Builds the user message for a milestone verification call. */
export function buildMilestoneVerificationUserMessage(
  req: MilestoneVerificationRequest,
  observationDigest: string,
): string {
  const criteria = req.milestone.completion.map((criterion, index) => `${index + 1}. ${criterion}`);
  return [
    `Overall goal: ${req.plan.goal}`,
    `Milestone ${req.milestone.id}: ${req.milestone.goal}`,
    "Completion criteria:",
    ...criteria,
    "",
    "Completed milestones so far:",
    renderCompleted(req.completedMilestones),
    "",
    "Current observation (bounded digest; sensitive values redacted):",
    observationDigest,
  ].join("\n");
}

/** Builds the user message for a final verification call. */
export function buildFinalVerificationUserMessage(
  req: FinalVerificationRequest,
  observationDigests: string[],
): string {
  const criteria: string[] = [];
  req.plan.finalCriteria.forEach((criterion, index) => {
    criteria.push(`F${index + 1}. ${criterion}`);
  });
  for (const milestone of req.plan.milestones) {
    for (const criterion of milestone.completion) {
      criteria.push(`${milestone.id}. ${criterion}`);
    }
  }

  const observations: string[] = [];
  observationDigests.forEach((digest, index) => {
    observations.push(`--- Observation ${index + 1} (most recent first) ---`, digest);
  });

  return [
    `Overall goal: ${req.plan.goal}`,
    "Final criteria (plan final criteria plus every milestone completion criterion):",
    ...criteria,
    "",
    "Completed milestones:",
    renderCompleted(req.completedMilestones),
    "",
    "Collected observations (bounded digests; sensitive values redacted):",
    ...observations,
  ].join("\n");
}
