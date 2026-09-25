# Remora protocol v0.1

Shared message contract between the agent orchestrator and the Chrome
extension. Implementation lives in [`src/index.ts`](./src/index.ts) (zod 4);
both sides import it as `@remora/protocol`.

This is a reduced, transport-neutral descendant of
[`../../SHARED_INTEGRATION_SPEC.md`](../../SHARED_INTEGRATION_SPEC.md), scoped to
what the browser agent needs. The transport is swappable: the current dev
transport is a WebSocket bridge; a Chrome native-messaging relay can carry the
same envelopes later.

## Envelope

```json
{
  "protocolVersion": "0.1",
  "id": "uuid",
  "correlationId": null,
  "sentAt": "2026-09-25T10:00:00Z",
  "source": "orchestrator",
  "type": "page.observe.request",
  "payload": {}
}
```

A response uses the request's `id` as its `correlationId`. Unknown types or
unsupported protocol versions receive `protocol.error`.

## Messages

| Type | Direction | Purpose |
|---|---|---|
| `bridge.hello` | extension → orchestrator | version, protocol list, optional token, active tab |
| `bridge.ready` | orchestrator → extension | selected protocol version + capabilities |
| `bridge.status` | extension → orchestrator | connected / degraded / permission state |
| `protocol.error` | either | stable code + safe message |
| `page.observe.request` | orchestrator → extension | ask for a bounded element snapshot |
| `page.observe.response` | extension → orchestrator | `PageObservation` |
| `browser.action.request` | orchestrator → extension | one action against a snapshot ref |
| `browser.action.result` | extension → orchestrator | succeeded / failed / uncertain / cancelled + fresh observation |
| `browser.cancel` | orchestrator → extension | cancel the current run and clear overlays |

## Rules

- `ref` values (`e1`, `e2`, …) are ephemeral and valid only for their
  `snapshotId`. The extension re-resolves before acting and rejects stale or
  ambiguous targets.
- Sensitive fields never carry values: `value` is `null` and
  `valueRedacted: true`.
- Observations are bounded (element count, text length); `truncated` reports
  what was omitted.
- The extension never decides that an action is approved; it only executes
  requests from the orchestrator.

## Full JSON Schema

The deferred integration spec called for a checked-in
`protocol.schema.json`. Runtime validation currently uses the zod schemas in
`src/index.ts`, which are the single source of truth for both sides; a JSON
Schema export can be generated from them when the native-messaging relay lands.

## Control protocol (macOS app ↔ agent)

[`src/control.ts`](./src/control.ts) defines a second, smaller envelope family
for the macOS app: `control.hello/ready/error`, `run.start`, `run.accepted`,
`run.cancel`, `run.approval`, and `run.event` carrying a `ControlEvent` union
(status, plan, milestone, observation, proposal, guard, approval_request,
approval_resolved, action, verification, usage, finished, error). Transport is
the local control WebSocket (`ws://127.0.0.1:8790`) owned by
`agent/src/control/control-server.ts`. The app never calls models or the
browser; approvals round-trip through the orchestrator, and a disconnected app
cancels the run.
