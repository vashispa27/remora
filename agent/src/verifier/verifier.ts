/**
 * Generative verifier. Compares milestone criteria with observed evidence and
 * returns SATISFIED | NOT_SATISFIED | PENDING | AMBIGUOUS with citations.
 *
 * OWNER: planner/verifier subagent.
 */
import type {
  FinalVerificationRequest,
  MilestoneVerificationRequest,
  ModelGateway,
  Verifier,
} from "../core/contracts.js";
import { VerificationSchema, type Verification } from "../schemas/domain.js";
import { summarizeObservation } from "../planner/observationDigest.js";
import {
  FINAL_VERIFIER_SYSTEM_PROMPT,
  MILESTONE_VERIFIER_SYSTEM_PROMPT,
  buildFinalVerificationUserMessage,
  buildMilestoneVerificationUserMessage,
} from "./prompts.js";

export interface GenerativeVerifierOptions {
  gateway: ModelGateway;
  /** Upper bound on elements included in each observation digest. */
  maxElements?: number;
  /** Upper bound on text length per field in each observation digest. */
  maxText?: number;
  /** Opt-in local debugging: receives each verification result. */
  logger?: (line: string) => void;
}

const VERIFIER_TIMEOUT_MS = 90_000;

const DEFAULT_MAX_ELEMENTS = 120;
const DEFAULT_MAX_TEXT = 160;

/** How many of the most recent observations the final verifier may consider. */
const MAX_FINAL_OBSERVATIONS = 3;

const CITATION_RETRY_INSTRUCTION =
  "Your previous response omitted evidence citations. Return the same judgment with at least one citation that names an element ref and a concrete observed fact.";

/** Returned when a SATISFIED/NOT_SATISFIED judgment still has no citations. */
function noCitationsVerification(): Verification {
  return {
    judgment: "AMBIGUOUS",
    citations: [],
    feedback: "Verifier returned no evidence citations.",
    summary: null,
  };
}

/** Returned when the model call fails or returns unusable output. */
function unusableVerification(): Verification {
  return {
    judgment: "AMBIGUOUS",
    citations: [],
    feedback: "Verifier could not evaluate the page evidence. Treating the result as unconfirmed.",
    summary: null,
  };
}

export class GenerativeVerifier implements Verifier {
  private readonly maxElements: number;
  private readonly maxText: number;

  constructor(private readonly options: GenerativeVerifierOptions) {
    this.maxElements = options.maxElements ?? DEFAULT_MAX_ELEMENTS;
    this.maxText = options.maxText ?? DEFAULT_MAX_TEXT;
  }

  async verifyMilestone(req: MilestoneVerificationRequest): Promise<Verification> {
    const digest = summarizeObservation(req.observation, this.maxElements, this.maxText);
    const user = buildMilestoneVerificationUserMessage(req, digest);
    return this.runVerification(MILESTONE_VERIFIER_SYSTEM_PROMPT, user, "verification");
  }

  async verifyFinal(req: FinalVerificationRequest): Promise<Verification> {
    const recent = req.observations.slice(-MAX_FINAL_OBSERVATIONS).reverse();
    const digests = recent.map((observation) =>
      summarizeObservation(observation, this.maxElements, this.maxText),
    );
    const user = buildFinalVerificationUserMessage(req, digests);
    return this.runVerification(FINAL_VERIFIER_SYSTEM_PROMPT, user, "final_verification");
  }

  /**
   * Runs one verification, retrying once when a decisive judgment lacks
   * citations. Never throws: unusable output becomes AMBIGUOUS.
   */
  private async runVerification(
    system: string,
    user: string,
    schemaName: string,
  ): Promise<Verification> {
    let verification = await this.call(system, user, schemaName);
    if (verification === null) return unusableVerification();
    this.options.logger?.(
      `[verifier] ${schemaName}\n${JSON.stringify(verification, null, 2)}`,
    );

    if (this.isDecisive(verification) && verification.citations.length === 0) {
      this.options.logger?.(`[verifier] ${schemaName} has no citations; retrying once`);
      verification = await this.call(system, `${user}\n\n${CITATION_RETRY_INSTRUCTION}`, schemaName);
      if (verification === null) return unusableVerification();
      this.options.logger?.(
        `[verifier] ${schemaName} retry result\n${JSON.stringify(verification, null, 2)}`,
      );
      if (this.isDecisive(verification) && verification.citations.length === 0) {
        return noCitationsVerification();
      }
    }

    return verification;
  }

  /** Decisive judgments are the only ones that require citations. */
  private isDecisive(verification: Verification): boolean {
    return verification.judgment === "SATISFIED" || verification.judgment === "NOT_SATISFIED";
  }

  /** One model call. Returns null on transport failure or invalid output. */
  private async call(
    system: string,
    user: string,
    schemaName: string,
  ): Promise<Verification | null> {
    try {
      const result = await this.options.gateway.chatJSON({
        system,
        user,
        schemaName,
        schema: VerificationSchema,
        temperature: 0,
        timeoutMs: VERIFIER_TIMEOUT_MS,
      });
      const parsed = VerificationSchema.safeParse(result.data);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }
}
