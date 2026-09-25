/**
 * Bounded, redaction-aware page digest. Shared by the planner (repair) and the
 * verifier so every model prompt sees the same compact representation of what
 * is actually on the page.
 *
 * OWNER: planner/verifier subagent.
 */
import type { PageElement, PageObservation } from "@remora/protocol";

export const DEFAULT_DIGEST_MAX_ELEMENTS = 60;
export const DEFAULT_DIGEST_MAX_TEXT = 120;

/** Collapses whitespace and truncates to `maxText` characters. */
function clip(value: string | null | undefined, maxText: number): string {
  if (value == null) return "";
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (maxText <= 0) return "";
  return collapsed.length > maxText ? `${collapsed.slice(0, maxText)}…` : collapsed;
}

/** Renders the states that matter for verification as a compact flag list. */
function stateFlags(element: PageElement): string {
  const flags: string[] = [element.visible ? "visible" : "hidden"];
  flags.push(element.enabled ? "enabled" : "disabled");
  if (element.editable) flags.push("editable");
  if (element.checked != null) flags.push(element.checked ? "checked" : "unchecked");
  if (element.selected != null) flags.push(element.selected ? "selected" : "unselected");
  if (element.expanded != null) flags.push(element.expanded ? "expanded" : "collapsed");
  if (element.sensitive || element.valueRedacted) flags.push("sensitive");
  return flags.join(",");
}

function renderElement(element: PageElement, maxText: number): string {
  const parts: string[] = [`[${element.ref}]`, element.role || element.tag];
  const name = clip(element.name, maxText);
  if (name !== "") parts.push(`"${name}"`);
  parts.push(`{${stateFlags(element)}}`);

  const label = clip(element.label, maxText);
  if (label !== "" && label !== name) parts.push(`label="${label}"`);

  if (element.sensitive || element.valueRedacted) {
    parts.push("value=[redacted]");
  } else if (element.value != null && element.value !== "") {
    parts.push(`value="${clip(element.value, maxText)}"`);
  }

  const text = clip(element.text, maxText);
  if (text !== "" && text !== name) parts.push(`text="${text}"`);

  return `- ${parts.join(" ")}`;
}

/**
 * Summarizes a page observation as plain text for a model prompt. Bounded by
 * `maxElements` and `maxText`; sensitive/redacted values are never rendered.
 */
export function summarizeObservation(
  observation: PageObservation,
  maxElements: number = DEFAULT_DIGEST_MAX_ELEMENTS,
  maxText: number = DEFAULT_DIGEST_MAX_TEXT,
): string {
  const url = clip(observation.tab.url, 2_000);
  const title = clip(observation.tab.title, maxText);
  const total = observation.elements.length;
  const bounded = observation.elements.slice(0, Math.max(0, maxElements));

  const lines: string[] = [`URL: ${url}`, `Title: ${title}`];

  const truncatedNote =
    observation.truncated.omittedCount > 0
      ? ` (${observation.truncated.omittedCount} omitted by the extension)`
      : "";
  lines.push(`Elements: ${bounded.length} shown of ${total}${truncatedNote}`);

  if (bounded.length === 0) {
    lines.push("(no actionable elements observed)");
  } else {
    for (const element of bounded) lines.push(renderElement(element, maxText));
  }

  const dropped = total - bounded.length;
  if (dropped > 0) {
    lines.push(`(${dropped} additional elements omitted from this digest)`);
  }

  return lines.join("\n");
}
