/**
 * Remora browser protocol (v0.1).
 *
 * Boundary between the agent orchestrator and the Chrome extension.
 * Follows the envelope shape described in SHARED_INTEGRATION_SPEC.md, reduced
 * to the message set the agent needs (observe, execute, cancel, bridge).
 *
 * Both sides validate with these zod schemas. `ref` values are ephemeral and
 * scoped to a `snapshotId`; they are never persisted.
 */
import { z } from "zod";

export const PROTOCOL_VERSION = "0.1";
export const SUPPORTED_PROTOCOL_VERSIONS = [PROTOCOL_VERSION];

export const ProtocolErrorCode = z.enum([
  "PROTOCOL_VERSION_UNSUPPORTED",
  "BRIDGE_NOT_CONNECTED",
  "TAB_NOT_FOUND",
  "PAGE_NOT_SUPPORTED",
  "PAGE_PERMISSION_REQUIRED",
  "SNAPSHOT_EXPIRED",
  "ELEMENT_NOT_FOUND",
  "ELEMENT_AMBIGUOUS",
  "ELEMENT_NOT_INTERACTABLE",
  "ACTION_TIMEOUT",
  "ACTION_FAILED",
  "ACTION_RESULT_UNCERTAIN",
  "USER_CANCELLED",
  "APPROVAL_REQUIRED",
  "POLICY_BLOCKED",
  "SENSITIVE_INPUT_REQUIRED",
  "NOT_IMPLEMENTED",
]);
export type ProtocolErrorCode = z.infer<typeof ProtocolErrorCode>;

export const Source = z.enum(["orchestrator", "extension"]);
export type Source = z.infer<typeof Source>;

export const EnvelopeSchema = z.object({
  protocolVersion: z.string(),
  id: z.string(),
  correlationId: z.string().nullable(),
  sentAt: z.string(),
  source: Source,
  type: z.string(),
  payload: z.unknown(),
});
export type Envelope = z.infer<typeof EnvelopeSchema>;

export const RectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type Rect = z.infer<typeof RectSchema>;

export const PageElementSchema = z.object({
  ref: z.string(),
  role: z.string(),
  name: z.string(),
  label: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  text: z.string().max(500).optional(),
  tag: z.string(),
  inputType: z.string().nullable().optional(),
  enabled: z.boolean(),
  visible: z.boolean(),
  editable: z.boolean(),
  sensitive: z.boolean(),
  checked: z.boolean().nullable().optional(),
  selected: z.boolean().nullable().optional(),
  expanded: z.boolean().nullable().optional(),
  value: z.string().nullable().optional(),
  valueRedacted: z.boolean().optional(),
  rect: RectSchema,
  semanticPath: z.array(z.string()).max(8),
  boundary: z.enum(["main", "same-origin-iframe", "open-shadow-root"]),
});
export type PageElement = z.infer<typeof PageElementSchema>;

export const PageObservationSchema = z.object({
  snapshotId: z.string(),
  tab: z.object({
    tabId: z.number().int().nullable(),
    url: z.string(),
    title: z.string(),
  }),
  viewport: z.object({
    width: z.number(),
    height: z.number(),
    deviceScaleFactor: z.number().optional(),
  }),
  elements: z.array(PageElementSchema).max(400),
  truncated: z.object({
    nodeLimitReached: z.boolean(),
    textLimitReached: z.boolean(),
    omittedCount: z.number().int().nonnegative(),
  }),
  capturedAt: z.string(),
});
export type PageObservation = z.infer<typeof PageObservationSchema>;

export const BrowserActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("click"), ref: z.string() }),
  z.object({
    kind: z.literal("type"),
    ref: z.string(),
    value: z.string(),
    clear: z.boolean().optional(),
  }),
  z.object({ kind: z.literal("select"), ref: z.string(), option: z.string() }),
  z.object({
    kind: z.literal("scroll"),
    direction: z.enum(["up", "down"]),
    amount: z.number().optional(),
    ref: z.string().optional(),
  }),
  z.object({ kind: z.literal("wait"), ms: z.number().int().nonnegative().max(10_000) }),
]);
export type BrowserAction = z.infer<typeof BrowserActionSchema>;

export const ActionStatus = z.enum(["succeeded", "failed", "uncertain", "cancelled"]);
export type ActionStatus = z.infer<typeof ActionStatus>;

export const BridgeHelloPayloadSchema = z.object({
  extensionVersion: z.string(),
  protocolVersions: z.array(z.string()),
  browserVersion: z.string().optional(),
  /** Optional shared dev token; required by the orchestrator when configured. */
  token: z.string().nullable().optional(),
  activeTab: z
    .object({ tabId: z.number().int(), url: z.string(), title: z.string() })
    .nullable()
    .optional(),
});
export type BridgeHelloPayload = z.infer<typeof BridgeHelloPayloadSchema>;

export const BridgeReadyPayloadSchema = z.object({
  protocolVersion: z.string(),
  capabilities: z.array(z.string()),
});
export type BridgeReadyPayload = z.infer<typeof BridgeReadyPayloadSchema>;

export const BridgeStatusPayloadSchema = z.object({
  state: z.enum(["connected", "disconnected", "missing_permission", "unsupported_page", "degraded"]),
  detail: z.string().optional(),
});
export type BridgeStatusPayload = z.infer<typeof BridgeStatusPayloadSchema>;

export const ProtocolErrorPayloadSchema = z.object({
  code: ProtocolErrorCode,
  message: z.string(),
  retryable: z.boolean().optional(),
});
export type ProtocolErrorPayload = z.infer<typeof ProtocolErrorPayloadSchema>;

export const PageObserveRequestPayloadSchema = z.object({
  maxElements: z.number().int().positive().optional(),
  maxTextLength: z.number().int().positive().optional(),
});
export type PageObserveRequestPayload = z.infer<typeof PageObserveRequestPayloadSchema>;

export const PageObserveResponsePayloadSchema = z.object({
  observation: PageObservationSchema,
});
export type PageObserveResponsePayload = z.infer<typeof PageObserveResponsePayloadSchema>;

export const BrowserActionRequestPayloadSchema = z.object({
  runId: z.string(),
  stepId: z.string(),
  snapshotId: z.string(),
  action: BrowserActionSchema,
  timeoutMs: z.number().int().positive().optional(),
});
export type BrowserActionRequestPayload = z.infer<typeof BrowserActionRequestPayloadSchema>;

export const BrowserActionResultPayloadSchema = z.object({
  runId: z.string(),
  stepId: z.string(),
  status: ActionStatus,
  effect: z.string().optional(),
  error: z
    .object({
      code: ProtocolErrorCode,
      message: z.string(),
      retryable: z.boolean().optional(),
    })
    .optional(),
  observation: PageObservationSchema.optional(),
});
export type BrowserActionResultPayload = z.infer<typeof BrowserActionResultPayloadSchema>;

export const BrowserCancelPayloadSchema = z.object({ runId: z.string() });
export type BrowserCancelPayload = z.infer<typeof BrowserCancelPayloadSchema>;

/** Request/response payload registry keyed by envelope `type`. */
export const PayloadSchemas = {
  "bridge.hello": BridgeHelloPayloadSchema,
  "bridge.ready": BridgeReadyPayloadSchema,
  "bridge.status": BridgeStatusPayloadSchema,
  "protocol.error": ProtocolErrorPayloadSchema,
  "page.observe.request": PageObserveRequestPayloadSchema,
  "page.observe.response": PageObserveResponsePayloadSchema,
  "browser.action.request": BrowserActionRequestPayloadSchema,
  "browser.action.result": BrowserActionResultPayloadSchema,
  "browser.cancel": BrowserCancelPayloadSchema,
} as const;

export type MessageType = keyof typeof PayloadSchemas;
export type PayloadFor<T extends MessageType> = z.infer<(typeof PayloadSchemas)[T]>;

export function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function makeEnvelope<T extends MessageType>(
  source: Source,
  type: T,
  payload: PayloadFor<T>,
  correlationId: string | null = null,
): Envelope {
  return {
    protocolVersion: PROTOCOL_VERSION,
    id: newId(),
    correlationId,
    sentAt: new Date().toISOString(),
    source,
    type,
    payload: payload as unknown,
  };
}

export function parseEnvelope(raw: unknown): Envelope {
  return EnvelopeSchema.parse(raw);
}

/** Validates an envelope and its payload for the given (or envelope) type. */
export function parseMessage<T extends MessageType>(
  raw: unknown,
  expectType?: T,
): { envelope: Envelope; type: MessageType; payload: unknown } {
  const envelope = EnvelopeSchema.parse(raw);
  if (expectType && envelope.type !== expectType) {
    throw new Error(`Expected ${expectType}, received ${envelope.type}`);
  }
  if (!(envelope.type in PayloadSchemas)) {
    throw new Error(`Unknown message type: ${envelope.type}`);
  }
  const schema = PayloadSchemas[envelope.type as MessageType];
  const payload = schema.parse(envelope.payload);
  return { envelope, type: envelope.type as MessageType, payload };
}

export function isSupportedProtocolVersion(version: string): boolean {
  return SUPPORTED_PROTOCOL_VERSIONS.includes(version as (typeof SUPPORTED_PROTOCOL_VERSIONS)[number]);
}
