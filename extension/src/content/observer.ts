/**
 * Bounded accessibility-oriented page snapshotter.
 *
 * Emits a deterministic list of visible actionable elements with ephemeral
 * refs, semantic properties and rectangles. Refs are scoped to a snapshot id
 * and never persisted. Sensitive inputs are flagged and their values (and
 * lengths) are never read into the snapshot.
 *
 * Traversal covers the main document, open shadow roots and same-origin
 * iframes. Cross-origin iframes and closed shadow roots are skipped.
 */
import type { PageElement, PageObservation, Rect } from "@remora/protocol";

export type Boundary = "main" | "same-origin-iframe" | "open-shadow-root";

export interface RefRecord {
  element: Element;
  role: string;
  name: string;
}

export interface ObserveContext {
  tabId: number | null;
  url: string;
  title: string;
  maxElements?: number;
  maxTextLength?: number;
}

export const DEFAULT_MAX_ELEMENTS = 400;
export const DEFAULT_MAX_TEXT = 160;

const MAX_NAME_LENGTH = 200;
const MAX_PATH_LENGTH = 8;

const SKIP_TAGS = new Set(["script", "style", "noscript", "template"]);
const LANDMARK_TAGS = new Set(["main", "nav", "header", "footer", "form", "dialog"]);
const VALUE_BEARING_TAGS = new Set(["input", "textarea", "select"]);

const SENSITIVE_RE =
  /pass(word)?|secret|token|api[-_ ]?key|access[-_ ]?key|private[-_ ]?key|otp|mfa|cvv|cvc/i;

let currentSnapshotId: string | null = null;
const refIndex = new Map<string, RefRecord>();

export function getCurrentSnapshotId(): string | null {
  return currentSnapshotId;
}

export function getRefIndex(): ReadonlyMap<string, RefRecord> {
  return refIndex;
}

export function clearSnapshot(): void {
  currentSnapshotId = null;
  refIndex.clear();
}

function makeSnapshotId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `snap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function tagOf(el: Element): string {
  return el.tagName.toLowerCase();
}

function normalizeText(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim();
}

export function visibleText(el: Element, max = Number.MAX_SAFE_INTEGER): string {
  const text = normalizeText(el.textContent);
  return text.length > max ? text.slice(0, max) : text;
}

function clip(value: string, max: number, state: { textLimit: boolean }): string {
  const normalized = normalizeText(value);
  if (normalized.length > max) {
    state.textLimit = true;
    return normalized.slice(0, max);
  }
  return normalized;
}

export function computeRole(el: Element): string {
  const explicit = el.getAttribute("role");
  if (explicit) {
    const first = explicit.trim().split(/\s+/)[0];
    if (first) return first;
  }
  if (el.hasAttribute("aria-live") && el.getAttribute("aria-live") !== "off") {
    return "status";
  }
  const tag = tagOf(el);
  switch (tag) {
    case "button":
    case "summary":
      return "button";
    case "a":
      return el.hasAttribute("href") ? "link" : "generic";
    case "textarea":
      return "textbox";
    case "select":
      return "combobox";
    case "option":
      return "option";
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return "heading";
    case "table":
      return "table";
    case "td":
      return "cell";
    case "th":
      return "columnheader";
    case "li":
      return "listitem";
    case "ul":
    case "ol":
      return "list";
    case "img":
      return "img";
    case "main":
      return "main";
    case "nav":
      return "navigation";
    case "header":
      return "banner";
    case "footer":
      return "contentinfo";
    case "form":
      return "form";
    case "dialog":
      return "dialog";
    case "section":
      return el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby")
        ? "region"
        : "generic";
    case "input": {
      const type = (el.getAttribute("type") ?? "text").toLowerCase();
      switch (type) {
        case "button":
        case "submit":
        case "reset":
        case "image":
          return "button";
        case "checkbox":
          return "checkbox";
        case "radio":
          return "radio";
        case "range":
          return "slider";
        case "number":
          return "spinbutton";
        case "search":
          return "searchbox";
        default:
          return "textbox";
      }
    }
    default:
      return "generic";
  }
}

export function computeLabel(el: Element): string | null {
  const doc = el.ownerDocument;
  const id = el.getAttribute("id");
  if (id) {
    for (const label of Array.from(doc.querySelectorAll("label[for]"))) {
      if (label.getAttribute("for") === id) {
        const text = visibleText(label, MAX_NAME_LENGTH);
        if (text) return text;
      }
    }
  }
  const wrapping = el.closest("label");
  if (wrapping) {
    const text = visibleText(wrapping, MAX_NAME_LENGTH);
    if (text) return text;
  }
  return null;
}

export function computeAccessibleName(el: Element, maxLength = MAX_NAME_LENGTH): string {
  const ariaLabel = normalizeText(el.getAttribute("aria-label"));
  if (ariaLabel) return ariaLabel.slice(0, maxLength);

  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const doc = el.ownerDocument;
    const text = normalizeText(
      labelledBy
        .split(/\s+/)
        .map((id) => {
          const ref = doc.getElementById(id);
          return ref ? visibleText(ref) : "";
        })
        .join(" "),
    );
    if (text) return text.slice(0, maxLength);
  }

  const label = computeLabel(el);
  if (label) return label.slice(0, maxLength);

  const placeholder = normalizeText(el.getAttribute("placeholder"));
  if (placeholder) return placeholder.slice(0, maxLength);

  const alt = normalizeText(el.getAttribute("alt"));
  if (alt) return alt.slice(0, maxLength);

  if (tagOf(el) === "input") {
    const value = normalizeText(el.getAttribute("value"));
    if (value) return value.slice(0, maxLength);
  }

  const text = visibleText(el);
  if (text) return text.slice(0, maxLength);

  const title = normalizeText(el.getAttribute("title"));
  if (title) return title.slice(0, maxLength);

  return "";
}

export function computeDescription(el: Element): string | null {
  const describedBy = el.getAttribute("aria-describedby");
  if (describedBy) {
    const doc = el.ownerDocument;
    const text = normalizeText(
      describedBy
        .split(/\s+/)
        .map((id) => {
          const ref = doc.getElementById(id);
          return ref ? visibleText(ref) : "";
        })
        .join(" "),
    );
    if (text) return text.slice(0, MAX_NAME_LENGTH);
  }
  const title = normalizeText(el.getAttribute("title"));
  if (title) return title.slice(0, MAX_NAME_LENGTH);
  return null;
}

function styleOf(el: Element): CSSStyleDeclaration | null {
  const view = el.ownerDocument.defaultView;
  return view ? view.getComputedStyle(el) : null;
}

function isContentHidden(style: CSSStyleDeclaration | null): boolean {
  if (!style) return false;
  if (style.display === "none") return true;
  if (style.visibility === "hidden" || style.visibility === "collapse") return true;
  const contentVisibility = (style as unknown as { contentVisibility?: string }).contentVisibility;
  if (contentVisibility === "hidden") return true;
  return false;
}

function isEditable(el: Element): boolean {
  const tag = tagOf(el);
  if (tag === "textarea") {
    return !isDisabled(el) && el.getAttribute("readonly") === null;
  }
  if (tag === "input") {
    const type = (el.getAttribute("type") ?? "text").toLowerCase();
    if (["button", "submit", "reset", "image", "checkbox", "radio", "file"].includes(type)) {
      return false;
    }
    return !isDisabled(el) && el.getAttribute("readonly") === null;
  }
  return (el as HTMLElement).isContentEditable === true;
}

function isDisabled(el: Element): boolean {
  if (el.getAttribute("aria-disabled") === "true") return true;
  const maybeDisabled = (el as unknown as { disabled?: unknown }).disabled;
  return maybeDisabled === true;
}

function readRawValue(el: Element): string | null {
  const maybeValue = (el as unknown as { value?: unknown }).value;
  return typeof maybeValue === "string" ? maybeValue : null;
}

function readChecked(el: Element): boolean | null {
  const tag = tagOf(el);
  if (tag === "input") {
    const type = (el.getAttribute("type") ?? "text").toLowerCase();
    if (type === "checkbox" || type === "radio") {
      return (el as HTMLInputElement).checked;
    }
  }
  return readAriaBoolean(el, "aria-checked");
}

function readSelected(el: Element): boolean | null {
  const tag = tagOf(el);
  if (tag === "option") return (el as HTMLOptionElement).selected;
  return readAriaBoolean(el, "aria-selected");
}

function readExpanded(el: Element): boolean | null {
  return readAriaBoolean(el, "aria-expanded");
}

function readAriaBoolean(el: Element, attribute: string): boolean | null {
  const value = el.getAttribute(attribute);
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function readInputType(el: Element): string | null {
  if (tagOf(el) !== "input") return null;
  return (el.getAttribute("type") ?? "text").toLowerCase();
}

export function isSensitive(el: Element): boolean {
  if (tagOf(el) === "input" && (el.getAttribute("type") ?? "").toLowerCase() === "password") {
    return true;
  }
  const haystack = [
    el.getAttribute("name"),
    el.getAttribute("id"),
    el.getAttribute("autocomplete"),
    el.getAttribute("placeholder"),
    el.getAttribute("aria-label"),
    computeLabel(el),
    computeDescription(el),
  ]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" ");
  if (!haystack) return false;
  return SENSITIVE_RE.test(haystack);
}

export function isVisible(el: Element, style: CSSStyleDeclaration | null): boolean {
  if (!style) return false;
  if (isContentHidden(style)) return false;
  if (style.opacity === "0") return false;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const view = el.ownerDocument.defaultView;
  const width = view?.innerWidth ?? 0;
  const height = view?.innerHeight ?? 0;
  return rect.bottom > 0 && rect.right > 0 && rect.top < height && rect.left < width;
}

function rectOf(el: Element): Rect {
  const rect = el.getBoundingClientRect();
  return {
    x: Math.round(rect.x * 100) / 100,
    y: Math.round(rect.y * 100) / 100,
    width: Math.round(rect.width * 100) / 100,
    height: Math.round(rect.height * 100) / 100,
  };
}

function semanticPath(el: Element): string[] {
  const parts: string[] = [];
  const landmarkRoles = new Set([
    "main",
    "navigation",
    "banner",
    "contentinfo",
    "form",
    "region",
    "dialog",
    "table",
  ]);
  let node: Element | null = el.parentElement;
  let guard = 0;
  while (node && guard < 60) {
    guard += 1;
    const role = computeRole(node);
    const tag = tagOf(node);
    const name = computeAccessibleName(node, 80);
    let descriptor: string | null = null;
    if (landmarkRoles.has(role)) {
      descriptor = name ? `${role} "${name}"` : role;
    } else if (role === "heading") {
      descriptor = name ? `heading "${name}"` : "heading";
    } else if (tag === "label" || tag === "fieldset") {
      descriptor = name ? `${tag} "${name}"` : tag;
    }
    if (descriptor) parts.push(descriptor);
    node = node.parentElement;
  }
  parts.reverse();
  return parts.slice(-MAX_PATH_LENGTH);
}

function shouldInclude(el: Element, role: string): boolean {
  const tag = tagOf(el);
  if (["input", "textarea", "select", "button"].includes(tag)) return true;
  if (tag === "a") return el.hasAttribute("href");
  if (["option", "table", "td", "th", "li", "summary", "details"].includes(tag)) return true;
  if (/^h[1-6]$/.test(tag)) return true;
  if (LANDMARK_TAGS.has(tag)) return true;
  if (tag === "section") {
    return el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby");
  }
  if (el.getAttribute("role")) return true;
  if (el.hasAttribute("aria-live")) return true;
  if ((el as HTMLElement).isContentEditable === true) return true;
  if (el.hasAttribute("tabindex")) return true;
  return false;
}

type Visitor = (
  el: Element,
  boundary: Boundary,
  style: CSSStyleDeclaration | null,
) => boolean | void;

/**
 * Depth-first element traversal across the main document, same-origin iframes
 * and open shadow roots. `visit` returning `false` skips the subtree.
 */
export function traverseDom(visit: Visitor): void {
  const root = document.documentElement;
  if (!root) return;
  walkChildren(root, "main", visit, 0);
}

function walkChildren(parent: ParentNode, boundary: Boundary, visit: Visitor, depth: number): void {
  if (depth > 200) return;
  for (const el of Array.from(parent.children)) {
    const tag = tagOf(el);
    if (SKIP_TAGS.has(tag)) continue;
    const style = styleOf(el);
    const descend = visit(el, boundary, style);
    if (descend === false) continue;

    if (tag === "iframe") {
      const frame = el as HTMLIFrameElement;
      let doc: Document | null = null;
      try {
        doc = frame.contentDocument;
      } catch {
        doc = null;
      }
      if (doc && doc.documentElement) {
        walkChildren(doc.documentElement, "same-origin-iframe", visit, depth + 1);
      }
      continue;
    }

    const shadow = (el as HTMLElement).shadowRoot;
    if (shadow) {
      walkChildren(el, boundary, visit, depth + 1);
      walkChildren(shadow, "open-shadow-root", visit, depth + 1);
      continue;
    }

    walkChildren(el, boundary, visit, depth + 1);
  }
}

export function observe(context: ObserveContext): PageObservation {
  const maxElements = context.maxElements ?? DEFAULT_MAX_ELEMENTS;
  const maxText = context.maxTextLength ?? DEFAULT_MAX_TEXT;
  const state = { textLimit: false, omitted: 0, nodeLimit: false };
  const elements: PageElement[] = [];
  const nextIndex = new Map<string, RefRecord>();

  traverseDom((el, boundary, style) => {
    if (el.getAttribute("aria-hidden") === "true") return true;
    if (isContentHidden(style)) return false;
    if (tagOf(el) === "input" && (el.getAttribute("type") ?? "").toLowerCase() === "hidden") {
      return false;
    }
    const role = computeRole(el);
    if (!shouldInclude(el, role)) return true;

    if (elements.length >= maxElements) {
      state.omitted += 1;
      state.nodeLimit = true;
      return true;
    }

    const sensitive = isSensitive(el);
    const label = computeLabel(el);
    const name = clip(computeAccessibleName(el), MAX_NAME_LENGTH, state);
    const description = computeDescription(el);
    const tag = tagOf(el);
    const inputType = readInputType(el);
    const valueBearing = VALUE_BEARING_TAGS.has(tag);

    let value: string | null = null;
    let valueRedacted: boolean | undefined;
    if (valueBearing) {
      if (sensitive) {
        value = null;
        valueRedacted = true;
      } else {
        if (tag === "select") {
          const select = el as HTMLSelectElement;
          const option = select.selectedOptions[0];
          const raw = option ? normalizeText(option.textContent) || option.value : select.value;
          value = clip(raw, maxText, state);
        } else {
          const raw = readRawValue(el);
          value = raw === null ? null : clip(raw, maxText, state);
        }
      }
    }

    const text = clip(visibleText(el), maxText, state);
    const ref = `e${elements.length + 1}`;
    const record: RefRecord = { element: el, role, name };
    nextIndex.set(ref, record);

    elements.push({
      ref,
      role,
      name,
      label: label ? clip(label, maxText, state) : null,
      description,
      text: text || undefined,
      tag,
      inputType,
      enabled: !isDisabled(el),
      visible: isVisible(el, style),
      editable: isEditable(el),
      sensitive,
      checked: readChecked(el),
      selected: readSelected(el),
      expanded: readExpanded(el),
      value,
      valueRedacted,
      rect: rectOf(el),
      semanticPath: semanticPath(el),
      boundary,
    });

    return true;
  });

  currentSnapshotId = makeSnapshotId();
  refIndex.clear();
  for (const [ref, record] of nextIndex) refIndex.set(ref, record);

  const view = document.defaultView;
  return {
    snapshotId: currentSnapshotId,
    tab: {
      tabId: context.tabId,
      url: context.url,
      title: context.title,
    },
    viewport: {
      width: view?.innerWidth ?? 0,
      height: view?.innerHeight ?? 0,
      deviceScaleFactor: view?.devicePixelRatio,
    },
    elements,
    truncated: {
      nodeLimitReached: state.nodeLimit,
      textLimitReached: state.textLimit,
      omittedCount: state.omitted,
    },
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Conservative semantic re-find used when a snapshot element has been
 * detached. Matches live elements by computed role and accessible name.
 * Ambiguity is surfaced to the caller, which must refuse to guess.
 */
export function findByRoleAndName(role: string, name: string): Element[] {
  const matches: Element[] = [];
  traverseDom((el, _boundary, style) => {
    if (el.getAttribute("aria-hidden") === "true") return true;
    if (isContentHidden(style)) return false;
    if (computeRole(el) !== role) return true;
    if (computeAccessibleName(el) !== name) return true;
    matches.push(el);
    return true;
  });
  return matches;
}
