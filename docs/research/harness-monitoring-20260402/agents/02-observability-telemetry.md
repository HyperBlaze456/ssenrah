# External Observability / Telemetry Research Report

Lane: agent harness observability, telemetry, tracing, hook/event capture, flight-recorder patterns, and operator-facing diagnosis
Date: 2026-04-02
Scope: primary sources first; English + multilingual query expansion where useful

## Executive summary

The current state of the art is converging on a few strong patterns:

1. **Capture the full execution graph, not just model calls.** Modern agent observability treats a user request as a trace containing nested spans for agent runs, tool calls, handoffs, guardrails, memory access, and custom events.
2. **Keep raw event capture and derived views separate.** Anthropic Claude Code hooks, OpenTelemetry GenAI conventions, LangSmith traces, Braintrust spans, and OpenLLMetry all point toward a raw signal stream plus higher-level dashboards, filters, and evaluation loops.
3. **Make sensitive-data controls explicit.** Most serious systems now support redaction, opt-in content capture, and separate toggles for operational telemetry versus prompt/content logging.
4. **Operator diagnosis depends on correlation IDs, trace context, and views that reflect the real workflow.** The best tools let you search, filter, compare, sample, and convert production traces into evaluation datasets.
5. **For agent harnesses, observability is not just monitoring — it is the feedback loop for improving reliability.** The OTel blog and vendor docs all describe telemetry as input to evaluation, debugging, and continuous improvement.

## What the primary sources say

### 1) Anthropic Claude Code hooks: the raw event surface for a local harness

**Source URLs**
- Hooks reference: https://code.claude.com/docs/en/hooks
- Quickstart / hooks guide: https://docs.anthropic.com/en/docs/claude-code/hooks-guide
- Monitoring: https://code.claude.com/docs/en/monitoring-usage
- Data usage / telemetry: https://code.claude.com/docs/en/data-usage

**Key findings**
- Claude Code hooks are configured in user/project settings and receive **JSON via stdin** for command hooks, or JSON request bodies for HTTP hooks.
- The hook surface includes **SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PermissionRequest, Stop, SubagentStop, PreCompact, CwdChanged, FileChanged, ConfigChange, and more**.
- **SessionStart** includes fields like `source`, `model`, and optionally `agent_type`.
- **PreToolUse** can **allow, deny, or modify** tool input before execution. It receives `tool_name`, `tool_input`, and `tool_use_id`.
- **SubagentStop** includes `agent_id`, `agent_type`, `agent_transcript_path`, and `last_assistant_message`, which is extremely valuable for building an agent-flight-recorder.
- Claude Code exposes hook-specific environment helpers such as `CLAUDE_PROJECT_DIR` and `CLAUDE_ENV_FILE`, which makes project-local instrumentation practical.
- The hooks docs explicitly warn that hooks run automatically in the agent loop with the current environment’s credentials, so hook-based observability is also a security boundary.

**Operational pattern worth borrowing**
- Treat hooks as the **lowest-level telemetry event bus**.
- Record session, tool, and subagent lifecycle facts without trying to infer them later from transcripts alone.
- Preserve transcript paths and agent transcript paths as first-class references.

**Telemetry / privacy posture**
- Claude Code’s monitoring page says OpenTelemetry metrics and events are supported, but this is beta and subject to change.
- Claude Code operational telemetry is opt-in via `CLAUDE_CODE_ENABLE_TELEMETRY=1` and standard OTel exporters.
- Anthropic says Statsig telemetry covers latency, reliability, and usage patterns, and does **not** include code or file paths.
- User prompt content is redacted by default in telemetry; only prompt length is recorded unless opted in.

### 2) OpenTelemetry GenAI agent spans: the emerging standard for agent traces

**Source URLs**
- GenAI agent/framework spans: https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/
- GenAI spans: https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/
- MCP semconv: https://opentelemetry.io/docs/specs/semconv/gen-ai/mcp/
- Semantic conventions overview: https://opentelemetry.io/docs/specs/semconv/general/trace/
- OTel AI agent observability blog: https://opentelemetry.io/blog/2025/ai-agent-observability/

**Key findings**
- The GenAI agent spans spec is currently **Development** status.
- Existing instrumentations using the older version are told **not** to change their default emitted convention version immediately; the page describes `OTEL_SEMCONV_STABILITY_OPT_IN` and a `gen_ai_latest_experimental` opt-in path.
- The spec defines distinct span types such as:
  - `create_agent`
  - `invoke_agent`
  - `execute_tool`
- Recommended naming patterns are low-cardinality and explicit, e.g. `invoke_agent {gen_ai.agent.name}`.
- For `invoke_agent`, span kind should usually be `CLIENT`, but can be `INTERNAL` for in-process agents.
- Attributes that matter for sampling decisions should be present at span creation when possible: `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`, `server.address`, `server.port`.
- The conventions strongly warn about sensitive content and prefer structured fields where possible for `gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.system_instructions`, and `gen_ai.tool.definitions`.
- The GenAI spec is explicit that **tool definitions, input/output messages, and system instructions may be sensitive** and should be filterable or truncatable.
- The OTel AI-agent observability blog frames telemetry as both monitoring and a **feedback loop for evaluation**.

**Operational pattern worth borrowing**
- Map every major agent lifecycle step to a stable span shape.
- Use **structured message content** only when needed; otherwise keep it opt-in and truncatable.
- Preserve `server.address`, `server.port`, provider name, and model name early for sampling and grouping.
- Treat tool execution as a first-class span type rather than hidden sub-logging.

### 3) OpenAI Agents SDK: built-in tracing plus custom processors

**Source URLs**
- JS configuration / tracing: https://openai.github.io/openai-agents-js/guides/config/
- Python tracing: https://openai.github.io/openai-agents-python/tracing/
- Python running agents / observability: https://openai.github.io/openai-agents-python/running_agents/

**Key findings**
- The SDK includes built-in tracing that records **LLM generations, tool calls, handoffs, guardrails, and custom events**.
- Tracing is enabled by default in supported server runtimes.
- Developers can add **custom trace processors** and export to destinations beyond OpenAI’s backend.
- The SDK exposes explicit controls to disable tracing or set a separate tracing export key.
- Sensitive-data controls are explicit:
  - `trace_include_sensitive_data` controls whether generation and function inputs/outputs are captured.
  - `OPENAI_AGENTS_DONT_LOG_MODEL_DATA` and `OPENAI_AGENTS_DONT_LOG_TOOL_DATA` disable logging of model/tool inputs and outputs in the JS SDK.
- The docs emphasize that tracing is useful both in development and production.

**Operational pattern worth borrowing**
- Build a **processor pipeline**: one path for the vendor backend, one for local analysis / export / filtering.
- Separate tracing verbosity controls from core execution, so the harness can keep working even when tracing is off.
- Make the sensitive-data defaults explicit and easy to override.

### 4) LangSmith: traces as the backbone of dashboards, sampling, threads, and evaluation

**Source URLs**
- Observability overview: https://docs.langchain.com/langsmith/observability
- Observability concepts: https://docs.langchain.com/langsmith/observability-concepts
- Dashboards: https://docs.langchain.com/langsmith/dashboards
- OpenTelemetry integration: https://docs.langchain.com/langsmith/trace-with-opentelemetry
- Sampling: https://docs.langchain.com/langsmith/sample-traces

**Key findings**
- LangSmith defines a **trace** as a collection of runs for one operation; if a user request triggers a chain that calls an LLM and parser, those runs are in the same trace.
- Multi-turn conversations can be linked into a **thread** using metadata like `session_id`, `thread_id`, or `conversation_id`.
- LangSmith dashboards surface:
  - trace count
  - latency
  - error rates
  - LLM call counts
  - cost and token totals
  - tool counts / tool latency
  - run types / execution path shape
- LangSmith supports **standard OpenTelemetry clients** for non-LangChain or custom instrumentation.
- LangSmith supports **sampling** through `LANGSMITH_TRACING_SAMPLING_RATE` and client-level sampling rates.
- LangSmith’s observability stack includes UI access, exports, sharing, comparison tools, automations, webhooks, and online evaluations.
- The docs also expose an AI assistant (“Polly”) and an Insights workflow that converts traces into summarized failure and usage patterns.

**Operational pattern worth borrowing**
- Use a **trace = request/operation** model and link conversation turns into threads.
- Make dashboards trace- and run-aware, not just metrics-only.
- Support sampling early so high-volume harnesses can stay affordable.

### 5) Braintrust: observability + evaluation + production feedback loop

**Source URLs**
- Instrument your application: https://www.braintrust.dev/docs/instrument
- Monitor with dashboards: https://www.braintrust.dev/docs/observe/dashboards
- View logs: https://www.braintrust.dev/docs/observe/view-logs
- Tracing quickstart: https://www.braintrust.dev/docs/observability
- Agent observability article: https://www.braintrust.dev/articles/agent-observability-tracing-tool-calls-memory
- OpenAI Agents SDK integration: https://www.braintrust.dev/docs/reference/integrations/openai-agents-js/0.1.2/openai-agents-js

**Key findings**
- Braintrust traces capture **inputs, outputs, model parameters, latency, token usage, and metadata**.
- A trace consists of nested spans, where spans can represent LLM calls, vector DB queries, tools, agent reasoning steps, or scoring functions.
- Dashboards track request counts, latency, token usage, costs, scores, and custom metrics over time.
- The monitor UI can filter traces by spans, group by span-level data, and support custom charts.
- The logs UI can switch between **trace rows** and **span rows**, which is ideal for operator diagnosis at different resolution levels.
- The article on agent observability makes an important point: **agent observability is broader than LLM observability**, because it must capture tool usage, memory reads/writes, and delegation across agent boundaries.
- The same article argues for **correlation IDs and shared trace context** so the full execution graph remains visible even when work is handed off.
- Braintrust also positions traces as the source for generating evaluation datasets and custom scorers.

**Operational pattern worth borrowing**
- Provide a **trace view** and a **span view**.
- Make it trivial to convert failed production traces into eval data.
- Use correlation IDs across agent boundaries, not just inside one model call.
- Distinguish memory observability from model-call observability.

### 6) OpenLLMetry / Traceloop: non-intrusive OpenTelemetry-first LLM observability

**Source URLs**
- Introduction: https://www.traceloop.com/docs/openllmetry/introduction
- Without SDK: https://www.traceloop.com/docs/openllmetry/tracing/without-sdk
- Supported integrations: https://www.traceloop.com/docs/openllmetry/tracing/supported
- Multi-modality: https://www.traceloop.com/docs/openllmetry/tracing/multi-modality
- Telemetry privacy: https://docs.traceloop.com/docs/openllmetry/privacy/telemetry

**Key findings**
- OpenLLMetry is positioned as an **open source, non-intrusive** monitoring/debugging layer built on top of OpenTelemetry.
- It can export to Traceloop or an existing observability stack.
- It supports direct use of standard OpenTelemetry instrumentations if you already have OTel in place.
- It has broad support for model/framework integrations and can automatically capture multimodal content (images, audio, video, documents) in supported backends.
- Its own product telemetry is explicitly separate from trace data, and opt-out is supported.

**Operational pattern worth borrowing**
- Keep the harness observability layer **OTel-native** so it can route to any backend.
- Separate product analytics from execution traces.
- Plan for multimodal evidence capture if the harness ever handles screenshots, docs, or audio.

## Practical implications for ssenrah

The repo’s current direction already looks aligned with the external patterns above, but the external sources suggest some concrete upgrades to emphasize:

1. **Define a first-class trace model for agent work**
   - Request/session trace
   - subagent/agent span
   - tool span
   - memory/retrieval span
   - verification span
   - escalation span

2. **Keep raw event logs and derived views separate**
   - raw hooks / event JSONL should remain the forensic source of truth
   - derived dashboards should summarize, not replace, the raw log

3. **Use explicit correlation across boundaries**
   - session ID
   - agent ID
   - task ID
   - tool call ID
   - transcript path / agent transcript path
   - optional thread / conversation ID

4. **Make content capture opt-in and filterable**
   - raw transcript capture is powerful but sensitive
   - default to metadata, lengths, counts, and structured summaries
   - gate full prompts/outputs behind explicit policy

5. **Expose operator-facing views, not just logs**
   - trace tree
   - timeline
   - per-agent summary
   - per-task summary
   - tool heatmap / failure rate / latency
   - cost and token views
   - sampling and filters

6. **Treat telemetry as a feedback loop**
   - traces should feed evals, failure buckets, regression tests, and harness improvements
   - monitoring and benchmarking should be one pipeline, not separate disciplines

## Multilingual query expansion notes

I used English plus localized queries in Korean and Chinese for Claude Code hooks and OpenTelemetry. The most useful outcome was not unique non-English content, but confirmation that Anthropic’s hook docs are available in localized official versions and that the terminology maps cleanly across languages.

Useful search terms for future work:
- English: `agent observability`, `LLM tracing`, `tool call spans`, `agent handoff tracing`, `flight recorder for agents`
- Korean: `에이전트 관측성`, `LLM 추적`, `도구 호출 스팬`, `에이전트 핸드오프 추적`
- Chinese: `智能体 可观测性`, `LLM 跟踪`, `工具调用 span`, `智能体 交接 跟踪`

## Bottom line

For a harness like ssenrah, the best external model is:

- **raw hooks / events at the edge**
- **normalized spans in the middle**
- **dashboards, alerts, and evaluation loops on top**

The strongest sources all converge on the same advice: capture the agent’s full execution graph, keep content capture controlled, preserve correlation IDs across boundaries, and make the telemetry directly usable for debugging and evaluation.

## Source index

- Anthropic hooks: https://code.claude.com/docs/en/hooks
- Anthropic monitoring: https://code.claude.com/docs/en/monitoring-usage
- Anthropic data usage: https://code.claude.com/docs/en/data-usage
- OTel GenAI agent spans: https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/
- OTel GenAI spans: https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/
- OTel MCP semconv: https://opentelemetry.io/docs/specs/semconv/gen-ai/mcp/
- OTel AI agent observability blog: https://opentelemetry.io/blog/2025/ai-agent-observability/
- OpenAI Agents SDK tracing: https://openai.github.io/openai-agents-python/tracing/
- OpenAI Agents SDK config: https://openai.github.io/openai-agents-js/guides/config/
- LangSmith observability: https://docs.langchain.com/langsmith/observability
- LangSmith dashboards: https://docs.langchain.com/langsmith/dashboards
- LangSmith OTel: https://docs.langchain.com/langsmith/trace-with-opentelemetry
- LangSmith sampling: https://docs.langchain.com/langsmith/sample-traces
- Braintrust instrumentation: https://www.braintrust.dev/docs/instrument
- Braintrust dashboards: https://www.braintrust.dev/docs/observe/dashboards
- Braintrust logs: https://www.braintrust.dev/docs/observe/view-logs
- Braintrust agent observability article: https://www.braintrust.dev/articles/agent-observability-tracing-tool-calls-memory
- OpenLLMetry intro: https://www.traceloop.com/docs/openllmetry/introduction
- OpenLLMetry without SDK: https://www.traceloop.com/docs/openllmetry/tracing/without-sdk
