/**
 * Semantic element resolution for action targets.
 *
 * Resolves `{snapshotId, ref}` against the live ref index and validates that
 * the target is still present and interactable. If the referenced element has
 * been detached, a conservative role+name re-find is attempted within the same
 * snapshot scope; ambiguity fails closed (never guess).
 */
import type { ProtocolErrorCode } from "@remora/protocol";
import {
  findByRoleAndName,
  getCurrentSnapshotId,
  getRefIndex,
  isSensitive,
} from "./observer.js";

export class ResolveError extends Error {
  readonly code: ProtocolErrorCode;

  constructor(code: ProtocolErrorCode, message: string) {
    super(message);
    this.name = "ResolveError";
    this.code = code;
  }
}

function styleOf(el: Element): CSSStyleDeclaration | null {
  const view = el.ownerDocument.defaultView;
  return view ? view.getComputedStyle(el) : null;
}

function isHiddenOrZeroSized(el: Element): boolean {
  const style = styleOf(el);
  if (!style) return true;
  if (style.display === "none") return true;
  if (style.visibility === "hidden" || style.visibility === "collapse") return true;
  const rect = el.getBoundingClientRect();
  return rect.width <= 0 || rect.height <= 0;
}

function isDisabled(el: Element): boolean {
  if (el.getAttribute("aria-disabled") === "true") return true;
  return (el as unknown as { disabled?: unknown }).disabled === true;
}

export function resolveRef(snapshotId: string, ref: string): Element {
  const current = getCurrentSnapshotId();
  if (!current || snapshotId !== current) {
    throw new ResolveError(
      "SNAPSHOT_EXPIRED",
      "The observation snapshot is no longer current; request a fresh observation.",
    );
  }

  const record = getRefIndex().get(ref);
  if (!record) {
    throw new ResolveError("ELEMENT_NOT_FOUND", `No element is registered for ref ${ref}.`);
  }

  if (record.element.isConnected) return record.element;

  const candidates = findByRoleAndName(record.role, record.name);
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) {
    throw new ResolveError(
      "ELEMENT_NOT_FOUND",
      `Element ${ref} was detached and no role/name match was found.`,
    );
  }
  throw new ResolveError(
    "ELEMENT_AMBIGUOUS",
    `Element ${ref} was detached and ${candidates.length} role/name matches remain.`,
  );
}

export function assertInteractable(el: Element): void {
  if (isHiddenOrZeroSized(el)) {
    throw new ResolveError("ELEMENT_NOT_INTERACTABLE", "Target is hidden or has no layout box.");
  }
  if (isDisabled(el)) {
    throw new ResolveError("ELEMENT_NOT_INTERACTABLE", "Target is disabled.");
  }
  const style = styleOf(el);
  if (style && style.pointerEvents === "none") {
    throw new ResolveError("ELEMENT_NOT_INTERACTABLE", "Target does not receive pointer events.");
  }
}

export function assertNotSensitive(el: Element): void {
  if (isSensitive(el)) {
    throw new ResolveError(
      "SENSITIVE_INPUT_REQUIRED",
      "Refusing to enter text into a field classified as sensitive.",
    );
  }
}
