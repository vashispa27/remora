/**
 * Control server: the macOS app's entry point into the agent.
 *
 * One local WebSocket client (the app). The orchestrator owns the run; this
 * server accepts run.start, streams run.event, bridges approval round-trips,
 * and cancels the run when the app disconnects. Model IDs, browser access, and
 * loop policy stay on this side.
 */
import { WebSocketServer, type RawData, type WebSocket as WsSocket } from "ws";
import { newId } from "@remora/protocol";
import {
  CONTROL_PROTOCOL_VERSION,
  isSupportedControlProtocolVersion,
  makeControlEnvelope,
  parseControlMessage,
  type ControlEnvelope,
  type ControlEvent,
  type ControlTarget,
} from "@remora/protocol/control";
import type { AgentConfig } from "../config.js";
import type {
  ApprovalDecision,
  ApprovalGate,
  ApprovalRequest,
  BrowserChannel,
  JevSelector,
  ModelGateway,
  Planner,
  RunResult,
  Verifier,
} from "../core/contracts.js";
import { DefaultOrchestrator } from "../orchestrator/orchestrator.js";
import { mapOrchestratorEvent, type MapperContext } from "./event-mapper.js";

export interface RunBrain {
  gateway: ModelGateway;
  planner: Planner;
  jev: JevSelector;
  verifier: Verifier;
  browser: BrowserChannel;
}

export interface ControlServerDeps {
  config: AgentConfig;
  /** Builds fresh components per run (fakes are stateful). */
  createBrain: () => RunBrain | Promise<RunBrain>;
  agentVersion?: string;
  logger?: (line: string) => void;
}

interface ActiveRun {
  runId: string;
  orchestrator: DefaultOrchestrator;
  pendingApproval: { id: string; resolve: (decision: ApprovalDecision) => void } | null;
}

function summarizeApproval(req: ApprovalRequest): string {
  const target = req.target ? `${req.target.role} "${req.target.name}"` : "the page";
  switch (req.action.kind) {
    case "click":
      return `Click ${target}`;
    case "type":
      return `Type ${req.action.value.length} characters into ${target}`;
    case "select":
      return `Select "${req.action.option}" in ${target}`;
    case "scroll":
      return `Scroll ${req.action.direction}`;
    case "wait":
      return `Wait ${req.action.ms} ms`;
  }
}

function targetFromApproval(req: ApprovalRequest): ControlTarget | null {
  if (!req.target) return null;
  return {
    ref: req.target.ref,
    role: req.target.role,
    name: req.target.name,
    url: req.url ?? null,
    rect: req.target.rect ?? null,
  };
}

export class ControlServer {
  private server: WebSocketServer | null = null;
  private socket: WsSocket | null = null;
  private handshaken = false;
  private activeRun: ActiveRun | null = null;
  private readonly logger: (line: string) => void;
  private readonly agentVersion: string;

  constructor(private readonly deps: ControlServerDeps) {
    this.logger = deps.logger ?? (() => {});
    this.agentVersion = deps.agentVersion ?? "0.1.0";
  }

  async start(): Promise<void> {
    const { controlHost, controlPort } = this.deps.config;
    this.server = new WebSocketServer({ host: controlHost, port: controlPort });
    this.server.on("connection", (socket) => this.handleConnection(socket));
    await new Promise<void>((resolve, reject) => {
      this.server!.once("listening", resolve);
      this.server!.once("error", reject);
    });
    this.logger(`[control] listening on ws://${controlHost}:${controlPort}`);
  }

  async close(): Promise<void> {
    this.denyPending("Control channel closed");
    this.activeRun?.orchestrator.cancel("Control channel closed");
    this.activeRun = null;
    this.socket?.close();
    this.socket = null;
    this.handshaken = false;
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server = null;
    }
  }

  private handleConnection(socket: WsSocket): void {
    if (this.socket && this.socket.readyState === this.socket.OPEN) {
      this.logger("[control] replacing previous app connection");
      this.denyPending("Replaced by a new app connection");
      this.activeRun?.orchestrator.cancel("Replaced by a new app connection");
      this.activeRun = null;
      this.socket.close();
    }
    this.socket = socket;
    this.handshaken = false;

    socket.on("message", (data: RawData) => this.handleMessage(data));
    socket.on("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.handshaken = false;
      // The app is the operator: losing it pauses automation.
      this.denyPending("App disconnected");
      this.activeRun?.orchestrator.cancel("App disconnected");
      this.activeRun = null;
      this.logger("[control] app disconnected");
    });
    socket.on("error", (error: Error) => this.logger(`[control] socket error: ${error.message}`));
  }

  private handleMessage(data: RawData): void {
    let type: string;
    let payload: unknown;
    try {
      const parsed = parseControlMessage(JSON.parse(String(data)) as unknown);
      type = parsed.type;
      payload = parsed.payload;
    } catch (error) {
      this.sendError("INVALID_MESSAGE", error instanceof Error ? error.message : String(error));
      return;
    }

    if (type === "control.hello") {
      this.handleHello(payload as { protocolVersions: string[]; token?: string | null });
      return;
    }

    if (!this.handshaken) {
      this.sendError("NOT_READY", "Send control.hello before any run message.");
      return;
    }

    switch (type) {
      case "run.start":
        void this.handleRunStart((payload as { prompt: string }).prompt);
        return;
      case "run.cancel":
        this.handleRunCancel((payload as { runId: string }).runId);
        return;
      case "run.approval":
        this.handleRunApproval(payload as { runId: string; approvalId: string; approved: boolean; reason?: string | null });
        return;
      case "control.error":
        this.logger(`[control] app error: ${JSON.stringify(payload)}`);
        return;
      default:
        this.sendError("UNKNOWN_TYPE", `Unsupported control message type: ${type}`);
    }
  }

  private handleHello(payload: { protocolVersions: string[]; token?: string | null }): void {
    if (!this.socket) return;
    if (!payload.protocolVersions.some(isSupportedControlProtocolVersion)) {
      this.sendError(
        "PROTOCOL_VERSION_UNSUPPORTED",
        `App supports ${payload.protocolVersions.join(", ")}; agent supports ${CONTROL_PROTOCOL_VERSION}.`,
      );
      this.socket.close();
      return;
    }
    const expected = this.deps.config.controlToken;
    if (expected && payload.token !== expected) {
      this.sendError("POLICY_BLOCKED", "Invalid control token.");
      this.socket.close();
      return;
    }
    this.handshaken = true;
    this.send(
      makeControlEnvelope("orchestrator", "control.ready", {
        protocolVersion: CONTROL_PROTOCOL_VERSION,
        agentVersion: this.agentVersion,
        status: this.activeRun ? "busy" : "idle",
      }),
    );
    this.logger("[control] app connected");
  }

  private async handleRunStart(prompt: string): Promise<void> {
    if (this.activeRun) {
      this.sendError("RUN_IN_PROGRESS", "A run is already active; cancel it first.", true);
      return;
    }

    const brain = await this.deps.createBrain();
    const connectable = brain.browser as BrowserChannel & { connected?: boolean };
    if (connectable.connected === false) {
      this.sendError(
        "BRIDGE_NOT_CONNECTED",
        "The Chrome extension is not connected. Load extension/dist and open the target tab.",
        true,
      );
      return;
    }

    const runId = newId();
    const ctx: MapperContext = {};

    const approvalGate: ApprovalGate = {
      request: (req) => this.requestApproval(runId, req),
    };

    const orchestrator = new DefaultOrchestrator({
      config: this.deps.config,
      gateway: brain.gateway,
      planner: brain.planner,
      jev: brain.jev,
      verifier: brain.verifier,
      browser: brain.browser,
      logger: this.logger,
    });

    this.activeRun = { runId, orchestrator, pendingApproval: null };
    this.send(makeControlEnvelope("orchestrator", "run.accepted", { runId }));
    this.logger(`[control] run ${runId} started: ${prompt}`);

    try {
      const result = await orchestrator.run({
        prompt,
        approvalGate,
        events: (event) => {
          const mapped = mapOrchestratorEvent(event, ctx);
          if (mapped) this.sendEvent(runId, mapped);
        },
      });
      this.sendEvent(runId, this.finishedEvent(result));
    } catch (error) {
      this.sendEvent(runId, {
        type: "finished",
        status: "failed",
        summary: error instanceof Error ? error.message : String(error),
        errorCode: "AGENT_ERROR",
      });
    } finally {
      this.denyPending("Run ended");
      this.activeRun = null;
      this.logger(`[control] run ${runId} ended`);
    }
  }

  private finishedEvent(result: RunResult): ControlEvent {
    let summary = result.summary;
    if (result.status === "needs_input" && result.questions && result.questions.length > 0) {
      summary = `${summary} ${result.questions.map((question) => question.question).join(" ")}`;
    }
    return {
      type: "finished",
      status: result.status,
      summary,
      errorCode: result.errorCode ?? null,
    };
  }

  private handleRunCancel(runId: string): void {
    if (!this.activeRun || this.activeRun.runId !== runId) {
      this.sendError("NO_ACTIVE_RUN", `No active run ${runId}.`);
      return;
    }
    this.logger(`[control] run ${runId} cancel requested`);
    this.denyPending("Run cancelled by the app");
    this.activeRun.orchestrator.cancel("Cancelled by the macOS app");
  }

  private handleRunApproval(payload: {
    runId: string;
    approvalId: string;
    approved: boolean;
    reason?: string | null;
  }): void {
    const run = this.activeRun;
    if (!run || run.runId !== payload.runId) {
      this.sendError("NO_ACTIVE_RUN", `No active run ${payload.runId}.`);
      return;
    }
    const pending = run.pendingApproval;
    if (!pending || pending.id !== payload.approvalId) {
      this.sendError("NO_PENDING_APPROVAL", "The approval is no longer awaiting a decision.");
      return;
    }
    run.pendingApproval = null;
    this.logger(`[control] approval ${payload.approvalId}: ${payload.approved ? "approved" : "denied"}`);
    pending.resolve(
      payload.approved
        ? { approved: true }
        : { approved: false, reason: payload.reason ?? "Denied in the macOS app" },
    );
  }

  private async requestApproval(
    runId: string,
    req: ApprovalRequest,
  ): Promise<ApprovalDecision> {
    const run = this.activeRun;
    if (!run || run.runId !== runId || !this.socket) {
      return { approved: false, reason: "Control connection unavailable" };
    }
    const approvalId = newId();
    this.sendEvent(runId, {
      type: "approval_request",
      approvalId,
      risk: req.risk,
      summary: summarizeApproval(req),
      reason: req.reason,
      target: targetFromApproval(req),
    });

    const decision = await new Promise<ApprovalDecision>((resolve) => {
      run.pendingApproval = { id: approvalId, resolve };
    });

    if (this.socket) {
      this.sendEvent(runId, {
        type: "approval_resolved",
        approvalId,
        approved: decision.approved,
      });
    }
    return decision;
  }

  private denyPending(reason: string): void {
    const pending = this.activeRun?.pendingApproval;
    if (!pending) return;
    this.activeRun!.pendingApproval = null;
    pending.resolve({ approved: false, reason });
  }

  private sendEvent(runId: string, event: ControlEvent): void {
    this.send(makeControlEnvelope("orchestrator", "run.event", { runId, event }));
  }

  private sendError(code: string, message: string, retryable?: boolean): void {
    this.send(makeControlEnvelope("orchestrator", "control.error", { code, message, retryable }));
  }

  private send(envelope: ControlEnvelope): void {
    if (this.socket && this.socket.readyState === this.socket.OPEN) {
      this.socket.send(JSON.stringify(envelope));
    }
  }
}
