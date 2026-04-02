# Safety / Reliability / Cost lane report

Date: 2026-04-02
Scope: primary sources on monitoring agent failures, anomaly detection, escalation, cost attribution, policy/sandbox controls, and reliability engineering patterns that apply to agent harnesses.

## Executive summary

The strongest current pattern is a **three-layer control stack**:
1. **Raw execution telemetry** for lineage and debugging.
2. **Standardized observability** for cross-system metrics, events, errors, and spans.
3. **Approval / sandbox / guardrail controls** to prevent unsafe tool use and to keep failures contained.

For ssenrah specifically, the repo already has the right local primitives for a flight recorder: raw hook capture, normalized event schema with `schema_version`, session cost estimation, threshold escalation, anomaly detection, and derived verification summaries. The main opportunity is not “more logging”; it is **better correlation and control**: stable conversation/session IDs, per-tool outcomes, low-cardinality metrics, explicit approvals, and a clean split between session estimates and authoritative billing/usage data.

## 1) What the local harness already does well

### Local baseline: good building blocks already exist
- `harness/src/hook.ts:24-279` normalizes hook payloads, preserves `_raw`, redacts input, computes session cost on `Stop` / `SessionEnd`, and calls escalation/anomaly checks after logging.
- `harness/src/types.ts:49-137` already has a versioned event contract, a forward-compatible `extras` bag, and dedicated fields for tool, agent, task, notification, MCP, stop, config, and cost data.
- `harness/src/anomaly.ts:18-60, 62-260` detects infinite loops, tool thrashing, error cascades, and cost spikes.
- `harness/src/escalation.ts:51-71, 109-235` provides threshold rules for session cost, error count, and duration, and emits `_escalation` events.
- `harness/src/telemetry.ts:7-56, 73-260` already derives a normalized timeline, agent summaries, and task summaries from flat events.
- `harness/src/verify.ts:59-221` extracts files changed, commands run, tests executed, and failures for a session verification report.
- `harness/src/cli.ts:70-236` exposes `summary`, `events`, `sessions`, `tail`, `cost`, `reasoning`, `anomalies`, and `verify`, plus derived telemetry views.
- `app/docs/agent-telemetry-research.md:16-31, 118-177` already frames the product direction as a flight recorder with lineage, lifecycle timing, tool attempts, cost attribution, and transcript/raw evidence linkage.

### Local gaps that matter
- The current schema is still mostly flat; the derived layer is useful, but not yet standardized around a vendor-neutral observability model.
- Cost is currently derived from transcripts in the local adapter, but there is no explicit separation between **session estimates** and **organization/billing truth**.
- The current alerting and anomaly detectors are mostly rule-based thresholds and pattern checks; that is a good start, but not yet connected to a broader evaluation loop or OTel exporter.
- The harness keeps raw payloads, which is good, but the repo still needs stronger correlation IDs and better segmentation dimensions to match modern observability practice.

## 2) Primary-source findings

### A. Monitoring and observability: treat telemetry as a first-class product surface

**Anthropic Claude Code Monitoring** is the clearest operational reference for agent-harness observability.
- Claude Code can export **metrics and events via OpenTelemetry**.
- It exposes counters for sessions, lines of code, pull requests, commits, cost, tokens, active time, and code-edit tool decisions.
- It exposes events such as user prompts, tool results, API requests, API errors, and tool decisions.
- The docs explicitly recommend alerting on **cost spikes, unusual token consumption, and high session volume from specific users**.
- The docs also recommend analyzing **tool success rates, average tool execution times, and error patterns by tool type**.
- Backend guidance names Prometheus, ClickHouse, and Honeycomb/Datadog as appropriate analysis backends.

Sources:
- Anthropic Monitoring docs: https://code.claude.com/docs/en/monitoring-usage
- Crawl date shown by search results: 2026-04 (page crawled ~7 months ago)

Relevant lines:
- OTel export and quick-start configuration: `turn14view0:90-118`
- Resource / team segmentation and cardinality control: `turn14view0:164-170`, `turn14view0:201-230`
- Cost counter / token counter / tool decision counter: `turn15view0:349-363`, `turn15view2:366-475`
- Alerting and event analysis: `turn15view3:492-522`, `turn15view6:515-535`

**OpenTelemetry GenAI agent spans** define the standardized shape that a harness can map onto.
- Agent operations should use stable names such as `create_agent` and `invoke_agent`.
- Agent spans should include `gen_ai.agent.id`, `gen_ai.agent.name`, `gen_ai.agent.version`, and `gen_ai.conversation.id`.
- The schema explicitly includes `error.type` for low-cardinality error classification.
- Token usage attributes include `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, and cached-token breakdowns.

Source:
- https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/
- Spec header shows semantic conventions `1.40.0` and status `Development`.

Relevant lines:
- Agent span names and status: `turn2view6:358-370`
- Agent identifiers, version, and conversation ID: `turn16view3:377-487`
- Provider/model/error/type guidance: `turn16view1:373-445`, `turn16view2:486-609`
- Token usage attributes: `turn16view0:502-620`

**OpenTelemetry MCP semantic conventions** are especially useful for agent-tool lineage.
- They define session spans and metrics such as `mcp.client.session.duration`.
- Tool calls carry `mcp.method.name`, `mcp.session.id`, `gen_ai.operation.name=execute_tool`, and `gen_ai.tool.name`.
- Tool call arguments and results can be captured explicitly.

Source:
- https://opentelemetry.io/docs/specs/semconv/gen-ai/mcp/
- Spec header shows semantic conventions `1.40.0` and status `Development`.

Relevant lines:
- MCP session metric: `turn5view1:846-855`
- MCP tool-call span attributes: `turn5view0:1025-1053`, `turn5view1:1005-1048`

**OpenTelemetry exception semantics** matter for failure handling.
- OTel 1.40.0 treats exception handling as a stable convention and supports a phased migration model from span events to logs or both (`logs/dup`).
- That is a good model for agent-failure events: keep low-cardinality structured error records, and be explicit about the signal layer.

Source:
- https://opentelemetry.io/docs/specs/semconv/exceptions/
- Relevant lines: `turn3view0:330-348`

### B. Failure detection, regression monitoring, and escalation

**Anthropic Monitoring** gives concrete failure-monitoring patterns that map directly to a harness.
- `claude_code.api_error` is a first-class event with error, status code, duration, and retry attempt metadata.
- `claude_code.tool_decision` records accept/reject decisions for tools and their source.
- Event analysis explicitly calls out tool success rates, execution time, and error patterns by tool type.
- The docs recommend alerting on cost spikes, unusual token consumption, and high session volume.

Sources:
- https://code.claude.com/docs/en/monitoring-usage
- Relevant lines: `turn15view1:451-462`, `turn15view2:466-475`, `turn15view6:515-522`, `turn15view3:504-522`

**OpenAI agent evals + trace grading** are a clean regression-detection model for agent workflows.
- Agent evals are explicitly about reproducible quality measurement.
- OpenAI recommends trace grading for workflow-level errors.
- Trace grading annotates a trace at the level of decisions, tool calls, or reasoning steps.
- OpenAI’s safety doc emphasizes combining trace grading, evals, guardrails, tool approvals, structured outputs, and isolation to reduce unexpected agent behavior.

Sources:
- https://developers.openai.com/api/docs/guides/agent-evals
- https://developers.openai.com/api/docs/guides/trace-grading
- https://developers.openai.com/api/docs/guides/agent-builder-safety

Relevant lines:
- Reproducible evals and workflow-level error identification: `turn19view0:602-611`
- Trace grading as trace-level annotations and error identification at scale: `turn18view0` search result summary; `turn19view4:637-644`
- Guardrails / approvals / structured outputs / isolation: `turn19view3:630-636`, `turn19view6:621-645`

### C. Cost attribution: distinguish local estimates from org-level truth

**Anthropic Usage & Cost API** is the best source for org-level cost reconciliation.
- It gives granular usage and cost data for an organization.
- It supports grouping by model, workspace, service tier, and time bucket.
- The docs explicitly position it for accurate usage tracking, cost reconciliation, product-performance monitoring, alerting, and deeper analysis.
- The API is available only to org/admin contexts, not individual accounts.

Source:
- https://platform.claude.com/docs/en/build-with-claude/usage-cost-api

Relevant lines:
- Programmatic granular usage/cost access and use cases: `turn1view0:180-193`
- Admin key requirements and billing/finance use cases: `turn1view0:213-221`
- Token tracking and grouping dimensions: `turn1view0:241-253`

**Anthropic Claude Code Analytics** is the closest official model for ROI and adoption monitoring.
- It exposes lines of code accepted, suggestion accept rate, daily active users, sessions, PRs with Claude Code, and spend.
- It supports CSV export for custom reporting.
- It defines suggestion accept rate as accepted / (accepted + rejected).
- It attributes PRs by matching Claude Code session activity against code in merged PRs.

Sources:
- https://code.claude.com/docs/en/analytics
- Search result versions also appeared in localized docs: `turn10search2`, `turn10search3`, `turn10search4`, `turn10search5`, `turn10search6`, `turn10search9`, `turn10search11`

Relevant lines:
- Usage / contribution / spend metrics: `turn12view3:79-82`, `turn12view7:126-130`, `turn12view7:139-179`, `turn12view7:238-244`
- Accept rate definition and lines accepted: `turn12view3:129-130`, `turn12view4:129-130`

**Anthropic cost guidance** shows how Claude Code itself recommends staying cost-aware.
- The `/cost` command shows detailed token usage statistics for the current session.
- Team usage is charged by API token consumption.
- The docs recommend using workspaces and spend limits, and note that some orgs use LiteLLM to track spend by key on non-first-party providers.
- The docs also recommend delegating verbose operations to subagents so the main context stays small.

Source:
- https://code.claude.com/docs/en/costs

Relevant lines:
- `/cost` command and session cost display: `turn12view0:73-77`, `turn12view1:66-88`
- Subagent delegation for verbose operations: `turn12view2:197-199`

**Anthropic’s data-usage page** is important for separating operational telemetry from sensitive content.
- Claude Code connects to Statsig to log operational metrics such as latency, reliability, and usage patterns, and those metrics do **not** include code or file paths.
- Sentry is used for operational error logging.
- `/feedback` can send full conversation history including code.
- Session quality surveys record only a numeric rating; prompt contents are not stored for that survey path.

Source:
- https://code.claude.com/docs/en/data-usage

Relevant lines:
- Data policy / survey / retention: `turn11view0:65-98`
- Telemetry services, Statsig, Sentry, `/feedback`, and data handling: `turn11view0:122-125`

**Local ssenrah cost model** is directionally aligned with these official patterns.
- `harness/src/cost.ts:1-167` computes session cost from transcript usage and model pricing.
- That is a good “session estimate” layer, but it should stay distinct from org-level billing truth from an admin API.

### D. Policy, approvals, and sandbox controls

**Anthropic Claude Code security** is explicit about default permissions.
- Claude Code uses strict read-only permissions by default.
- Additional actions such as editing files, running tests, or executing commands require explicit permission.
- Bash commands require approval before execution.
- The docs also list context-aware analysis, command blocklists, network request approval, isolated context windows, trust verification for first-time codebase runs and new MCP servers, and command-injection detection.

Source:
- https://code.claude.com/docs/en/security

Relevant lines:
- Strict read-only default / explicit permission model: `turn8view0:78-78`
- Security protections list: `turn8view1:104-129`
- Best practices for untrusted content and VM use: `turn8view1:131-138`

**Anthropic MCP docs** show policy controls at the tool-integration layer.
- Project-scoped MCP servers require approval before use.
- `managed-mcp.json` can centrally control which servers are allowed.
- The docs support local, user, project, and managed scopes, plus allowlist/denylist policy control.

Source:
- https://code.claude.com/docs/en/mcp

Relevant lines:
- Project-scoped approval requirement: `turn8view2:307-307`
- Scope hierarchy and managed policy controls: `turn8view3:290-333`, `turn8view4:853-1051`

**Anthropic code execution tool** is a concrete sandbox model.
- It runs Bash and file operations in a secure, sandboxed container.
- The docs warn that client-provided tools and sandboxed code execution are separate environments and that state does not persist between them.
- Tool versions are pinned, and older versions are not guaranteed to be backwards-compatible.
- The current tool version is `code_execution_20250825`; the docs also mention `code_execution_20260120` for programmatic tool calling with REPL persistence.

Source:
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool

Relevant lines:
- Sandboxed execution and secure container: `turn9view0:191-197`, `turn9view1:191-201`
- Separate execution environments / no shared state: `turn9view1:269-278`
- Current and legacy tool versions: `turn9view2:204-219`

**OpenAI safety guidance** reinforces the same operational controls.
- Keep tool approvals on.
- Use guardrails to redact PII and detect jailbreaks.
- Use structured outputs between nodes to reduce free-form injection paths.
- Treat isolation as helpful but not sufficient on its own.
- Use trace graders and evals to catch mistakes.

Sources:
- https://developers.openai.com/api/docs/guides/agent-builder-safety
- https://developers.openai.com/api/docs/guides/agent-evals

Relevant lines:
- Tool approvals and guardrails: `turn19view3:630-636`
- Structured outputs and isolation: `turn19view6:621-645`
- Trace graders and evals: `turn19view4:637-644`

## 3) Practical operational patterns to carry into ssenrah

### Pattern 1 — Separate raw evidence from derived views
Keep the JSONL event log as the source of truth, but make derived timeline / agent / task views first-class. This is consistent with:
- Anthropic’s telemetry/events model (`turn14view0`)
- OTel’s agent/span/session conventions (`turn2view6`, `turn5view0`, `turn5view1`)
- OpenAI trace grading, which expects the trace to be a structured object worth annotating (`turn19view0`, `turn19view4`)

### Pattern 2 — Use low-cardinality identifiers everywhere
At minimum: `session.id`, `conversation.id`, `agent.id`, `tool.name`, `model`, `app.version`, `organization.id`, `team.id`, `cost_center`. 
Anthropic explicitly recommends resource attributes for team/cost-center segmentation and warns about metric cardinality controls (`turn14view0:164-170`, `turn14view0:201-230`). OTel likewise treats conversation/session and error.type as important correlation attributes (`turn16view2`, `turn16view1`).

### Pattern 3 — Make failures actionable, not just visible
The best failure signals are:
- API error events with retry count and status codes (`turn15view1`)
- tool decision accept/reject events (`turn15view2`)
- tool success rate / error pattern analyses (`turn15view6`, `turn15view7`)
- trace grading of workflow-level failures (`turn19view0`, `turn19view4`)

### Pattern 4 — Split cost into three layers
1. **Per-session estimate** from local transcript/hook data (what ssenrah already does).
2. **Org-level usage/cost truth** from a provider admin API (`turn1view0`).
3. **Behavior/adoption/ROI** via analytics and contribution metrics (`turn12view3`, `turn12view7`).

### Pattern 5 — Make approvals and sandbox boundaries visible to users
If a system is safe, users need to see where approvals happened and what was blocked.
- Anthropic exposes explicit approval requirements for commands and project-scoped MCP servers (`turn8view0`, `turn8view2`).
- Anthropic’s code execution sandbox is isolated and separate from client tools (`turn9view1`).
- OpenAI’s safety guidance recommends keeping tool approvals on and using human approval nodes (`turn19view3`).

## 4) What this means for the ssenrah harness

### High-value next steps
1. **Standardize telemetry fields** around session/agent/tool/task lineage, OTel-compatible operation names, and low-cardinality resource attributes.
2. **Add explicit segmentation dimensions** for team, model, and cost center so alerts can identify who/what is driving cost or failure.
3. **Add a trace-like view** over `verify` + `reasoning` + `anomalies`, so one session can be replayed from prompts → tools → results → errors.
4. **Keep session estimates separate from billing truth** so the UI can show “estimated local cost” without pretending it is invoice-grade.
5. **Promote approval states** in the UI/logs: permission requested, accepted, rejected, blocked by policy, sandboxed execution.
6. **Treat evals as a regression harness**: use trace grading or a similar structured annotation system to compare sessions over time.

### What not to do
- Do not collapse everything into one giant event struct without a derived model.
- Do not rely on raw cost estimates alone for team reporting.
- Do not store high-cardinality prompt text in every metric.
- Do not make approvals implicit; that hides the control boundary that safety depends on.

## 5) Multilingual search notes

I expanded queries in English, Korean, and Chinese. The useful pattern was that non-English searches mostly surfaced the same official Anthropic docs, which suggests the underlying operational vocabulary is stable across locales.

Example query families used:
- English: `Claude Code monitoring usage`, `OpenTelemetry GenAI agent spans`, `agent evals trace grading`, `Claude Code analytics API`, `Claude Code security MCP approval`
- Korean: `Claude Code 모니터링 OpenTelemetry`, `에이전트 trace grading`, `토큰 비용 추적`, `MCP 승인`
- Chinese: `Claude Code 监控 OpenTelemetry`, `代理 评测 trace grading`, `令牌 成本 统计`, `工具 审批`

The Korean / Chinese / Japanese / Spanish Anthropic pages were especially helpful as corroboration for the same monitoring and analytics features, but they did not reveal materially different guidance from the English docs.

## 6) Source register

### Anthropic / Claude Code
- Monitoring: https://code.claude.com/docs/en/monitoring-usage
- Usage & Cost API: https://platform.claude.com/docs/en/build-with-claude/usage-cost-api
- Analytics: https://code.claude.com/docs/en/analytics
- Costs: https://code.claude.com/docs/en/costs
- Data usage: https://code.claude.com/docs/en/data-usage
- Security: https://code.claude.com/docs/en/security
- MCP: https://code.claude.com/docs/en/mcp
- Code execution tool: https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool

### OpenTelemetry
- GenAI agent spans: https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/
- MCP semconv: https://opentelemetry.io/docs/specs/semconv/gen-ai/mcp/
- Exceptions semconv: https://opentelemetry.io/docs/specs/semconv/exceptions/

### OpenAI
- Agent evals: https://developers.openai.com/api/docs/guides/agent-evals
- Trace grading: https://developers.openai.com/api/docs/guides/trace-grading
- Safety in building agents: https://developers.openai.com/api/docs/guides/agent-builder-safety
- Practical guide to building agents (PDF): https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf

## Bottom line

For agent harnesses, the current best practice is not a single observability dashboard. It is a **layered control system**:
- capture raw evidence,
- standardize spans/events/metrics,
- enforce approvals and sandbox boundaries,
- segment cost and reliability by team/model/session,
- and use trace-grade evaluations to prevent regressions.

That is the shape ssenrah is already closest to — and the place where the next gains are likely to be the highest leverage.
