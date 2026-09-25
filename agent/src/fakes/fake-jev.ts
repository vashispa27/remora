/**
 * Deterministic fake JEV selector. Walks a scripted action list for the
 * DynamoDB fixture so the orchestrator loop can be exercised without models.
 *
 * OWNER: fakes subagent.
 */
import type { JevContext, JevSelection, JevSelector } from "../core/contracts.js";
import type { JevAction } from "../schemas/domain.js";

export interface FakeJevOptions {
  /** milestoneId -> ordered proposals. The last entry should be milestone_done. */
  script?: Record<string, JevAction[]>;
}

/** Raw step before the shared confidence/probabilities/rationale fields. */
type JevStep =
  | { kind: "click"; ref: string }
  | { kind: "type_text"; ref: string; inputKey: string }
  | { kind: "select"; ref: string; option: string }
  | { kind: "scroll"; direction: "up" | "down" }
  | { kind: "wait" }
  | { kind: "milestone_done" }
  | { kind: "blocked"; reason: string };

function decorate(step: JevStep, n: number): JevAction {
  return {
    ...step,
    confidence: 0.99,
    probabilities: null,
    rationale: `fake JEV step ${n}`,
  } as JevAction;
}

/**
 * Default script keyed by milestone id. Refs are stable within each fixture
 * page state: home e2 opens the form, form e2/e3/e4 fill the fields, form e6
 * submits.
 */
const DEFAULT_SCRIPT: Record<string, JevAction[]> = {
  m1: [
    decorate({ kind: "click", ref: "e2" }, 1),
    decorate({ kind: "milestone_done" }, 2),
  ],
  m2: [
    decorate({ kind: "type_text", ref: "e2", inputKey: "tableName" }, 1),
    decorate({ kind: "type_text", ref: "e3", inputKey: "partitionKey" }, 2),
    decorate({ kind: "select", ref: "e4", option: "String" }, 3),
    decorate({ kind: "milestone_done" }, 4),
  ],
  m3: [
    decorate({ kind: "click", ref: "e6" }, 1),
    decorate({ kind: "milestone_done" }, 2),
  ],
};

export class FakeJevSelector implements JevSelector {
  /** milestoneId -> next index into that milestone's script. */
  private readonly cursors = new Map<string, number>();

  constructor(private readonly options: FakeJevOptions = {}) {}

  /** Clears per-milestone cursors so a new run replays from the start. */
  reset(): void {
    this.cursors.clear();
  }

  async select(ctx: JevContext): Promise<JevSelection> {
    const milestoneId = ctx.milestone.id;
    const script = this.options.script ?? DEFAULT_SCRIPT;
    const steps = script[milestoneId];
    const cursor = this.cursors.get(milestoneId) ?? 0;

    if (!steps || cursor >= steps.length) {
      return {
        action: {
          kind: "blocked",
          reason: `no fake script for milestone ${milestoneId}`,
          confidence: 0,
          probabilities: null,
          rationale: null,
        },
        usage: null,
      };
    }

    this.cursors.set(milestoneId, cursor + 1);
    return { action: steps[cursor], usage: null };
  }
}
