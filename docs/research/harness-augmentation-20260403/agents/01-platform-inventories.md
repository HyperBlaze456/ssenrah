# Platform Inventory — concrete harness and agent-platform patterns

Date: 2026-04-03
Scope: concrete platform patterns that show up repeatedly in current agent runtimes, harnesses, and eval stacks.

## Executive summary

The ecosystem is converging on a small number of repeatable harness patterns:

1. **Trace-first runtimes** with sessions, spans, and per-step lineage.
2. **Hookable tool mediation** so tool use, permissions, and failures are observable.
3. **OpenTelemetry export** as the vendor-neutral observability backbone.
4. **Dashboard layers** that turn traces into operator questions.
5. **Explicit memory/compaction engines** instead of stuffing more into prompt context.
6. **Benchmark adapters and historical trajectories** for reproducible evaluation.

These are not mutually exclusive; most serious platforms combine several of them.

## Inventory table

| Pattern | Concrete examples | What the pattern buys you | Fit for ssenrah |
|---|---|---|---|
| Trace-first runtime | OpenAI Agents SDK tracing, sessions, context management, MCP, guardrails, human-in-the-loop | A single SDK surface for agent orchestration plus durable run lineage | Strong fit for extending the current telemetry/verification stack |
| Hook-mediated lifecycle | Anthropic Claude Code hooks + monitoring/usage docs | Intercept pre-tool, post-tool, permission, and session events without rewriting the agent | Strong fit for the existing hook ingestion model |
| Standard observability export | OpenTelemetry GenAI agent spans and MCP semantic conventions | A common schema for agent/tool spans across vendors and backends | Strong fit for export/interchange |
| Operator dashboards | LangSmith dashboards; Braintrust observability + dashboards | Turn traces into comparable views, alerts, and project-level monitoring | Strong fit for the current CLI/read-model idea |
| Explicit memory blocks | Letta memory blocks / custom memory | Separate working memory from persistent memory so state survives long workflows | Likely needs a dedicated memory subsystem |
| Compaction-aware sessions | OpenClaw context engine + compaction + session management | Make context pruning an explicit runtime concern instead of an accidental one | Likely needs a dedicated checkpoint/compaction subsystem |
| Benchmark harnesses | τ-bench, Terminal-Bench, OSWorld, AgentBench | Reproducible task suites with historical trajectories and structured result files | Likely needs a benchmark/eval adapter layer |
| Instrumentation + cost reporting | Braintrust instrumentation, Claude Code monitoring, OpenAI usage/cost docs | Cost and token usage become first-class signals rather than after-the-fact invoices | Strong fit for cost guards and anomaly detection |

## Pattern notes

### 1) Trace-first runtimes
OpenAI’s Agents SDK surfaces tracing, sessions, context management, MCP, and guardrails as first-class guides rather than add-ons.

**Why it matters:** the runtime itself is already assuming that agent runs need to be inspectable, replayable, and policy-aware.

**Takeaway for ssenrah:** keep the current event log as the source of truth, then add richer run lineage and trace export on top.

### 2) Hook-mediated lifecycle
Claude Code exposes hooks around tool use and monitoring/usage telemetry. That is a strong pattern for any harness that wants to observe behavior without forcing the model to emit structured JSON itself.

**Why it matters:** hooks catch the real lifecycle boundary where tool choices, permissions, and failures happen.

**Takeaway for ssenrah:** the current hook/event approach is aligned with this pattern already.

### 3) OpenTelemetry as the interchange layer
OpenTelemetry’s GenAI semantic conventions explicitly cover agent spans and MCP-related spans.

**Why it matters:** if multiple runtimes and backends are involved, semantic conventions prevent one-off logging schemas from fragmenting the stack.

**Takeaway for ssenrah:** export is more valuable than replacing the local log format.

### 4) Memory and compaction are runtime concerns
Letta and OpenClaw both treat memory/compaction as a first-class subsystem, not a prompt trick.

**Why it matters:** long-horizon agents fail when they lose context, overfill context, or compact badly.

**Takeaway for ssenrah:** memory probably deserves a separate subsystem boundary.

### 5) Benchmark harnesses need historical trajectories
τ-bench explicitly ships historical trajectories and warns about result-file structure; Terminal-Bench / OSWorld / AgentBench all treat reproducibility as part of the product.

**Why it matters:** evaluation is not just scoring an answer; it is replayable task infrastructure.

**Takeaway for ssenrah:** the monitoring stack should grow into an eval adapter layer, not a pile of ad hoc scripts.

## Source URLs

- OpenAI Agents SDK config/tracing/session/MCP/guardrails navigation: https://openai.github.io/openai-agents-js/guides/config/ , https://openai.github.io/openai-agents-js/guides/tracing/ , https://openai.github.io/openai-agents-js/guides/sessions/ , https://openai.github.io/openai-agents-js/guides/context-management/ , https://openai.github.io/openai-agents-js/guides/mcp/ , https://openai.github.io/openai-agents-js/guides/guardrails/
- Anthropic Claude Code hooks and monitoring/usage: https://code.claude.com/docs/en/hooks , https://code.claude.com/docs/en/monitoring-usage , https://code.claude.com/docs/en/analytics , https://code.claude.com/docs/en/costs
- OpenTelemetry AI agent observability and semantic conventions: https://opentelemetry.io/blog/2025/ai-agent-observability/ , https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/ , https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/ , https://opentelemetry.io/docs/specs/semconv/gen-ai/mcp/
- LangSmith observability and dashboards: https://docs.langchain.com/langsmith/observability-concepts , https://docs.langchain.com/langsmith/dashboards
- Braintrust observability, instrumentation, dashboards: https://www.braintrust.dev/docs/observability , https://www.braintrust.dev/docs/instrument , https://www.braintrust.dev/docs/observe/dashboards
- Letta memory blocks/custom memory: https://docs.letta.com/guides/core-concepts/memory/memory-blocks , https://docs.letta.com/guides/agents/custom-memory/
- OpenClaw compaction/context/session management: https://docs.openclaw.ai/concepts/context-engine , https://docs.openclaw.ai/concepts/compaction , https://docs.openclaw.ai/reference/session-management-compaction
- Benchmarks / evaluation harnesses: https://www.tbench.ai/ , https://os-world.github.io/ , https://github.com/THUDM/AgentBench , https://github.com/sierra-research/tau-bench
