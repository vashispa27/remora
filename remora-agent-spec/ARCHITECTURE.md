# Remora Browser Agent Architecture

## Objective

Convert a user prompt into safe, visible browser actions:

```text
Prompt → plan → active milestone → JEV action loop → verification → next milestone → complete
```

The first workflow is DynamoDB table creation. The final **Create table** action requires user approval; deletion is out of scope.

## Components

### Mac app

- Captures the prompt and approval decisions.
- Displays status and the Remora pointer.
- Never calls models directly.

### Agent orchestrator

- Owns the task, milestones, action history, loop, cancellation, and terminal state.
- Calls OpenRouter and the Chrome extension.
- Is the only component allowed to advance a milestone or finish a task.

### OpenRouter gateway

- Keeps `OPENROUTER_API_KEY` outside the extension.
- Calls a configurable generative model through Chat Completions.
- Calls JEV through `POST /api/alpha/decisions` with model `typesafe/jev-1.13`.
- Uses strict JSON Schema outputs for planning and verification.

### Planner

Uses the user prompt, model knowledge, and optional retrieved documentation to produce:

```json
{
  "goal": "Create DynamoDB table remora",
  "inputs": {},
  "milestones": [
    {"id": "m1", "goal": "Open DynamoDB", "completion": ["DynamoDB page is visible"]}
  ],
  "finalCriteria": [],
  "approvalRules": []
}
```

Milestones describe outcomes, not DOM selectors or click sequences. Missing required inputs return clarification questions instead of a plan.

### Chrome extension

- Observes the active page as a bounded table of visible actionable elements.
- Returns roles, names, values, states, rectangles, URL, title, and visible text.
- Animates the Remora browser pointer to the chosen element.
- Executes one validated action: click, type, select, scroll, or wait.
- Re-observes after execution and reports the mechanical result.

### JEV action selector

Receives only the current tactical context:

- Overall goal.
- Active milestone and required values.
- Short completed-milestone summary.
- Current page observation.
- Recent actions and verifier feedback.

It returns one of:

```text
CLICK(element)
TYPE_TEXT(element, inputKey)
SELECT(element, option)
SCROLL(direction)
WAIT
MILESTONE_DONE
BLOCKED
```

JEV proposes actions and completion; it never executes or advances the plan.

### Verifier

The generative verifier compares milestone criteria with current observed evidence and returns:

```text
SATISFIED | NOT_SATISFIED | PENDING | AMBIGUOUS
```

Each judgment must cite element references or page facts. `MILESTONE_DONE` is accepted only after verifier confirmation. The final verifier checks every final criterion before task completion.

### Safety guard

- Reject stale, missing, hidden, disabled, covered, or ambiguous targets.
- Gate actions using JEV confidence and action risk.
- Require approval immediately before external mutation.
- Never automatically retry an uncertain mutation.
- Block passwords, MFA, credentials, IAM privilege changes, payments, and deletion in v0.

## Execution loop

```text
1. Planner creates TaskPlan or asks for clarification.
2. Orchestrator activates the first milestone.
3. Extension observes the current page.
4. JEV proposes one action.
5. If MILESTONE_DONE: verifier confirms; advance or return feedback to JEV.
6. If BLOCKED/low confidence: ask the planner to repair remaining milestones or request user help.
7. Otherwise: safety guard checks the action.
8. Pointer animates; extension executes exactly once.
9. Extension verifies the immediate mechanical effect.
10. Repeat from observation.
11. After all milestones, run final verification and finish.
```

## Required state

Persist in memory for v0:

```text
taskId, prompt, TaskPlan, activeMilestone
pageSnapshotId, recentActions, verifierFeedback
approvals, status, error, timestamps
```

States:

```text
planning → needs_input | running → awaiting_approval | replanning → completed | failed | cancelled
```

## Boundaries

- DOM-first; no screenshot/vision fallback in v0.
- No saved skills, teaching, native-app automation, or local models yet.
- RAG is optional and supplies planning context only; raw documents are not sent to JEV.
- Start against a local AWS-like fixture, then use a sandbox AWS account.
