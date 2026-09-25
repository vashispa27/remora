# Remora Agent Specification

This folder specifies the browser agent that turns a submitted prompt into visible browser actions.

- [Architecture](./ARCHITECTURE.md)
- [Implementation tasks](./TASKS.md)

Initial target: create and configure a DynamoDB table in an AWS sandbox account.

All cloud models are accessed through OpenRouter using one `OPENROUTER_API_KEY`:

- Generative planner and verifier: OpenRouter Chat Completions with strict structured output.
- JEV action selector: OpenRouter Decisions API using `typesafe/jev-1.13` initially.

Model IDs must remain configuration values. No model-specific logic belongs in the orchestrator.
