/**
 * Fixture check for the OpenRouter gateway.
 *
 * Proves all three model-call shapes (planner Chat Completions, verifier Chat
 * Completions, JEV Decisions) can be driven and validated without a real API
 * key: a fake `fetchImpl` serves the recorded fixtures.
 *
 * Run from the repo root: `npx tsx agent/scripts/check-gateway-fixtures.ts`
 */
import { readFileSync } from "node:fs";
import { PlannerOutputSchema, VerificationSchema } from "../src/schemas/domain.js";
import { loadConfig } from "../src/config.js";
import { OpenRouterGateway } from "../src/gateway/openrouter.js";

const DUMMY_KEY = "fixture-key";

interface ChatFixture {
  request: { method: string; url: string; body: unknown };
  response: { status: number; body: unknown };
}

interface DecisionsFixture {
  request: { method: string; url: string; body: unknown };
  response: { status: number; body: unknown };
}

function readFixture<T>(name: string): T {
  const path = new URL(`../fixtures/openrouter/${name}`, import.meta.url);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

async function main(): Promise<void> {
  const plannerFixture = readFixture<ChatFixture>("planner.chat.json");
  const verifierFixture = readFixture<ChatFixture>("verifier.chat.json");
  const decisionsFixture = readFixture<DecisionsFixture>("jev.decisions.json");

  const served: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = requestUrl(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));

    if (method === "POST" && url.endsWith("/chat/completions")) {
      const schemaName = (body as { response_format?: { json_schema?: { name?: string } } })
        ?.response_format?.json_schema?.name;
      const fixture = schemaName === "Verification" ? verifierFixture : plannerFixture;
      served.push(`chat:${schemaName}`);
      return new Response(JSON.stringify(fixture.response.body), {
        status: fixture.response.status,
        headers: { "content-type": "application/json" },
      });
    }

    if (method === "POST" && url.endsWith("/decisions")) {
      served.push("decisions");
      return new Response(JSON.stringify(decisionsFixture.response.body), {
        status: decisionsFixture.response.status,
        headers: { "content-type": "application/json" },
      });
    }

    throw new Error(`Unexpected request: ${method} ${url}`);
  };

  const config = loadConfig({
    OPENROUTER_API_KEY: DUMMY_KEY,
    OPENROUTER_CHAT_MODEL: "fixture/model",
    OPENROUTER_JEV_MODEL: "typesafe/jev-1.13",
  });

  const logLines: string[] = [];
  const gateway = new OpenRouterGateway({
    config,
    fetchImpl,
    logger: (line) => logLines.push(line),
  });

  // (a) Planner Chat Completions shape.
  const planResult = await gateway.chatJSON({
    system: "You are the Remora planner.",
    user: "Create a DynamoDB table named remora-demo with partition key id.",
    schemaName: "PlannerOutput",
    schema: PlannerOutputSchema,
  });
  assert(
    planResult.data.status === "ready" || planResult.data.status === "needs_input",
    "planner status must be ready or needs_input",
  );
  assert(planResult.usage.inputTokens > 0, "planner usage inputTokens must be recorded");
  assert(planResult.usage.kind === "chat", "planner usage kind must be chat");
  console.log(`PASS planner.chat (status=${planResult.data.status}, model=${planResult.usage.model})`);

  // (b) Verifier Chat Completions shape.
  const verifyResult = await gateway.chatJSON({
    system: "You are the Remora verifier.",
    user: "Compare milestone criteria with the observation and cite evidence.",
    schemaName: "Verification",
    schema: VerificationSchema,
  });
  assert(
    verifyResult.data.judgment === "SATISFIED",
    "verifier judgment must be SATISFIED",
  );
  assert(verifyResult.data.citations.length > 0, "verifier must cite evidence");
  console.log(
    `PASS verifier.chat (judgment=${verifyResult.data.judgment}, citations=${verifyResult.data.citations.length})`,
  );

  // (c) JEV Decisions shape.
  const decision = await gateway.decide({
    state: (decisionsFixture.request.body as { state: unknown }).state,
    questions: (
      decisionsFixture.request.body as {
        questions: Parameters<OpenRouterGateway["decide"]>[0]["questions"];
      }
    ).questions,
  });
  const operation = decision.answers.operation;
  assert(operation?.type === "choice", "operation answer must be a choice");
  assert(decision.usage.kind === "decisions", "decision usage kind must be decisions");
  console.log(
    `PASS jev.decisions (operation=${operation.choice}, confidence=${operation.confidence ?? "n/a"})`,
  );

  // (d) Usage accumulation.
  const usage = gateway.drainUsage();
  assert(usage.length === 3, `expected exactly 3 usage records, got ${usage.length}`);
  assert(
    usage.filter((u) => u.kind === "chat").length === 2,
    "expected exactly 2 chat usage records",
  );
  assert(
    usage.filter((u) => u.kind === "decisions").length === 1,
    "expected exactly 1 decisions usage record",
  );
  console.log(`PASS usage.drain (${usage.length} records)`);

  // (e) Redaction: the API key must never appear in logger output.
  assert(logLines.length >= 3, "expected at least 3 log lines");
  for (const line of logLines) {
    assert(!line.includes(DUMMY_KEY), `logger leaked the API key: ${line}`);
  }
  console.log(`PASS redaction.logger (${logLines.length} lines, key absent)`);

  assert(served.length === 3, `expected 3 served fixtures, got ${served.length}`);
}

main()
  .then(() => {
    console.log("3/3 model-call shapes validated");
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`FAIL: ${message}`);
    process.exit(1);
  });
