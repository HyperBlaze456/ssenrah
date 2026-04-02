# Design Recommendations — Evolving ssenrah's Monitoring / Benchmarking Stack

Date: 2026-04-02
Scope: concrete repo-applicable recommendations across immediate / medium-term / long-term horizons

## Executive summary

The right next move for `ssenrah` is **not** a giant rewrite. It is a staged evolution:

1. **Stabilize the measurement contract**.
2. **Add a benchmark/eval adapter layer on top of the existing flight recorder**.
3. **Only then invest in indexed storage, dashboards, and replay infrastructure**.

The repo is already strong on raw capture and derived CLI summaries. The highest-leverage missing layer is an explicit **run/benchmark/evidence contract**.

## Horizon 1 — Immediate (smallest, highest-leverage changes)

### A. Make cost semantics explicit
Problem:
- current summary/session surfaces can overcount by summing cumulative `cost_usd` snapshots.

Recommendation:
- split cost into explicit fields:
  - `cost_snapshot_usd`
  - `cost_delta_usd`
  - `cost_recomputed_usd`
  - `cost_source: transcript_recompute | hook_snapshot | billing_export`

Why first:
- this fixes a real local correctness issue immediately.

### B. Introduce a canonical run lineage envelope
Add to the normalized event contract:
- `run_id`
- `parent_run_id`
- `thread_id`
- `benchmark_id`
- `artifact_bundle_id`
- `attempt_index`
- `retry_group_id`

Why first:
- this unlocks comparison, replay, and benchmark aggregation without forcing storage migration yet.

### C. Add timing/outcome fields to the telemetry model
Add fields like:
- `duration_ms`
- `queue_ms`
- `outcome: success | failure | cancelled | partial`
- `failure_class`
- `side_effect_class`

Why first:
- benchmark and reliability work becomes much stronger once tool/task durations and normalized outcomes exist.

### D. Add a minimal benchmark manifest
A repo-local JSON or YAML contract should define:
- benchmark name / task id
- environment/setup command
- inputs / fixtures
- expected artifacts
- evaluator command or evaluator type
- success conditions
- score schema

Why first:
- this turns the current harness from observer into evaluator.

## Horizon 2 — Medium-term (turn observability into evaluation infrastructure)

### A. Build benchmark adapters, not one-off scripts
Recommended first adapters:
1. **CLI / Terminal adapter** — Terminal-Bench-like runs
2. **Coding adapter** — SWE-bench-style issue / patch / test workflows
3. **Tool/MCP adapter** — τ-bench / MCP-AgentBench-style policy + tool workflows
4. **Browser or GUI adapter** — only after CLI/coding layers are solid

### B. Add an evidence bundle per run
For each run, persist a bundle containing:
- event slice
- transcript references
- file modifications
- command/test outputs
- anomaly outputs
- verification report
- evaluator output
- summary JSON

This bundle becomes the atomic unit for:
- replay
- regression testing
- judge scoring
- audit trails

### C. Add compare/regression CLI surfaces
Recommended new commands:
- `ssenrah compare --run A --run B`
- `ssenrah benchmark run <manifest>`
- `ssenrah benchmark score <run>`
- `ssenrah benchmark regress --baseline X --candidate Y`
- `ssenrah export --run X --format json|otel|bundle`

### D. Add judge/eval outputs next to human-readable verification
`verify` should eventually produce both:
- current human summary
- machine-readable result schema, e.g.:
  - `files_changed_count`
  - `tests_passed`
  - `tests_failed`
  - `errors_count`
  - `anomaly_count`
  - `score`
  - `pass`

## Horizon 3 — Long-term (operator platform / durable measurement system)

### A. Indexed storage and replay
Current JSONL should remain the source of truth, but add an index/read layer for:
- fast cross-run queries
- run-to-run comparison
- actor/task lineage graphing
- benchmark leaderboard generation

`better-sqlite3` is already in `harness/package.json`, so SQLite is a plausible near-natural first index layer.

### B. Dashboard and operator workflow
Build the UI around debugging questions, not abstract observability ideals:
- What failed?
- Where did time go?
- Which tool/agent caused it?
- Did this regression get worse than baseline?
- Was the extra spend worth it?

Recommended dashboard panes:
- traces / timelines
- cost and token trends
- anomaly and escalation inbox
- benchmark leaderboard / variance view
- verification and artifact browser

### C. OTel/export interoperability
Once the local contract is stable, add export mapping for:
- OpenTelemetry GenAI spans
- backend-specific sinks later
- cross-system correlation with other runtime telemetry

### D. Security and approval evidence pipeline
Long-term, each run should also carry:
- approval events
- permission/escalation decisions
- sandbox/worktree context
- security flags / policy violations
- attack or prompt-injection markers

## Recommended sequencing

1. Fix cost semantics.
2. Add run lineage fields.
3. Add benchmark manifest + bundle format.
4. Add compare/regression CLI.
5. Add 1–2 benchmark adapters.
6. Add indexed storage for faster replay/query.
7. Add richer dashboards and export.

That order keeps the current repo useful at every stage and avoids premature platform work.

## Concrete schema direction

A practical next schema could center on four layers:

### 1) Raw event
Closest possible representation of hook/transcript/tool evidence.

### 2) Normalized telemetry record
Stable operator-facing event with:
- operation
- phase
- severity
- actor
- resource
- duration
- outcome
- lineage IDs

### 3) Evidence bundle
Per-run package of raw + normalized + verification + artifacts.

### 4) Benchmark result
Machine-readable scoring result over one or more evidence bundles.

## Risks to avoid

- **Do not replace raw JSONL too early.** Keep it as forensic truth.
- **Do not overbuild dashboards before comparison/eval exists.** Pretty views without benchmark contracts will stall out.
- **Do not conflate cumulative vs authoritative cost.** This already caused visible misreporting.
- **Do not jump straight to browser/GUI benchmarking.** CLI/coding/MCP are a better fit for the current repo.

## Bottom line

The strongest path for `ssenrah` is:
- keep the current flight recorder
- standardize run lineage and cost semantics
- add benchmark manifests and evidence bundles
- then build replay, comparison, and dashboards on top

That path matches both the codebase’s current shape and the strongest external research trends.
