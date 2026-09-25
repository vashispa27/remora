/**
 * Deterministic fake planner for Task 1's mocked multi-milestone run.
 * Defaults to the DynamoDB fixture plan. No network, no model.
 *
 * OWNER: fakes subagent.
 */
import type { PlanRequest, PlanResult, Planner, RepairRequest } from "../core/contracts.js";
import type { ClarifyQuestion, TaskPlan } from "../schemas/domain.js";

export interface FakePlannerOptions {
  plan?: TaskPlan;
  /** When set, the first plan() call returns these clarification questions. */
  clarifyOnce?: ClarifyQuestion[];
}

/**
 * The frozen DynamoDB demo plan. Mirrors the mock AWS fixture flow and the
 * single `mutate` approval rule for the final `Create table` submit.
 */
export const DEFAULT_DYNAMODB_PLAN: TaskPlan = {
  goal: "Create DynamoDB table remora-demo with partition key id",
  inputs: { tableName: "remora-demo", partitionKey: "id" },
  milestones: [
    {
      id: "m1",
      goal: "Open the Create table form",
      completion: ["The Create table form is visible with Table name and Partition key fields"],
    },
    {
      id: "m2",
      goal: "Enter the table name and partition key",
      completion: ["The Table name field contains remora-demo", "The Partition key field contains id"],
    },
    {
      id: "m3",
      goal: "Create the table after approval",
      completion: ["The DynamoDB table list shows remora-demo with status Active"],
    },
  ],
  finalCriteria: ["The DynamoDB table remora-demo is listed with status Active"],
  approvalRules: [
    {
      id: "r1",
      description: "Require approval immediately before the final Create table submit",
      risk: "mutate",
      when: {
        actionKinds: ["click"],
        targetNamePattern: "^Create table$",
        targetRole: "button",
        pageUrlPattern: "create-table",
      },
    },
  ],
};

export class FakePlanner implements Planner {
  private clarifyConsumed = false;

  constructor(private readonly options: FakePlannerOptions = {}) {}

  private currentPlan(): TaskPlan {
    return this.options.plan ?? DEFAULT_DYNAMODB_PLAN;
  }

  async plan(_req: PlanRequest): Promise<PlanResult> {
    const clarify = this.options.clarifyOnce;
    if (clarify && clarify.length > 0 && !this.clarifyConsumed) {
      this.clarifyConsumed = true;
      return { kind: "clarify", questions: clarify };
    }
    return { kind: "plan", plan: this.currentPlan() };
  }

  async repair(_req: RepairRequest): Promise<PlanResult> {
    const clarify = this.options.clarifyOnce;
    if (clarify && clarify.length > 0 && !this.clarifyConsumed) {
      return { kind: "clarify", questions: clarify };
    }
    return { kind: "plan", plan: this.currentPlan() };
  }
}
