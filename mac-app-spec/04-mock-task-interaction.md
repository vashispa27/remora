# Subtask 4 — Mock Task Interaction

Depends on: Subtasks 1–3

## Objective

Connect the command panel to a deterministic UI-only driver so the prototype visibly transitions from command entry to apparent task execution and completion.

No external application is inspected or controlled.

## State flow

```text
ready
  -> submitting (brief acknowledgment)
  -> working step 1
  -> working step 2
  -> working step 3
  -> succeeded
```

Debug controls must also allow:

```text
working -> failed
working -> cancelled
```

## Panel transformations

### Submitting

- Lock editing immediately after a valid submission.
- Replace the submit icon with a small indeterminate progress indicator.
- Retain the command text so the transition feels continuous.
- Duration in the mock: approximately 300–500 ms.

### Working

Collapse the panel into a smaller activity card anchored to the pointer:

```text
┌──────────────────────────────────────┐
│ ● Remora is working             Stop │
│ Opening DynamoDB console…        1/3 │
└──────────────────────────────────────┘
```

Show:

- Plain-language current step.
- Step number such as `1/3`.
- Thin determinate progress indicator.
- Stop button.
- A compact disclosure control to reveal the original command; no detailed logs.

### Success

- Show a check badge at the pointer.
- Activity card reads `Done` plus a one-line mock summary.
- Automatically dismiss after 2.5 seconds unless hovered or keyboard-focused.
- Pressing Return or Escape dismisses immediately.

### Failure

- Keep the card visible with a short mock error.
- Actions: **Try again** and **Dismiss**.
- **Try again** restarts only the deterministic animation; it performs no external work.

### Cancelled

- Stop the current mock animation promptly.
- Display `Stopped` for approximately one second, then dismiss.

## Mock driver

Implement a deterministic `MockTaskUIDriver` using async timing and injected test clocks where practical.

For commands containing `dynamodb` or `table`, use these sample labels:

1. `Opening DynamoDB…`
2. `Filling table details…`
3. `Reviewing the request…`

For other commands:

1. `Looking at the current app…`
2. `Preparing the task…`
3. `Finishing up…`

The labels are presentation fixtures only. Do not parse parameters, generate a plan, or claim a resource was actually created. Success copy should say `Demo complete` in debug builds so the prototype cannot be mistaken for real automation.

## Mock pointer path

- On working-state entry, animate the Remora pointer along two or three points inside the active display's visible frame.
- Use a short eased path that suggests intention rather than random movement.
- Never derive points from another application's controls.
- Never click, type, scroll, focus, or post input events.
- Keep the activity card attached and correctly flipped during movement.
- With Reduce Motion enabled, keep the pointer stationary and advance only labels/progress.

## Concurrency rules

- Only one mock run exists at a time.
- A second submit cannot occur during a run.
- Shortcut invocation during a run brings the activity card forward rather than creating a new run.
- Cancellation invalidates pending timers so late success cannot appear.
- App termination cancels outstanding mock work cleanly.

## Acceptance criteria

- Submitting changes state exactly once.
- The mock run shows three deterministic steps and synchronized progress.
- The Remora pointer moves visually without affecting the real pointer or target application.
- Stop produces cancellation and prevents a later success transition.
- Debug failure can retry and complete.
- Re-invocation during work reveals the existing activity card.
- Reduce Motion uses stationary-pointer behavior.
- Unit tests cover every allowed and rejected state transition.
