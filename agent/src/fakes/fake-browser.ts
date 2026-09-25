/**
 * Deterministic fake browser channel that simulates the mock AWS fixture pages
 * (home -> create form -> created) with the exact element names used by
 * fixtures/mock-aws/. Lets the orchestrator loop run end to end with no Chrome.
 *
 * OWNER: fakes subagent.
 */
import {
  PageObservationSchema,
  type PageElement,
  type PageObservation,
  type PageObserveRequestPayload,
  type ProtocolErrorCode,
} from "@remora/protocol";
import type { BrowserChannel, ExecuteActionRequest, ActionOutcome } from "../core/contracts.js";

export interface FakeBrowserOptions {
  fixture?: "dynamodb";
  tableName?: string;
  partitionKey?: string;
  /** Injects one deterministic uncertain result for the first action of this kind. */
  failOnce?: { stepKind: string };
}

type StateName = "home" | "form" | "created";

const FIXTURE_ORIGIN = "http://127.0.0.1:4173";
const PARTITION_KEY_TYPES = ["String", "Number", "Binary"] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function newSnapshotId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `snap-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export class FakeBrowserChannel implements BrowserChannel {
  private readonly tableName: string;
  private readonly partitionKey: string;
  private failOnce: { stepKind: string } | undefined;

  private state: StateName = "home";
  private form = { tableName: "", partitionKey: "", partitionKeyType: "String" };

  constructor(private readonly options: FakeBrowserOptions = {}) {
    this.tableName = options.tableName ?? "remora-demo";
    this.partitionKey = options.partitionKey ?? "id";
    this.failOnce = options.failOnce;
  }

  // -------------------------------------------------------------------------
  // Page state
  // -------------------------------------------------------------------------

  private createdName(): string {
    return this.form.tableName || this.tableName;
  }

  private tabUrl(): string {
    switch (this.state) {
      case "home":
        return `${FIXTURE_ORIGIN}/`;
      case "form":
        return `${FIXTURE_ORIGIN}/create-table.html`;
      case "created":
        return `${FIXTURE_ORIGIN}/created.html?name=${encodeURIComponent(this.createdName())}`;
    }
  }

  private tabTitle(): string {
    switch (this.state) {
      case "home":
        return "DynamoDB | AWS Console (Mock)";
      case "form":
        return "Create table | DynamoDB (Mock)";
      case "created":
        return "Tables | DynamoDB (Mock)";
    }
  }

  private rect(index: number, height = 32): PageElement["rect"] {
    return { x: 24, y: 24 + index * 44, width: 640, height };
  }

  private homeElements(): PageElement[] {
    return [
      {
        ref: "e1",
        role: "heading",
        name: "DynamoDB",
        tag: "h1",
        text: "DynamoDB",
        enabled: true,
        visible: true,
        editable: false,
        sensitive: false,
        rect: this.rect(0),
        semanticPath: ["main", "h1"],
        boundary: "main",
      },
      {
        ref: "e2",
        role: "button",
        name: "Create table",
        tag: "button",
        text: "Create table",
        enabled: true,
        visible: true,
        editable: false,
        sensitive: false,
        rect: this.rect(1, 36),
        semanticPath: ["main", "button"],
        boundary: "main",
      },
      {
        ref: "e3",
        role: "table",
        name: "Tables",
        tag: "table",
        text: "Name Status Partition key No tables",
        enabled: true,
        visible: true,
        editable: false,
        sensitive: false,
        rect: this.rect(2, 120),
        semanticPath: ["main", "table"],
        boundary: "main",
      },
    ];
  }

  private formElements(): PageElement[] {
    return [
      {
        ref: "e1",
        role: "heading",
        name: "Create table",
        tag: "h1",
        text: "Create table",
        enabled: true,
        visible: true,
        editable: false,
        sensitive: false,
        rect: this.rect(0),
        semanticPath: ["main", "h1"],
        boundary: "main",
      },
      {
        ref: "e2",
        role: "textbox",
        name: "Table name",
        tag: "input",
        inputType: "text",
        value: this.form.tableName,
        text: "Table name",
        enabled: true,
        visible: true,
        editable: true,
        sensitive: false,
        rect: this.rect(1, 36),
        semanticPath: ["main", "form", "textbox"],
        boundary: "main",
      },
      {
        ref: "e3",
        role: "textbox",
        name: "Partition key",
        tag: "input",
        inputType: "text",
        value: this.form.partitionKey,
        text: "Partition key",
        enabled: true,
        visible: true,
        editable: true,
        sensitive: false,
        rect: this.rect(2, 36),
        semanticPath: ["main", "form", "textbox"],
        boundary: "main",
      },
      {
        ref: "e4",
        role: "combobox",
        name: "Partition key type",
        tag: "select",
        value: this.form.partitionKeyType,
        selected: true,
        description: `options: ${PARTITION_KEY_TYPES.join(", ")}`,
        text: PARTITION_KEY_TYPES.join(" "),
        enabled: true,
        visible: true,
        editable: true,
        sensitive: false,
        rect: this.rect(3, 36),
        semanticPath: ["main", "form", "combobox"],
        boundary: "main",
      },
      {
        ref: "e5",
        role: "button",
        name: "Cancel",
        tag: "button",
        text: "Cancel",
        enabled: true,
        visible: true,
        editable: false,
        sensitive: false,
        rect: this.rect(4, 36),
        semanticPath: ["main", "form", "button"],
        boundary: "main",
      },
      {
        ref: "e6",
        role: "button",
        name: "Create table",
        tag: "button",
        inputType: "submit",
        text: "Create table",
        enabled: true,
        visible: true,
        editable: false,
        sensitive: false,
        rect: this.rect(5, 36),
        semanticPath: ["main", "form", "button"],
        boundary: "main",
      },
    ];
  }

  private createdElements(): PageElement[] {
    const name = this.createdName();
    return [
      {
        ref: "e1",
        role: "heading",
        name: "Tables",
        tag: "h1",
        text: "Tables",
        enabled: true,
        visible: true,
        editable: false,
        sensitive: false,
        rect: this.rect(0),
        semanticPath: ["main", "h1"],
        boundary: "main",
      },
      {
        ref: "e2",
        role: "status",
        name: "Table created successfully",
        tag: "div",
        text: "Table created successfully",
        enabled: true,
        visible: true,
        editable: false,
        sensitive: false,
        rect: this.rect(1, 36),
        semanticPath: ["main", "status"],
        boundary: "main",
      },
      {
        ref: "e3",
        role: "link",
        name,
        tag: "a",
        text: name,
        enabled: true,
        visible: true,
        editable: false,
        sensitive: false,
        rect: this.rect(2),
        semanticPath: ["main", "table", "link"],
        boundary: "main",
      },
      {
        ref: "e4",
        role: "cell",
        name: "Active",
        tag: "td",
        text: "Active",
        enabled: true,
        visible: true,
        editable: false,
        sensitive: false,
        rect: this.rect(3),
        semanticPath: ["main", "table", "cell"],
        boundary: "main",
      },
      {
        ref: "e5",
        role: "button",
        name: "Create table",
        tag: "button",
        text: "Create table",
        enabled: true,
        visible: true,
        editable: false,
        sensitive: false,
        rect: this.rect(4, 36),
        semanticPath: ["main", "button"],
        boundary: "main",
      },
    ];
  }

  private elements(): PageElement[] {
    switch (this.state) {
      case "home":
        return this.homeElements();
      case "form":
        return this.formElements();
      case "created":
        return this.createdElements();
    }
  }

  private find(ref: string): PageElement | undefined {
    return this.elements().find((el) => el.ref === ref);
  }

  // -------------------------------------------------------------------------
  // Channel API
  // -------------------------------------------------------------------------

  async observe(opts?: PageObserveRequestPayload): Promise<PageObservation> {
    await sleep(1);
    const all = this.elements();
    const max = opts?.maxElements ?? all.length;
    const elements = all.slice(0, max);
    const observation: PageObservation = {
      snapshotId: newSnapshotId(),
      tab: { tabId: 1, url: this.tabUrl(), title: this.tabTitle() },
      viewport: { width: 1280, height: 800 },
      elements,
      truncated: {
        nodeLimitReached: elements.length < all.length,
        textLimitReached: false,
        omittedCount: Math.max(0, all.length - elements.length),
      },
      capturedAt: new Date().toISOString(),
    };
    return PageObservationSchema.parse(observation);
  }

  async execute(req: ExecuteActionRequest): Promise<ActionOutcome> {
    const { action } = req;

    switch (action.kind) {
      case "click": {
        const target = this.find(action.ref);
        if (!target) return this.notFound(action.ref);
        const injected = this.maybeFail("click");
        if (injected) return injected;

        if (this.state === "home" && action.ref === "e2") {
          this.state = "form";
        } else if (this.state === "form" && action.ref === "e6") {
          this.state = "created";
        } else if (this.state === "form" && action.ref === "e5") {
          this.state = "home";
        }
        return this.succeeded(
          `clicked ${target.role} "${target.name}" on ${this.tabUrl()}`,
        );
      }

      case "type": {
        const target = this.find(action.ref);
        if (!target) return this.notFound(action.ref);
        if (this.state !== "form" || target.role !== "textbox") {
          return this.failure(
            "ELEMENT_NOT_INTERACTABLE",
            `element ${action.ref} ("${target.name}") is not an editable textbox on the ${this.state} page`,
          );
        }
        const injected = this.maybeFail("type");
        if (injected) return injected;

        if (target.ref === "e2") this.form.tableName = action.value;
        else if (target.ref === "e3") this.form.partitionKey = action.value;
        return this.succeeded(
          `typed ${action.value.length} chars into textbox "${target.name}"`,
        );
      }

      case "select": {
        const target = this.find(action.ref);
        if (!target) return this.notFound(action.ref);
        if (target.role !== "combobox") {
          return this.failure(
            "ELEMENT_NOT_INTERACTABLE",
            `element ${action.ref} ("${target.name}") is not a combobox`,
          );
        }
        const injected = this.maybeFail("select");
        if (injected) return injected;
        if (!(PARTITION_KEY_TYPES as readonly string[]).includes(action.option)) {
          return this.failure(
            "ACTION_FAILED",
            `option "${action.option}" is not available on combobox "${target.name}"`,
          );
        }
        this.form.partitionKeyType = action.option;
        return this.succeeded(`selected ${action.option}`);
      }

      case "scroll": {
        if (action.ref) {
          const target = this.find(action.ref);
          if (!target) return this.notFound(action.ref);
        }
        const injected = this.maybeFail("scroll");
        if (injected) return injected;
        return this.succeeded(`scrolled ${action.direction}`);
      }

      case "wait": {
        const injected = this.maybeFail("wait");
        if (injected) return injected;
        return this.succeeded(`waited ${action.ms}ms`);
      }
    }
  }

  async cancel(_runId: string): Promise<void> {
    this.state = "home";
    this.form = { tableName: "", partitionKey: "", partitionKeyType: "String" };
  }

  async close(): Promise<void> {
    // no-op: nothing to release for the in-memory fake
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async succeeded(effect: string): Promise<ActionOutcome> {
    return { status: "succeeded", effect, observation: await this.observe() };
  }

  private failure(
    code: ProtocolErrorCode,
    message: string,
    retryable?: boolean,
  ): ActionOutcome {
    const error: NonNullable<ActionOutcome["error"]> = { code, message };
    if (retryable !== undefined) error.retryable = retryable;
    return { status: "failed", error };
  }

  private notFound(ref: string): ActionOutcome {
    return this.failure(
      "ELEMENT_NOT_FOUND",
      `element ${ref} not found on the ${this.state} page`,
    );
  }

  private maybeFail(stepKind: string): ActionOutcome | null {
    if (this.failOnce && this.failOnce.stepKind === stepKind) {
      this.failOnce = undefined;
      return {
        status: "uncertain",
        error: {
          code: "ACTION_RESULT_UNCERTAIN",
          message: `fake injected uncertainty for ${stepKind}`,
          retryable: true,
        },
      };
    }
    return null;
  }
}
