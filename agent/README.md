# Remora Agent

Browser agent that turns a submitted prompt into safe, visible browser actions,
following [`../remora-agent-spec/`](../remora-agent-spec/README.md).

```text
Prompt -> planner -> active milestone -> observe -> JEV -> guard -> pointer -> execute -> verify -> next -> final
```

First workflow (fixture): create a DynamoDB table locally. Live experiment
target is Vercel in a real signed-in browser (the AWS sandbox target is
deferred). Deletion is out of scope.

## Layout

```text
agent/
  src/
    schemas/domain.ts         TaskPlan, Milestone, JevAction, Verification, RunStatus (zod)
    core/contracts.ts         interfaces: ModelGateway, Planner, JevSelector, Verifier,
                              BrowserChannel, SafetyGuard, ApprovalGate, events
    config.ts                 env loader + budgets/thresholds
    gateway/openrouter.ts     Chat Completions (strict JSON Schema) + Decisions API (JEV)
    planner/planner.ts        prompt -> plan or clarification questions
    jev/jev-selector.ts       dynamic typed questions -> one validated JevAction
    verifier/verifier.ts      milestone/final verification with evidence citations
    orchestrator/             execution loop + safety guard
    browser/ws-channel.ts     dev WebSocket bridge to the Chrome extension
    fakes/                    deterministic planner/JEV/verifier/browser for the demo
  fixtures/openrouter/        recorded model call shapes (no key needed)
  scripts/check-gateway-fixtures.ts
```

Model IDs are configuration only (`OPENROUTER_CHAT_MODEL`,
`OPENROUTER_JEV_MODEL`). No model-specific logic lives in the orchestrator.

## Commands

```sh
# Deterministic multi-milestone run, no models and no Chrome.
# Asks for approval before the final create unless --yes.
npm run demo:mocked -w @remora/agent -- --yes

# Recorded model-call shapes (planner chat, verifier chat, JEV decisions).
npm run check:gateway -w @remora/agent

# Live run against the Chrome extension (needs agent/.env + extension loaded).
npm run run -w @remora/agent -- --prompt "Create a DynamoDB table named remora-demo with partition key id"

# One observation from the active tab.
npm run observe -w @remora/agent

# Run the agent service for the macOS app (control channel + browser bridge).
npm run serve -w @remora/agent
npm run serve -w @remora/agent -- --mock --fake-browser   # model-free wiring test
```

## Configuration

Copy `agent/.env.example` to `agent/.env`. Key values:

| Variable | Meaning |
|---|---|
| `OPENROUTER_API_KEY` | single key for Chat Completions and Decisions |
| `OPENROUTER_CHAT_MODEL` | generative model for planner/verifier |
| `OPENROUTER_JEV_MODEL` | defaults to `typesafe/jev-1.13` |
| `REMORA_WS_PORT` | dev bridge port (default 8787) |
| `REMORA_BRIDGE_TOKEN` | optional shared dev token |
| budget/threshold vars | steps per milestone, total steps, confidence threshold |

## Bridge

Development uses a WebSocket bridge: the extension connects to
`ws://127.0.0.1:8787` (override in `chrome.storage.local`), sends
`bridge.hello`, and serves `page.observe.request` / `browser.action.request`
envelopes defined in [`../shared/protocol/`](../shared/protocol/src/index.ts).
`WsBrowserChannel` can be replaced by a Chrome native-messaging relay later
without touching the orchestrator.

## macOS control channel

`npm run serve` starts the agent service. The app connects to
`ws://127.0.0.1:8790` (see
[`../shared/protocol/control.ts`](../shared/protocol/src/control.ts)) and:

1. sends `control.hello`, receives `control.ready`;
2. sends `run.start {prompt}` and receives `run.accepted {runId}`;
3. consumes `run.event` (plan, milestone, observation, proposal, guard,
   approval_request, approval_resolved, action, verification, usage, finished);
4. answers approvals with `run.approval {runId, approvalId, approved, reason}`,
   which pauses the exact mutating step until a decision arrives;
5. sends `run.cancel {runId}` to stop. If the app disconnects, the run is
   cancelled and any pending approval is denied — automation never continues
   without its operator.

The Mac app contains no model or browser logic; it is a thin client of this
protocol. `--mock --fake-browser` runs the whole loop with deterministic fakes
so the wiring can be tested without an API key or Chrome. `REMORA_CONTROL_TOKEN`
optionally requires a shared token in `control.hello`.

## Local fixture

`fixtures/mock-aws/` is a deterministic stand-in for the DynamoDB console
(`node fixtures/mock-aws/serve.mjs` → `http://127.0.0.1:4173`). The fake browser
channel mirrors the same element contract, so the demo exercises the exact
milestones and approval rule used against the real console.

## Task status (remora-agent-spec/TASKS.md)

- [x] 1. Scaffold, schemas, deterministic fakes (`demo:mocked` completes)
- [x] 2. OpenRouter gateway (`check:gateway` validates all three call shapes)
- [x] 3. Goal planner (prompt → plan or clarification questions)
- [x] 4. Browser observation (extension content script, bounded + redacted)
- [x] 5. Pointer and action executor (single action, re-observe)
- [x] 6. JEV tactical policy (typed questions → one validated action)
- [x] 7. Orchestrator loop (budgets, cancellation, no-progress stops)
- [x] 8. Milestone and final verification (citations required)
- [ ] 9. Approval and Mac UI integration
- [ ] 10. Live web-app experiment (Vercel; the AWS sandbox target is deferred)

## Live runbook: Vercel

Prerequisites:

1. `cp agent/.env.example agent/.env` and set `OPENROUTER_API_KEY` plus
   `OPENROUTER_CHAT_MODEL` (any current OpenRouter chat model). JEV defaults to
   `typesafe/jev-1.13`.
2. Build and load the extension in the Chrome profile that is already signed in
   to Vercel: `npm run build:extension`, then `chrome://extensions` → Developer
   mode → Load unpacked → `extension/dist`.
3. Open `https://vercel.com` and stay signed in manually. Remora never handles
   login, MFA, or credentials.

Run:

```sh
# keep the Vercel tab active for the whole run
npm run run -w @remora/agent -- --prompt "Create a new Vercel project from my Git repository <repo> named remora-demo and deploy it"
```

1. Open the Remora popup on the Vercel tab and click **Grant access**.
2. Watch the loop in the terminal: plan → observations → JEV proposals → guard.
3. Approve the final committing action at the prompt (`Deploy`/`Create`); the
   page is re-observed and the target re-resolved before exactly one execution.
4. Verify the project/deployment in the Vercel dashboard; the final verifier
   checks the plan's `finalCriteria` against the page.

Notes:

- The plan and its `approvalRules` are planner-generated from your prompt; the
  guard also flags deploy/create/submit-like buttons heuristically.
- Deletion is out of scope in v0. Remora stops and reports `BLOCKED` on login
  walls, CAPTCHA, MFA, or payment screens.
- Do not switch tabs or click during a run: the extension always acts on the
  active tab.

## Verification performed

- `npm run demo:mocked -w @remora/agent -- --yes` completes all three
  milestones, including the approval checkpoint and final verification.
- `npm run check:gateway -w @remora/agent` validates the three recorded model
  call shapes, usage accounting, and key redaction.
- Live browser run (Chrome for Testing 154, unpacked `extension/dist`): bridge
  handshake, an 11-element snapshot of the fixture home page, and
  `click → type → type → select → click` completing
  `/ → /create-table.html → /created.html?name=remora-demo`. The full
  orchestrator loop with a scripted JEV against the real bridge also completed
  with the approval checkpoint before the final submit. See
  `extension/README.md` for the exact Chrome-for-Testing launch command.
- `npm run typecheck` is clean for protocol, agent, and extension.

## Safety behaviours in the loop

- Stale/missing/hidden/disabled targets are rejected before execution.
- Sensitive fields (password/token/key/OTP/MFA/CVV) are redacted in observations
  and blocked for typing.
- Destructive actions (delete/terminate/revoke/…) are blocked in v0.
- `mutate` actions pause for approval; after approval the page is re-observed
  and the target re-resolved before exactly one execution.
- An uncertain mutating action stops the run; it is never retried.
- Repeated identical actions and repeated verifier rejections stop the run.
