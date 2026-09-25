/**
 * Content script entry point.
 *
 * Owns all page access: observation, resolution and execution. It never talks
 * to the bridge directly; the service worker routes requests here and wraps the
 * responses in protocol envelopes.
 */
import type { ContentRequestMessage, ContentResponseMessage } from "../shared/internal.js";
import { executeAction } from "./executor.js";
import { clearSnapshot, observe } from "./observer.js";
import { clearPointer } from "./pointer.js";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Registered once per frame. The service worker injects this file on hosts that
 * are not declared in the manifest (real sites with granted optional access),
 * so guard against duplicate listener registration.
 */
function register(): void {
  // Drop the snapshot and any overlay as soon as this frame starts navigating.
  window.addEventListener("pagehide", () => {
    clearSnapshot();
    clearPointer();
  });
  window.addEventListener("popstate", () => {
    clearSnapshot();
  });

async function handleObserve(
  request: Extract<ContentRequestMessage, { type: "remora.observe" }>,
): Promise<ContentResponseMessage> {
  try {
    const observation = observe({
      tabId: request.tabId,
      url: location.href,
      title: document.title,
      maxElements: request.maxElements,
      maxTextLength: request.maxTextLength,
    });
    return { ok: true, observation };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "PAGE_NOT_SUPPORTED",
        message: `Observation failed: ${messageOf(error)}`,
        retryable: true,
      },
    };
  }
}

async function handleAction(
  request: Extract<ContentRequestMessage, { type: "remora.action" }>,
): Promise<ContentResponseMessage> {
  try {
    const result = await executeAction(request.action, request.snapshotId, {
      tabId: request.tabId,
      url: location.href,
      title: document.title,
    });
    return { ok: true, result };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "ACTION_FAILED",
        message: `Action failed: ${messageOf(error)}`,
        retryable: false,
      },
    };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const request = message as ContentRequestMessage | undefined;
  if (!request || typeof request !== "object") return false;

  if (request.type === "remora.observe") {
    void handleObserve(request).then(sendResponse);
    return true;
  }
  if (request.type === "remora.action") {
    void handleAction(request).then(sendResponse);
    return true;
  }
  return false;
});
}

const scope = globalThis as typeof globalThis & { __remoraContentScriptLoaded?: boolean };
if (!scope.__remoraContentScriptLoaded) {
  scope.__remoraContentScriptLoaded = true;
  register();
}
