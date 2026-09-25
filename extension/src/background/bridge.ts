/**
 * Dev WebSocket bridge to the Remora orchestrator.
 *
 * Owns the connection lifecycle (handshake, reconnect backoff, keepalive),
 * validates every inbound envelope with `@remora/protocol`, routes observe and
 * action requests to the active tab's content script, and correlates every
 * response with its request. It never touches page DOM directly.
 */
import {
  EnvelopeSchema,
  PROTOCOL_VERSION,
  isSupportedProtocolVersion,
  makeEnvelope,
  parseMessage,
  type BrowserActionRequestPayload,
  type BridgeReadyPayload,
  type Envelope,
  type PageObserveRequestPayload,
  type ProtocolErrorCode,
  type ProtocolErrorPayload,
} from "@remora/protocol";
import type { ContentResponseMessage } from "../shared/internal.js";

export const DEFAULT_BRIDGE_URL = "ws://127.0.0.1:8787";
const KEEPALIVE_ALARM = "remora-bridge-keepalive";
const KEEPALIVE_PERIOD_MINUTES = 25 / 60;
const HANDSHAKE_TIMEOUT_MS = 5_000;
const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;
const RECONNECT_JITTER = 0.2;

export interface BridgeStatus {
  connected: boolean;
  bridgeUrl: string;
  version: string;
  tab: { supported: boolean; url: string };
  hostAccess: {
    origin: string | null;
    granted: boolean;
    canRequest: boolean;
  };
}

/** Thrown when the active tab cannot serve a content-script request. */
class ContentScriptError extends Error {
  constructor(
    readonly code: "PAGE_PERMISSION_REQUIRED" | "PAGE_NOT_SUPPORTED",
    message: string,
  ) {
    super(message);
    this.name = "ContentScriptError";
  }
}

interface TabContext {
  tabId: number;
  url: string;
  title: string;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class Bridge {
  private ws: WebSocket | null = null;
  private ready = false;
  private started = false;

  private bridgeUrl = DEFAULT_BRIDGE_URL;
  private bridgeToken: string | null = null;
  private lastError: string | null = null;

  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;

  private actionInFlight = false;

  async start(): Promise<void> {
    if (!this.started) {
      this.started = true;
      chrome.alarms.create(KEEPALIVE_ALARM, {
        periodInMinutes: KEEPALIVE_PERIOD_MINUTES,
        delayInMinutes: KEEPALIVE_PERIOD_MINUTES,
      });
      chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === KEEPALIVE_ALARM) void this.ensureConnected();
      });
    }
    await this.loadSettings();
    this.connect();
  }

  async reloadSettings(): Promise<void> {
    await this.loadSettings();
  }

  async reconnect(): Promise<void> {
    this.reconnectAttempt = 0;
    this.clearHandshakeTimer();
    this.clearReconnectTimer();
    this.teardownSocket();
    await this.loadSettings();
    this.connect();
  }

  async ensureConnected(): Promise<void> {
    if (
      !this.ws ||
      this.ws.readyState === WebSocket.CLOSED ||
      this.ws.readyState === WebSocket.CLOSING
    ) {
      this.reconnectAttempt = 0;
      await this.loadSettings();
      this.connect();
    }
  }

  async getStatus(): Promise<BridgeStatus> {
    const tab = await this.activeTab();
    return {
      connected: this.ready,
      bridgeUrl: this.bridgeUrl,
      version: chrome.runtime.getManifest().version,
      tab: {
        supported: tab ? this.isSupportedUrl(tab.url) : false,
        url: tab?.url ?? "",
      },
      hostAccess: await this.hostAccess(tab),
    };
  }

  private async hostAccess(
    tab: TabContext | null,
  ): Promise<BridgeStatus["hostAccess"]> {
    if (!tab || !this.isSupportedUrl(tab.url)) {
      return { origin: null, granted: false, canRequest: false };
    }
    let origin: string;
    try {
      origin = new URL(tab.url).origin;
    } catch {
      return { origin: null, granted: false, canRequest: false };
    }
    const granted = await chrome.permissions.contains({ origins: [`${origin}/*`] });
    return { origin, granted, canRequest: !granted };
  }

  private async loadSettings(): Promise<void> {
    const stored = await chrome.storage.local.get(["bridgeUrl", "bridgeToken"]);
    const url = stored.bridgeUrl;
    this.bridgeUrl = typeof url === "string" && url.trim() ? url.trim() : DEFAULT_BRIDGE_URL;
    const token = stored.bridgeToken;
    this.bridgeToken = typeof token === "string" && token.trim() ? token.trim() : null;
  }

  private connect(): void {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    this.clearReconnectTimer();
    this.ready = false;

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.bridgeUrl);
    } catch (error) {
      this.lastError = `could not open websocket: ${messageOf(error)}`;
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;

    socket.addEventListener("open", () => {
      if (this.ws !== socket) return;
      console.info("[remora] bridge socket open");
      void this.sendHello();
      this.armHandshakeTimeout(socket);
    });

    socket.addEventListener("message", (event) => {
      if (this.ws !== socket) return;
      void this.handleInbound(event.data);
    });

    socket.addEventListener("close", () => {
      if (this.ws !== socket) return;
      this.ws = null;
      this.ready = false;
      this.clearHandshakeTimer();
      this.lastError = "socket closed";
      this.scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      if (this.ws !== socket) return;
      this.lastError = "websocket error";
    });
  }

  private teardownSocket(): void {
    const socket = this.ws;
    this.ws = null;
    this.ready = false;
    if (socket) {
      try {
        socket.close();
      } catch {
        /* ignore */
      }
    }
  }

  private async sendHello(): Promise<void> {
    const tab = await this.activeTab();
    this.send(
      makeEnvelope("extension", "bridge.hello", {
        extensionVersion: chrome.runtime.getManifest().version,
        protocolVersions: [PROTOCOL_VERSION],
        browserVersion: navigator.userAgent,
        token: this.bridgeToken,
        activeTab: tab ? { tabId: tab.tabId, url: tab.url, title: tab.title } : null,
      }),
    );
  }

  private armHandshakeTimeout(socket: WebSocket): void {
    this.clearHandshakeTimer();
    this.handshakeTimer = setTimeout(() => {
      if (this.ws === socket && !this.ready) {
        console.warn("[remora] bridge handshake timed out; reconnecting");
        this.reconnectSoon("handshake timed out");
      }
    }, HANDSHAKE_TIMEOUT_MS);
  }

  private clearHandshakeTimer(): void {
    if (this.handshakeTimer !== null) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /** Close the current socket and schedule a backoff reconnect. */
  private reconnectSoon(reason: string): void {
    this.lastError = reason;
    this.clearHandshakeTimer();
    this.teardownSocket();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    const base = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** this.reconnectAttempt);
    const jitter = Math.round(base * RECONNECT_JITTER * Math.random());
    const delay = base + jitter;
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private send(envelope: Envelope): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(envelope));
    }
  }

  private sendError(
    correlationId: string | null,
    code: ProtocolErrorCode,
    message: string,
    retryable?: boolean,
  ): void {
    this.send(
      makeEnvelope("extension", "protocol.error", { code, message, retryable }, correlationId),
    );
  }

  private async handleInbound(raw: unknown): Promise<void> {
    let data: unknown;
    try {
      data = JSON.parse(typeof raw === "string" ? raw : "");
    } catch {
      console.warn("[remora] dropped non-JSON bridge message");
      return;
    }

    let parsed: ReturnType<typeof parseMessage>;
    try {
      parsed = parseMessage(data);
    } catch (error) {
      let correlationId: string | null = null;
      try {
        correlationId = EnvelopeSchema.parse(data).id;
      } catch {
        correlationId = null;
      }
      this.sendError(correlationId, "ACTION_FAILED", `Invalid message: ${messageOf(error)}`, false);
      return;
    }

    const { envelope, type, payload } = parsed;

    if (!isSupportedProtocolVersion(envelope.protocolVersion)) {
      this.sendError(
        envelope.id,
        "PROTOCOL_VERSION_UNSUPPORTED",
        `Unsupported protocol version ${envelope.protocolVersion}`,
        false,
      );
      if (!this.ready) this.reconnectSoon("protocol version unsupported");
      return;
    }

    switch (type) {
      case "bridge.ready": {
        const readyPayload = payload as BridgeReadyPayload;
        if (!isSupportedProtocolVersion(readyPayload.protocolVersion)) {
          console.warn(
            `[remora] orchestrator protocol ${readyPayload.protocolVersion} is unsupported; reconnecting later`,
          );
          this.reconnectSoon("orchestrator protocol version unsupported");
          return;
        }
        this.ready = true;
        this.reconnectAttempt = 0;
        this.clearHandshakeTimer();
        this.lastError = null;
        console.info(
          "[remora] bridge ready",
          readyPayload.capabilities.length ? readyPayload.capabilities.join(",") : "(no capabilities)",
        );
        return;
      }
      case "protocol.error": {
        const errorPayload = payload as ProtocolErrorPayload;
        console.warn(`[remora] orchestrator error ${errorPayload.code}: ${errorPayload.message}`);
        this.lastError = `${errorPayload.code}: ${errorPayload.message}`;
        if (!this.ready) this.reconnectSoon("handshake rejected");
        return;
      }
      case "page.observe.request":
        await this.handleObserve(envelope, payload as PageObserveRequestPayload);
        return;
      case "browser.action.request":
        await this.handleAction(envelope, payload as BrowserActionRequestPayload);
        return;
      case "browser.cancel":
        this.sendError(envelope.id, "NOT_IMPLEMENTED", "Cancellation is not supported.", false);
        return;
      default:
        return;
    }
  }

  private async activeTab(): Promise<TabContext | null> {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab || typeof tab.id !== "number") return null;
    return { tabId: tab.id, url: tab.url ?? "", title: tab.title ?? "" };
  }

  private isSupportedUrl(url: string): boolean {
    return /^https?:\/\//i.test(url);
  }

  /**
   * Sends a content-script message, injecting the content script once when the
   * page has no listener (real sites such as vercel.com are not declared in the
   * manifest and require a granted optional host permission).
   */
  private async sendToTab(tab: TabContext, message: unknown): Promise<ContentResponseMessage> {
    try {
      const response = await chrome.tabs.sendMessage(tab.tabId, message);
      if (response !== undefined) return response as ContentResponseMessage;
      throw new Error("Content script did not respond.");
    } catch (firstError) {
      const injected = await this.ensureContentScript(tab);
      let origin = tab.url;
      try {
        origin = new URL(tab.url).origin;
      } catch {
        /* keep the full url */
      }
      if (!injected) {
        throw new ContentScriptError(
          "PAGE_PERMISSION_REQUIRED",
          `Remora needs site access for ${origin}. Open the Remora popup on that tab and click "Grant access".`,
        );
      }
      try {
        const response = await chrome.tabs.sendMessage(tab.tabId, message);
        if (response !== undefined) return response as ContentResponseMessage;
        throw new Error("Content script did not respond after injection.");
      } catch {
        throw new ContentScriptError(
          "PAGE_NOT_SUPPORTED",
          `Injected content script did not answer on ${origin}: ${messageOf(firstError)}`,
        );
      }
    }
  }

  private async ensureContentScript(tab: TabContext): Promise<boolean> {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.tabId },
        files: ["content/content-script.js"],
      });
      return true;
    } catch (error) {
      console.warn(
        `[remora] content-script injection failed for ${tab.url}: ${messageOf(error)}`,
      );
      return false;
    }
  }

  private async handleObserve(
    envelope: Envelope,
    payload: PageObserveRequestPayload,
  ): Promise<void> {
    const tab = await this.activeTab();
    if (!tab) {
      this.sendError(envelope.id, "TAB_NOT_FOUND", "No active tab is available.", false);
      return;
    }
    if (!this.isSupportedUrl(tab.url)) {
      this.sendError(
        envelope.id,
        "PAGE_NOT_SUPPORTED",
        `The active page is not supported: ${tab.url}`,
        false,
      );
      return;
    }

    try {
      const response = await this.sendToTab(tab, {
        type: "remora.observe",
        tabId: tab.tabId,
        maxElements: payload.maxElements,
        maxTextLength: payload.maxTextLength,
      });

      if (response && response.ok && "observation" in response) {
        this.send(
          makeEnvelope(
            "extension",
            "page.observe.response",
            { observation: response.observation },
            envelope.id,
          ),
        );
        return;
      }
      const error =
        response && !response.ok
          ? response.error
          : { code: "PAGE_NOT_SUPPORTED" as ProtocolErrorCode, message: "Content script did not respond.", retryable: true };
      this.sendError(envelope.id, error.code, error.message, error.retryable);
    } catch (error) {
      const code = error instanceof ContentScriptError ? error.code : "PAGE_NOT_SUPPORTED";
      this.sendError(envelope.id, code, messageOf(error), true);
    }
  }

  private async handleAction(
    envelope: Envelope,
    payload: BrowserActionRequestPayload,
  ): Promise<void> {
    if (this.actionInFlight) {
      this.sendError(
        envelope.id,
        "ACTION_FAILED",
        "A previous action is still running; retry after it completes.",
        true,
      );
      return;
    }

    const tab = await this.activeTab();
    if (!tab) {
      this.sendError(envelope.id, "TAB_NOT_FOUND", "No active tab is available.", false);
      return;
    }
    if (!this.isSupportedUrl(tab.url)) {
      this.sendError(
        envelope.id,
        "PAGE_NOT_SUPPORTED",
        `The active page is not supported: ${tab.url}`,
        false,
      );
      return;
    }

    const beforeUrl = tab.url;
    this.actionInFlight = true;
    try {
      const response = await this.sendToTab(tab, {
        type: "remora.action",
        tabId: tab.tabId,
        runId: payload.runId,
        stepId: payload.stepId,
        snapshotId: payload.snapshotId,
        action: payload.action,
        timeoutMs: payload.timeoutMs,
      });

      if (response && response.ok && "result" in response) {
        const result = response.result;
        this.send(
          makeEnvelope(
            "extension",
            "browser.action.result",
            {
              runId: payload.runId,
              stepId: payload.stepId,
              status: result.status,
              effect: result.effect,
              error: result.error,
              observation: result.observation,
            },
            envelope.id,
          ),
        );
        return;
      }

      const error =
        response && !response.ok
          ? response.error
          : { code: "ACTION_FAILED" as ProtocolErrorCode, message: "Content script did not respond.", retryable: true };
      this.sendActionResult(payload, envelope.id, "failed", undefined, {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      });
    } catch (error) {
      if (error instanceof ContentScriptError) {
        this.sendError(envelope.id, error.code, error.message, true);
        return;
      }
      // A navigation can destroy the content script mid-action. If the URL
      // changed, treat the action as succeeded; otherwise the outcome is unknown.
      const after = await this.activeTab();
      if (after && after.url && after.url !== beforeUrl) {
        this.sendActionResult(
          payload,
          envelope.id,
          "succeeded",
          `action triggered navigation to ${after.url}`,
        );
      } else {
        this.sendActionResult(payload, envelope.id, "uncertain", undefined, {
          code: "ACTION_RESULT_UNCERTAIN",
          message: `Action outcome unknown: ${messageOf(error)}`,
          retryable: false,
        });
      }
    } finally {
      this.actionInFlight = false;
    }
  }

  private sendActionResult(
    payload: BrowserActionRequestPayload,
    correlationId: string,
    status: "succeeded" | "failed" | "uncertain" | "cancelled",
    effect?: string,
    error?: { code: ProtocolErrorCode; message: string; retryable?: boolean },
  ): void {
    this.send(
      makeEnvelope(
        "extension",
        "browser.action.result",
        {
          runId: payload.runId,
          stepId: payload.stepId,
          status,
          effect,
          error,
        },
        correlationId,
      ),
    );
  }
}
