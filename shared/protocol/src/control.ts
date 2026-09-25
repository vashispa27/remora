/**
 * Remora control protocol (v0.1).
 *
 * Boundary between the macOS app and the agent orchestrator. The orchestrator
 * owns the run; the app submits a prompt, receives an event stream, and answers
 * approval requests. No models, browser access, or automation live in the app.
 *
 * Envelope shape matches the extension protocol (`./index.ts`), with its own
 * source domain and payload registry. Transport today is a local WebSocket
 * (`ws://127.0.0.1:8790`); the envelopes are transport-neutral.
 */
import { z } from "zod";
import { newId } from "./index.js";

export const CONTROL_PROTOCOL_VERSION = "0.1";
export const SUPPORTED_CONTROL_PROTOCOL_VERSIONS = [CONTROL_PROTOCOL_VERSION];

export const ControlSource = z.enum(["macos", "orchestrator"]);
export type ControlSource = z.infer<typeof ControlSource>;

export const ControlEnvelopeSchema = z.object({
  protocolVersion: z.string(),
  id: z.string(),
  correlationId: z.string().nullable(),
  sentAt: z.string(),
  source: ControlSource,
  type: z.string(),
  payload: z.unknown(),
});
export type ControlEnvelope = z.infer<typeof ControlEnvelopeSchema>;

export const ControlRisk = z.enum(["read", "draft", "mutate", "destructive"]);
export type ControlRisk = z.infer<typeof ControlRisk>;

export const ControlRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type ControlRect = z.infer<typeof ControlRectSchema>;

/** A page element the app may want to point at. Rects are viewport-relative. */
export const ControlTargetSchema = z.object({
  ref: z.string().nullable(),
  role: z.string().nullable(),
  name: z.string().nullable(),
  url: z.string().nullable(),
  rect: ControlRectSchema.nullable(),
});
export type ControlTarget = z.infer<typeof ControlTargetSchema>;

export const ControlMilestoneSchema = z.object({
  id: z.string(),
  goal: z.string(),
  completion: z.array(z.string()),
});
export type ControlMilestone = z.infer<typeof ControlMilestoneSchema>;

export const ControlEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("status"),
    status: z.string(),
    detail: z.string().nullable(),
  }),
  z.object({
    type: z.literal("plan"),
    goal: z.string(),
    milestones: z.array(ControlMilestoneSchema),
  }),
  z.object({
    type: z.literal("milestone"),
    id: z.string(),
    index: z.number().int(),
    total: z.number().int(),
    goal: z.string(),
  }),
  z.object({
    type: z.literal("observation"),
    url: z.string(),
    title: z.string(),
    elementCount: z.number().int(),
    snapshotId: z.string(),
    target: ControlTargetSchema.nullable(),
  }),
  z.object({
    type: z.literal("proposal"),
    actionKind: z.string(),
    summary: z.string(),
    confidence: z.number(),
    target: ControlTargetSchema.nullable(),
  }),
  z.object({
    type: z.literal("guard"),
    decision: z.enum(["allow", "require_approval", "block"]),
    risk: ControlRisk,
    reason: z.string(),
  }),
  z.object({
    type: z.literal("approval_request"),
    approvalId: z.string(),
    risk: ControlRisk,
    summary: z.string(),
    reason: z.string(),
    target: ControlTargetSchema.nullable(),
  }),
  z.object({
    type: z.literal("approval_resolved"),
    approvalId: z.string(),
    approved: z.boolean(),
  }),
  z.object({
    type: z.literal("action"),
    actionKind: z.string(),
    summary: z.string(),
    status: z.enum(["succeeded", "failed", "uncertain", "cancelled"]),
    effect: z.string().nullable(),
  }),
  z.object({
    type: z.literal("verification"),
    scope: z.enum(["milestone", "final"]),
    judgment: z.enum(["SATISFIED", "NOT_SATISFIED", "PENDING", "AMBIGUOUS"]),
    summary: z.string().nullable(),
    feedback: z.string().nullable(),
  }),
  z.object({
    type: z.literal("usage"),
    model: z.string(),
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    costUsd: z.number().nullable(),
  }),
  z.object({
    type: z.literal("finished"),
    status: z.enum(["completed", "failed", "cancelled", "needs_input"]),
    summary: z.string(),
    errorCode: z.string().nullable(),
  }),
  z.object({
    type: z.literal("error"),
    code: z.string(),
    message: z.string(),
  }),
]);
export type ControlEvent = z.infer<typeof ControlEventSchema>;

export const ControlHelloPayloadSchema = z.object({
  appVersion: z.string(),
  protocolVersions: z.array(z.string()),
  token: z.string().nullable().optional(),
});
export type ControlHelloPayload = z.infer<typeof ControlHelloPayloadSchema>;

export const ControlReadyPayloadSchema = z.object({
  protocolVersion: z.string(),
  agentVersion: z.string(),
  status: z.enum(["idle", "busy"]),
});
export type ControlReadyPayload = z.infer<typeof ControlReadyPayloadSchema>;

export const ControlErrorPayloadSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean().optional(),
});
export type ControlErrorPayload = z.infer<typeof ControlErrorPayloadSchema>;

export const RunStartPayloadSchema = z.object({ prompt: z.string().min(1) });
export type RunStartPayload = z.infer<typeof RunStartPayloadSchema>;

export const RunAcceptedPayloadSchema = z.object({ runId: z.string() });
export type RunAcceptedPayload = z.infer<typeof RunAcceptedPayloadSchema>;

export const RunCancelPayloadSchema = z.object({ runId: z.string() });
export type RunCancelPayload = z.infer<typeof RunCancelPayloadSchema>;

export const RunApprovalPayloadSchema = z.object({
  runId: z.string(),
  approvalId: z.string(),
  approved: z.boolean(),
  reason: z.string().nullable().optional(),
});
export type RunApprovalPayload = z.infer<typeof RunApprovalPayloadSchema>;

export const RunEventPayloadSchema = z.object({
  runId: z.string(),
  event: ControlEventSchema,
});
export type RunEventPayload = z.infer<typeof RunEventPayloadSchema>;

export const ControlPayloadSchemas = {
  "control.hello": ControlHelloPayloadSchema,
  "control.ready": ControlReadyPayloadSchema,
  "control.error": ControlErrorPayloadSchema,
  "run.start": RunStartPayloadSchema,
  "run.accepted": RunAcceptedPayloadSchema,
  "run.cancel": RunCancelPayloadSchema,
  "run.approval": RunApprovalPayloadSchema,
  "run.event": RunEventPayloadSchema,
} as const;

export type ControlMessageType = keyof typeof ControlPayloadSchemas;
export type ControlPayloadFor<T extends ControlMessageType> = z.infer<
  (typeof ControlPayloadSchemas)[T]
>;

export function makeControlEnvelope<T extends ControlMessageType>(
  source: ControlSource,
  type: T,
  payload: ControlPayloadFor<T>,
  correlationId: string | null = null,
): ControlEnvelope {
  return {
    protocolVersion: CONTROL_PROTOCOL_VERSION,
    id: newId(),
    correlationId,
    sentAt: new Date().toISOString(),
    source,
    type,
    payload: payload as unknown,
  };
}

export function parseControlMessage(
  raw: unknown,
  expectType?: ControlMessageType,
): { envelope: ControlEnvelope; type: ControlMessageType; payload: unknown } {
  const envelope = ControlEnvelopeSchema.parse(raw);
  if (expectType && envelope.type !== expectType) {
    throw new Error(`Expected ${expectType}, received ${envelope.type}`);
  }
  if (!(envelope.type in ControlPayloadSchemas)) {
    throw new Error(`Unknown control message type: ${envelope.type}`);
  }
  const schema = ControlPayloadSchemas[envelope.type as ControlMessageType];
  return { envelope, type: envelope.type as ControlMessageType, payload: schema.parse(envelope.payload) };
}

export function isSupportedControlProtocolVersion(version: string): boolean {
  return SUPPORTED_CONTROL_PROTOCOL_VERSIONS.includes(
    version as (typeof SUPPORTED_CONTROL_PROTOCOL_VERSIONS)[number],
  );
}
