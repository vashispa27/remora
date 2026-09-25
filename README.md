# Remora

The active implementation scope is a UI-only macOS prototype.

Start with [Mac App UI Specification](./mac-app-spec/README.md). It is divided into five small implementation tasks that can be completed sequentially.

The browser-agent is specified in [Remora Agent Specification](./remora-agent-spec/README.md) and implemented in [`agent/`](./agent/README.md) with the Chrome extension in [`extension/`](./extension/README.md). It covers prompt planning, JEV-driven browser actions, milestone verification, and the execution loop. Tasks 1–8 of the agent spec are implemented against the local fixture; Mac UI wiring (Task 9) and the live Vercel experiment (Task 10, AWS deferred) are still open.

```sh
npm install
npm run demo:mocked    # deterministic agent run, no models and no Chrome
npm run check:gateway  # recorded OpenRouter call-shape validation
npm run build:extension
npm run serve -w @remora/agent   # macOS control channel + browser bridge
npm run serve:fixtures # mock AWS pages on http://127.0.0.1:4173
```

The implementation lives in [`macos/`](./macos/README.md). See that README for build,
test, run, and debug instructions. In short:

```sh
cd macos
./scripts/test.sh        # unit tests
./scripts/build-app.sh   # .build/Remora.app
open .build/Remora.app
```

The current prototype demonstrates this interaction:

1. The user invokes Remora with a global shortcut.
2. A separate Remora pointer appears with a compact command panel.
3. The user enters a task and presses Return.
4. The panel changes state and the Remora pointer visually demonstrates performing the task.

The macOS prototype itself remains UI-only: no real automation, model integration, retrieval, or browser communication happens inside `macos/`. The agent and extension implement those separately.

`SHARED_INTEGRATION_SPEC.md` and `TASK_2_CHROME_EXTENSION_SPEC.md` are deferred drafts. They must not be implemented until the automation backend and integration boundary are reconsidered.
