---
title: Token Efficiency and Latency Reduction for Agentic LLM Systems
subtitle: State of the art as of April 2026, oriented to QIAP (quickest iteration as possible)
date: 2026-04-25
audience: ssenrah harness designers
scope: Anthropic / OpenAI / DeepSeek as of April 2026
metric_focus: wall-clock time per agent turn (prefill + decode + RTT), not $ cost
---

# Token Efficiency and Latency Reduction for Agentic LLM Systems

> Token counts matter for **speed** in this harness, not cost. The asymmetry that drives every decision below: prefill is parallel and compute-bound (~hundreds of ms for 10k tokens on H100-class hardware), decode is serial and memory-bandwidth-bound (~30-150 tok/s depending on model). Cutting decoded tokens is roughly 10-30x more valuable per token than cutting prefill tokens, and cache-hit prefill is roughly an order of magnitude faster than cold prefill. Design accordingly.

## 1. Prompt caching

**Technique.** Hash a prefix of the request, keep the KV cache warm on the server, replay it on the next request that shares the same prefix. Anthropic exposes this explicitly via `cache_control: {"type": "ephemeral"}` on content blocks; OpenAI does it automatically on requests larger than the threshold; DeepSeek does it automatically on disk with prefix matching.

**Who.** Anthropic (explicit, up to 4 breakpoints per request, 5-minute default TTL, 1-hour beta TTL). OpenAI (automatic on prompts >=1024 tokens for GPT-4o family). DeepSeek (automatic, 64-token storage unit, persistent disk cache).

**Measured impact.**
- Anthropic cache reads cost 0.1x base input price (90% off) and have substantially better TTFT. Cache writes cost 1.25x base (5-min TTL) or 2.0x base (1-hour TTL). Source: Anthropic prompt caching docs.
- OpenAI: cache hits originally 50% off, now up to 90% off. TTFT drop from ~5s to ~200ms cited for a 30k-token prompt; independent eval reports 13-31% TTFT improvement across providers. Source: OpenAI cookbook + arxiv 2601.06007.
- DeepSeek: cache hits at 0.1 yuan / Mtok vs 1.0 yuan / Mtok miss (90% off). 64-token minimum cacheable unit. Source: api-docs.deepseek.com.

**Cache breakpoint pattern.** Order content from most-stable to most-volatile: `tools -> system -> early messages -> recent messages -> current user turn`. Place the cache breakpoint immediately after the last block you expect to reuse. Anthropic invalidates hierarchically: any change to `tools` blows the entire cache; changes to `system` blow system+messages; changes to messages only blow messages. So **do not embed timestamps or rotating IDs in tools/system**.

**Implementation hint for ssenrah.**
- Pin `tools` and `system` deterministically. Never inject "current time" or per-turn UUIDs above the breakpoint.
- Use the 1-hour TTL beta header (`extended-cache-ttl-2025-04-11`) for any agent loop that may pause for human review or long tool execution. The 1.25x->2.0x write premium is irrelevant for QIAP (we want speed, and the hit is ~10x faster prefill).
- For multi-turn loops, use Anthropic's automatic top-level `cache_control` so the breakpoint advances forward each turn without manual breakpoint shuffling.
- Watch `cache_creation_input_tokens` and `cache_read_input_tokens` in `usage`; if both are 0 on a long prompt, you are below the per-model minimum (Sonnet 4.6: 2048 tok; Opus 4.7 / Haiku 4.5: 4096 tok) and should expand the cached prefix to cross it.

## 2. Context compression / elision

**Technique.** Strip stale tool results from the conversation while keeping the structural skeleton (the tool_use/tool_result chain) so the model still sees what was attempted and what answer pattern emerged, but not the full payload.

**Who and what.**
- Anthropic ships **two** server-side primitives:
  - `clear_tool_uses_20250919` (context editing): drops oldest tool results past a token threshold, replaces them with a placeholder so Claude knows they were elided. Optional `clear_tool_inputs: true` also drops the tool call args. Beta header `context-management-2025-06-27`.
  - `compact_20260112` (compaction, GA-track): when input tokens exceed a configurable threshold (default 150k, min 50k), the API generates a summary, wraps it in a `compaction` block in the response, and continues. You must echo the compaction block back on the next request. Beta header `compact-2026-01-12`. Supported on Opus 4.6/4.7, Sonnet 4.6, Mythos preview. Anthropic recommends this over client-side compaction for most cases.
- Claude Code: the `/compact` command does an explicit summarize-and-restart. Community guidance is to compact at ~60% utilization, before quality degrades.
- OpenHands / deepagents / Cursor 2.x: filesystem-as-context patterns - write big payloads to disk, keep only file paths and short summaries in the message history.

**Measured impact.** No clean public number for QIAP, but the math is mechanical: every 10k input tokens you elide saves ~200-400ms of cold prefill on H100-class hardware (HuggingFace blog, NVIDIA NIM benchmarking docs). On cache hits the savings are smaller but still real because cache reads are not free. Anthropic's own engineering post on advanced tool use claims "37% token reduction on complex tasks" for programmatic tool calling, which keeps tool I/O out of the model's context entirely (see also section 4).

**Files-as-context vs in-context.** Files-as-context (Claude Code, Cursor, OpenHands) wins for QIAP whenever a tool result is large and only needed briefly. Pattern: tool returns a path, model later asks for `read(path, line_range)` if it needs it. Anthropic's effective-context-engineering writeup pushes the same "just-in-time retrieval" principle.

**Implementation hint for ssenrah.**
- Default to `compact_20260112` for any agent expected to run >50k input tokens. Set `pause_after_compaction: false` so the loop never blocks.
- Layer `clear_tool_uses_20250919` on top with a low threshold (e.g., 30k) for tool-heavy loops where most context is stale grep/read output.
- For tools that return >2KB, write to a workspace file and return only the path + a one-line head; let the model `read()` only if it asks. This is what Claude Code does.
- **Do not paraphrase the conversation manually.** It breaks the cache. Use the API-native compaction blocks so the prefix up to the compaction is still cacheable.

## 3. Structured outputs

**Technique.** Constrained decoding: at each decode step, mask logits to only the tokens permitted by a precompiled grammar (FSM/CFG) derived from the JSON schema.

**Who.** OpenAI Structured Outputs (`response_format: json_schema, strict: true`), Anthropic Structured Outputs (now GA via `output_config.format`, also `strict: true` on tool definitions), vLLM/SGLang/XGrammar/llguidance for self-hosted.

**Latency impact.**
- First request with a new schema: 100-300ms grammar compile (Anthropic explicitly documents this; cached for 24h thereafter).
- Steady-state per-token overhead: ~10-30% in naive implementations, ~near-zero in modern engines (XGrammar, llguidance, vLLM v1, SGLang's compressed FSM with multi-token decoding for up to 2x speedup on JSON workloads). Anthropic's grammar runs server-side and is cached.
- Net effect in practice is often **faster** wall time because the model emits no chitchat, stops at JSON close brace, and you skip retry-on-parse-error loops.

**Anthropic vs OpenAI tool-call API differences (relevant for QIAP).**
- Anthropic's tools API is "free-form" by default - tool_use blocks are not strict-validated unless you opt in with `strict: true`. The schema is enforced post-hoc on input parsing, not by constrained decoding, unless strict is set.
- OpenAI's function calling has had `strict: true` constrained decoding for longer and is the default mental model for most frameworks.
- Practical implication: with Anthropic, you can ship looser tool descriptions and let the model write whatever it wants in the input JSON. With strict, you pay the grammar compile once and lose some flexibility but gain predictability.

**When to skip structured outputs (QIAP take).**
- Skip for the **agent's planning text** - free decode is fastest.
- Use strict tool schemas only for tools where parse failure is catastrophic (file edits, shell). For read-only tools (grep, ls), looseness is fine.
- Skip JSON mode entirely on the final user-facing message; let the model speak prose.

**Implementation hint.** `strict: true` on `Edit`, `Write`, `Bash`-equivalent tools; loose on read tools. One schema set, kept stable across the run, so the grammar cache stays warm.

## 4. Parallel tool calls

**Technique.** Emit multiple `tool_use` blocks in a single assistant turn; the harness fans them out, awaits all, returns N `tool_result` blocks in a single user turn. One round-trip instead of N.

**Who.** Anthropic and OpenAI both support multi-block tool_use. Anthropic exposes `tool_choice.disable_parallel_tool_use: true` if you need to force serial (rarely useful for QIAP). Cursor, OpenHands, Claude Code all aggressively prompt for parallelism.

**Measured impact.** Each parallel tool call you collapse saves one full agent round-trip: prefill of (system + history + new tool result) + decode of next assistant turn. For a 50k-token cached context that is conservatively 1-3 seconds saved per collapsed round-trip. Cursor reports parallel tool use moving response times "from minutes to seconds" on multi-file reads.

**Best practices to encourage parallelism.**
- Prompt the model explicitly: "If actions are independent, call tools in parallel in a single response." Cursor and Claude Code system prompts do this verbatim.
- Tool descriptions should state idempotency / read-only-ness; models are more willing to parallelize tools they recognize as side-effect-free.
- Do not parallelize tools whose inputs depend on prior outputs (the model usually figures this out, but explicitly say so).
- Watch out for the March 2026 regression: there have been reports that Opus 4.6/Sonnet 4.6 sometimes emit only one tool_use per response despite `tool_choice: auto` (anthropic-sdk-typescript issue #956). Test your loop; if you observe it, the workaround is to keep tool counts modest and prompt aggressively.

**Implementation hint for ssenrah.**
- Run the harness's tool dispatch as `Promise.all` (or equivalent) over all tool_use blocks in an assistant turn. Time-box each tool with its own timeout; do not let one slow tool hold up the rest of the batch beyond a deadline.
- Consider Anthropic's **programmatic tool calling** beta: tools execute inside a server-side code-exec sandbox, intermediate results never enter the model's context. Reported 37% token reduction on complex tasks, with parallel `await asyncio.gather`-style fan-out built in.

## 5. Streaming + early exit

**Technique.** Server-sent events stream the assistant message token-by-token. The harness can (a) parse partial JSON to start tool prep before generation finishes, (b) detect a stop-trigger and cancel the decode, (c) speculatively dispatch tools whose call is "obvious" before the model has finished emitting it.

**Who.** Anthropic and OpenAI both expose SSE streaming with `content_block_start` / `content_block_delta` / `content_block_stop` (Anthropic) and `chunk.choices[0].delta` (OpenAI). Mastra, Microsoft Agent Framework, mini_agent and others have partial-JSON-parse streaming tool calls. Recent academic work: **PASTE** (Pattern-Aware Speculative Tool Execution, arxiv 2603.18897) and **B-PASTE** (beam-aware extension, arxiv 2604.16469) show measurable wall-time wins by speculatively dispatching tool calls before the model commits.

**Measured impact.** Partial-JSON parsing alone saves the decode time of the JSON suffix; for a typical `Edit` call with a 1000-token diff, that's seconds at decode rates of 30-150 tok/s. Speculative tool execution wins more for slow tools (network, compile) where the speculation hides behind tool latency.

**Implementation hint for ssenrah.**
- Always stream. Never use the non-streaming endpoint for an agent loop.
- Run a partial-JSON parser on `input_json_delta` events. As soon as a tool's required args are observed, kick off speculative dispatch behind a feature flag (rollback if the model later cancels the tool_use). For pure-read tools this is always safe.
- Implement **early cancel** on the client side: if the assistant emits a clear "done" signal (e.g., a `final_answer` tool, or a stop sentinel), stop reading the stream and start the next turn.
- Anthropic streams a single `content_block_delta` for compaction blocks (no intermediate streaming during compaction); design your loop to tolerate the brief gap.

## 6. Model choice for latency

**Technique.** Pick the smallest model that meets the quality bar for the current step. Use big models for planning, small models for routine tool dispatch.

**Numbers (April 2026, from public benchmarks - tech-insider.org, dextralabs, morphllm, sitepoint).**
- **Haiku 4.5**: ~80-150 tok/s decode, ~1s TTFT. ~3x faster than Opus.
- **Sonnet 4.6**: ~40-60 tok/s decode. Noticeably faster than Opus 4.6 across all task types.
- **Opus 4.6**: ~45 tok/s decode, ~12s TTFT on long contexts.
- **Opus 4.7**: same pricing as 4.6 ($5/$25 per Mtok), step-change in agentic coding, throughput numbers not yet cleanly published. Same feature set as 4.6 incl. 1M context, 128k output, adaptive thinking.

Treat published tok/s numbers as approximate; the order is what matters.

**Reasoning vs non-reasoning.**
- Adaptive thinking (Anthropic) ships effort levels `low / medium / high / max`. Default in Claude Code was downgraded high->medium on March 4 2026 specifically to fix UI latency issues.
- Extended thinking adds wall time roughly equal to the thinking-token decode time. **Skip thinking for routine tool dispatch** (file reads, greps, simple edits). Enable only for plan generation or hard reasoning steps.
- Anthropic explicitly documents: "Extended thinking adds latency and should only be used when it will meaningfully improve answer quality - typically for problems that require multi-step reasoning."
- **Watch the thinking-tokens trap**: thinking tokens count against `max_tokens` and against billing; a model can burn its budget thinking and emit no answer.

**"Fast mode" / draft modes.** Anthropic exposes a `speed` parameter on some endpoints (see the prompt-caching invalidation table - changing speed setting blows the system+messages cache). It is a knob worth setting up-front and never changing within a run.

**Implementation hint for ssenrah.**
- Default tool-loop driver: **Haiku 4.5** for routine steps, **Sonnet 4.6** for everything else, **Opus 4.7** only when explicitly requested or for the planning/repair head.
- Disable extended thinking by default in the tool-loop. Enable only on a separate "planner" call that runs once per task.
- Pick a `speed` setting at session start and never mutate it.

## 7. Context window math

**Wall-time decomposition for a typical agent turn (50k input cached, 2k output, Sonnet 4.6 class):**

| Stage              | Cold (no cache)       | Warm (cache hit)       |
|--------------------|-----------------------|------------------------|
| RTT + queue        | 50-200 ms             | 50-200 ms              |
| Prefill (50k tok)  | ~1.0-2.0 s            | ~0.1-0.3 s             |
| TTFT total         | ~1.5 s                | ~0.3 s                 |
| Decode (2k tok)    | ~33 s @ 60 tok/s      | ~33 s @ 60 tok/s       |
| **Total**          | **~35 s**             | **~34 s**              |

The headline result, repeated across Databricks, NVIDIA NIM, HuggingFace, and morphllm benchmarking writeups: **for a typical coding-agent turn, decode dominates wall time**. Prefill is parallel and on H100-class hardware processes a 10k-token prompt in 200-400ms; decode is serial and runs at 30-150 tok/s. Caching slashes prefill but does nothing for decode.

**Concrete implications for QIAP.**
1. **Cutting output tokens is the highest-leverage lever.** A tool call that returns "OK" instead of a 500-token explanation saves ~8 seconds at 60 tok/s. Tell the model to be terse on confirmations.
2. **Cutting input tokens helps cold prefill, barely helps warm prefill.** Caching first, elision second.
3. **Round-trip count matters more than per-turn input size.** Each round-trip is one decode of an assistant message - typically 1-5 seconds at minimum. Parallel tool calls that collapse 4 round-trips into 1 save 3-15 seconds outright.
4. **The asymmetry**: prefill at 10k+ tok/s vs decode at 60 tok/s = ~166x. So one decoded token costs roughly 166 prefilled tokens of wall time. Optimize aggressively against decoded text.

(See arxiv 2601.06007 "Don't Break the Cache" for an empirical evaluation of prompt caching across long-horizon agent tasks; Databricks LLM Inference Performance Engineering for prefill/decode breakdown; HuggingFace tngtech blog for concurrent-request prefill/decode dynamics.)

## 8. Skills / tool search

**Technique.** Don't load the full tool registry into the system prompt. Instead, expose a small "tool search" tool plus your handful of always-needed tools; defer everything else with `defer_loading: true`. The model issues a search query (regex via `tool_search_tool_regex_20251119` or BM25 via `tool_search_tool_bm25_20251119`), the API returns 3-5 `tool_reference` blocks, and the matched tool definitions get spliced inline into the conversation.

**Who.** Anthropic ships this as an API primitive (Claude Mythos preview, Sonnet 4.0+, Opus 4.0+, Haiku 4.5+; up to 10,000 tools per catalog). Claude Code uses the same pattern via Skills and ToolSearch (you've seen it - this very session is using it). MCP integrates via `mcp_toolset` with `defer_loading`.

**Measured impact (Anthropic's own numbers, engineering blog).**
- Token overhead reduction: **~85%** less context spent on tool definitions. A 5-server MCP stack drops from ~55k tokens to ~3k tokens.
- Tool selection accuracy on Opus 4: 49% -> 74%. On Opus 4.5: 79.5% -> 88.1%. Big tool catalogs degrade selection accuracy past 30-50 tools; deferred loading recovers it.
- **Crucially: deferred tools are not in the system-prompt prefix, so prompt caching is preserved.** Discovered tools are appended inline in the conversation, not the prefix.

**Implementation hint for ssenrah.**
- Keep your 3-5 most-used tools (Bash, Read, Edit, Grep, Write for a coding harness) as non-deferred. Defer everything else.
- Pick the **regex** variant if your tool names follow a prefix convention (`github_*`, `slack_*`); pick **BM25** if descriptions are paragraph-style.
- Add a one-line system-prompt section listing tool *categories* ("git, github, fs, web, planning") so the model knows what's discoverable.
- Discovered tools persist across turns - the API auto-expands `tool_reference` blocks throughout history. So a tool found in turn 3 is still available in turn 30 without re-search.

---

## QIAP playbook: the highest-leverage levers in priority order

1. **Cache aggressively, never break the prefix.** Pin tools+system, use the 1-hour TTL beta, structure messages so the cache breakpoint moves forward automatically. Target >80% cache-read on input tokens. (Cuts prefill ~10x, gives near-instant TTFT.)
2. **Force parallel tool calls and stream everything.** Each collapsed round-trip is 1-5+ seconds saved. Partial-JSON-parse tool args; speculatively dispatch read-only tools. (Removes whole agent turns from the wall clock.)
3. **Default to Haiku 4.5 for the tool loop, no extended thinking.** Reserve Sonnet 4.6 / Opus 4.7 + thinking for the planner head. Decode dominates wall time; smaller fast models are 2-3x faster decode. (Direct multiplier on every output token.)

Then: tool search to keep the prefix small, server-side compaction at 150k input tokens, terse tool outputs (paths > payloads), strict schemas only on dangerous tools.

## Citations

- Anthropic, Prompt caching docs (platform.claude.com/docs/en/build-with-claude/prompt-caching) - cache_control, breakpoints, TTLs, cost multipliers, minimum cacheable lengths, invalidation hierarchy.
- Anthropic, Compaction docs (platform.claude.com/docs/en/build-with-claude/compaction) - `compact_20260112`, beta header `compact-2026-01-12`, default 150k threshold, response format.
- Anthropic, Context editing docs (platform.claude.com/docs/en/build-with-claude/context-editing) - `clear_tool_uses_20250919`, beta header `context-management-2025-06-27`, `clear_tool_inputs`.
- Anthropic, Tool search tool docs (platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool) - `defer_loading`, regex vs BM25 variants, 85% token reduction, 3-5 results per search, 10k tool max.
- Anthropic engineering, "Introducing advanced tool use on the Claude Developer Platform" (anthropic.com/engineering/advanced-tool-use) - 37% token reduction with programmatic tool calling, accuracy gains 49%->74% (Opus 4) and 79.5%->88.1% (Opus 4.5).
- Anthropic, Structured outputs docs (platform.claude.com/docs/en/build-with-claude/structured-outputs) - `output_config.format`, 24-hour grammar cache, 100-300ms first-call compile, strict tool use.
- Anthropic, Adaptive thinking docs (platform.claude.com/docs/en/build-with-claude/adaptive-thinking) - effort levels, latency tradeoff.
- Anthropic, "April 23 postmortem" (anthropic.com/engineering/april-23-postmortem) and VentureBeat coverage - documented harness/reasoning latency issues in early 2026.
- OpenAI, Prompt caching guide (developers.openai.com/api/docs/guides/prompt-caching) and OpenAI cookbook "Prompt Caching 201" - automatic, >=1024 tokens, 50%-90% discount, up to 80% TTFT reduction cited.
- OpenAI, Structured outputs (openai.com/index/introducing-structured-outputs-in-the-api/, developers.openai.com/api/docs/guides/structured-outputs) - `strict: true`, `response_format: json_schema`.
- DeepSeek, Context caching docs (api-docs.deepseek.com/guides/kv_cache) - 0.1 yuan/Mtok cache hit vs 1.0 yuan/Mtok miss, 64-token storage unit, prefix matching only.
- arxiv 2601.06007, "Don't Break the Cache: An Evaluation of Prompt Caching for Long-Horizon Agentic Tasks" - 13-31% TTFT improvement across providers in independent benchmarking.
- arxiv 2603.18897, "Act While Thinking: Pattern-Aware Speculative Tool Execution (PASTE)" and arxiv 2604.16469 "B-PASTE" - speculative tool execution wall-time wins.
- arxiv 2512.15834, "Optimizing Agentic Language Model Inference via Speculative Tool Calls".
- HuggingFace blog (huggingface.co/blog/tngtech/llm-performance-prefill-decode-concurrent-requests) - prefill/decode dynamics, ~200-400ms prefill for 10k tokens on H100.
- Databricks, "LLM Inference Performance Engineering: Best Practices" - prefill compute-bound, decode memory-bandwidth-bound, role of KV cache.
- NVIDIA NIM Benchmarking docs and Anyscale "Understand LLM latency and throughput metrics" - definitions and measurement methodology.
- morphllm.com, "Tokens Per Second: LLM Speed Benchmark Guide (2026)" and "LLM Inference: Prefill, Decode, KV Cache & Cost Guide (2026)" - 2026-current decode rates by model.
- tech-insider.org, dextralabs.com, sitepoint.com Claude model comparisons (April 2026) - Haiku 4.5 ~80-150 tok/s, Sonnet 4.6 ~40-60 tok/s, Opus 4.6 ~45 tok/s, ~12s TTFT on Opus.
- Cursor, "Best practices for coding with agents" (cursor.com/blog/agent-best-practices) and "Tool Calling" learn page - parallel tool call guidance.
- OpenHands docs and "OpenHands Index" Jan 28 2026 announcement - large-codebase parallel agent execution.
- Mastra docs (mastra.ai/docs/streaming/tool-streaming) and Microsoft Agent Framework docs - partial-JSON streaming tool args.
- vLLM / SGLang / XGrammar / llguidance documentation - constrained decoding overhead approaching zero in 2025-2026.
- Anthropic SDK TypeScript issue #956 (March 2026) - parallel tool call regression on Opus 4.6 / Sonnet 4.6 in some configurations.
