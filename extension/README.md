# Remora Agent Bridge (Chrome extension)

Manifest V3 extension that gives the Remora orchestrator structured eyes and
hands inside a web page:

- Observes the active page as a bounded, accessibility-oriented snapshot of
  actionable elements (ephemeral `e1…` refs scoped to a `snapshotId`).
- Animates a Remora pointer and highlight ring to the chosen element.
- Executes exactly **one** validated action per request: `click`, `type`,
  `select`, `scroll`, or `wait`.
- Re-observes after execution and reports the mechanical effect.

The extension never executes model-generated JavaScript or arbitrary selectors,
never logs sensitive values, and clears all page snapshots on navigation.

## Build

```sh
npm run build -w @remora/extension      # one-shot build into extension/dist
npm run watch -w @remora/extension      # rebuild JS entry points on change
npm run typecheck -w @remora/extension  # tsc --noEmit
```

The build bundles the service worker, content script and popup with esbuild
(IIFE, Chrome 120, inline source maps) and copies `manifest.json` plus the popup
HTML/CSS into `extension/dist/`.

## Load unpacked

1. Run the build above.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. **Load unpacked** → select `extension/dist`.
5. Note the extension ID and reload after each rebuild.

Click the toolbar icon to open the popup, which reports connection state, the
bridge URL, the extension version, and whether the active tab is supported.

## Dev bridge

The service worker connects to a dev WebSocket bridge (default
`ws://127.0.0.1:8787`). It sends `bridge.hello` on connect and waits for
`bridge.ready`. Reconnects use exponential backoff (1s → 30s, with jitter) and a
`chrome.alarms` keepalive (every 25s) reconnects when the socket is closed.

Override the bridge settings in `chrome.storage.local`:

| Key | Default | Purpose |
|---|---|---|
| `bridgeUrl` | `ws://127.0.0.1:8787` | Orchestrator WebSocket endpoint |
| `bridgeToken` | unset | Optional shared dev token sent in `bridge.hello` |

From the service-worker console (or any extension page):

```js
chrome.storage.local.set({ bridgeUrl: "ws://127.0.0.1:8787" });
chrome.storage.local.set({ bridgeToken: "dev-token" });
```

## Real-site access (optional permissions)

`http://127.0.0.1/*` and `http://localhost/*` are declared host permissions, so
the content script loads automatically on the local fixture. Everything else is
opt-in:

- The manifest declares `optional_host_permissions` for
  `https://vercel.com/*` and `https://*.vercel.com/*`.
- On an undeclared host, the service worker tries `tabs.sendMessage`; if no
  listener answers it injects `content/content-script.js` with
  `chrome.scripting.executeScript` and retries once.
- Without a granted host permission or activeTab, the request fails with
  `PAGE_PERMISSION_REQUIRED` and tells the orchestrator to ask the user.

To grant access: open the target site, click the Remora toolbar icon, then
**Grant access** in the popup. The popup shows the current tab origin, whether
access is granted, and the bridge state. Remora never requests `<all_urls>`.

The content script installs its listeners once per frame, so repeated injection
after navigations does not duplicate handlers.

## Fixture workflow

The extension only runs on `http://127.0.0.1/*` and `http://localhost/*`
(`<all_urls>` is intentionally not requested).

```sh
node fixtures/mock-aws/serve.mjs        # http://127.0.0.1:4173
```

Pages: `/` (DynamoDB home) → `/create-table.html` → `/created.html?name=…`.
The element contract is documented in `fixtures/mock-aws/README.md`.

## Message flow

```
orchestrator ──page.observe.request──▶ service worker ──remora.observe──▶ content script
orchestrator ◀─page.observe.response── service worker ◀─observation────── content script
orchestrator ──browser.action.request─▶ service worker ──remora.action──▶ content script
orchestrator ◀─browser.action.result── service worker ◀─result─────────── content script
```

All inbound bridge envelopes are validated with `@remora/protocol`
(`parseMessage`). Invalid payloads produce a correlated `protocol.error`.
Routing failures use `TAB_NOT_FOUND` / `PAGE_NOT_SUPPORTED`; action-level
failures are reported through `browser.action.result`. A second action request
is rejected with retryable `ACTION_FAILED` while one is in flight.

## Safety notes

- Targets must resolve from the current snapshot; stale refs return
  `SNAPSHOT_EXPIRED`, detached elements are re-found conservatively by role +
  accessible name, and ambiguity fails closed (`ELEMENT_AMBIGUOUS`).
- Password/secret-classified fields are flagged `sensitive`; values (and lengths)
  are never read, and `type` refuses to write into them.
- Navigation to non-HTTP(S) pages is never attempted.
- The pointer overlay lives in a closed shadow root, is `aria-hidden`, ignores
  pointer events, and respects `prefers-reduced-motion`.

## Automated browser checks

Chrome branded builds (137+) ignore `--load-extension` from the command line;
use Chrome for Testing or Chromium when launching from a script. Playwright's
cached Chromium is one option:

```sh
CHROME="$HOME/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
"$CHROME" --headless=new --disable-gpu --user-data-dir=/tmp/remora-profile \
  --remote-debugging-port=9222 \
  --disable-extensions-except="$PWD/extension/dist" \
  --load-extension="$PWD/extension/dist" \
  http://127.0.0.1:4173/
```

Then `npm run observe -w @remora/agent` connects to the extension.

Verified manually on Chrome for Testing 154: bridge handshake, an 11-element
snapshot of the fixture home page, and a `click → type → type → select → click`
sequence completing `/ → /create-table.html → /created.html?name=remora-demo`.
The full orchestrator loop (fakes for planning/verification, real bridge and
page) also completed with the approval checkpoint before the final submit.
