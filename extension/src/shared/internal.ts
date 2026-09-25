/**
 * Internal messaging contracts between the service worker and content script.
 *
 * These messages never cross the bridge; protocol envelopes live in
 * `@remora/protocol`. Keeping them typed here avoids ad-hoc `unknown` casts in
 * both directions.
 */
import type {
  BrowserAction,
  PageObservation,
  ProtocolErrorCode,
} from "@remora/protocol";
import type { ExecutionResult } from "../content/executor.js";

export interface ObserveRequestMessage {
  type: "remora.observe";
  tabId: number | null;
  maxElements?: number;
  maxTextLength?: number;
}

export interface ActionRequestMessage {
  type: "remora.action";
  tabId: number | null;
  runId: string;
  stepId: string;
  snapshotId: string;
  action: BrowserAction;
  timeoutMs?: number;
}

export type ContentRequestMessage = ObserveRequestMessage | ActionRequestMessage;

export interface ContentError {
  code: ProtocolErrorCode;
  message: string;
  retryable?: boolean;
}

export interface ObserveResponseMessage {
  ok: true;
  observation: PageObservation;
}

export interface ActionResultResponseMessage {
  ok: true;
  result: ExecutionResult;
}

export interface ContentErrorResponse {
  ok: false;
  error: ContentError;
}

export type ContentResponseMessage =
  | ObserveResponseMessage
  | ActionResultResponseMessage
  | ContentErrorResponse;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isContentRequest(value: unknown): value is ContentRequestMessage {
  if (!isRecord(value)) return false;
  const type = value.type;
  return type === "remora.observe" || type === "remora.action";
}
