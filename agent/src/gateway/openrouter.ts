/**
 * OpenRouter gateway. Owns OPENROUTER_API_KEY, Chat Completions (strict JSON
 * Schema) for planner/verifier, and the Decisions API for JEV.
 *
 * OWNER: gateway subagent. Keep all model IDs as configuration.
 *
 * Redaction rules:
 * - The API key is only ever placed in the Authorization header.
 * - `logger` receives safe one-liners (method, model, status, tokens, cost,
 *   ms). Request state, page values, prompts, and the key are never logged.
 */
import { z } from "zod";
import type {
  ChatJsonRequest,
  DecisionAnswer,
  DecisionRequest,
  DecisionResponse,
  ModelCallResult,
  ModelGateway,
  ModelUsage,
} from "../core/contracts.js";
import { requireApiKey, type AgentConfig } from "../config.js";

export interface OpenRouterGatewayOptions {
  config: AgentConfig;
  fetchImpl?: typeof fetch;
  logger?: (line: string) => void;
  /**
   * Opt-in local debugging: receives full request/response payloads (planner
   * prompts, model output, JEV state/questions/answers). Never contains the API
   * key. Page values are already redacted upstream.
   */
  trace?: (line: string) => void;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_SNIPPET = 300;
const TRACE_MAX = 8_000;

function clip(text: string, max = TRACE_MAX): string {
  return text.length <= max ? text : `${text.slice(0, max)}… [${text.length - max} chars truncated]`;
}

/** Accepts a JSON string or an already-decoded object; returns null on failure. */
function tryParseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

/** Short, redaction-safe reason for a JSON/zod failure. */
function shortReason(error: unknown): string {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    if (!issue) return "schema validation failed";
    const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return `${path}${issue.message}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Collapses whitespace and truncates an HTTP error body. */
function snippet(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_SNIPPET);
}

// ---------------------------------------------------------------------------
// Decisions API response schema (local; the JEV endpoint is not JSON Schema
// constrained the way Chat Completions is).
// ---------------------------------------------------------------------------

const DecisionAnswerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("noul"), noul: z.number() }),
  z.object({
    type: z.literal("choice"),
    choice: z.string(),
    confidence: z.number().optional(),
    probabilities: z.record(z.string(), z.number()).optional(),
  }),
  z.object({
    type: z.literal("score"),
    score: z.number(),
    confidence: z.number().optional(),
    probabilities: z.record(z.string(), z.number()).optional(),
    legend: z.record(z.string(), z.string()).optional(),
  }),
]);

const DecisionsResponseSchema = z.object({
  id: z.string().optional(),
  model: z.string(),
  provider: z.string().optional(),
  answers: z.record(z.string(), DecisionAnswerSchema),
  usage: z.object({
    input_tokens: z.number(),
    output_tokens: z.number(),
    cost: z.number().optional(),
  }),
});

interface ChatCompletionResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number | null;
  };
}

export class OpenRouterGateway implements ModelGateway {
  private readonly usageQueue: ModelUsage[] = [];
  private readonly fetchImpl: typeof fetch;
  private readonly logger?: (line: string) => void;
  private readonly trace?: (line: string) => void;

  constructor(private readonly options: OpenRouterGatewayOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.logger = options.logger;
    this.trace = options.trace;
  }

  get chatModelId(): string {
    return this.options.config.chatModel;
  }

  get jevModelId(): string {
    return this.options.config.jevModel;
  }

  async chatJSON<T>(req: ChatJsonRequest<T>): Promise<ModelCallResult<T>> {
    const config = this.options.config;
    const apiKey = requireApiKey(config);
    const model = (req.model ?? config.chatModel).trim();
    if (!model) {
      throw new Error(
        "OPENROUTER_CHAT_MODEL is not set. Planner and verifier calls need a generative model slug.",
      );
    }

    const schemaJson = z.toJSONSchema(req.schema);
    const baseMessages = [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ];

    let lastReason = "unknown error";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const messages =
        attempt === 0
          ? baseMessages
          : [
              ...baseMessages,
              {
                role: "user",
                content: `Your previous response failed validation: ${lastReason}. Return only valid JSON that matches the schema exactly.`,
              },
            ];

      if (attempt === 0) {
        this.trace?.(
          [
            `[gw] → chatJSON schema=${req.schemaName} model=${model}`,
            `[gw] system:\n${clip(req.system, 4_000)}`,
            `[gw] user:\n${clip(req.user)}`,
          ].join("\n"),
        );
      } else {
        this.trace?.(`[gw] retry chatJSON schema=${req.schemaName} reason="${lastReason}"`);
      }

      const started = Date.now();
      const response = await this.fetchImpl(`${config.openRouterBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: req.temperature ?? 0,
          max_tokens: req.maxOutputTokens ?? 2000,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: req.schemaName,
              strict: true,
              schema: schemaJson,
            },
          },
        }),
        signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          `OpenRouter chatJSON (model "${model}") failed with status ${response.status}: ${
            snippet(text) || "no response body"
          }`,
        );
      }

      const completion = (await response.json()) as ChatCompletionResponse;
      const usage = this.recordChatUsage(completion, model);
      const content = completion.choices?.[0]?.message?.content;

      if (typeof content !== "string" || content.trim() === "") {
        this.trace?.(`[gw] ← chatJSON schema=${req.schemaName} empty response`);
        lastReason = "empty model response";
        continue;
      }

      const decoded = tryParseJson(content);
      if (decoded === undefined) {
        this.trace?.(`[gw] ← chatJSON schema=${req.schemaName} invalid JSON:\n${clip(content)}`);
        lastReason = "invalid JSON";
        continue;
      }

      const parsed = req.schema.safeParse(decoded);
      if (!parsed.success) {
        this.trace?.(
          `[gw] ← chatJSON schema=${req.schemaName} schema mismatch (${shortReason(parsed.error)}):\n${clip(content)}`,
        );
        lastReason = shortReason(parsed.error);
        continue;
      }

      this.trace?.(`[gw] ← chatJSON schema=${req.schemaName} model=${completion.model ?? model}\n${clip(content)}`);

      this.logger?.(
        `chatJSON model=${model} status=${response.status} inputTokens=${usage.inputTokens} ` +
          `outputTokens=${usage.outputTokens} costUsd=${usage.costUsd ?? "null"} ms=${Date.now() - started}`,
      );
      return { data: parsed.data, usage };
    }

    throw new Error(`OpenRouter chatJSON failed for model "${model}" after retry: ${lastReason}`);
  }

  async decide(req: DecisionRequest): Promise<DecisionResponse> {
    const config = this.options.config;
    const apiKey = requireApiKey(config);
    const model = (req.model ?? config.jevModel).trim();
    if (!model) {
      throw new Error(
        "OPENROUTER_JEV_MODEL is not set. JEV decisions need a configured model slug.",
      );
    }

    const started = Date.now();
    this.trace?.(
      [
        `[gw] → decide model=${model}`,
        `[gw] state:\n${clip(JSON.stringify(req.state, null, 2))}`,
        `[gw] questions:\n${clip(JSON.stringify(req.questions, null, 2))}`,
      ].join("\n"),
    );
    const response = await this.fetchImpl(config.openRouterDecisionsUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, state: req.state, questions: req.questions }),
      signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `OpenRouter decide (model "${model}") failed with status ${response.status}: ${
          snippet(text) || "no response body"
        }`,
      );
    }

    const raw: unknown = await response.json();
    const parsed = DecisionsResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `OpenRouter decide (model "${model}") returned an invalid response: ${shortReason(parsed.error)}`,
      );
    }

    const value = parsed.data;
    this.trace?.(
      `[gw] ← decide model=${value.model} provider=${value.provider ?? "?"}\n${clip(
        JSON.stringify(value.answers, null, 2),
        4_000,
      )}`,
    );
    const usage: ModelUsage = {
      kind: "decisions",
      model: value.model,
      inputTokens: value.usage.input_tokens,
      outputTokens: value.usage.output_tokens,
      costUsd: value.usage.cost ?? null,
    };
    this.usageQueue.push(usage);

    this.logger?.(
      `decide model=${value.model} status=${response.status} inputTokens=${usage.inputTokens} ` +
        `outputTokens=${usage.outputTokens} costUsd=${usage.costUsd ?? "null"} ms=${Date.now() - started}`,
    );

    const answers: Record<string, DecisionAnswer> = value.answers;
    return {
      model: value.model,
      provider: value.provider,
      id: value.id,
      answers,
      usage,
      raw: value,
    };
  }

  drainUsage(): ModelUsage[] {
    return this.usageQueue.splice(0, this.usageQueue.length);
  }

  private recordChatUsage(
    completion: ChatCompletionResponse,
    requestedModel: string,
  ): ModelUsage {
    const usage: ModelUsage = {
      kind: "chat",
      model: completion.model ?? requestedModel,
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
      costUsd: completion.usage?.cost ?? null,
    };
    this.usageQueue.push(usage);
    return usage;
  }
}
