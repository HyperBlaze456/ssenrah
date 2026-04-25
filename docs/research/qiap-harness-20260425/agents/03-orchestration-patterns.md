---
title: "Orchestration Patterns Through a QIAP Lens"
date: 2026-04-25
author: research-agent
project: ssenrah
metric: QIAP (quickest-iteration-as-possible; wall-clock latency)
milestones: [M1 single-loop, M2 multi-agent, M3 fixed workflow]
status: opinionated
sources:
  - https://www.anthropic.com/engineering/building-effective-agents
  - https://www.anthropic.com/engineering/multi-agent-research-system
  - https://github.com/openai/swarm
  - https://openai.github.io/openai-agents-python/
  - https://developers.openai.com/cookbook/examples/orchestrating_agents
  - https://www.langchain.com/langgraph
  - https://docs.langchain.com/oss/python/langgraph/overview
  - https://a2a-protocol.org/latest/specification/
  - https://cloud.google.com/blog/products/ai-machine-learning/agent2agent-protocol-is-getting-an-upgrade
  - https://code.claude.com/docs/en/sub-agents
  - https://www.agentic-patterns.com/patterns/sub-agent-spawning/
---

# Orchestration Patterns Through a QIAP Lens

The harness's primary metric is **QIAP** — quickest-iteration-as-possible. Wall-clock from user-prompt to user-visible output. Not dollars, not token efficiency, not "elegance." Every pattern below is ranked on how it moves wall-clock, and what it costs to get there.

A useful baseline: a single tool-calling loop on a fast model with parallel tool calls is *very hard to beat* on QIAP for tasks that fit one context. Anthropic's own guidance is consistent with this: "Start with simple prompts ... add multi-step agentic systems only when simpler solutions fall short" [^anthropic-effective].

## Pattern Survey, Ranked by QIAP Behavior

### 1. Single Loop (M1 baseline)

```
user -> [LLM + tools (parallel)]^N -> output
```

Wall-time = `sum(turn_i)` where each turn = `model_latency + max(tool_latency_in_turn)`. With parallel tool calls, the only true serial cost is the model's autoregressive thinking between turns. **This is the QIAP champion when the work fits one context.** Anthropic's "agents" pattern [^anthropic-effective] is exactly this.

### 2. Routing

```
user -> [tiny classifier LLM] -> [specialist LLM/loop]
```

Wall-time = `router_time + specialist_time`. Router on Haiku-class is ~200-400ms; specialist takes whatever it takes. **QIAP-favorable** when routing prevents an oversized model from chewing on a trivial query (the "Haiku for easy, Sonnet for hard" example) [^anthropic-effective]. **QIAP-hostile** if the router is the same size as the specialist — you've just added a serial call for nothing.

### 3. Prompt Chaining

```
user -> [LLM A] -> gate -> [LLM B] -> [LLM C] -> output
```

Wall-time = `sum(LLM_i)` strictly serial. Anthropic frames it bluntly: chains "trade off latency for higher accuracy" [^anthropic-effective]. **QIAP-hostile by definition.** Only worth it when (a) intermediate gates catch errors that would force a full re-run, or (b) each step uses a smaller/faster model than a single mega-prompt would require. For ssenrah, prompt chaining is a refactoring trick, not an orchestration strategy.

### 4. Parallelization — Sectioning

```
        ┌─> [LLM A] ─┐
user ───┤             ├─> merge -> output
        └─> [LLM B] ─┘
```

Wall-time = `max(workers) + merge`. **QIAP-favorable** when subtasks are genuinely independent (Anthropic's content-guardrail example: model handles the request while another screens for unsafe input) [^anthropic-effective]. The merge step is often deterministic code, not an LLM, which keeps it cheap.

### 5. Parallelization — Voting / Ensemble

```
        ┌─> [LLM] ─┐
user ───┼─> [LLM] ─┼─> majority/aggregator -> output
        └─> [LLM] ─┘
```

Wall-time = `max(workers) + aggregator`. Same shape as sectioning. **QIAP-neutral** — costs no more wall-time than one call, but spends N× tokens. Worth it only when reliability matters more than dollars.

### 6. Orchestrator-Workers (Planner-Worker)

```
user -> [planner LLM] -> spawn ─┬─> [worker 1] ─┐
                                 ├─> [worker 2] ─┼─> [synthesizer] -> output
                                 └─> [worker N] ─┘
```

Wall-time = `planner + max(workers) + synth`. Anthropic's research multi-agent system reports it "cut research time by up to 90% for complex queries" by parallelizing 3-5 subagents [^anthropic-multiagent]. **But:** the same article notes 15× token usage versus chat, and that tasks "requiring all agents to share the same context or [with] many dependencies between agents" — explicitly including most coding work — are bad fits.

QIAP math: this beats a single loop iff `max(workers) << sum_of_what_one_agent_would_have_done_serially`, *and* the planner+synth overhead doesn't eat the gains. For a 30-second task, a 5-second planner + 5-second synth is fatal. For a 5-minute research dive, it's free.

### 7. Sub-Agent Spawning (Claude Code Task tool)

```
main ──> spawn(child with fresh, small context)
         child loops independently
         child returns SUMMARY (not full transcript)
main ─── continues with summary appended
```

Each subagent runs in its own context window, returning only a digest [^claude-subagents][^agentic-patterns]. **QIAP profile is mixed:**

- **Win:** keeps the main agent's context tight, so each *main* turn stays fast (model latency scales with context).
- **Win when parallel:** spawn N children, await all. Same `max(workers)` math as orchestrator-workers.
- **Loss when serial:** if you spawn one child and wait, you've added a full LLM-loop's wall-time *plus* a context cold-start for zero parallelism.

The Claude Code limit — subagents can't spawn subagents [^claude-subagents] — is a *feature* for QIAP. It bounds depth.

### 8. Swarms / Handoffs (OpenAI Swarm → Agents SDK, A2A)

```
user -> [Agent A] -> handoff -> [Agent B] -> handoff -> [Agent C] -> output
```

Wall-time = `sum(agents)` strictly serial — handoff is just "next agent reads the conversation and replies." OpenAI's Swarm/Agents SDK handoff primitive is explicitly stateless and client-driven for "lower latency" within a single handoff [^openai-swarm][^openai-cookbook], but the *aggregate* shape is still a chain. A2A adds cross-org transport (gRPC/HTTP3, SSE streaming) and reports a 40% latency reduction *versus custom middleware* [^a2a-spec][^a2a-google] — but that's "less bad than ad-hoc HTTP," not "faster than a single loop."

**QIAP verdict:** handoffs are prompt chaining wearing a hat. Useful for org/domain boundaries (different tools, different permissions), QIAP-neutral-to-hostile within one process. For ssenrah, only adopt A2A when the harness genuinely talks to *external* agents.

### 9. State Machine / DAG (LangGraph, Temporal-shaped)

```
   ┌─[node A]─┐
   │          ├─> [node D] -> output
   └─[node B]─┘
        │
        └─loop back to A on condition
```

LangGraph compiles a graph of nodes (LLM or deterministic) with conditional edges and shared state [^langgraph][^langgraph-overview]. **QIAP-favorable in two specific ways:**

1. Independent branches run in parallel automatically (sectioning, but reusable).
2. Deterministic nodes (regex, API calls, code) have ~zero LLM latency and replace what would otherwise be LLM turns.

The cost is compile-time topology — you have to know the shape ahead of time, which is exactly what M3 means.

### 10. Evaluator-Optimizer Loops

```
[generator] -> [critic] -> if good: stop, else loop
```

Wall-time = `K × (gen + critic)`. Anthropic's own framing: multiple rounds increase latency [^anthropic-effective]. **It only beats one careful pass when** (a) the critic catches a *specific class* of error the generator can't self-correct without external signal, and (b) `K` is bounded and small (≤2). Anything else is reflection theater.

## Critical Section — What NOT To Do

1. **Group chats with >3 agents.** Each "round" is N serial LLM calls. For 4 agents over 3 rounds, that's 12 sequential turns. There is essentially no task where this beats a single loop with the same tools.
2. **JSON-schema message-passing between agents.** Every hop is `serialize -> model -> parse -> retry-on-malformed`. Anthropic's effective-agents post is explicit that the simplest interface (function calls, plain strings) wins; frameworks "obscure underlying prompts and responses" [^anthropic-effective]. If you must pass structure, pass it as a tool-call result, not a free-form JSON blob another agent has to re-parse.
3. **Recursive sub-agents without a depth limit.** Latency compounds geometrically. Claude Code's hard rule that subagents can't spawn subagents [^claude-subagents] exists for this reason. Copy that rule.
4. **Reflection loops without exit criteria.** If your evaluator can't return a hard "done" signal, you've built a metronome, not a refiner. Always cap K and always have a deterministic fallback.
5. **Frameworks that abstract the model API.** LangChain-style wrapper-on-wrapper hides the prompt, hides tokens-in, hides latency. If you can't print the exact bytes going to the model, your QIAP debugging is blind.

## How To Stage M1 → M2 → M3 (Opinionated)

The user said "be free." Here it is.

**M1 — Single loop, and squeeze it.** Build the cleanest possible tool-calling while-loop on the fastest model that's accurate enough. Make tool calls *parallel by default* (this alone is worth more than any orchestration pattern below). Ship a `--verbose-timing` flag that prints model-latency vs tool-latency per turn. Most teams declare M1 "done" too early — you should be able to look at a turn and instantly say where the wall-clock went. Until that's true, do not move on.

**M2 — Add exactly two patterns, in this order.** First, **routing** (Haiku-class classifier in front of a Sonnet/Opus loop) — biggest QIAP win for the least architectural cost. Second, **sub-agent spawning with a hard depth limit of 1** — only for tasks that are obviously parallel (search-fanout, multi-file edits, independent verifications), and only when the parent passes a *prompt*, not a structured handoff object. Skip swarms entirely. Skip group chat. Skip evaluator loops unless you have a specific bug class they fix.

The mental check before adding any M2 pattern: *"Does this reduce wall-clock for a real user task by ≥30%, measured?"* If you can't measure it, don't ship it.

**M3 — Compile what's already proven.** Once M2 has shown which task shapes are stable (same planner output, same worker fanout, same synth pattern), freeze them as a DAG. LangGraph-style or hand-rolled — doesn't matter. The win at M3 is *predictable* latency: deterministic nodes replace LLM turns, parallel branches are explicit, cache-keys are stable. M3 is not "fancier M2"; it's M2 with the freedom-to-improvise removed in exchange for speed and observability.

**The trap to avoid:** treating M2 as the destination. Multi-agent is a tax you pay for parallelism or context isolation. If a task doesn't need either, M1 is the answer forever. The Anthropic research-agent post is honest about this — they ship multi-agent for *research* (massively parallel, context-exceeding) and explicitly warn against it for coding (high dependency, shared context) [^anthropic-multiagent]. ssenrah should be the same: multi-agent where parallelism is real, single-loop everywhere else, DAG only for the patterns that have earned compilation.

QIAP is won at M1 and protected at M2/M3. Build accordingly.

---

[^anthropic-effective]: Anthropic, *Building Effective Agents* — https://www.anthropic.com/engineering/building-effective-agents
[^anthropic-multiagent]: Anthropic, *How we built our multi-agent research system* — https://www.anthropic.com/engineering/multi-agent-research-system
[^openai-swarm]: OpenAI, *Swarm* (reference design) — https://github.com/openai/swarm
[^openai-cookbook]: OpenAI, *Orchestrating Agents: Routines and Handoffs* — https://developers.openai.com/cookbook/examples/orchestrating_agents
[^langgraph]: LangChain, *LangGraph* — https://www.langchain.com/langgraph
[^langgraph-overview]: LangChain Docs, *LangGraph overview* — https://docs.langchain.com/oss/python/langgraph/overview
[^a2a-spec]: A2A Protocol Specification — https://a2a-protocol.org/latest/specification/
[^a2a-google]: Google Cloud, *Agent2Agent protocol is getting an upgrade* — https://cloud.google.com/blog/products/ai-machine-learning/agent2agent-protocol-is-getting-an-upgrade
[^claude-subagents]: Anthropic, *Create custom subagents (Claude Code)* — https://code.claude.com/docs/en/sub-agents
[^agentic-patterns]: Agentic Patterns, *Sub-Agent Spawning* — https://www.agentic-patterns.com/patterns/sub-agent-spawning/
