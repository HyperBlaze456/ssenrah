---
title: "QIAP Harness — Milestone Roadmap"
date: 2026-04-25
status: draft, awaiting user direction
---

# QIAP Harness — Milestone Roadmap

Each milestone has a definition-of-done that is **measurable in seconds**, not "feels good." Don't move forward until the prior milestone's measurement is trivially answerable.

---

## M0 — Bootstrap (≤1 day)

Goal: a runnable scaffold that emits one tool call. No optimization yet.

**Deliverables**
- `engine/` package skeleton (TypeScript ESM, Node ≥20, `@anthropic-ai/sdk`).
- `engine/src/loop.ts`: hard-coded loop with one tool (`echo`) that calls Anthropic and prints the response.
- `engine/bin/qiap.ts`: CLI that takes a prompt and runs the loop.
- A reproducible `npm run demo` that ends in <10s on a cached system prompt.

**Done when:** `qiap "say hi"` works end-to-end.

**Out of scope:** caching, parallelism, elision, multiple tools.

---

## M1 — Single Loop, Squeezed (1–2 weeks)

Goal: the QIAP-correct minimum-viable harness. After M1, *most* coding tasks should already feel snappier than running them through Claude Code, because we've cut everything we don't need.

**Deliverables**

1. **Tool surface (Claude Code minimum):** `Bash`, `Read`, `Edit`, `Write`, `Glob`, `Grep`. Each tool declares `readOnly: boolean`. Tool definitions live in `engine/src/tools/`.
2. **Prompt cache discipline:** `cache_control: ephemeral` on the last tool def and on system. No timestamps, UUIDs, or current-time strings above the breakpoint. 1-hour TTL beta header on by default.
3. **Parallel read-only tool dispatch:** `Promise.all` over read-only tool_use blocks; serial fallback for state-mutating tools. Per-tool timeout (default 15s) so one slow tool doesn't stall the batch.
4. **Tool-result elision:** `engine/src/elide.ts` replaces tool_result content older than the last 2 turns with `[elided N bytes from <tool_name>]` once the cumulative tool-result payload exceeds a threshold (default 20k tokens).
5. **Streaming + partial-JSON parse:** SSE streaming on; an incremental JSON parser kicks off speculative dispatch for read-only tools as soon as their args are complete. Behind a feature flag for the first iteration.
6. **Terse-response system prompt:** explicit instruction that tool confirmations should be one line, no chitchat, no "let me know if you need anything else." Test that median assistant-message length drops vs an unprompted run.
7. **Per-turn timing instrumentation (`--time-each-turn`):** prints `model_latency_ms / tool_latency_ms / decoded_tokens / cache_read_input_tokens / cache_write_input_tokens / cache_hit_ratio` for each turn. This is the QIAP debugger; it ships with M1.
8. **Event-log emission compatible with the existing tracker schema** (`tracker/src/types.ts`). Day one. Reuse the dashboard for free.
9. **Model defaults:** Haiku 4.5, no extended thinking. `--model` flag overrides.

**Definition of done — three numeric gates on a 5-task fixture**
- p50 turn wall-clock under **6 seconds** (50k cached input, 1k output, Haiku 4.5).
- Cache-read ratio on input tokens **≥ 70%** by turn 3.
- Across the fixture, median **decoded tokens / turn ≤ 800** (proxy for "the model isn't yapping").

If any gate fails, the bug is in M1, not M2.

**Explicitly out of scope:** sub-agents, routing, hooks, sandboxing, MCP, plan mode, memory, anything `await another_loop()`.

---

## M1.5 — Hardening (≤1 week, optional, do if M1 is unstable)

Only land if M1's gates aren't holding under real use.

- **Cache-key debugger:** detect prefix invalidation between turns and log which block changed.
- **Compaction:** turn on Anthropic's server-side `compact_20260112` for runs that cross 50k input tokens. Echo the compaction block back automatically.
- **Tool search:** if the tool count grows past ~10 (e.g., adding `WebFetch`, project-specific tools), introduce `tool_search_tool_regex_20251119` with `defer_loading: true` so the cached prefix stays small.
- **Files-as-context for large outputs:** any tool result >2KB writes to `.qiap/scratch/<run_id>/<n>.txt` and returns `{ path, head }` instead of full payload.

---

## M2 — Two Orchestration Additions (2–3 weeks, only after M1 gates hold)

Goal: add **routing** and **parallel sub-agents**, in that order. Nothing else.

### M2.a — Routing

**Deliverables**
- `engine/src/route.ts`: a tiny Haiku-class classifier that takes the user prompt and returns one of `{trivial, code, research, plan}`.
- `trivial` answers come from a single non-tool call (no loop). `code/research/plan` dispatch into the M1 loop with task-specific system prompts and tool subsets.
- Routing decision is logged as an event (`route.decision`) consumable by the tracker.

**Definition of done**
- On a 20-task mixed fixture, routing reduces median wall-clock by **≥ 30%** vs running everything through the full M1 loop. If <30%, routing is decoration, not value — pull it out.
- Router itself adds **<400ms p95** to total turn time on the routed-into-loop path.

### M2.b — Parallel Sub-Agents (depth-limit 1)

**Deliverables**
- A `spawn(prompts: string[])` tool exposed to the main loop. Each spawn runs an isolated M1 loop with a fresh small context and a restricted tool set (default: read-only).
- Hard depth limit: spawned agents cannot themselves spawn.
- Parent receives only a **summary** (assistant's final message), not the full transcript.
- Concurrency cap (default 5).

**Definition of done**
- On a fixture of "obvious fanout" tasks (e.g., "find all callers of function X across these 8 files and summarize each"), parallel spawn reduces p50 wall-clock by **≥ 40%** vs serial in-loop calls.
- On non-fanout tasks, the planner **does not** spawn (verified by an evaluation pass on the fixture).
- No measurable QIAP regression on M1's own fixture (within 10%).

**Explicitly NOT in M2:** swarms, A2A, group chat, evaluator-optimizer loops, recursive sub-agents, MCP gateway, plan-mode, memory subsystem, hooks beyond what the tracker already needs, sandboxing.

---

## M3 — Compiled Workflows (open-ended, do only after M2 has stable patterns)

Goal: take the recurring shapes M2 proved and freeze them as DAGs.

**Deliverables (per workflow)**
- A workflow definition (TypeScript, hand-rolled — no graph framework yet) that explicitly enumerates nodes (LLM call or deterministic) and edges.
- Deterministic nodes for everything that doesn't actually need a model: file listing, regex matches, JSON schema validation, formatter calls, tests.
- Explicit parallelism: independent branches start concurrently.
- Stable cache keys: per-node prompts are templated and known at compile time, so prompt cache hits maximally.

**Candidate first workflows** (in priority order, all observed shapes from M2 traffic)
1. *"Edit N files for one change"* — planner picks the change, fanout edits, parallel verifier reads.
2. *"Investigate question across codebase"* — fanout greps, summarize, single-pass synthesis.
3. *"Run-fix loop"* — run tests, classify failure, fix one class at a time with bounded K.

**Definition of done (per workflow)**
- Compiled version is **≥ 25%** faster wall-clock p50 than the M2 organic version on the same task.
- Latency variance (p95 / p50 ratio) is **< 1.5×**. The whole point of compilation is predictability; if it's not more predictable, it's not worth the rigidity.

---

## What we are explicitly NOT doing in this roadmap

- **No graph framework.** LangGraph etc. is for workflows already debugged. We hand-roll until we have ≥3 production workflows.
- **No multi-agent message protocol.** No A2A, no swarms, no JSON message envelopes between agents. Sub-agents take prompts and return text.
- **No memory subsystem.** Compaction is a server-side primitive (M1.5). Long-term memory is M3+ at earliest, if at all.
- **No sandboxing on the hot path.** Hooks-as-policy via the tracker existing infra is enough through M2.
- **No GUI integration with `app/` until M2 is shipping.** Premature integration wastes design budget.

---

## Cross-cutting: the QIAP scoreboard

A small file `engine/bench/qiap-scoreboard.json` captures, per milestone:

```jsonc
{
  "milestone": "M1",
  "fixture": "fixtures/m1-5tasks.yaml",
  "model": "claude-haiku-4-5",
  "median_turn_ms": 5832,
  "median_total_ms": 28115,
  "median_decoded_tokens_per_turn": 612,
  "cache_read_ratio": 0.78,
  "tasks": [{ "name": "...", "p50_ms": 0, "p95_ms": 0, "decoded_tokens": 0 }]
}
```

Every milestone bump must beat the previous milestone's number on the same fixture, on the same model. If not, the milestone isn't done.

---

## The shortest version of this whole document

> Make M1 fast. Earn M2. Compile M3 only when patterns repeat.
> If you can't print where the wall-clock went on any given turn, you don't have M1.
> If a feature can't show ≥30% wall-clock reduction on a real task, don't ship it.
