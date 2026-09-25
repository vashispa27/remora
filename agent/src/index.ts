#!/usr/bin/env tsx
/**
 * Remora agent CLI.
 *
 *   npm run demo:mocked -w @remora/agent      # no models, no Chrome
 *   npm run run -w @remora/agent -- --prompt "Create a DynamoDB table ..."
 *   npm run observe -w @remora/agent          # live snapshot of the active tab
 *
 * Env is loaded from <repo>/.env then agent/.env. See agent/.env.example.
 */
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import type { BrowserAction, PageObservation } from "@remora/protocol";
import { WsBrowserChannel } from "./browser/ws-channel.js";
import { loadConfig, loadDefaultEnvFiles, requireApiKey, requireChatModel, type AgentConfig } from "./config.js";
import { ControlServer, type RunBrain } from "./control/control-server.js";
import type {
  ApprovalDecision,
  ApprovalGate,
  ApprovalRequest,
  ChatJsonRequest,
  DecisionRequest,
  DecisionResponse,
  EventSink,
  JevSelection,
  ModelCallResult,
  ModelGateway,
  ModelUsage,
  OrchestratorEvent,
} from "./core/contracts.js";
import type { JevAction } from "./schemas/domain.js";
import { buildDynamoDbDemo } from "./fakes/index.js";
import { OpenRouterGateway } from "./gateway/openrouter.js";
import { JevQuestionSelector } from "./jev/jev-selector.js";
import { DefaultOrchestrator } from "./orchestrator/orchestrator.js";
import { GoalPlanner } from "./planner/planner.js";
import { GenerativeVerifier } from "./verifier/verifier.js";

const DEMO_PROMPT = "Create a DynamoDB table named remora-demo with partition key id";

class NullGateway implements ModelGateway {
  readonly chatModelId = "none";
  readonly jevModelId = "none";

  async chatJSON<T>(_req: ChatJsonRequest<T>): Promise<ModelCallResult<T>> {
    throw new Error("NullGateway: model calls are disabled (demo mode).");
  }

  async decide(_req: DecisionRequest): Promise<DecisionResponse> {
    throw new Error("NullGateway: model calls are disabled (demo mode).");
  }

  drainUsage(): ModelUsage[] {
    return [];
  }
}

class CliApprovalGate implements ApprovalGate {
  constructor(private readonly autoApprove: boolean) {}

  async request(req: ApprovalRequest): Promise<ApprovalDecision> {
    console.log("");
    console.log("  ┌─ APPROVAL REQUIRED ─────────────────────────────");
    console.log(`  │ risk    ${req.risk}`);
    console.log(`  │ action  ${describeAction(req.action)}`);
    if (req.target) console.log(`  │ target  ${req.target.role} "${req.target.name}"`);
    if (req.rule) console.log(`  │ rule    ${req.rule.description}`);
    console.log(`  │ reason  ${req.reason}`);
    console.log("  └──────────────────────────────────────────────────");
    if (this.autoApprove) {
      console.log("  → auto-approved (--yes)");
      return { approved: true };
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = (await rl.question("  Approve this action? [y/N] ")).trim().toLowerCase();
      return answer.startsWith("y")
        ? { approved: true }
        : { approved: false, reason: "User declined in terminal" };
    } finally {
      rl.close();
    }
  }
}

function describeAction(action: BrowserAction): string {
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

function describeJev(action: JevAction): string {
  switch (action.kind) {
    case "click":
      return `click ${action.ref}`;
    case "type_text":
      return `type_text ${action.ref} inputKey=${action.inputKey}`;
    case "select":
      return `select ${action.ref} option="${action.option}"`;
    case "scroll":
      return `scroll ${action.direction}`;
    case "wait":
      return "wait";
    case "milestone_done":
      return "milestone_done";
    case "blocked":
      return `blocked (${action.reason})`;
  }
}

function createRenderer(verbose: boolean): EventSink {
  return (event: OrchestratorEvent): void => {
    switch (event.type) {
      case "status":
        console.log(`  · ${event.status}${event.detail ? ` — ${event.detail}` : ""}`);
        break;
      case "plan":
        console.log(`  ◆ plan: ${event.plan.goal}`);
        event.plan.milestones.forEach((m, i) => {
          console.log(`      ${i + 1}. [${m.id}] ${m.goal}`);
        });
        break;
      case "clarification":
        console.log("  ? planner needs input:");
        event.questions.forEach((q) => console.log(`      ${q.key}: ${q.question}`));
        break;
      case "milestone_started":
        console.log(`\n▶ milestone ${event.index}/${event.total} [${event.milestone.id}] ${event.milestone.goal}`);
        break;
      case "observation":
        if (verbose) {
          console.log(`  👁 observation ${event.observation.snapshotId}`);
          for (const el of event.observation.elements) {
            console.log(
              `      ${el.ref} ${el.role} "${el.name}"${el.value ? ` value="${el.value}"` : ""}` +
                `${el.valueRedacted ? " value=[redacted]" : ""}${el.enabled ? "" : " [disabled]"}`,
            );
          }
        } else {
          console.log(
            `  👁 ${event.observation.elements.length} elements — ${event.observation.tab.url}`,
          );
        }
        break;
      case "proposal":
        console.log(
          `  ☆ JEV: ${describeJev(event.proposal)} (confidence ${event.proposal.confidence.toFixed(2)})`,
        );
        break;
      case "verification":
        console.log(
          `  ✔ verify(${event.scope}): ${event.verification.judgment}` +
            (event.verification.summary ? ` — ${event.verification.summary}` : ""),
        );
        if (event.verification.judgment !== "SATISFIED" && event.verification.feedback) {
          console.log(`      feedback: ${event.verification.feedback}`);
        }
        break;
      case "guard":
        console.log(`  ⚖ guard: ${event.decision} (${event.risk}) — ${event.reason}`);
        break;
      case "approval_requested":
        break; // rendered by the approval gate itself
      case "approval_resolved":
        console.log(`  ✋ approval ${event.decision.approved ? "granted" : "denied"}`);
        break;
      case "action_executed":
        console.log(
          `  → ${event.action.kind}${"ref" in event.action ? ` ${event.action.ref}` : ""} -> ${event.outcome.status}` +
            (event.outcome.effect ? ` — ${event.outcome.effect}` : ""),
        );
        break;
      case "usage":
        console.log(
          `  $ ${event.usage.kind} ${event.usage.model}: in ${event.usage.inputTokens}, out ${event.usage.outputTokens}` +
            (event.usage.costUsd !== null ? `, $${event.usage.costUsd.toFixed(6)}` : ""),
        );
        break;
      case "error":
        console.error(`  ✗ ${event.code}: ${event.message}`);
        break;
      case "finished":
        console.log(`\n${event.status === "completed" ? "✅" : "⛔"} ${event.status}: ${event.summary}`);
        break;
    }
  };
}

function printObservation(observation: PageObservation, verbose: boolean): void {
  console.log(`${observation.tab.title} — ${observation.tab.url} (${observation.elements.length} elements)`);
  for (const el of observation.elements) {
    const value = el.valueRedacted ? " [redacted]" : el.value ? ` value="${el.value}"` : "";
    console.log(
      `${verbose ? "  " : ""}${el.ref.padEnd(5)} ${el.role.padEnd(10)} "${el.name}"${value}` +
        `${el.enabled ? "" : " [disabled]"}${el.visible ? "" : " [hidden]"}${el.sensitive ? " [sensitive]" : ""}`,
    );
  }
}

async function main(): Promise<number> {
  loadDefaultEnvFiles();
  const config = loadConfig();

  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      prompt: { type: "string", short: "p" },
      yes: { type: "boolean", short: "y", default: false },
      verbose: { type: "boolean", short: "v", default: false },
      retrieval: { type: "string", multiple: true },
      mock: { type: "boolean", default: false },
      "fake-browser": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  const command = positionals[0] ?? (values.help ? "help" : "help");
  const renderer = createRenderer(Boolean(values.verbose));

  switch (command) {
    case "demo": {
      const demo = buildDynamoDbDemo();
      const orchestrator = new DefaultOrchestrator({
        config,
        gateway: new NullGateway(),
        planner: demo.planner,
        jev: demo.jev,
        verifier: demo.verifier,
        browser: demo.browser,
        logger: (line) => console.log(`  ${line}`),
      });
      const result = await orchestrator.run({
        prompt: DEMO_PROMPT,
        approvalGate: new CliApprovalGate(Boolean(values.yes)),
        events: renderer,
      });
      return exitCode(result.status);
    }
    case "run": {
      return await runLive(config, values.prompt, Boolean(values.yes), values.retrieval ?? [], renderer);
    }
    case "serve": {
      return await runServe(config, {
        mock: Boolean(values.mock),
        fakeBrowser: Boolean(values["fake-browser"]),
      });
    }
    case "observe": {
      const browser = new WsBrowserChannel({
        config,
        logger: (line) => console.log(`  ${line}`),
      });
      await browser.start();
      try {
        console.log(`Waiting for the Chrome extension on ws://${config.wsHost}:${config.wsPort} …`);
        await browser.waitForExtension();
        const observation = await browser.observe();
        printObservation(observation, Boolean(values.verbose));
        return 0;
      } finally {
        await browser.close();
      }
    }
    default:
      printHelp();
      return values.help ? 0 : 1;
  }
}

async function runLive(
  config: AgentConfig,
  prompt: string | undefined,
  autoApprove: boolean,
  retrieval: string[],
  renderer: EventSink,
): Promise<number> {
  if (!prompt || prompt.trim() === "") {
    console.error('Missing prompt. Use: npm run run -w @remora/agent -- --prompt "..."');
    return 1;
  }
  requireApiKey(config);
  requireChatModel(config);

  const gateway = new OpenRouterGateway({
    config,
    logger: (line) => console.log(`  [gw] ${line}`),
  });
  const planner = new GoalPlanner({ gateway });
  const verifier = new GenerativeVerifier({ gateway });
  const jev = new JevQuestionSelector({
    gateway,
    confidenceThreshold: config.limits.confidenceThreshold,
    maxElements: config.observation.maxElements,
  });
  const browser = new WsBrowserChannel({
    config,
    logger: (line) => console.log(`  ${line}`),
  });

  await browser.start();
  try {
    console.log(`Waiting for the Chrome extension on ws://${config.wsHost}:${config.wsPort} …`);
    await browser.waitForExtension();
    const orchestrator = new DefaultOrchestrator({
      config,
      gateway,
      planner,
      jev,
      verifier,
      browser,
      logger: (line) => console.log(`  ${line}`),
    });
    const result = await orchestrator.run({
      prompt,
      retrievalContext: retrieval.length > 0 ? retrieval : undefined,
      approvalGate: new CliApprovalGate(autoApprove),
      events: renderer,
    });
    return exitCode(result.status);
  } finally {
    await browser.close();
  }
}

function exitCode(status: string): number {
  switch (status) {
    case "completed":
      return 0;
    case "needs_input":
      return 3;
    case "cancelled":
      return 130;
    default:
      return 2;
  }
}

interface ServeOptions {
  mock: boolean;
  fakeBrowser: boolean;
}

async function runServe(config: AgentConfig, options: ServeOptions): Promise<number> {
  if (options.mock) {
    console.log("Mock mode: deterministic planner/JEV/verifier; no model calls.");
  } else {
    requireApiKey(config);
    requireChatModel(config);
  }
  if (options.fakeBrowser && !options.mock) {
    console.error("--fake-browser requires --mock (the simulated browser only matches the fixture).");
    return 1;
  }

  const gateway: ModelGateway = options.mock
    ? new NullGateway()
    : new OpenRouterGateway({ config, logger: (line) => console.log(`  [gw] ${line}`) });

  let sharedBrowser: WsBrowserChannel | null = null;
  if (options.fakeBrowser) {
    console.log("Simulated browser: the fixture flow runs without Chrome.");
  } else {
    sharedBrowser = new WsBrowserChannel({
      config,
      logger: (line) => console.log(`  ${line}`),
    });
    await sharedBrowser.start();
    if (options.mock) {
      console.warn(
        "Warning: mock JEV uses fixture refs; a real page will not match. Prefer --mock --fake-browser, or run without --mock for live sites.",
      );
    }
  }

  const createBrain = (): RunBrain => {
    if (options.mock) {
      const demo = buildDynamoDbDemo();
      return {
        gateway: new NullGateway(),
        planner: demo.planner,
        jev: demo.jev,
        verifier: demo.verifier,
        browser: options.fakeBrowser ? demo.browser : sharedBrowser!,
      };
    }
    return {
      gateway,
      planner: new GoalPlanner({ gateway }),
      jev: new JevQuestionSelector({
        gateway,
        confidenceThreshold: config.limits.confidenceThreshold,
        maxElements: config.observation.maxElements,
      }),
      verifier: new GenerativeVerifier({ gateway }),
      browser: sharedBrowser!,
    };
  };

  const control = new ControlServer({
    config,
    createBrain,
    logger: (line) => console.log(`  ${line}`),
  });
  await control.start();

  console.log("");
  console.log("Remora agent ready.");
  console.log(`  Control channel (macOS app): ws://${config.controlHost}:${config.controlPort}`);
  if (options.fakeBrowser) {
    console.log("  Browser: simulated fixture (no Chrome needed)");
  } else {
    console.log(
      `  Browser bridge (extension): ws://${config.wsHost}:${config.wsPort} (the extension connects when loaded)`,
    );
  }
  console.log("  Press Ctrl+C to stop.");
  console.log("");

  await waitForTermination();
  console.log("\nShutting down…");
  await control.close();
  await sharedBrowser?.close();
  return 0;
}

function waitForTermination(): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => {
      process.off("SIGINT", finish);
      process.off("SIGTERM", finish);
      resolve();
    };
    process.on("SIGINT", finish);
    process.on("SIGTERM", finish);
  });
}

function printHelp(): void {
  console.log(`Remora agent

Usage:
  npm run demo:mocked -w @remora/agent [-- --yes] [-v]
      Deterministic multi-milestone run. No models, no Chrome.
      --yes skips the interactive approval checkpoint.

  npm run run -w @remora/agent -- --prompt "<task>" [--yes] [-v] [--retrieval <file>]...
      Live run: OpenRouter planner/verifier/JEV + Chrome extension bridge.
      Requires OPENROUTER_API_KEY and OPENROUTER_CHAT_MODEL.

  npm run observe -w @remora/agent [-v]
      Print one page observation from the connected extension.

  npm run serve -w @remora/agent -- [--mock] [--fake-browser]
      Run the agent service: control channel for the macOS app + browser bridge.
      --mock          deterministic fakes, no OpenRouter calls
      --fake-browser  simulate the fixture page (no Chrome); pair with --mock

Environment: see agent/.env.example (repo .env and agent/.env are loaded).
`);
}

const code = await main();
process.exitCode = code;
