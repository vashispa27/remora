/**
 * WebSocket implementation of BrowserChannel (dev bridge).
 *
 * The Chrome extension connects to this server, performs the bridge.hello /
 * bridge.ready handshake, then serves page.observe.request and
 * browser.action.request envelopes. Swap this class for a native-messaging
 * relay later; the orchestrator only sees BrowserChannel.
 */
import { WebSocketServer, type RawData, type WebSocket as WsSocket } from "ws";
import {
  PROTOCOL_VERSION,
  isSupportedProtocolVersion,
  makeEnvelope,
  parseMessage,
  type PageObservation,
  type PageObserveRequestPayload,
} from "@remora/protocol";
import type { AgentConfig } from "../config.js";
import type { ActionOutcome, BrowserChannel, ExecuteActionRequest } from "../core/contracts.js";

export class BridgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BridgeError";
  }
}

interface PendingRequest {
  expectedType: string;
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface WsBrowserChannelOptions {
  config: AgentConfig;
  logger?: (line: string) => void;
}

export class WsBrowserChannel implements BrowserChannel {
  private server: WebSocketServer | null = null;
  private socket: WsSocket | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly readyWaiters: Array<() => void> = [];
  private handshaken = false;
  private activeTab: { tabId: number; url: string; title: string } | null = null;
  private closed = false;
  private readonly logger: (line: string) => void;

  constructor(private readonly options: WsBrowserChannelOptions) {
    this.logger = options.logger ?? (() => {});
  }

  async start(): Promise<void> {
    const { config } = this.options;
    this.server = new WebSocketServer({ host: config.wsHost, port: config.wsPort });
    this.server.on("connection", (socket) => this.handleConnection(socket));
    await new Promise<void>((resolve, reject) => {
      this.server!.once("listening", resolve);
      this.server!.once("error", reject);
    });
    this.logger(`[bridge] listening on ws://${config.wsHost}:${config.wsPort}`);
  }

  get connected(): boolean {
    return this.handshaken && this.socket !== null && this.socket.readyState === this.socket.OPEN;
  }

  get tab(): { tabId: number; url: string; title: string } | null {
    return this.activeTab;
  }

  /** Resolves once a valid extension handshake has completed. */
  async waitForExtension(timeoutMs = 30_000): Promise<void> {
    if (this.connected) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new BridgeError("BRIDGE_NOT_CONNECTED", "No extension connected in time.")),
        timeoutMs,
      );
      this.readyWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async observe(opts?: PageObserveRequestPayload): Promise<PageObservation> {
    const payload = (await this.request(
      "page.observe.request",
      opts ?? {},
      "page.observe.response",
      this.options.config.limits.observeTimeoutMs,
    )) as { observation: PageObservation };
    return payload.observation;
  }

  async execute(req: ExecuteActionRequest): Promise<ActionOutcome> {
    const payload = (await this.request(
      "browser.action.request",
      {
        runId: req.runId,
        stepId: req.stepId,
        snapshotId: req.snapshotId,
        action: req.action,
        timeoutMs: req.timeoutMs,
      },
      "browser.action.result",
      (req.timeoutMs ?? this.options.config.limits.actionTimeoutMs) + 5_000,
    )) as ActionOutcome;
    return payload;
  }

  async cancel(runId: string): Promise<void> {
    if (!this.connected || !this.socket) return;
    this.socket.send(JSON.stringify(makeEnvelope("orchestrator", "browser.cancel", { runId })));
  }

  async close(): Promise<void> {
    this.closed = true;
    this.failPending("BRIDGE_NOT_CONNECTED", "Bridge closed.");
    this.socket?.close();
    this.socket = null;
    this.handshaken = false;
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server = null;
    }
  }

  private handleConnection(socket: WsSocket): void {
    if (this.closed) {
      socket.close();
      return;
    }
    if (this.socket && this.socket.readyState === this.socket.OPEN) {
      this.logger("[bridge] replacing previous extension connection");
      this.failPending("BRIDGE_NOT_CONNECTED", "Replaced by a new extension connection.");
      this.socket.close();
    }
    this.socket = socket;
    this.handshaken = false;
    this.activeTab = null;

    const handshakeTimer = setTimeout(() => {
      this.logger("[bridge] handshake timed out");
      socket.close();
    }, 5_000);

    socket.on("message", (data: RawData) => this.handleMessage(socket, data, handshakeTimer));
    socket.on("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.handshaken = false;
      this.activeTab = null;
      this.failPending("BRIDGE_NOT_CONNECTED", "Extension disconnected.");
      this.logger("[bridge] extension disconnected");
    });
    socket.on("error", (error: Error) => this.logger(`[bridge] socket error: ${error.message}`));
  }

  private handleMessage(socket: WsSocket, data: RawData, handshakeTimer: NodeJS.Timeout): void {
    let parsed: ReturnType<typeof parseMessage>;
    try {
      const raw = JSON.parse(String(data)) as unknown;
      parsed = parseMessage(raw);
    } catch (error) {
      this.logger(`[bridge] rejected malformed message: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    const { envelope, type, payload } = parsed;

    if (type === "bridge.hello") {
      clearTimeout(handshakeTimer);
      const hello = payload as {
        extensionVersion: string;
        protocolVersions: string[];
        token?: string | null;
        activeTab?: { tabId: number; url: string; title: string } | null;
      };
      if (!hello.protocolVersions.some(isSupportedProtocolVersion)) {
        socket.send(
          JSON.stringify(
            makeEnvelope("orchestrator", "protocol.error", {
              code: "PROTOCOL_VERSION_UNSUPPORTED",
              message: `Extension supports ${hello.protocolVersions.join(", ")}; orchestrator supports ${PROTOCOL_VERSION}.`,
              retryable: false,
            }),
          ),
        );
        socket.close();
        return;
      }
      const expected = this.options.config.bridgeToken;
      if (expected && hello.token !== expected) {
        socket.send(
          JSON.stringify(
            makeEnvelope("orchestrator", "protocol.error", {
              code: "POLICY_BLOCKED",
              message: "Invalid bridge token.",
              retryable: false,
            }),
          ),
        );
        socket.close();
        return;
      }
      this.handshaken = true;
      this.activeTab = hello.activeTab ?? null;
      socket.send(
        JSON.stringify(
          makeEnvelope("orchestrator", "bridge.ready", {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: ["page.observe", "browser.action", "browser.cancel"],
          }),
        ),
      );
      this.logger(`[bridge] extension connected (${hello.extensionVersion})`);
      this.readyWaiters.splice(0).forEach((resolve) => resolve());
      return;
    }

    if (!this.handshaken) {
      this.logger(`[bridge] ignoring ${type} before handshake`);
      return;
    }

    if (type === "bridge.status") {
      this.logger(`[bridge] status: ${JSON.stringify(payload)}`);
      return;
    }

    if (type === "protocol.error") {
      const err = payload as { code: string; message: string };
      if (envelope.correlationId) {
        const pending = this.pending.get(envelope.correlationId);
        if (pending) {
          this.settle(envelope.correlationId, pending);
          pending.reject(new BridgeError(err.code, err.message));
        }
      } else {
        this.logger(`[bridge] protocol error: ${err.code}: ${err.message}`);
      }
      return;
    }

    if (!envelope.correlationId) return;
    const pending = this.pending.get(envelope.correlationId);
    if (!pending) return;
    if (type !== pending.expectedType) {
      this.settle(envelope.correlationId, pending);
      pending.reject(
        new BridgeError(
          "ACTION_FAILED",
          `Expected ${pending.expectedType} but received ${type} for ${envelope.correlationId}.`,
        ),
      );
      return;
    }
    this.settle(envelope.correlationId, pending);
    pending.resolve(payload);
  }

  private request(
    type: "page.observe.request" | "browser.action.request",
    payload: unknown,
    expectedType: string,
    timeoutMs: number,
  ): Promise<unknown> {
    if (!this.connected || !this.socket) {
      return Promise.reject(
        new BridgeError("BRIDGE_NOT_CONNECTED", "The Chrome extension is not connected to the bridge."),
      );
    }
    const envelope = makeEnvelope(
      "orchestrator",
      type,
      payload as never,
    );
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(envelope.id);
        reject(new BridgeError("ACTION_TIMEOUT", `No ${expectedType} within ${timeoutMs} ms.`));
      }, timeoutMs);
      this.pending.set(envelope.id, { expectedType, resolve, reject, timer });
      this.socket!.send(JSON.stringify(envelope));
    });
  }

  private settle(id: string, pending: PendingRequest): void {
    clearTimeout(pending.timer);
    this.pending.delete(id);
  }

  private failPending(code: string, message: string): void {
    for (const [id, pending] of this.pending) {
      this.settle(id, pending);
      pending.reject(new BridgeError(code, message));
    }
  }
}
