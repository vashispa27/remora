# Task 2 Specification — Remora Chrome Extension — Deferred Draft

> **Do not implement this document yet.** The current active scope is the UI-only macOS prototype in `mac-app-spec/`. The extension contract will be reconsidered after the UI direction is validated.

Status: ready after Task 1 bridge contract exists  
Priority: second  
Platform: Google Chrome, Manifest V3  
Primary language: TypeScript

## 1. Objective

Build the browser adapter that gives the Remora macOS app structured eyes and hands inside web applications. It observes the active page, exposes an accessibility-oriented element snapshot, safely performs requested semantic actions, records user demonstrations, verifies outcomes, and communicates through the Task 1 native-messaging bridge.

The first real-world experiment is the AWS Management Console DynamoDB workflow. The extension must remain general rather than containing an AWS-specific chain of CSS selectors.

## 2. Dependencies from Task 1

Before implementation, verify that Task 1 provides:

- `shared/protocol/protocol.schema.json` and examples.
- Native host name and development installation instructions.
- Configurable unpacked-extension ID.
- Working `bridge.hello`/`bridge.ready` fixture exchange.
- Mock AWS pages and expected semantic snapshots.
- Safety classifications and expected DynamoDB plan.

If the Mac app is incomplete, develop against a test native host that reads and writes the same protocol. Do not replace the agreed protocol with a localhost web server.

## 3. Deliverables

- A buildable unpacked Chrome extension under `extension/`.
- Manifest V3 configuration with least-privilege permissions.
- Service worker for bridge, tab, action, and recording coordination.
- Content script for observation, highlighting, actions, and recording.
- Page-context serializer with stable behavior across ordinary DOM changes.
- Semantic element resolution and action executor.
- Teach-mode recorder with sensitive-value redaction.
- Minimal extension popup showing connection and permission state.
- Automated unit and browser integration tests.
- AWS-console experiment documentation and known limitations.

## 4. Permissions

Start with:

```text
activeTab
scripting
storage
nativeMessaging
tabs (only if required for navigation/status behavior)
```

AWS host access should be optional and requested in response to a user gesture:

```text
https://*.console.aws.amazon.com/*
```

Requirements:

- Do not request `<all_urls>` by default.
- Explain each optional host request in the popup.
- Do not run on `chrome://`, Chrome Web Store, extension pages, or other browser-protected pages.
- Incognito support is off by default.
- Store preferences only; do not store page contents, AWS data, cookies, tokens, or recorded form values in `chrome.storage`.

## 5. Extension UI

The extension popup is operational, not the primary Remora interface. It displays:

- Mac app connection status.
- Current tab support/access status.
- Button to grant access for the current origin.
- Recording status with a stop button as a fallback.
- Version and diagnostics link.
- Clear messages for unsupported pages and missing native host.

All commands, plan review, approvals, saved skills, and history remain in the Mac app.

## 6. Internal architecture

Suggested structure:

```text
extension/
  src/
    background/
      service-worker.ts
      native-bridge.ts
      tab-registry.ts
    content/
      observer.ts
      serializer.ts
      resolver.ts
      executor.ts
      recorder.ts
      highlighter.ts
      redaction.ts
    popup/
    protocol/
    shared/
  tests/
    unit/
    fixtures/
    browser/
  manifest.json
```

Responsibilities:

- **Service worker:** owns native connection, request routing, permissions, active-tab selection, timeouts, and message correlation.
- **Content script:** owns page inspection and interaction. It must not communicate directly with the native host.
- **Popup:** reads sanitized status from the service worker.
- **Protocol layer:** validates incoming and outgoing messages against shared types/schema.

The service worker may be suspended by Chrome. Reconnect lazily and make connection state explicit. Do not assume in-memory state survives.

## 7. Page observation

Build a compact, accessibility-oriented representation of the current viewport and relevant off-screen controls.

Include elements that are:

- Interactive, focusable, editable, or semantically meaningful.
- Visible headings, alerts, labels, table headers/cells, and navigation landmarks.
- Associated with an interactive element through label/description relationships.

For each element collect, when available:

```text
ephemeral ref
role
accessible name
label/description
short visible text
tag and safe input type
enabled/disabled
visible/hidden
editable
checked/selected/expanded state
bounding rectangle
semantic ancestor path
iframe/shadow-root boundary
sensitive flag
```

Do not include:

- Script/style contents.
- Hidden bulk application state.
- Cookies, local storage, session storage, or network headers.
- Password values.
- Entire unbounded tables when only a visible subset is relevant.

Apply limits for node count, text length per node, and total serialized size. Return truncation metadata so the planner knows the context is incomplete.

`ref` values are ephemeral and scoped to a `snapshotId`. Maintain a weak internal mapping for the life of the snapshot. Rebuild after navigation or material DOM changes.

## 8. Semantic resolution

Before acting, resolve the target again using a weighted combination of:

1. Live reference from the matching snapshot.
2. Accessible role and name.
3. Associated label or description.
4. Nearby landmark/heading and semantic ancestor path.
5. Visible text.
6. Stable element attributes that do not look generated.
7. CSS/XPath and screen position only as fallbacks.

If zero elements match, return `ELEMENT_NOT_FOUND`. If multiple candidates remain materially ambiguous, highlight them when possible and return `ELEMENT_AMBIGUOUS`; never guess for a mutating action.

Support open shadow roots. Report closed shadow roots as an unsupported boundary. Enumerate same-origin iframes; cross-origin iframe support requires explicit host permission and must be reported when unavailable.

## 9. Action execution

Implement the shared actions:

- `click`: scroll into view, focus where appropriate, highlight, and use a realistic DOM/user interaction path.
- `fill`: focus, clear according to request, set text through normal input events, and verify the resulting value without logging sensitive content.
- `select`: choose an option by semantic label/value and emit normal change events.
- `check`/`uncheck`: change only when needed and verify state.
- `press`: send an allowlisted key or chord. Block arbitrary browser/system shortcuts.
- `scroll`: scroll a specified container or viewport by a bounded amount.
- `focus`: focus an editable/interactive element.
- `navigate`: allow only HTTP(S) destinations permitted by the run's origin policy.
- `waitFor`: observe until a semantic condition or URL condition is met.

Each action must:

1. Validate the protocol request.
2. Confirm the tab and origin.
3. Confirm the snapshot/resolve the target.
4. Confirm interactability and sensitive-field policy.
5. Highlight the intended target briefly.
6. Perform exactly one action.
7. Observe the expected postcondition.
8. Return succeeded, failed, uncertain, or cancelled.

Do not automatically repeat clicks. If navigation or a service-worker suspension makes the outcome unknowable, return `ACTION_RESULT_UNCERTAIN`.

## 10. Highlighting and user visibility

Render Remora overlays in an isolated shadow root at the highest practical stacking level. They must:

- Draw a clear outline around the intended target.
- Show a small non-sensitive action label such as `Remora: Click Create table`.
- Never intercept pointer events outside an explicit teaching control.
- Be removed after completion, cancellation, navigation, or disconnection.
- Avoid changing page layout.
- Remain visually distinct on both light and dark pages.

## 11. Teach mode

Teach mode starts only after a request from the Mac app and applies only to one selected tab.

Record trusted user events for:

- Clicks on interactive elements.
- Text entry, coalesced into one semantic fill event per field.
- Select/checkbox/radio changes.
- Form submission.
- Relevant keyboard actions.
- Same-tab navigation and significant history changes.

Each event contains semantic target information, before/after page metadata, timestamp, and a suggested assertion. Debounce noisy input and mutation events.

Sensitive handling:

- Never record password values.
- Treat fields whose names/labels contain password, secret, token, access key, private key, OTP, MFA, or CVV as sensitive unless explicitly proven otherwise.
- Emit a named sensitive input placeholder instead of its value.
- Do not read values from browser autofill beyond what normal content scripts are permitted to observe.

The Mac app performs workflow compilation and editing. The extension returns an ordered event trace; it does not invent the final reusable skill.

## 12. AWS DynamoDB experiment

### Preconditions

- The user is already signed in to AWS manually.
- The user manually handles account selection, role assumption, MFA, and any authentication prompt.
- The active region and account identifier are surfaced to the Mac app when safely extractable from visible UI.
- Testing should use a dedicated sandbox AWS account with budgets/alerts. Local fixture tests remain the default.

### Required scenario

From the DynamoDB console, execute a plan equivalent to:

```text
Create a DynamoDB table named remora-demo with partition key id.
```

Expected behavior:

1. Observe the current page.
2. Find and click **Create table** semantically.
3. Fill table name.
4. Fill partition key name.
5. Leave defaults unless the approved plan explicitly says otherwise.
6. Read back and display the proposed values.
7. Stop before the final create action and wait for Mac-app approval.
8. After approval, click the final **Create table** button once.
9. Wait for a success/status condition and return the resulting table name/status.
10. If the status is uncertain, tell the Mac app to inspect the table list; never click create again automatically.

The extension must not delete the test table. Cleanup is manual in v0.1.

### Robustness requirements

- Do not encode a chain of positional selectors such as `div:nth-child(...)`.
- Tolerate minor AWS layout changes and delayed rendering.
- Distinguish duplicate **Create table** buttons using landmarks, page phase, and dialog/form context.
- Handle region redirects and SPA route changes.
- Detect if the table name already exists and return the visible validation/error message.
- Avoid capturing unrelated table names or account data in logs.

## 13. Security requirements

- Accept commands only from the configured Remora native host.
- Validate sender and origin for messages from content scripts.
- Validate every native envelope and content-script response.
- Enforce allowed origins again in the extension even though the Mac app has policy checks.
- Block `javascript:`, `data:`, `file:`, browser-internal, and extension navigation.
- Never execute model-generated JavaScript.
- Never expose a general `eval`, CDP command passthrough, arbitrary selector execution, or arbitrary fetch endpoint.
- Do not access cookies or authentication headers.
- Do not log field values marked sensitive.
- Clear in-memory page snapshots and recording buffers when their session ends.

## 14. Implementation phases

### Phase 1 — Scaffold and protocol

- TypeScript build, lint, test, and packaging scripts.
- Manifest V3 and minimal popup.
- Generated/shared protocol types and runtime validation.
- Native connection and handshake.

Exit criterion: popup shows the Mac app as connected and protocol contract tests pass.

### Phase 2 — Observe and highlight

- Active-tab permission flow.
- Content-script injection.
- Serializer, snapshot/ref lifecycle, limits, and redaction.
- Target highlighting.

Exit criterion: Mac debug view displays a structured snapshot of the mock AWS page and can highlight an element by ref.

### Phase 3 — Execute and verify

- Semantic resolver.
- All v0.1 action types.
- Postcondition observation, cancellation, timeouts, and uncertainty.

Exit criterion: the Mac app's deterministic DynamoDB plan runs against the mock AWS fixture without changing its orchestrator.

### Phase 4 — Teach mode

- Recording lifecycle and trusted-event capture.
- Input coalescing, navigation capture, suggested assertions, and secret placeholders.

Exit criterion: a demonstration on the fixture becomes a saved Mac-app skill and replays with different values.

### Phase 5 — Real AWS experiment

- Optional AWS origin permission.
- Test in a sandbox account.
- Fix semantic handling without introducing AWS positional-selector scripts.
- Document tested AWS console route, browser version, locale, and limitations.

Exit criterion: Remora fills a DynamoDB create form, obtains explicit approval, submits once, and verifies the outcome.

### Phase 6 — Quality pass

- Accessibility and keyboard usability for popup/overlays.
- Service-worker suspension/reconnect tests.
- Cross-origin iframe, shadow DOM, unsupported page, missing permission, navigation, and tab-close handling.
- Packaging and developer setup documentation.

## 15. Tests

At minimum, automate:

- Protocol schema validation and message correlation.
- Service-worker reconnect and request timeout.
- Accessible-name/role extraction.
- Label association and duplicate-name disambiguation.
- Snapshot expiry after navigation/mutation.
- Open shadow root and same-origin iframe traversal.
- Unsupported cross-origin iframe reporting.
- Element-not-found and ambiguity behavior.
- Fill/select/check events on controlled fixtures.
- Postcondition success/failure/uncertainty.
- No duplicate click after uncertainty.
- Password and secret-field redaction.
- Recording event ordering and input coalescing.
- Origin policy and unsafe navigation rejection.
- Overlay cleanup.
- Mock AWS DynamoDB flow with approval boundary.

Do not make CI depend on a real AWS account. Real AWS testing is a documented manual integration test.

## 16. Definition of done

Task 2 is complete when:

- The unpacked extension builds and installs from documented commands.
- The popup accurately reports Mac connection and current-tab access.
- The Mac app can request a structured page snapshot and highlight an element.
- Semantic click/fill/select/check/wait actions work on fixtures.
- Teach mode records and replays a workflow with sensitive data redacted.
- Every mutating AWS action is gated by Mac-app approval.
- The DynamoDB experiment succeeds in a sandbox account or has a documented environmental blocker after passing all local fixture tests.
- Service-worker suspension, tab navigation, cancellation, and uncertain outcomes are handled safely.
- The extension requests no unnecessary broad host access.
- Automated tests pass and no credentials or page data are committed.
- Known limitations and the manual AWS test procedure are documented.

## 17. Handoff artifacts

The final handoff must include:

- Built extension directory and source maps suitable for development.
- Exact installation steps for the unpacked extension and native host.
- Extension ID setup instructions.
- Permission rationale.
- Protocol compatibility/version statement.
- Test output and manual AWS experiment notes.
- Short demo script covering command, approval, Teach mode, replay, and failure recovery.
