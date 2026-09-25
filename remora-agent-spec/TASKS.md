# Remora Agent — Implementation Tasks

Complete these in order. Each task must have tests before the next begins.

## 1. Agent scaffold and schemas

- Create the agent service and configuration loader.
- Define and validate `TaskPlan`, `Milestone`, `PageObservation`, `JevAction`, `Verification`, and `RunState`.
- Add a deterministic fake planner, JEV client, verifier, and browser adapter.

Done: a fully mocked multi-milestone run reaches completion.

## 2. OpenRouter gateway

- Add one client using `OPENROUTER_API_KEY`.
- Implement Chat Completions with strict JSON Schema for planner/verifier calls.
- Implement the OpenRouter Decisions API for JEV.
- Make all model IDs configurable; add timeouts, cancellation, usage logging, and redaction.

Done: recorded fixtures validate all three model-call shapes without exposing the key.

## 3. Goal planner

- Convert a prompt into inputs, outcome-based milestones, completion criteria, and approval rules.
- Return clarification questions for missing inputs.
- Add an optional retrieval-context field; no full RAG system yet.

Done: DynamoDB prompts produce valid plans and incomplete prompts request the correct information.

## 4. Browser observation

- Build the Chrome content-script snapshotter.
- Emit visible actionable elements with ephemeral refs, semantic properties, values, and rectangles.
- Bound node count and text size; redact sensitive inputs.

Done: a local AWS-like page produces a stable validated observation.

## 5. Pointer and action executor

- Render the Remora pointer/highlight inside the page.
- Animate to a referenced element.
- Execute click, type, select, scroll, and wait exactly once.
- Reject stale or unsafe targets and report success, failure, or uncertainty.

Done: scripted actions visibly complete the local fixture without model calls.

## 6. JEV tactical policy

- Build dynamic operation and compatible-target choices from the observation.
- Send overall goal, active milestone, inputs, recent actions, and feedback through OpenRouter Decisions.
- Validate probabilities, confidence, selected operation, and selected target.

Done: JEV completes one fixture milestone through multiple actions.

## 7. Orchestrator loop

- Implement state transitions, milestone activation, action history, budgets, cancellation, and timeout handling.
- Loop observe → JEV → guard → animate → execute → observe.
- Stop safely on low confidence, repeated no-progress actions, `BLOCKED`, or uncertain mutation.

Done: a multi-milestone fixture task runs without manual backend intervention.

## 8. Milestone and final verification

- Invoke the verifier when JEV proposes `MILESTONE_DONE`.
- Require evidence references for every judgment.
- Return unmet criteria as feedback to JEV.
- Run a separate final verification across all task criteria.

Done: premature completion is rejected and correct completion advances the plan.

## 9. Approval and Mac UI integration

- Connect prompt submission, progress, pointer state, approval, cancellation, and final result to the Mac app.
- Pause before the DynamoDB final-create action.
- Re-observe after approval before executing once.

Done: the user can start, inspect, approve, stop, and finish a run from Remora.

## 10. AWS experiment and evaluation

- First pass the complete workflow on the local AWS-like fixture.
- Then test in a dedicated AWS sandbox account.
- Measure success, wrong actions, interventions, latency, model cost, steps, and confidence.
- Do not automate cleanup or deletion.

Done: Remora creates and verifies one DynamoDB table after explicit approval, with a complete trace and documented limitations.
