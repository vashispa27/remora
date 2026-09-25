/**
 * Fake wiring for the model-free DynamoDB demo. The CLI owns approval; this
 * module only assembles the deterministic planner, JEV, verifier, and browser
 * with consistent defaults.
 *
 * OWNER: fakes subagent.
 */
import { FakePlanner } from "./fake-planner.js";
import { FakeJevSelector } from "./fake-jev.js";
import { FakeVerifier } from "./fake-verifier.js";
import { FakeBrowserChannel } from "./fake-browser.js";

export interface DynamoDbDemo {
  planner: FakePlanner;
  jev: FakeJevSelector;
  verifier: FakeVerifier;
  browser: FakeBrowserChannel;
}

/** Builds the four fakes wired around the DynamoDB fixture defaults. */
export function buildDynamoDbDemo(): DynamoDbDemo {
  const tableName = "remora-demo";
  const partitionKey = "id";
  return {
    planner: new FakePlanner(),
    jev: new FakeJevSelector(),
    verifier: new FakeVerifier({ tableName, partitionKey }),
    browser: new FakeBrowserChannel({ fixture: "dynamodb", tableName, partitionKey }),
  };
}

export { FakePlanner, DEFAULT_DYNAMODB_PLAN } from "./fake-planner.js";
export type { FakePlannerOptions } from "./fake-planner.js";
export { FakeJevSelector } from "./fake-jev.js";
export type { FakeJevOptions } from "./fake-jev.js";
export { FakeVerifier } from "./fake-verifier.js";
export type { FakeVerifierOptions } from "./fake-verifier.js";
export { FakeBrowserChannel } from "./fake-browser.js";
export type { FakeBrowserOptions } from "./fake-browser.js";
