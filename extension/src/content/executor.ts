/**
 * Single-action executor.
 *
 * Performs exactly one validated browser action and then re-observes the page.
 * It never retries; uncertain mutations are surfaced as `uncertain` so the
 * orchestrator can decide what to do. Effects describe mechanical results and
 * never include typed values or counts of sensitive content.
 */
import type {
  BrowserAction,
  PageObservation,
  ProtocolErrorCode,
} from "@remora/protocol";
import { animatePointer } from "./pointer.js";
import { computeAccessibleName, computeRole, observe } from "./observer.js";
import { ResolveError, assertInteractable, assertNotSensitive, resolveRef } from "./resolver.js";

export interface ExecutionResult {
  status: "succeeded" | "failed" | "uncertain" | "cancelled";
  effect?: string;
  error?: { code: ProtocolErrorCode; message: string; retryable?: boolean };
  observation?: PageObservation;
}

export interface ExecutionContext {
  tabId: number | null;
  url: string;
  title: string;
}

const MAX_WAIT_MS = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function tagOf(el: Element): string {
  return el.tagName.toLowerCase();
}

function focusElement(el: Element): void {
  const focusable = el as unknown as { focus?: () => void };
  if (typeof focusable.focus === "function") {
    try {
      focusable.focus();
    } catch {
      /* focus is best-effort */
    }
  }
}

function dragScrollIntoView(el: Element): void {
  const scrollable = el as unknown as { scrollIntoView?: (options?: ScrollIntoViewOptions) => void };
  if (typeof scrollable.scrollIntoView === "function") {
    try {
      scrollable.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
    } catch {
      /* ignore */
    }
  }
}

function dispatchPointerLike(el: Element, type: string, init: MouseEventInit): void {
  const view = el.ownerDocument.defaultView;
  const PointerCtor = view?.PointerEvent ?? globalThis.PointerEvent;
  const event =
    type.startsWith("pointer") && typeof PointerCtor === "function"
      ? new PointerCtor(type, init as PointerEventInit)
      : new MouseEvent(type, init);
  el.dispatchEvent(event);
}

function humanClickSequence(el: Element): void {
  const rect = el.getBoundingClientRect();
  const init: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: el.ownerDocument.defaultView,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    button: 0,
    buttons: 1,
  };
  dispatchPointerLike(el, "pointerover", init);
  dispatchPointerLike(el, "pointerenter", init);
  dispatchPointerLike(el, "mouseover", init);
  dispatchPointerLike(el, "mouseenter", init);
  dispatchPointerLike(el, "pointerdown", init);
  dispatchPointerLike(el, "mousedown", init);
  focusElement(el);
}

function nativeValueSetter(el: Element): ((value: string) => void) | null {
  let proto: object | null = el;
  while (proto) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor && typeof descriptor.set === "function") {
      const setter = descriptor.set;
      return (value: string) => setter.call(el, value);
    }
    proto = Object.getPrototypeOf(proto);
  }
  return null;
}

function setElementValue(el: Element, value: string): void {
  const tag = tagOf(el);
  if (
    tag !== "input" &&
    tag !== "textarea" &&
    tag !== "select" &&
    (el as HTMLElement).isContentEditable === true
  ) {
    el.textContent = value;
    return;
  }
  const setter = nativeValueSetter(el);
  if (setter) {
    setter(value);
    return;
  }
  const mutable = el as unknown as { value?: string };
  mutable.value = value;
}

function readElementValue(el: Element): string | null {
  const mutable = el as unknown as { value?: unknown };
  if (typeof mutable.value === "string") return mutable.value;
  if ((el as HTMLElement).isContentEditable === true) return el.textContent;
  return null;
}

function fireInputEvents(el: Element): void {
  el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
}

function safeName(el: Element): string {
  const name = computeAccessibleName(el, 80);
  return name || tagOf(el);
}

async function finish(
  context: ExecutionContext,
  beforeUrl: string,
  effect: string,
): Promise<ExecutionResult> {
  await sleep(150);
  const navigated = location.href !== beforeUrl;
  try {
    const observation = observe({
      tabId: context.tabId,
      url: location.href,
      title: document.title,
    });
    return {
      status: "succeeded",
      effect: navigated ? `${effect}; page navigated to ${location.href}` : effect,
      observation,
    };
  } catch {
    if (navigated) {
      return { status: "succeeded", effect: `${effect}; page navigated to ${location.href}` };
    }
    return {
      status: "uncertain",
      effect,
      error: {
        code: "ACTION_RESULT_UNCERTAIN",
        message: "Action completed but the page could not be re-observed.",
        retryable: false,
      },
    };
  }
}

async function executeClick(
  ref: string,
  snapshotId: string,
  context: ExecutionContext,
): Promise<ExecutionResult> {
  const el = resolveRef(snapshotId, ref);
  assertInteractable(el);

  const name = safeName(el);
  const beforeUrl = location.href;
  dragScrollIntoView(el);
  await animatePointer(el, `Click ${name}`);

  humanClickSequence(el);

  const clickable = el as unknown as { click?: () => void };
  if (typeof clickable.click === "function") {
    // Use the native click so links/submit buttons keep default behavior.
    clickable.click();
  } else {
    el.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: el.ownerDocument.defaultView,
      }),
    );
  }

  return finish(context, beforeUrl, `clicked ${computeRole(el)} "${name}"`);
}

async function executeType(
  ref: string,
  snapshotId: string,
  value: string,
  clear: boolean,
  context: ExecutionContext,
): Promise<ExecutionResult> {
  const el = resolveRef(snapshotId, ref);
  assertInteractable(el);
  assertNotSensitive(el);

  const name = safeName(el);
  const beforeUrl = location.href;
  dragScrollIntoView(el);
  await animatePointer(el, `Type into ${name}`);

  focusElement(el);
  if (clear) {
    setElementValue(el, "");
    fireInputEvents(el);
  }
  setElementValue(el, value);
  fireInputEvents(el);

  await sleep(30);

  const readBack = readElementValue(el);
  const effect = `typed ${value.length} chars into ${computeRole(el)} "${name}"`;
  if (readBack !== value) {
    return {
      status: "uncertain",
      effect,
      error: {
        code: "ACTION_RESULT_UNCERTAIN",
        message: "Typed value did not verify on read-back.",
        retryable: false,
      },
    };
  }
  return finish(context, beforeUrl, effect);
}

async function executeSelect(
  ref: string,
  snapshotId: string,
  option: string,
  context: ExecutionContext,
): Promise<ExecutionResult> {
  const el = resolveRef(snapshotId, ref);
  assertInteractable(el);

  if (tagOf(el) !== "select") {
    throw new ResolveError("ELEMENT_NOT_INTERACTABLE", "Target is not a select element.");
  }

  const name = safeName(el);
  const beforeUrl = location.href;
  const select = el as HTMLSelectElement;
  const wanted = option.trim().toLowerCase();
  const match = Array.from(select.options).find(
    (candidate) =>
      candidate.value.trim().toLowerCase() === wanted ||
      (candidate.textContent ?? "").trim().toLowerCase() === wanted,
  );

  if (!match) {
    return {
      status: "failed",
      effect: `select option not found in combobox "${name}"`,
      error: {
        code: "ELEMENT_NOT_FOUND",
        message: `No option matched "${option}".`,
        retryable: false,
      },
    };
  }

  dragScrollIntoView(el);
  await animatePointer(el, `Select ${match.textContent?.trim() || match.value}`);

  setElementValue(el, match.value);
  fireInputEvents(el);
  await sleep(20);

  if (select.value !== match.value) {
    return {
      status: "uncertain",
      effect: `could not confirm selected option in combobox "${name}"`,
      error: {
        code: "ACTION_RESULT_UNCERTAIN",
        message: "Selected option did not verify.",
        retryable: false,
      },
    };
  }

  return finish(
    context,
    beforeUrl,
    `selected "${(match.textContent ?? "").trim()}" in combobox "${name}"`,
  );
}

async function executeScroll(
  action: Extract<BrowserAction, { kind: "scroll" }>,
  snapshotId: string,
  context: ExecutionContext,
): Promise<ExecutionResult> {
  const beforeUrl = location.href;
  const amount = action.amount ?? Math.round(window.innerHeight * 0.8);

  if (action.ref) {
    const el = resolveRef(snapshotId, action.ref);
    dragScrollIntoView(el);
  } else {
    window.scrollBy({
      top: action.direction === "down" ? amount : -amount,
      left: 0,
      behavior: "smooth",
    });
  }

  await sleep(350);
  return finish(context, beforeUrl, `scrolled ${action.direction} ${Math.round(amount)}px`);
}

async function executeWait(ms: number, context: ExecutionContext): Promise<ExecutionResult> {
  const beforeUrl = location.href;
  const bounded = Math.min(Math.max(ms, 0), MAX_WAIT_MS);
  await sleep(bounded);
  return finish(context, beforeUrl, `waited ${bounded}ms`);
}

export async function executeAction(
  action: BrowserAction,
  snapshotId: string,
  context: ExecutionContext,
): Promise<ExecutionResult> {
  try {
    switch (action.kind) {
      case "click":
        return await executeClick(action.ref, snapshotId, context);
      case "type":
        return await executeType(action.ref, snapshotId, action.value, action.clear ?? false, context);
      case "select":
        return await executeSelect(action.ref, snapshotId, action.option, context);
      case "scroll":
        return await executeScroll(action, snapshotId, context);
      case "wait":
        return await executeWait(action.ms, context);
      default: {
        const exhaustive: never = action;
        return {
          status: "failed",
          error: {
            code: "NOT_IMPLEMENTED",
            message: `Unsupported action: ${JSON.stringify(exhaustive)}`,
            retryable: false,
          },
        };
      }
    }
  } catch (error) {
    if (error instanceof ResolveError) {
      return {
        status: "failed",
        error: { code: error.code, message: error.message, retryable: false },
      };
    }
    return {
      status: "failed",
      error: { code: "ACTION_FAILED", message: messageOf(error), retryable: false },
    };
  }
}
