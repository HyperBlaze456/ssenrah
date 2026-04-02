# Codebase Baseline — ssenrah Harness Monitoring / Benchmarking

Date: 2026-04-02
Scope: local-repo audit of current monitoring, telemetry, anomaly, verification, reasoning, and benchmark-readiness capabilities

## Executive summary

`ssenrah` already behaves like a usable local flight recorder for Claude Code sessions.

Today it has:
- edge capture from Claude Code hooks into JSONL
- a versioned event schema with forward-compatible extras/raw payload retention
- derived telemetry views for timeline / agents / tasks
- transcript-derived cost and reasoning extraction
- session verification and anomaly detection
- threshold escalation and operator CLI surfaces

The repo is therefore **past the "can we monitor agents at all?" stage** and firmly in the **"how do we standardize, benchmark, and compare runs?" stage**.

The biggest local gaps are:
1. no benchmark execution contract / manifest layer
2. no first-class run lineage / parent-child correlation beyond the current event fields
3. no indexed storage or replay/eval layer
4. cost reporting semantics are inconsistent across CLI surfaces
5. anomaly detection is still mostly threshold/pattern-based, not yet tied to regression evaluation

## Current architecture map

### 1) Ingestion boundary
- `harness/src/hook.ts:24-29` sets schema version + JSONL log location.
- `harness/src/hook.ts:58-116` defines normalized keys and preserves unknown keys in `extras`.
- `harness/src/hook.ts:118-198` converts raw hook payloads into `AgentEvent`.
- `harness/src/hook.ts:253-282` redacts input, appends the event, computes transcript-based cost on `Stop` / `SessionEnd`, then runs escalation and anomaly checks.

### 2) Event contract
- `harness/src/types.ts:5-30` tracks a broad April 2026 hook event surface.
- `harness/src/types.ts:49-137` defines a versioned `AgentEvent` with tool / agent / task / MCP / config / stop / cost / extras / `_raw` fields.

### 3) Derived telemetry
- `harness/src/telemetry.ts:7-27` defines normalized telemetry record shape.
- `harness/src/telemetry.ts:151-412` maps hook events to stable operations such as `tool.start`, `task.create`, `alert.escalation`, `alert.anomaly`, `session.stop_failure`.
- `harness/src/telemetry.ts:441-576` derives timeline + agent + task summaries.
- `harness/src/telemetry.ts:599-637` formats those summaries for operators.

### 4) Verification / anomaly / reasoning / cost
- `harness/src/verify.ts:1-197` reconstructs files changed, commands run, tests run, failures, and duration.
- `harness/src/anomaly.ts:18-59` defines anomaly thresholds; `62-255` implements infinite-loop, tool-thrashing, error-cascade, and cost-spike detection.
- `harness/src/reasoning.ts:1-52` defines decision-chain extraction; `196-237` reconstructs steps/prompts from transcript JSONL.
- `harness/src/cost.ts:36-78` defines model pricing; `99-167` calculates session cost from transcript usage.

### 5) Operator surfaces
- `harness/src/cli.ts:70-121` provides summary.
- `harness/src/cli.ts:124-337` provides events / sessions / tail / cost / verify / anomalies.
- `harness/src/cli.ts:339-531` provides reasoning / timeline / agents / tasks.
- `harness/INSTALL.md:46-68` documents the operator command surface.

### 6) Tests as evidence
- `harness/tests/hook.test.ts:49-191` validates ingestion, redaction, richer hook fields, and elicitation/cwd fields.
- `harness/tests/telemetry.test.ts:22-114` validates normalized timeline, agent summary, and task lifecycle logic.
- `harness/tests/verify.test.ts:20-241` validates file/command/test/error extraction.
- `harness/tests/anomaly.test.ts:45-255` validates loop, thrash, cascade, and cost-spike detectors.
- `harness/tests/cli.test.ts:46-186` validates summary / events / sessions / telemetry views / help.

## Evidence map

### Product philosophy and intended direction
- `docs/harness_architecutre/current_philosophy.md:35-55` defines the dependency chain: visibility → coordination → orchestration ↔ memory → self-improvement.
- `docs/harness_architecutre/current_philosophy.md:59-108` explicitly makes visibility / telemetry / anomaly / testability the first architectural layer.
- `docs/harness_architecutre/current_philosophy.md:206-231` explicitly calls out working/indexed/persistent memory, compaction safety, and monitoring memory performance.

### Prior internal telemetry research
- `app/docs/agent-telemetry-research.md:16-31` states the local baseline and previous gaps.
- `app/docs/agent-telemetry-research.md:96-103` lists mandatory telemetry: session → agent → task → tool → outcome, timing, retries, impact, cost, transcript linkage.
- `app/docs/agent-telemetry-research.md:107-146` recommends JSONL-as-source-of-truth plus derived timeline / agents / tasks surfaces.

### Installation and operator affordances
- `harness/INSTALL.md:31-44` gives verification commands.
- `harness/INSTALL.md:80-101` defines the captured hook surface and transcript-derived cost model.
- `harness/INSTALL.md:103-121` defines escalation config and current alert conditions.
- `harness/INSTALL.md:123-145` documents redaction + test execution.

## What the harness demonstrably does right now

### Verified test status
Local verification run:
- `cd harness && npm test` → **9 test files passed, 103 tests passed**, duration **57.28s**.

### Verified CLI behavior on existing log data
Local CLI runs produced:
- `npx tsx harness/src/cli.ts summary` → **1483 events**, **10 sessions**, **476 tool uses**, **12 errors**, **6 subagents**, **14 tasks completed**.
- `npx tsx harness/src/cli.ts anomalies` → **5 anomalies**, all cost spikes.
- `npx tsx harness/src/cli.ts verify --session 6ef49eca` → **869 events**, **29 files edited**, **13 files written**, **55 files read**, **69 commands**, **4 tests**, **1 failed test run**, **5 errors**.
- `npx tsx harness/src/cli.ts reasoning --session 6ef49eca --limit 8` → **346 turns**, **159 reasoning blocks**, **381 decisions**, **48 prompts**.
- `npx tsx harness/src/cli.ts cost` → **$255.21** grand total over sessions in the current transcripts.

These outputs prove the current harness is not just a schema sketch; it already works as a real operator tool over historical sessions.

## Strengths

1. **Good edge capture model**  
   Raw hook data is preserved, redacted, versioned, and forward-compatible (`types.ts`, `hook.ts`).

2. **Clear derived read model**  
   Telemetry is separated from raw ingestion (`telemetry.ts`), matching the repo's own research direction.

3. **Human-usable verification layer**  
   `verify.ts` reconstructs the exact kinds of evidence a human reviewer wants after an agent run.

4. **Transcript-aware forensic layer**  
   Cost and reasoning are reconstructed from transcript artifacts, not guessed from surface logs.

5. **Benchmark-adjacent operator surface already exists**  
   `timeline`, `agents`, `tasks`, `anomalies`, `verify`, and `cost` are already the right primitives for future evaluation harnesses.

## Important gaps and risks

### 1) Cost semantics are inconsistent across surfaces
A concrete local inconsistency showed up during verification:
- `summary` / `sessions` surfaced session `6ef49eca` around **$2314.56**.
- `cost` recomputed from transcripts surfaced the same session at **$220.08**.

A direct log inspection shows why: the event log contains **multiple cumulative `cost_usd` stamps** across repeated `Stop` / `SessionEnd` events for the same session, and the summary path simply sums those values. For session prefix `6ef49eca`, 12 cost-bearing stop/end events sum to `$2314.56`, while the transcript-derived authoritative recomputation is `$220.08`.

Implication: the harness needs explicit distinction between:
- cumulative session cost snapshots
- delta cost events
- authoritative recomputed session cost

### 2) No benchmark manifest / adapter layer
The repo can observe runs, but it cannot yet declare:
- benchmark task spec
- environment snapshot/setup
- oracle/evaluator
- artifact bundle
- replay/regression comparison target

### 3) Missing latency and outcome metrics per tool / step
The current telemetry model has operation/phase/severity, but no first-class:
- tool duration
- wait time / stall time
- retry count
- outcome class
- judge score / rubric score

### 4) Limited lineage model
The current model is good for sessions, tasks, tools, agents, and transcripts, but weaker on:
- parent/child run IDs
- benchmark run IDs
- thread / conversation IDs
- branch/merge lineage
- replay provenance

### 5) Anomaly system is still heuristic-first
The detector is useful, but currently threshold/pattern-based rather than:
- eval-linked
- benchmark-aware
- model/agent normalized
- false-positive calibrated by benchmark data

## What already looks benchmarkable

The repo is especially ready for benchmarks that care about:
- CLI trajectories and tool use
- task lifecycle and subagent activity
- test execution and failure evidence
- cost attribution and budget tracking
- verification of code-editing sessions

That makes the current harness naturally compatible with:
- Terminal-Bench-like CLI runs
- SWE-bench-style coding trajectories
- MCP/tool-use reliability evals
- operator-facing replay and regression audits

## Recommended next measurements for this repo

### Immediate
1. Add a **cost-kind** field: `cumulative | delta | recomputed`.
2. Add **tool duration_ms** and **attempt/retry counters**.
3. Add a **run lineage envelope**: `run_id`, `parent_run_id`, `thread_id`, `benchmark_id`.
4. Add a **compare** CLI for session-vs-session or benchmark-vs-benchmark diffing.

### Near-term
5. Define a **benchmark manifest** (`task`, `setup`, `artifacts`, `evaluator`, `success criteria`).
6. Add **artifact bundles** per run: event slice, transcript refs, file diff, test outputs, anomaly outputs.
7. Add **judge/eval hooks** so `verify` can emit structured scores as well as text summaries.

### Medium-term
8. Add indexed storage or replay-oriented storage for large logs and repeated benchmarking.
9. Add benchmark adapters for CLI / coding / MCP / browser environments.
10. Add run-to-run variance measurement, not just one-shot success.

## Bottom line

`ssenrah` already has the bones of a strong harness-monitoring system. The next leap is not more logging. It is making the existing evidence stream **comparable, replayable, and benchmarkable**.
