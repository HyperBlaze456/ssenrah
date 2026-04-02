# Problem-to-component map — reverse mapping harness additions to the failures they solve

Date: 2026-04-03
Scope: translate harness/platform additions into the failure they address, then classify them as either:

- **extend-current-ssenrah**: can sit on top of the existing event/log/CLI substrate
- **needs-new-subsystem**: requires a new durable state boundary, trust boundary, or orchestration engine

## Decision rule

If the feature is basically a new read model, metric, policy check, or report over existing events, it usually **extends current ssenrah**.

If the feature needs its own persistent state machine, planner, compiler, sandbox, or gateway boundary, it usually **needs a new subsystem**.

This matches the local philosophy doc’s ordering: visibility first, coordination second, orchestration and memory as a coupled boundary, then self-improvement.

## Map

| Failure / problem | Harness addition | Why this addition exists | Classification |
|---|---|---|---|
| “We cannot see what the agent did.” | Event log, traces, telemetry records, replayable timelines | Visibility is the prerequisite for everything else | extend-current-ssenrah |
| “We cannot tell which tool call caused the failure.” | Hooked lifecycle events, tool start/finish records, permission events | Intercept the real lifecycle boundary where tool choice and failure happen | extend-current-ssenrah |
| “We cannot tell whether the run is correct.” | Verification reports, file/command/test extraction, trace grading, grader outputs | Humans and machines both need a quick correctness signal | extend-current-ssenrah for reports; needs-new-subsystem for a full eval engine |
| “We cannot tell whether the run is too expensive or too noisy.” | Cost guards, escalation thresholds, anomaly detection, dashboards | Spend spikes and thrash are control-plane problems | extend-current-ssenrah |
| “We cannot safely let an agent execute risky actions.” | Human approvals, guardrails, permission checks | Writes and external side effects need an explicit trust gate | extend-current-ssenrah |
| “We cannot compare runs reliably.” | Benchmark manifests, evidence bundles, compare/regression CLI, scored datasets | Comparison requires canonical inputs and outputs | needs-new-subsystem |
| “We lose context during long tasks or compaction.” | Memory blocks, checkpointing, resume packets, compaction policy | Long-horizon work needs explicit state survival | needs-new-subsystem |
| “Tool integrations are fragmenting into N-by-M adapters.” | MCP gateway / tool mediation layer | A central gateway turns many point-to-point calls into one policy boundary | needs-new-subsystem |
| “We cannot coordinate work across multiple agents or roles.” | Planner/orchestrator, typed handoffs, reviewer/verifier loop, subagent delegation | Coordination requires stateful task ownership and a separate completion gate | needs-new-subsystem |
| “Parallel code changes collide.” | Worktrees, isolated workspaces, task-scoped claims | Isolation reduces merge conflicts and makes attribution tractable | extend-current-ssenrah |
| “We cannot standardize telemetry across tools and vendors.” | OpenTelemetry export / semantic conventions | A common schema enables cross-platform analysis | extend-current-ssenrah |
| “We do not know if benchmark results still mean the same thing.” | Historical trajectories, eval adapters, curation workflow | Benchmarks drift and need maintenance | needs-new-subsystem |

## Interpretation for ssenrah

### What should stay on the current stack
These belong near the existing `telemetry.ts`, `verify.ts`, `cost.ts`, `anomaly.ts`, and `escalation.ts` surfaces:

- visibility / trace export
- verification reports
- cost guards
- anomaly detection
- worktree-scoped isolation
- human approval events
- dashboard projections

### What wants a separate subsystem boundary
These are hard to do well as just another helper function:

- durable memory and resume packets
- planner / orchestrator / reviewer loop
- MCP gateway and tool-policy mediation
- sandboxed execution boundary
- benchmark/eval engine with historical replay

## Recommended sequencing

1. **Normalize the event substrate**: canonical cost, trace, and lineage semantics.
2. **Add the evidence layer**: verification artifacts and comparison outputs.
3. **Introduce benchmark/eval adapters**: manifests, historical trajectories, and regression scoring.
4. **Split out new subsystems only when the boundary is real**: memory, orchestration, gateway, sandbox.

## Source URLs

### Local context
- Current repo philosophy: `docs/harness_architecutre/current_philosophy.md`
- Monitoring / evidence pack: `docs/research/harness-monitoring-20260402/agents/00-leader-empirical-findings.md`, `docs/research/harness-monitoring-20260402/agents/08-design-recommendations.md`, `docs/research/harness-monitoring-20260402/agents/09-memory-compaction-longhorizon.md`

### Official docs and primary sources
- OpenAI Agent Builder: https://platform.openai.com/docs/guides/agent-builder
- OpenAI node reference / human approval node: https://platform.openai.com/docs/guides/node-reference
- OpenAI safety in building agents: https://platform.openai.com/docs/guides/agent-builder-safety
- OpenAI trace grading: https://platform.openai.com/docs/guides/trace-grading
- OpenAI agent evals: https://platform.openai.com/docs/guides/agent-evals
- Anthropic Claude Code hooks: https://docs.anthropic.com/en/docs/claude-code/hooks
- Anthropic Claude Code subagents: https://docs.anthropic.com/en/docs/claude-code/sub-agents
- Anthropic Claude Code permissions / security: https://docs.anthropic.com/en/docs/claude-code/team , https://docs.anthropic.com/en/docs/claude-code/security
- Model Context Protocol intro: https://modelcontextprotocol.io/docs/getting-started/intro
- Model Context Protocol architecture / sessions / versioning: https://modelcontextprotocol.io/docs/getting-started/intro , https://modelcontextprotocol.io/docs/getting-started/intro#about-mcp
- OpenTelemetry GenAI agent spans: https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/
- OpenTelemetry MCP semantic conventions: https://opentelemetry.io/docs/specs/semconv/gen-ai/mcp/
- LangSmith observability: https://docs.langchain.com/langsmith/observability
- LangSmith dashboards: https://docs.langchain.com/langsmith/dashboards
- LangSmith threads/state: https://docs.langchain.com/langsmith/threads , https://docs.langchain.com/langsmith/use-threads
- LangSmith OTel bridge: https://docs.langchain.com/langsmith/collector-proxy
- LangSmith long-term memory: https://docs.langchain.com/oss/python/langchain/long-term-memory
- Braintrust observability / logs / dashboards / deep search: https://www.braintrust.dev/docs/observe , https://www.braintrust.dev/docs/platform/logs/view , https://www.braintrust.dev/docs/observe/dashboards , https://www.braintrust.dev/docs/core/logs/use-deep-search
- Letta memory / ADE: https://docs.letta.com/letta-code/memory , https://docs.letta.com/guides/ade/overview
- Git worktree: https://git-scm.com/docs/git-worktree.html
