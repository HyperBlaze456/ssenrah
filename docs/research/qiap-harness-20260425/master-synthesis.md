---
title: "QIAP Harness — Master Synthesis"
date: 2026-04-25
audience: ssenrah authors
metric: QIAP — quickest iteration as possible (wall-clock per loop step, not $)
status: opinionated
---

# QIAP Harness — Master Synthesis

The user wants their own harness. The existing repo has `app/` (Tauri GUI for configuring Claude Code) and `tracker/` (telemetry over CC/Codex JSONL). Both *augment* third-party harnesses. This new effort builds the engine itself — and the goal is not "the most agentic," it is QIAP: minimum wall-clock between sending a prompt and seeing the next decision.

That single metric reframes everything the prior philosophy doc (`docs/harness_architecutre/initial_philosophy.md`) lays out. Visibility, coordination, memory, self-improvement — those are correct as long-horizon layers. They are not where wall-clock lives. Wall-clock lives in **decode tokens, round trips, and prefill cache misses**, in that order. Build for that first; the architectural layers get added later only when they earn their cost.

## Where wall time actually goes (the only paragraph that matters)

For a typical agent turn with ~50k input cached and ~2k output on Sonnet 4.6: RTT+queue ~150ms, warm prefill ~200ms, decode ~33s. **Decode is ~95% of the wall clock.** Cold prefill on the same turn would add ~1.5s — meaningful, but dwarfed by decode. The asymmetry is roughly **166× wall-clock per decoded token vs prefilled token** (~60 tok/s decode vs ~10k tok/s prefill on H100-class). That asymmetry dictates the lever order.

## The four levers, in order of impact

1. **Cut decoded output.** The single biggest QIAP knob. Tools that return "OK" instead of 500 tokens save ~8 seconds. Default to terse responses, structured outputs only on dangerous tools, no extended thinking on routine tool dispatch.
2. **Cut round trips with parallel tool calls.** Each collapsed round-trip removes a full assistant decode (1–5+ s). `Promise.all` over read-only tool_use blocks. Stream and partial-JSON-parse so tool prep starts before the JSON closes.
3. **Cache the prefix; never break it.** `cache_control: ephemeral` on `tools` and `system`. 1-hour TTL beta for any loop with human-review pauses. Never embed timestamps or rotating IDs above the breakpoint. Cache reads cost 0.1× input price *and* prefill latency (~10× faster TTFT).
4. **Elide stale tool results.** Old grep/read outputs are dead weight. Server-side `compact_20260112` for >50k input loops, `clear_tool_uses_20250919` layered on top for tool-heavy work. Files-as-context for anything >2KB: tool returns a path + 1-line head; the model reads only if it asks.

These are stage-0 hygiene. Without them, no orchestration cleverness recovers the wall clock you've already burned.

## Model choice as a multiplier

Decode rate is per-model. Haiku 4.5 decodes ~80–150 tok/s, Sonnet 4.6 ~40–60 tok/s, Opus 4.7 slower still. Default the inner tool loop to **Haiku 4.5 with adaptive thinking off**. Reserve Sonnet 4.6 / Opus 4.7 + thinking for a one-shot planner head that fires once per task. This is not "small model = bad answers" — it is "small fast model in the loop, big slow model at the boundaries where structure is set."

## Staging — M1 → M2 → M3

The QIAP-correct progression is opinionated and short.

**M1 — single loop, squeezed.** A ~30-line `while` over the Anthropic SDK with: parallel read-only tool dispatch, prompt-cached system+tools, tool-result elision, terse-response system prompt, streaming with partial-JSON parse. Ship a `--time-each-turn` mode that prints `model_latency_ms / tool_latency_ms / decoded_tokens / cache_hit_ratio` so you can point at any turn and say where the wall-clock went. **You do not graduate from M1 until that observation is trivial.** A clean M1 beats most M2 designs on QIAP.

**M2 — exactly two additions, in this order.** First, **routing**: Haiku-class classifier in front of the M1 loop, biggest QIAP win for least architectural cost. Second, **sub-agent spawning with hard depth-limit-1**, only where parallelism is real (search fanout, multi-file edits, independent verifications). Pass *prompts*, not JSON handoffs. Skip swarms, group chat, evaluator loops, prompt chaining as a habit. Each M2 addition has to clear the bar: *"does this cut wall-clock by ≥30% on a real task, measured?"* If you can't measure it, don't ship it.

**M3 — compile what M2 proves.** Once a fanout shape repeats (same planner output, same worker pattern, same synth), freeze it as a DAG. Replace LLM turns with deterministic nodes wherever you can. Hand-rolled or LangGraph-style — irrelevant. The win at M3 is *predictable* latency: explicit parallelism, deterministic gates, stable cache keys. M3 is M2 with improvisation removed in exchange for speed and observability.

The trap is treating M2 as the destination. Multi-agent is a tax for parallelism or context isolation. Tasks that need neither stay at M1 forever.

## What ssenrah is **not** building (here)

- No graph runtime as a starting primitive. LangGraph is for workflows you've already debugged enough to draw — that's M3 territory.
- No group-chat or role-play orchestration (crewAI/AutoGen shape). Each round is N serial calls; there is essentially no task where this beats a single loop with the same tools.
- No XML tool-call protocol (Cline/early Roo failure mode). Native Anthropic tools, full stop.
- No Docker-on-the-hot-path sandboxing. Hooks-as-policy at M2+, not container spin-up cost on every turn.
- No JSON-schema message-passing between agents. Pass results back as tool_result content. Anthropic's effective-agents thesis: the simplest interface wins, frameworks that obscure prompts and tokens are blind in QIAP debugging.
- No reflection loops without a hard exit criterion and bounded K (≤2).

## How this connects to the existing philosophy doc

`initial_philosophy.md` orders the world as Visibility → Coordination → Orchestration ↔ Memory → Self-Improvement. That ordering is right for *trustworthy* agents. QIAP is a different axis. The mapping:

- **Visibility (Layer 0)** is the *measurement substrate* QIAP relies on. The existing tracker schema (lineage IDs, cost/duration fields, transcript-derived cost) is the right substrate. Reuse it: emit JSONL events from the new harness on day one in the tracker's vocabulary, so the existing dashboard works for free.
- **Coordination, Orchestration, Memory** are deferred until M2+, and even then only the QIAP-paying subset (parallel sub-agents, server-side compaction, file-as-context).
- **Self-Improvement (Layer 4)** is M3+ work. Hold.

The philosophy doc and QIAP staging do not conflict — they layer. QIAP defines *what to build first and how to measure it*; the layered architecture defines *what comes after a clean M1*.

## Where this lives in the repo

Proposed: a new top-level `engine/` directory parallel to `app/` and `tracker/`. TypeScript, ESM, Node ≥20, Anthropic SDK (`@anthropic-ai/sdk`) as the only model dependency. The shape:

```
engine/
  package.json
  src/
    loop.ts          # the M1 ~30-line loop
    tools/           # tool definitions + readOnly metadata
    cache.ts         # cache_control breakpoint helper
    elide.ts         # tool-result elision
    stream.ts        # partial-JSON parse + speculative dispatch (M1.5)
    timing.ts        # per-turn instrumentation (--time-each-turn)
    bin/
      qiap.ts        # CLI entrypoint
  tests/
```

This keeps the new engine independent of the GUI configurer and the tracker, while letting the tracker consume its event stream.

## Open questions for the user (where I'd want signal before committing code)

1. **Single binary or library-first?** A CLI entrypoint is fine for dogfooding, but the long-term shape is probably a TypeScript library that other harnesses (your own future ones) embed. Confirm.
2. **Tool surface for M1.** Suggest the Claude Code minimum: `Bash`, `Read`, `Edit`, `Write`, `Glob`, `Grep`. Add `WebFetch` only after M1 is stable. Confirm or trim.
3. **Where to dogfood.** The tightest feedback loop comes from running ssenrah-engine against ssenrah-tracker development tasks themselves. Yes?
4. **Eval metric.** QIAP needs a "wait time saved" benchmark, not just SWE-bench accuracy. Suggest a small fixed task set with median wall-clock as the headline number.

## Companion docs

- [`milestones.md`](./milestones.md) — concrete deliverables for M0/M1/M2/M3.
- [`agents/01-existing-harnesses.md`](./agents/01-existing-harnesses.md) — survey of 12 harnesses graded for QIAP.
- [`agents/02-token-and-latency.md`](./agents/02-token-and-latency.md) — the techniques that move wall-clock in 2026.
- [`agents/03-orchestration-patterns.md`](./agents/03-orchestration-patterns.md) — orchestration patterns ranked by QIAP behavior.
