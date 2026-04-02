# Harness augmentation synthesis

Date: 2026-04-03
Scope: what the external ecosystem says the next layer of ssenrah should be.

## One-line synthesis

The ecosystem is converging on a **control plane for agent work**: traces, hooks, approvals, memory, and evals are becoming the platform, while the model itself is only one part of the stack.

## What the research says

### 1) Visibility comes first
OpenAI Agent Builder / trace grading, Claude Code hooks, Braintrust, LangSmith, and OpenTelemetry all point to the same conclusion: if you cannot observe the run, you cannot reliably improve it.

**For ssenrah:** keep hardening the existing event log, telemetry read models, and verification surfaces before adding more orchestration complexity.

### 2) Tool mediation is a trust boundary
Claude Code hooks and OpenAI’s MCP / guardrail surfaces show that tool calls, permissions, and failures need to be intercepted as first-class events.

**For ssenrah:** the current hook/event architecture is the right foundation for cost guards, approval events, and anomaly detection.

### 3) Memory and compaction are a separate subsystem
Letta, LangGraph persistence, and OpenClaw compaction all treat memory, pruning, and resume as runtime infrastructure rather than prompt engineering.

**For ssenrah:** this is the clearest candidate for a new subsystem boundary. Long-horizon work needs durable checkpoints, not just more context.

### 4) Evaluation must become replayable
OpenAI evals / trace grading, LangSmith thread history, and benchmark projects like τ-bench / AgentBench / OSWorld all show that evaluation only becomes useful when the task definition, run artifacts, and scoring contract are stable.

**For ssenrah:** evolve the monitoring stack into an evidence + benchmark layer, not just a dashboard.

## What should stay inside the current stack
These are natural extensions of the current `harness` package and its event model:

- telemetry and trace export
- verification summaries
- cost accounting / escalation
- anomaly detection
- human-readable dashboards / projections
- worktree-scoped task isolation
- approval events and policy logs

## What should become new subsystems
These are likely too boundary-heavy to keep as helpers:

- durable memory and resume packets
- planner / orchestrator / verifier loop
- MCP gateway / centralized tool mediation
- sandboxed execution boundary
- benchmark manifest + replay engine

## Recommended next step sequence

1. Normalize the current event substrate: trace, cost, lineage, and verification semantics.
2. Add a benchmark/evidence contract: manifest, artifact bundle, compare CLI.
3. Split out the memory subsystem: compaction, checkpointing, resume.
4. Split out orchestration only after visibility is stable: planner, verifier, handoffs.
5. Add a tool gateway and sandbox boundary last, once the policy model is clear.

## Research URLs

- OpenAI Agent Builder: https://platform.openai.com/docs/guides/agent-builder
- OpenAI node reference / human approval node: https://platform.openai.com/docs/guides/node-reference
- OpenAI safety in building agents: https://platform.openai.com/docs/guides/agent-builder-safety
- OpenAI trace grading: https://platform.openai.com/docs/guides/trace-grading
- OpenAI agent evals: https://platform.openai.com/docs/guides/agent-evals
- Anthropic Claude Code hooks: https://docs.anthropic.com/en/docs/claude-code/hooks
- Anthropic Claude Code subagents: https://docs.anthropic.com/en/docs/claude-code/sub-agents
- Anthropic Claude Code permissions / security: https://docs.anthropic.com/en/docs/claude-code/team , https://docs.anthropic.com/en/docs/claude-code/security
- Model Context Protocol intro: https://modelcontextprotocol.io/docs/getting-started/intro
- OpenTelemetry GenAI agent spans: https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/
- OpenTelemetry MCP semantic conventions: https://opentelemetry.io/docs/specs/semconv/gen-ai/mcp/
- LangSmith observability and dashboards: https://docs.langchain.com/langsmith/observability , https://docs.langchain.com/langsmith/dashboards
- LangSmith threads/state: https://docs.langchain.com/langsmith/threads , https://docs.langchain.com/langsmith/use-threads
- LangSmith OpenTelemetry bridge: https://docs.langchain.com/langsmith/collector-proxy
- LangSmith long-term memory / persistence: https://docs.langchain.com/oss/python/langchain/long-term-memory
- Braintrust observability / logs / dashboards: https://www.braintrust.dev/docs/observe , https://www.braintrust.dev/docs/platform/logs/view , https://www.braintrust.dev/docs/observe/dashboards
- Letta memory / ADE: https://docs.letta.com/letta-code/memory , https://docs.letta.com/guides/ade/overview
- Git worktree: https://git-scm.com/docs/git-worktree.html
