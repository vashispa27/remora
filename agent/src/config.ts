import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface AgentConfig {
  openRouterApiKey: string | null;
  openRouterBaseUrl: string;
  openRouterDecisionsUrl: string;
  chatModel: string;
  jevModel: string;
  wsHost: string;
  wsPort: number;
  bridgeToken: string | null;
  controlHost: string;
  controlPort: number;
  controlToken: string | null;
  observation: {
    maxElements: number;
    maxTextLength: number;
  };
  limits: {
    maxStepsPerMilestone: number;
    maxTotalSteps: number;
    confidenceThreshold: number;
    actionTimeoutMs: number;
    observeTimeoutMs: number;
    maxRepairAttempts: number;
  };
}

function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Minimal .env loader: KEY=VALUE lines, optional surrounding quotes, `#`
 * comments. Existing process.env values always win.
 */
export function loadEnvFile(path: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (env[key] === undefined || env[key] === "") env[key] = value;
  }
}

/** Loads the repo root .env then agent/.env (agent wins unless already set). */
export function loadDefaultEnvFiles(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const agentRoot = resolve(here, "..");
  const repoRoot = resolve(agentRoot, "..");
  loadEnvFile(resolve(repoRoot, ".env"));
  loadEnvFile(resolve(agentRoot, ".env"));
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  return {
    openRouterApiKey: env.OPENROUTER_API_KEY?.trim() || null,
    openRouterBaseUrl: (env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1").replace(/\/+$/, ""),
    openRouterDecisionsUrl:
      env.OPENROUTER_DECISIONS_URL?.trim() || "https://openrouter.ai/api/alpha/decisions",
    chatModel: env.OPENROUTER_CHAT_MODEL?.trim() || "",
    jevModel: env.OPENROUTER_JEV_MODEL?.trim() || "typesafe/jev-1.13",
    wsHost: env.REMORA_WS_HOST?.trim() || "127.0.0.1",
    wsPort: num(env.REMORA_WS_PORT, 8787),
    bridgeToken: env.REMORA_BRIDGE_TOKEN?.trim() || null,
    controlHost: env.REMORA_CONTROL_HOST?.trim() || "127.0.0.1",
    controlPort: num(env.REMORA_CONTROL_PORT, 8790),
    controlToken: env.REMORA_CONTROL_TOKEN?.trim() || null,
    observation: {
      maxElements: num(env.REMORA_MAX_ELEMENTS, 120),
      maxTextLength: num(env.REMORA_MAX_TEXT_LENGTH, 160),
    },
    limits: {
      maxStepsPerMilestone: num(env.REMORA_MAX_STEPS_PER_MILESTONE, 30),
      maxTotalSteps: num(env.REMORA_MAX_TOTAL_STEPS, 120),
      confidenceThreshold: num(env.REMORA_CONFIDENCE_THRESHOLD, 0.55),
      actionTimeoutMs: num(env.REMORA_ACTION_TIMEOUT_MS, 20_000),
      observeTimeoutMs: num(env.REMORA_OBSERVE_TIMEOUT_MS, 15_000),
      maxRepairAttempts: num(env.REMORA_MAX_REPAIR_ATTEMPTS, 1),
    },
  };
}

export function requireApiKey(config: AgentConfig): string {
  if (!config.openRouterApiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Copy agent/.env.example to agent/.env and fill it in, " +
        "or use the mocked demo (`npm run demo:mocked`).",
    );
  }
  return config.openRouterApiKey;
}

export function requireChatModel(config: AgentConfig): string {
  if (!config.chatModel) {
    throw new Error(
      "OPENROUTER_CHAT_MODEL is not set. Planner and verifier calls need a generative model slug.",
    );
  }
  return config.chatModel;
}
