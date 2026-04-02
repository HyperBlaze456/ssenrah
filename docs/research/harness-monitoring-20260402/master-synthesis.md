# Master Synthesis — Harness Monitoring / Benchmarking Research Pack

Date: 2026-04-02

## Report index

- `agents/01-codebase-baseline.md` — local codebase baseline and benchmark-readiness audit
- `agents/02-observability-telemetry.md` — external telemetry / tracing / flight-recorder patterns
- `agents/03-benchmarks-evals.md` — benchmark landscape and repo applicability
- `agents/04-safety-reliability-cost.md` — safety, reliability, cost, approvals, and operational controls
- `agents/05-multilingual-landscape.md` — EN/KR/ZH query expansion and regional landscape
- `agents/06-team-academic-papers.md` — academic papers for observability, evaluation, security, and long-horizon agents
- `agents/07-team-industry-case-studies.md` — Anthropic / OpenAI / LangSmith / Braintrust / OpenLLMetry patterns
- `agents/08-design-recommendations.md` — staged architecture recommendations
- `agents/09-memory-compaction-longhorizon.md` — memory, compaction, and long-horizon reliability


## Highest-confidence conclusions

### 1) ssenrah already has a real flight recorder
Local evidence confirms the harness already captures:
- raw JSONL hook events
- versioned event schema with extras/raw payload preservation
- transcript-derived cost and reasoning
- anomaly detection
- verification reports
- derived telemetry views for timeline / agents / tasks

### 2) The next leap is benchmarkability, not more logging
Across the benchmark, academic, and industry lanes, the strongest repeated pattern was:
- keep raw traces
- normalize them into stable read models
- wrap them in benchmark manifests / evidence bundles
- compare runs and feed them into regression control

### 3) The biggest concrete local bug/risk is cost semantics
Current summary/session views can overcount by summing cumulative `cost_usd` snapshots across multiple `Stop` / `SessionEnd` events, while transcript recomputation shows lower authoritative values.

### 4) Long-horizon quality will depend on memory / compaction observability
The philosophy doc is already pointed in the right direction. The missing step is making checkpoint/compaction evidence durable and measurable.

## Prioritized recommendations

### Immediate
1. Fix cost semantics.
2. Add lineage IDs (`run_id`, `parent_run_id`, `thread_id`, `benchmark_id`).
3. Add timing/outcome fields (`duration_ms`, `outcome`, `failure_class`).
4. Add a benchmark manifest + evidence bundle format.

### Near-term
5. Add compare/regression CLI surfaces.
6. Add benchmark adapters for CLI/coding/tool-use workloads.
7. Add structured judge/eval outputs alongside human-readable verification.

### Longer-term
8. Add indexed storage for query/replay.
9. Add dashboards around debugging questions, not vanity metrics.
10. Add memory/compaction checkpoint benchmarking.

## External sources that appeared most relevant

- Anthropic Claude Code hooks / monitoring docs
- OpenTelemetry GenAI semantic conventions and agent spans
- Terminal-Bench, τ-bench, SWE-bench, OSWorld, WebArena, MCP-AgentBench
- MAESTRO, Beyond Black-Box Benchmarking, AgentRewardBench, ASB
- OpenAI Agents SDK tracing docs
- LangSmith, Braintrust, OpenLLMetry/Traceloop
- Letta, Mastra Observational Memory, LongMemEval, OpenClaw compaction docs, MemGPT

## Final assessment

`ssenrah` is already beyond the prototype logging stage. It is close to becoming a serious benchmark-ready harness, but only if it standardizes lineage, cost semantics, benchmark contracts, and long-horizon evidence handling.
