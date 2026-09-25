/**
 * Extension popup.
 *
 * Shows a sanitized connection summary from the service worker. It never
 * displays page content and never executes actions.
 */
interface PopupStatus {
  connected: boolean;
  bridgeUrl: string;
  version: string;
  tab: { supported: boolean; url: string };
  hostAccess: { origin: string | null; granted: boolean; canRequest: boolean };
}

type BadgeState = "connected" | "connecting" | "error" | "unsupported";

function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing popup element #${id}`);
  return el as T;
}

const connectionEl = requireEl<HTMLSpanElement>("connection");
const bridgeUrlEl = requireEl<HTMLElement>("bridge-url");
const versionEl = requireEl<HTMLElement>("version");
const tabEl = requireEl<HTMLElement>("tab");
const hostAccessEl = requireEl<HTMLElement>("host-access");
const grantEl = requireEl<HTMLButtonElement>("grant");
const reconnectEl = requireEl<HTMLButtonElement>("reconnect");
const errorEl = requireEl<HTMLParagraphElement>("error");

function setBadge(state: BadgeState, text: string): void {
  connectionEl.dataset.state = state;
  connectionEl.textContent = text;
}

let lastStatus: PopupStatus | null = null;

function render(status: PopupStatus): void {
  lastStatus = status;
  errorEl.hidden = true;
  bridgeUrlEl.textContent = status.bridgeUrl;
  versionEl.textContent = status.version;

  if (status.tab.supported) {
    tabEl.textContent = status.tab.url || "—";
  } else {
    tabEl.textContent = status.tab.url ? `unsupported: ${status.tab.url}` : "no active tab";
  }

  if (status.hostAccess.origin === null) {
    hostAccessEl.textContent = "not applicable";
    grantEl.hidden = true;
  } else if (status.hostAccess.granted) {
    hostAccessEl.textContent = `granted (${status.hostAccess.origin})`;
    grantEl.hidden = true;
  } else {
    hostAccessEl.textContent = status.hostAccess.origin;
    grantEl.hidden = !status.hostAccess.canRequest;
  }

  if (status.connected) {
    setBadge("connected", "connected");
  } else if (!status.tab.supported && status.tab.url) {
    setBadge("unsupported", "page unsupported");
  } else {
    setBadge("connecting", "connecting");
  }
}

function renderError(message: string): void {
  setBadge("error", "error");
  errorEl.hidden = false;
  errorEl.textContent = message;
}

async function refresh(): Promise<void> {
  try {
    const status = (await chrome.runtime.sendMessage({
      type: "remora.popup.status",
    })) as PopupStatus | undefined;
    if (!status) {
      renderError("No response from the service worker.");
      return;
    }
    render(status);
  } catch (error) {
    renderError(`Service worker unavailable: ${messageOf(error)}`);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

grantEl.addEventListener("click", () => {
  const origin = lastStatus?.hostAccess.origin ?? null;
  if (!origin) return;
  grantEl.disabled = true;
  chrome.permissions
    .request({ origins: [`${origin}/*`] })
    .then((granted) => {
      if (!granted) renderError(`Access to ${origin} was not granted.`);
    })
    .catch((error: unknown) => renderError(messageOf(error)))
    .finally(() => {
      grantEl.disabled = false;
      void refresh();
    });
});

reconnectEl.addEventListener("click", () => {
  reconnectEl.disabled = true;
  setBadge("connecting", "connecting");
  void chrome.runtime
    .sendMessage({ type: "remora.popup.reconnect" })
    .then(() => refresh())
    .catch((error: unknown) => renderError(messageOf(error)))
    .finally(() => {
      reconnectEl.disabled = false;
    });
});

void refresh();
window.setInterval(() => void refresh(), 2000);
