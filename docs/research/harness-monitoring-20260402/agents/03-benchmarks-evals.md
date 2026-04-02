# Benchmarks / Evaluation Lane Report

Date: 2026-04-02
Scope: agent harness monitoring, benchmarking, tool-use evaluation, and long-horizon reliability measurement

## Executive summary

The strongest pattern across the current benchmark landscape is that **good agent evaluations are not just scoreboards**. They are *instrumented execution systems*: they capture trajectories, environment state, tool calls, intermediate artifacts, checkpoints, and a deterministic or rubric-backed evaluator. For `ssenrah`, this is a good fit because the harness already has the observability substrate: normalized event timelines, cost attribution, anomaly detection, and session verification.

The main gap is not “more logging”; it is a **benchmark adapter layer**: a way to declare a benchmark’s task spec, environment snapshot, success criteria, and artifact set so the harness can replay, score, compare, and regress-check runs consistently.

## 1) Current `ssenrah` baseline: what we already have

`ssenrah` already looks like a lightweight flight recorder for agent work:

- `harness/src/types.ts` keeps a wide hook contract, a schema version, cost, transcript paths, extras, and raw payloads. [`harness/src/types.ts:5-30`, `49-136`]
- `harness/src/telemetry.ts` normalizes hook events into timeline records with `operation`, `phase`, `severity`, `actor`, `resource`, `summary`, and transcript links; it also derives agent/task summaries. [`harness/src/telemetry.ts:7-27`, `29-55`, `144-260`, `441-626`]
- `harness/src/cli.ts` exposes `summary`, `events`, `sessions`, `timeline`, `agents`, `tasks`, `cost`, `reasoning`, `anomalies`, and `verify`. [`harness/src/cli.ts:5-14`, `70-121`, `235-260`, `388-531`]
- `harness/src/verify.ts` extracts file changes, commands, test runs, and errors from a session. [`harness/src/verify.ts:4-12`, `59-72`, `77-145`, `175-252`]
- `harness/src/anomaly.ts` detects infinite loops, tool thrashing, error cascades, and cost spikes. [`harness/src/anomaly.ts:4-12`, `40-60`, `62-190`, `193-299`, `339-385`]
- `harness/INSTALL.md` already frames the package as an agent transparency layer with event capture, cost tracking, escalation, and redaction. [`harness/INSTALL.md:3`, `46-67`, `80-147`]
- The existing telemetry research doc already calls for lineage, lifecycle timing, tool failures/retries, task state transitions, file/command impact, cost attribution, and raw evidence linkage. [`app/docs/agent-telemetry-research.md:16-31`, `85-153`, `169-182`]

**Interpretation:** `ssenrah` is already strong on observability and verification. What it lacks is benchmark-specific orchestration: environment setup adapters, task manifests, rubrics, replayable snapshots, and result schemas.

---

## 2) Benchmarks / frameworks that matter most for this repo

### A. Terminal-Bench + Harbor

**Sources**
- Terminal-Bench site: https://www.tbench.ai/
- Terminal-Bench 2.0 / Harbor announcement: https://www.tbench.ai/news/announcement-2-0

**What it measures**
- Terminal-Bench 1.0: terminal-task completion using a terminal.
- Terminal-Bench 2.0: a harder, better-verified terminal-agent benchmark with 89 tasks across software engineering, ML, security, data science, and more.
- Harbor: a package that reworks the benchmark harness for cloud-deployed containers and agent optimization workflows.

**Instrumentation required**
- Shell/terminal command traces
- Containerized task environments
- Task-specific verification scripts
- Artifact capture for outputs, logs, and environment state
- For Harbor-style scaling: remote/cloud container orchestration and rollout interfaces

**Why it matters for `ssenrah`**
- This is the closest benchmark family to the harness’s current strengths: shell commands, file edits, errors, cost, and verification.
- `ssenrah` can already summarize command/test/file evidence; it would need a benchmark adapter to turn those into pass/fail plus per-task regression records.

**Version note**
- Terminal-Bench 2.0 was announced on 2025-11-07; the site also keeps Terminal-Bench 1.0 (80 tasks) active. [`tbench.ai` lines in announcement/site]

---

### B. τ-bench / τ²-bench / τ³-bench

**Sources**
- τ-bench GitHub repo: https://github.com/sierra-research/tau-bench
- τ²-bench paper: https://arxiv.org/abs/2506.07982

**What it measures**
- τ-bench evaluates tool-agent-user interaction in real-world domains.
- The repo warns that the old airline/retail tasks are outdated and points users to τ³-bench for the latest fixed tasks and new domains.
- τ²-bench extends the idea to a dual-control telecom environment where both agent and user can use tools.

**Instrumentation required**
- Agent/user dialog traces
- Domain API calls and tool-call logs
- Policy guideline compliance signals
- User-simulator state and behavior traces
- Outcome scoring with pass@k style reporting
- Fine-grained fault attribution, including whether failures are reasoning vs communication/coordination

**Why it matters for `ssenrah`**
- This benchmark family is excellent for testing whether the harness can reconstruct “who did what” in mixed human/agent workflows.
- It is especially relevant if `ssenrah` eventually monitors Slack/teammate-style workflows, not just solo coding sessions.

**Version note**
- The repo explicitly says the tasks are outdated and directs users to τ³-bench. Use the repo as a foundational reference, not the latest task source.
- τ²-bench is a 2025 paper (v1 on 2025-06-09).

---

### C. AgentBench / AgentBench FC

**Sources**
- AgentBench repo: https://github.com/THUDM/AgentBench
- AgentBench paper: https://arxiv.org/abs/2308.03688

**What it measures**
- Original AgentBench is a multi-dimensional benchmark with 8 distinct environments for LLM-as-agent reasoning/decision-making in multi-turn settings.
- The repo’s current “AgentBench FC” update (2025-10-10) adds function-calling style prompts and fully containerized deployment for five tasks: alfworld, dbbench, knowledgegraph, os_interaction, and webshop.

**Instrumentation required**
- Environment containers
- Tool/function-call traces
- Per-environment task runners
- API/service setup for DB, OS interaction, and web tasks
- Model/config provenance for each run

**Why it matters for `ssenrah`**
- This is a good fit for a benchmark harness that wants a generic “adapter over diverse environments” model.
- `ssenrah` can already ingest hook logs; AgentBench-style runs would need environment adapters and an evaluation manifest.

**Version note**
- Original paper: 2023-08 (arXiv 2308.03688).
- Repo update: 2025-10-10 introduced AgentBench FC and containerized tasks.

---

### D. SWE-bench / SWE-bench Verified

**Sources**
- SWE-bench repo: https://github.com/SWE-bench/SWE-bench
- OpenAI analysis of SWE-bench Verified: https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/

**What it measures**
- Real GitHub issue resolution: given a repository and issue, produce a patch that fixes the problem.
- Evaluation is execution-based: the patch passes task-specific tests while preserving regression tests.
- SWE-bench Verified curates a subset to reduce some original issues, but OpenAI later reported residual benchmark-quality problems and training contamination concerns.

**Instrumentation required**
- Repo checkout and patch application
- Build/test execution logs
- Regression test outcomes
- Task/source provenance and gold patch metadata
- Environment/version metadata, since some failures are environment-sensitive

**Why it matters for `ssenrah`**
- `ssenrah` already captures file edits, commands, tests, errors, cost, and session verification — almost exactly the evidence SWE-bench-style evaluation needs.
- The missing piece is the benchmark runner: a reproducible way to map a run to an instance, apply patches, execute tests, and record the score.

**Version note**
- OpenAI’s later analysis says SWE-bench Verified was widely used after its Aug 2024 release, but is no longer suitable for frontier capability tracking at today’s performance levels.
- Practical takeaway: keep SWE-bench as a historical baseline, but do not rely on it as the only long-term coding metric.

---

### E. OSWorld / OSWorld-Verified

**Sources**
- OSWorld repo: https://github.com/xlang-ai/OSWorld
- OSWorld arXiv paper: https://arxiv.org/abs/2404.07972

**What it measures**
- OSWorld is a scalable real-computer benchmark for multimodal agents in open-ended desktop tasks.
- The paper describes 369 computer tasks across real web and desktop apps, OS file I/O, and multi-application workflows.
- OSWorld-Verified updates the benchmark and (per repo announcements) improves signals and support for AWS/parallelization.

**Instrumentation required**
- Screenshots / video recordings
- Action traces
- Initial state setup configs
- Execution scripts for reliable evaluation
- Optional monitoring data and trajectories for verified leaderboard participation

**Why it matters for `ssenrah`**
- This is the benchmark family that most clearly says: for GUI/computer-use agents, text logs are not enough.
- `ssenrah` would need visual/trajectory artifacts or integration with a computer-use evaluator to be useful here.

**Version note**
- Paper: 2024-04.
- Repo notes: OSWorld-Verified update announced 2025-07-28.

---

### F. WebArena-Verified

**Source**
- WebArena-Verified repo: https://github.com/ServiceNow/webarena-verified

**What it measures**
- Realistic web-agent task completion on curated, version-controlled web tasks.
- The verified release emphasizes deterministic evaluation and offline replay.

**Instrumentation required**
- Agent responses / trajectory artifacts
- Captured network traces
- Deterministic evaluator outputs
- Versioned dataset and environment snapshots
- Offline replay for debugging and batch evaluation

**Why it matters for `ssenrah`**
- WebArena-Verified is a good example of a benchmark moving from “score only” to “score + replay + auditability.”
- This is very aligned with the `ssenrah` philosophy of preserving raw traces and layering derived summaries on top.

**Version note**
- The repo page shows a verified release with versioned tasks and deterministic evaluators; latest release listed is v1.2.3 (2026-02-07).

---

### G. TheAgentCompany

**Sources**
- GitHub repo: https://github.com/TheAgentCompany/TheAgentCompany
- arXiv paper: https://arxiv.org/abs/2412.14161

**What it measures**
- Real-world professional task performance in a simulated software company.
- The benchmark emphasizes web browsing, code execution, terminal work, and communication with simulated coworkers.
- Tasks include checkpoints with partial credit, deterministic or programmatic evaluators, and collaboration-heavy milestones.

**Instrumentation required**
- Dockerized local workspace
- Intranet service state (GitLab, OwnCloud, Plane, RocketChat)
- Simulated colleague conversations
- Checkpoint/grader outputs
- Trajectory analysis, browsing history, and action sequences

**Why it matters for `ssenrah`**
- This is one of the best matches for a “harness for teams” because it models real work distribution, collaboration, and long-horizon checkpoints.
- It suggests the next step for `ssenrah` should be a benchmark manifest that can represent checkpoints, simulated teammates, and partial credit.

**Version note**
- arXiv paper date: 2024-12-18 (arXiv 2412.14161).

---

### H. PaperBench

**Source**
- arXiv paper: https://arxiv.org/abs/2504.01848

**What it measures**
- Whether agents can replicate frontier AI research papers from scratch.
- The benchmark decomposes each replication task into hierarchically graded subtasks with clear rubrics.
- The paper says it contains 8,316 individually gradable tasks and uses an LLM-based judge plus a separate judge benchmark.

**Instrumentation required**
- Paper/task rubrics
- Codebase and experiment artifacts
- Hierarchical subtask scoring
- Automated judge outputs
- Separate evaluation for judge quality

**Why it matters for `ssenrah`**
- PaperBench is a strong model for long-horizon evaluation when a task is too complex for a single binary pass/fail.
- Its rubric hierarchy is directly useful if `ssenrah` wants to evaluate multi-stage agent workflows rather than simple command success.

**Version note**
- arXiv 2504.01848, last revised 2025-04-07 (v3).

---

### I. MCP-AgentBench

**Source**
- arXiv paper: https://arxiv.org/abs/2509.09734

**What it measures**
- Real-world language-agent performance in MCP-mediated tool interactions.
- The abstract describes 33 operational servers, 188 tools, 600 queries, 6 categories, and an outcome-oriented MCP-Eval method.

**Instrumentation required**
- MCP server/tool traces
- Query/task categories
- Outcome-oriented success metrics
- Tool availability and server provenance
- Possibly per-server interaction logs and tool-result capture

**Why it matters for `ssenrah`**
- This is one of the most directly relevant sources for a harness that cares about MCP visibility and tool-using reliability.
- It tells us that the next benchmark layer should not just log tool calls; it should also score them by outcome and environment category.

**Version note**
- arXiv 2509.09734, v1 submitted 2025-09-10.

---

### J. OpenHands benchmarks / benchmark harness infrastructure

**Source**
- GitHub repo: https://github.com/OpenHands/benchmarks

**What it measures**
- Standardized evaluation pipelines for OpenHands agents across real-world tasks.

**Instrumentation required**
- Reproducible evaluation pipeline
- Task-specific adapters
- Trajectory and result capture
- Integration points for different benchmarks

**Why it matters for `ssenrah`**
- This is a useful infrastructure reference, not just a benchmark.
- If `ssenrah` wants to become a benchmark runner rather than only a telemetry logger, a harness-style repository like this is the closest practical pattern.

**Version note**
- Current repo page describes it as the evaluation harness for OpenHands V1.

---

## 3) Adjacent but still useful benchmarks

### GAIA
- Source: https://arxiv.org/abs/2311.12983
- Measures general-assistant capability via real-world questions that require reasoning, multimodality, web browsing, and tool use.
- Useful as a broad assistant baseline, but it is less about environment replay and more about answer-level ability.

### τ-bench / TheAgentCompany crossover insight
- TheAgentCompany’s paper explicitly notes that τ-bench is one of the few benchmarks that measures interaction, but only in customer-service scenarios; TheAgentCompany broadens this to workplace collaboration.
- That is a useful framing for `ssenrah`: if we care about team workflows, we need collaboration-aware checkpoints, not just single-agent task success.

### SWE-bench cautionary lesson
- OpenAI’s critique of SWE-bench Verified is the caution sign for all benchmark work: a benchmark can become a proxy for memorization or flawed tests rather than capability.
- This is why the harness should store provenance, environment versions, and intermediate artifacts for later audit.

---

## 4) What `ssenrah` should borrow next

### High-priority measurement primitives
1. **Run manifest** — benchmark name, version, task id, environment image, model, seed, and tool set.
2. **Trajectory capture** — tool calls, file edits, terminal commands, screenshots/video when GUI tasks are involved, and network traces for web tasks.
3. **Checkpoint/rubric schema** — partial credit, milestone checkpoints, and deterministic evaluators where possible.
4. **Outcome schema** — pass/fail/partial, score, cost, duration, retries, failure mode, and reproducibility notes.
5. **Replay/debug artifacts** — raw logs plus enough environment state to reproduce or inspect a failure.

### How this maps to the current repo
- `harness/src/verify.ts` already captures the file/command/test slice of a terminal-style benchmark.
- `harness/src/anomaly.ts` already gives you benchmark-adjacent reliability signals: loops, thrashing, error cascades, cost spikes.
- `harness/src/telemetry.ts` already resembles the beginning of a generic benchmark timeline model.
- Missing: benchmark manifests, environment adapters, replay artifacts, score registries, and benchmark-specific result schemas.

### Practical recommendation
If I were extending `ssenrah` next, I would add a **benchmark adapter layer** with these pieces:
- `benchmark_manifest.json` / schema
- `run_record.json` with provenance and score fields
- environment adapter interfaces for terminal, web, desktop, and MCP tasks
- deterministic evaluator plug-ins
- a report/export command that can emit machine-readable results for comparisons across runs

---

## 5) Multilingual query expansion notes

I used broad search expansion in English, Korean, and Chinese. Helpful terms for future research:

- English: `agent benchmark`, `tool-use benchmark`, `terminal agent`, `workflow reliability evaluation`, `computer-use benchmark`, `long-horizon agent evaluation`
- Korean: `에이전트 벤치마크`, `도구 사용 평가`, `터미널 에이전트`, `워크플로 신뢰성 평가`, `장기 과제 평가`
- Chinese: `智能体评测`, `工具调用评测`, `终端智能体`, `工作流可靠性评估`, `长程任务评估`

Most non-English searches surfaced secondary summaries or benchmark directories rather than the primary sources themselves, so I treated them mainly as discovery aids.

---

## Bottom line for `ssenrah`

`ssenrah` is already very close to a **benchmark-ready observability layer**. The next step is not to add another logger; it is to define a **benchmark execution contract** so that the harness can ingest benchmark manifests, capture the right artifacts for each benchmark family, and emit deterministic results.

If we do that, the repo can support:
- terminal/code benchmarks like Terminal-Bench and SWE-bench,
- workflow/collaboration benchmarks like τ-bench and TheAgentCompany,
- GUI/computer-use benchmarks like OSWorld and WebArena,
- and future MCP-native tool benchmarks like MCP-AgentBench.
