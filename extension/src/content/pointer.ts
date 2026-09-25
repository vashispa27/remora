/**
 * Remora cursor overlay.
 *
 * Renders a synthetic pointer and highlight ring isolated in a closed shadow
 * root attached to <html>. The overlay never intercepts pointer events, is
 * `aria-hidden`, and never moves or hides the real system cursor.
 *
 * The label is supplied by the executor and must never contain typed values.
 */

const ACCENT = "#42C6B7";
const TRAVEL_MS = 600;
const FADE_MS = 260;

interface PointerOverlay {
  host: HTMLDivElement;
  shadow: ShadowRoot;
  arrow: HTMLDivElement;
  ring: HTMLDivElement;
  label: HTMLDivElement;
}

let overlay: PointerOverlay | null = null;
let lastX = 0;
let lastY = 0;

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function arrowMarkup(): string {
  return `
    <svg width="26" height="30" viewBox="0 0 26 30" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 1.5 L2 24 L8.4 18.2 L12.2 27.4 L16.5 25.4 L12.6 16.4 L21.5 16.2 Z"
            fill="${ACCENT}" stroke="#08312d" stroke-width="1.6" stroke-linejoin="round"/>
    </svg>`;
}

function ensureOverlay(): PointerOverlay | null {
  if (overlay) return overlay;
  if (!document.documentElement) return null;

  const host = document.createElement("div");
  host.setAttribute("data-remora-overlay", "");
  host.setAttribute("aria-hidden", "true");
  host.style.all = "initial";
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.pointerEvents = "none";
  host.style.zIndex = "2147483647";
  host.style.contain = "layout style";

  const shadow = host.attachShadow({ mode: "closed" });

  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.inset = "0";
  container.style.pointerEvents = "none";
  container.style.zIndex = "2147483647";

  const arrow = document.createElement("div");
  arrow.style.position = "fixed";
  arrow.style.left = "0";
  arrow.style.top = "0";
  arrow.style.pointerEvents = "none";
  arrow.style.willChange = "transform, opacity";
  arrow.style.filter = "drop-shadow(0 1px 2px rgba(0,0,0,0.45))";
  arrow.innerHTML = arrowMarkup();

  const ring = document.createElement("div");
  ring.style.position = "fixed";
  ring.style.pointerEvents = "none";
  ring.style.border = `2px solid ${ACCENT}`;
  ring.style.borderRadius = "6px";
  ring.style.boxShadow = `0 0 0 2px rgba(66,198,183,0.25)`;
  ring.style.opacity = "0";

  const label = document.createElement("div");
  label.style.position = "fixed";
  label.style.pointerEvents = "none";
  label.style.maxWidth = "280px";
  label.style.padding = "3px 8px";
  label.style.borderRadius = "999px";
  label.style.background = "#08312d";
  label.style.color = "#eafffb";
  label.style.font = "600 12px/1.4 ui-sans-serif, system-ui, -apple-system, sans-serif";
  label.style.whiteSpace = "nowrap";
  label.style.overflow = "hidden";
  label.style.textOverflow = "ellipsis";
  label.style.opacity = "0";

  container.append(arrow, ring, label);
  shadow.append(container);
  document.documentElement.append(host);

  lastX = window.innerWidth / 2;
  lastY = window.innerHeight / 2;

  overlay = { host, shadow, arrow, ring, label };
  return overlay;
}

function place(el: HTMLElement, x: number, y: number): void {
  el.style.transform = `translate(${x}px, ${y}px)`;
}

/**
 * Animate the pointer to the target's center, draw the highlight ring and
 * action label, then fade out. Resolves once the animation has settled.
 */
export async function animatePointer(target: Element, actionLabel: string): Promise<void> {
  const view = ensureOverlay();
  if (!view) return;

  const rect = target.getBoundingClientRect();
  const targetX = Math.round(rect.left + rect.width / 2 - 4);
  const targetY = Math.round(rect.top + rect.height / 2 - 4);
  const reduced = prefersReducedMotion();

  view.ring.style.left = `${Math.round(rect.left - 4)}px`;
  view.ring.style.top = `${Math.round(rect.top - 4)}px`;
  view.ring.style.width = `${Math.round(rect.width + 8)}px`;
  view.ring.style.height = `${Math.round(rect.height + 8)}px`;

  const labelX = Math.min(
    view.shadow.host.clientWidth || window.innerWidth,
    Math.max(8, Math.round(rect.left)),
  );
  const labelY = Math.max(8, Math.round(rect.top - 30));
  view.label.style.left = `${labelX}px`;
  view.label.style.top = `${labelY}px`;
  view.label.textContent = `Remora: ${actionLabel}`;

  if (reduced) {
    place(view.arrow, targetX, targetY);
    lastX = targetX;
    lastY = targetY;
    const fadeIn = [
      { opacity: 0 },
      { opacity: 1 },
    ];
    view.arrow.animate(fadeIn, { duration: 120, fill: "forwards" });
    view.ring.animate(fadeIn, { duration: 120, fill: "forwards" });
    view.label.animate(fadeIn, { duration: 120, fill: "forwards" });
    await sleep(200);
  } else {
    const startX = lastX;
    const startY = lastY;
    lastX = targetX;
    lastY = targetY;

    const travel = view.arrow.animate(
      [
        { transform: `translate(${startX}px, ${startY}px)` },
        { transform: `translate(${targetX}px, ${targetY}px)` },
      ],
      { duration: TRAVEL_MS, easing: "cubic-bezier(0.22, 0.61, 0.36, 1)", fill: "forwards" },
    );
    place(view.arrow, targetX, targetY);

    view.ring.animate(
      [
        { opacity: 0, transform: "scale(1.06)" },
        { opacity: 1, transform: "scale(1)" },
      ],
      { duration: 180, fill: "forwards" },
    );
    view.label.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, fill: "forwards" });

    await travel.finished.catch(() => undefined);
    await sleep(120);
  }

  const fadeOut = view.arrow.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: FADE_MS,
    fill: "forwards",
  });
  view.ring.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, fill: "forwards" });
  view.label.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, fill: "forwards" });
  await fadeOut.finished.catch(() => undefined);
}

export function clearPointer(): void {
  if (overlay) {
    overlay.host.remove();
    overlay = null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
