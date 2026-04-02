# Memory / Compaction / Long-Horizon Reliability Lane

Date: 2026-04-02
Scope: primary-source review of long-horizon reliability, memory architectures, compaction safety, checkpointing/resume, and implications for harness monitoring

## Executive summary

The strongest cross-source lesson is simple:

**long-horizon agent quality depends as much on memory/control architecture as on model capability.**

For `ssenrah`, that means monitoring should not stop at tool calls and costs. A serious harness should also track:
- compaction boundaries
- checkpoint/resume quality
- what was persisted vs forgotten
- memory read/write behavior
- long-task degradation over time / context growth

## Most relevant sources

### 1) METR on long-task ability
- METR blog / evaluation references surfaced during research, including:
  - https://metr.org/blog/2025-03-19-measuring-ai-ability-to-complete-long-tasks/
  - related evaluation update: https://metr.org/blog/2024-08-06-update-on-evaluations/
- Why it matters:
  - METR popularized measuring capability by **task length / time horizon**, not just benchmark score.
  - This aligns directly with long-running harness monitoring.
- Implication for `ssenrah`:
  - track run horizon metrics explicitly: elapsed wall-clock time, context growth, compaction count, resume count, and success-vs-duration curves.

### 2) Letta memory blocks / memory systems
- Letta docs:
  - https://docs.letta.com/guides/core-concepts/memory/memory-blocks
  - https://docs.letta.com/guides/agents/custom-memory/
  - https://docs.letta.com/letta-code/memory/
- Why it matters:
  - Letta treats memory as explicit, structured, editable blocks instead of vague hidden state.
- Implication for `ssenrah`:
  - treat important persistent facts as first-class tracked artifacts.
  - monitoring should distinguish:
    - working memory
    - indexed recall
    - persistent memory writes

### 3) Mastra Observational Memory
- Research / blog:
  - https://mastra.ai/research/observational-memory
  - https://mastra.ai/blog/observational-memory
- Why it matters:
  - Mastra frames memory as **observational** and benchmarked against LongMemEval.
  - It explicitly positions memory as an operationally measurable subsystem.
- Implication for `ssenrah`:
  - memory should emit evidence: what observation was stored, why, and when it was reused.
  - benchmark runs should be able to compare memory-enabled vs memory-disabled modes.

### 4) LongMemEval and AMA-Bench
- LongMemEval repo: https://github.com/xiaowu0162/LongMemEval
- AMA-Bench paper: https://arxiv.org/abs/2602.22769
- Why they matter:
  - these benchmarks focus on long-horizon memory rather than one-shot task execution.
- Implication for `ssenrah`:
  - a future memory benchmarking lane should measure not just recall accuracy, but whether persisted state improves end-to-end task completion.

### 5) OpenClaw compaction docs
- Compaction docs:
  - https://docs.openclaw.ai/concepts/compaction
  - https://docs.openclaw.ai/concepts/context-engine
  - https://docs.openclaw.ai/reference/session-management-compaction
- Why they matter:
  - OpenClaw makes compaction an explicit runtime concept with thresholds, retries, reserves, and session-management policy.
- Implication for `ssenrah`:
  - compaction should be observable as a lifecycle event, not an invisible implementation detail.
  - the harness should record pre/post compaction state and whether retries succeeded.

### 6) MemGPT
- Paper: https://arxiv.org/abs/2310.08560
- Why it matters:
  - MemGPT’s OS-like framing remains one of the clearest memory-architecture references for long-context agents.
- Implication for `ssenrah`:
  - distinguish short-context working state from externalized/persistent memory and monitor traffic across that boundary.

## Practical design implications for ssenrah

### A. Treat compaction as a measurable event family
The repo already has `PreCompact` / `PostCompact` mapping in telemetry (`harness/src/telemetry.ts:324-339`).

Next step:
- add fields like:
  - `context_tokens_before`
  - `context_tokens_after`
  - `compaction_reason`
  - `summary_size`
  - `resume_success`
  - `resume_latency_ms`

### B. Add checkpoint / resume packet evidence
The philosophy doc already points toward compaction-safe resume packets (`docs/harness_architecutre/current_philosophy.md:217-231`).

Next step:
- persist a typed checkpoint artifact with:
  - active task graph state
  - current branch/attempt info
  - open tool operations
  - key decisions already made
  - memory writes since last checkpoint

### C. Track memory operations separately from general telemetry
Recommended future event types or normalized operations:
- `memory.write`
- `memory.read`
- `memory.flush`
- `memory.compact`
- `memory.resume`
- `memory.miss`

### D. Add long-horizon degradation metrics
For every long run, track:
- wall-clock duration
- turns
- compaction count
- resume count
- tool failure rate over time
- anomaly density over time
- score or success probability by elapsed horizon bucket

These are more useful for long-horizon reliability than raw total-event counts alone.

## Suggested benchmark/eval additions

1. **Compaction replay test**  
   Re-run a task with forced compaction thresholds and compare outcome, anomaly count, and verification evidence.

2. **Checkpoint integrity test**  
   Interrupt mid-run, restore from checkpoint, and compare final result vs uninterrupted baseline.

3. **Memory usefulness test**  
   Measure whether persisted memory actually improves later task completion, not just recall accuracy.

4. **Long-horizon variance test**  
   Repeat the same long task several times and chart failure mode drift as horizon increases.

## Repo-specific recommendation

For `ssenrah`, the best next memory/compaction move is not a giant memory subsystem build. It is to make compaction and resume behavior **visible and benchmarkable** first.

That means:
- log compaction inputs/outputs more explicitly
- persist checkpoint artifacts
- compare pre/post-compaction run quality
- add long-horizon reliability metrics to the benchmark layer

## Bottom line

If `ssenrah` wants to become a serious agent harness, it should treat memory/compaction as a monitored subsystem with explicit evidence, not as background magic. The monitoring layer already points in that direction; the next step is to make that evidence durable, comparable, and benchmark-ready.
