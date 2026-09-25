# Remora Shared Integration Specification — Deferred Draft

> **Do not implement this document yet.** The current active scope is the UI-only macOS prototype in `mac-app-spec/`. Backend and browser integration decisions will be revisited later.

Status: implementation contract for v0.1  
Owners: Task 1 and Task 2 implementers  
Protocol version: `0.1`

## 1. Purpose

This document defines the boundary between the Remora macOS app and Chrome extension. Neither component should depend on the other's internal implementation.

The high-level flow is:

```text
User
  -> Remora macOS UI
  -> Orchestrator and safety policy
  -> Native messaging relay
  -> Chrome extension service worker
  -> Content script
  -> Current webpage
```

The Mac app is authoritative for commands, plans, skills, approvals, run state, model calls, retrieval, and audit history. The extension is authoritative for browser tabs, page observations, element references, browser actions, and recorded page events.

## 2. Repository boundaries

The expected repository layout is:

```text
remora/
  macos/                       Swift app and native host helper
  extension/                   Chrome Manifest V3 extension
  shared/
    protocol/
      protocol.schema.json     JSON Schema for every envelope and payload
      examples/                Valid request and response fixtures
  fixtures/
    mock-aws/                  Deterministic local AWS-like test pages
  docs/
```

Task 1 owns `macos/` and creates the initial protocol schema and fixtures. Task 2 owns `extension/`. A protocol change requires an update to the schema, examples, and contract tests.

## 3. Transport

Use Chrome Native Messaging.

```text
Chrome extension
  <-> stdin/stdout native-messaging frames
remora-native-host helper
  <-> Unix domain socket
running Remora macOS app
```

Requirements:

- Native messages use Chrome's four-byte native-endian length prefix followed by UTF-8 JSON.
- The helper must never write logs to stdout; stdout is reserved for protocol frames. Logs go to stderr or unified logging.
- The helper rejects messages larger than 1 MiB. Screenshots must not be sent as base64 through native messaging; save them locally in the app and exchange metadata only.
- The native-host manifest allows only the packaged Remora extension ID.
- The Mac app exposes a Unix socket inside its application-support directory with permissions limited to the current user.
- Requests time out and return a structured error. A dropped connection must not silently retry an action that could have succeeded.
- Development may use an unpacked-extension ID configured by an installation script. Do not hard-code a developer's absolute home path in committed files.

## 4. Envelope

Every message uses this envelope:

```json
{
  "protocolVersion": "0.1",
  "id": "uuid",
  "correlationId": "uuid-or-null",
  "sentAt": "2026-09-25T10:00:00Z",
  "source": "macos|extension|native-host",
  "type": "page.context.request",
  "payload": {}
}
```

Rules:

- `id` is unique per message.
- A response uses the request's `id` as `correlationId`.
- Unknown message types or major protocol versions receive `protocol.error`.
- Payloads are versioned through the envelope; do not infer types from missing fields.
- All timestamps are UTC ISO-8601 strings.

## 5. Required message types

### Connection

- `bridge.hello`: component version, supported protocol versions, extension ID, browser version, active-tab metadata.
- `bridge.ready`: selected protocol version and capability list.
- `bridge.heartbeat`: liveness only; never changes run state.
- `bridge.status`: connected, disconnected, missing permission, unsupported page, or degraded.
- `protocol.error`: stable error code, safe message, and optional retryability.

### Observation

- `page.context.request`: asks for the active page or a specified tab.
- `page.context.response`: returns page metadata, an accessibility-oriented element snapshot, viewport, and snapshot ID.
- `page.screenshot.request`: asks Chrome to capture the visible tab when permission allows it.
- `page.screenshot.response`: returns capture metadata; the Mac app is responsible for durable local storage.
- `element.highlight.request`: highlights a referenced element for user review.
- `element.highlight.clear`: clears all Remora highlights.

Example page context:

```json
{
  "snapshotId": "snap-uuid",
  "tab": {
    "tabId": 42,
    "url": "https://us-east-1.console.aws.amazon.com/dynamodbv2/home",
    "title": "DynamoDB | AWS Console"
  },
  "viewport": { "width": 1440, "height": 900, "deviceScaleFactor": 2 },
  "elements": [
    {
      "ref": "e17",
      "role": "button",
      "name": "Create table",
      "label": null,
      "text": "Create table",
      "tag": "button",
      "enabled": true,
      "visible": true,
      "editable": false,
      "sensitive": false,
      "rect": { "x": 1180, "y": 122, "width": 126, "height": 34 },
      "semanticPath": ["main", "region:Tables", "button:Create table"]
    }
  ]
}
```

Element references are valid only for the matching `snapshotId`. The extension must re-resolve an element immediately before acting and reject ambiguous matches.

### Execution

- `browser.action.request`: one browser action plus its originating snapshot and semantic target.
- `browser.action.result`: success, failure, or uncertain, along with the resulting observation.
- `browser.cancel`: cancels the current action and clears overlays.

Supported v0.1 actions:

```text
click
fill
select
check
uncheck
press
scroll
focus
navigate
waitFor
```

An action request contains:

```json
{
  "runId": "run-uuid",
  "stepId": "step-uuid",
  "snapshotId": "snap-uuid",
  "action": "click",
  "target": {
    "ref": "e17",
    "role": "button",
    "name": "Create table",
    "semanticPath": ["main", "region:Tables", "button:Create table"]
  },
  "value": null,
  "timeoutMs": 10000,
  "expected": {
    "urlContains": "/create-table",
    "visible": { "role": "heading", "name": "Create table" }
  }
}
```

The result status is one of:

- `succeeded`: action and postcondition were verified.
- `failed`: action did not complete and is safe to retry.
- `uncertain`: the extension cannot determine whether the action completed. Never automatically retry an uncertain mutating action.
- `cancelled`: user or orchestrator cancelled it.

### Teach mode

- `recording.start`: starts recording in an explicitly selected tab.
- `recording.started`: returns recording and tab IDs.
- `recording.event`: semantic click, fill, select, check, navigation, or assertion candidate.
- `recording.stop`: stops recording.
- `recording.completed`: returns the final ordered event trace and warnings.

Recorded events must contain semantic targets and page state, not only coordinates or CSS selectors. Password fields and likely secrets are represented as required variables without recording their values.

## 6. Skill definition

The Mac app persists skills in a transport-neutral format:

```json
{
  "schemaVersion": "0.1",
  "id": "skill-uuid",
  "name": "Create a DynamoDB table",
  "description": "Creates a basic on-demand table after user approval.",
  "allowedOrigins": ["https://*.console.aws.amazon.com"],
  "inputs": [
    { "key": "tableName", "type": "string", "required": true, "sensitive": false },
    { "key": "partitionKey", "type": "string", "required": true, "sensitive": false }
  ],
  "steps": [],
  "createdFrom": "demonstration|planner|manual",
  "createdAt": "2026-09-25T10:00:00Z",
  "updatedAt": "2026-09-25T10:00:00Z"
}
```

Each step contains an action, semantic target, templated input, precondition, expected postcondition, timeout, retry policy, and risk classification.

Coordinates, XPath, and CSS selectors are allowed only as fallback hints. They must not be the only selector stored for a reusable skill.

## 7. Risk and approval policy

Risk classifications:

- `read`: observation, navigation, opening panels, or retrieving documentation.
- `draft`: entering non-sensitive data without committing it.
- `mutate`: creating or changing remote state.
- `destructive`: deletion, permission changes, credential changes, or potentially irreversible operations.

Policy for v0.1:

- `read` and `draft` may execute after the user starts a run.
- `mutate` requires a clearly labeled approval immediately before the committing action.
- `destructive` is disabled for autonomous execution. Remora may explain or navigate to the confirmation screen but must not perform the final action.
- Authentication, CAPTCHA, MFA, payment, IAM privilege escalation, access-key creation, and password entry must be handed back to the user.
- Each approval shows the exact action, target account/region when known, supplied values, and expected effect.
- The extension never decides that an action is approved; it only acts on a request from the Mac orchestrator.

For the DynamoDB experiment, clicking the final AWS **Create table** button is classified as `mutate` and requires approval. Any table deletion is `destructive` and remains manual.

## 8. Data handling

- Store application data under the normal macOS Application Support directory.
- Store secrets only in Keychain. Do not put API keys, cookies, tokens, or passwords in skill JSON, extension storage, fixtures, logs, or screenshots.
- Redact values from password fields and common secret/token inputs.
- Allow the user to delete a run, captured screenshot, document index, or saved skill.
- The default model configuration must permit a fully local endpoint.
- Before sending page context to any hosted model, show which provider is active and minimize the transmitted tree.

## 9. Error codes

Implement at least:

```text
PROTOCOL_VERSION_UNSUPPORTED
BRIDGE_NOT_CONNECTED
APP_NOT_RUNNING
TAB_NOT_FOUND
PAGE_NOT_SUPPORTED
PAGE_PERMISSION_REQUIRED
SNAPSHOT_EXPIRED
ELEMENT_NOT_FOUND
ELEMENT_AMBIGUOUS
ELEMENT_NOT_INTERACTABLE
ACTION_TIMEOUT
ACTION_FAILED
ACTION_RESULT_UNCERTAIN
RECORDING_NOT_ACTIVE
USER_CANCELLED
APPROVAL_REQUIRED
POLICY_BLOCKED
SENSITIVE_INPUT_REQUIRED
```

Errors shown to the user must include a useful recovery action. Internal stack traces remain in local debug logs.

## 10. Contract testing

Both tasks must run the same JSON fixtures against the checked-in JSON Schema.

The minimum fixtures are:

- Successful handshake.
- Supported and unsupported protocol versions.
- Page context with a button, textbox, select, checkbox, iframe marker, and sensitive field.
- Successful click and fill results.
- Expired snapshot.
- Ambiguous element.
- Uncertain mutating action.
- Recording containing a redacted password field.
- DynamoDB final-create approval requirement.

Integration is complete only when the real extension can replace the Task 1 simulator without changes to the Mac app's orchestration or persistence layers.
