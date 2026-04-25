---
title: "Existing Agent Harnesses, Surveyed for QIAP"
date: 2026-04-25
audience: ssenrah harness authors
focus: "Quickest Iteration As Possible — minimize wall-clock per loop step"
status: research
---

# Existing Agent Harnesses, Surveyed for QIAP

QIAP — quickest iteration as possible — measures how long the human waits between sending a prompt and seeing the next decision point. Token economy matters only as a proxy: more tokens means slower prefill, longer decode, and more cache invalidations. This survey grades twelve harness designs against that single axis and extracts what ssenrah should adopt or skip.

## The harnesses

### 1. Aider

**Architecture.** A single-process Python REPL wrapped around a "repo map" (a tree-sitter-derived compact summary of symbols across the codebase) plus a chat history. Every turn the LLM is asked to emit either whole files or a custom diff/udiff format; Aider parses, applies, runs tests, and auto-commits via git. Tools are not function calls — they are textual edit blocks the model is trained to emit.[^aider-faq]

**Token efficiency.** Strong by design. The repo map is the only mandatory background context; the user explicitly `/add`s files. There is no built-in prompt-cache hint layer in the cross-provider abstraction, and edits return as text rather than as compactable tool results.

**Latency.** Felt-fast because the prompt stays small. There is no parallel tool-calling layer because there are no first-class tools — every action goes through the diff parser, which is sequential.

**Steal:** the discipline of "only the files explicitly in scope plus a tight repo map." **Avoid:** routing all action through one giant edit-blob response — it wastes the parallel-tool-call slot the modern Anthropic API gives you for free.

### 2. OpenHands (formerly OpenDevin)

**Architecture.** Event-stream loop: `Agent → Action → Environment → Observation → Agent`. The default `CodeActAgent` runs inside a Docker sandbox with a Jupyter kernel, an SSH session, and a BrowserGym browser. Each agent has its own LLM session and event log.[^openhands-arxiv]

**Token efficiency.** Mediocre for QIAP. The sandboxed environment generates verbose observations (full Jupyter outputs, full browser DOM snippets) that get appended to history. Observation truncation exists but is conservative.

**Latency.** Container-bound. Cold sandbox spin-up plus per-step tool dispatch through a runtime client adds hundreds of ms before any LLM call. The OpenHands team's own data notes Claude finishes tasks "much more quickly" than open models, which says more about model choice than loop overhead.[^openhands-index]

**Steal:** the `Action / Observation` typing — clean event log makes replay debugging trivial. **Avoid:** mandatory containerization. For a single-developer harness, putting Docker on the hot path is a tax of seconds per session.

### 3. SmolAgents (Hugging Face)

**Architecture.** ~1000 lines of Python. The headline idea: instead of JSON tool calls, the model emits a Python code block; the harness `exec`s it in a restricted interpreter where tools are bound as functions.[^smolagents-blog]

**Token efficiency.** Excellent on the action-emission side — one `code` block can chain five operations that JSON tool-calling would split into five round trips. Excellent on context discipline because intermediate Python variables stay in the interpreter, not in the LLM transcript.

**Latency.** This is the big QIAP win nobody else replicates: the right answer to "minimize round trips" is sometimes "let one decode produce a multi-step program." However, because most current code-trained LLMs are post-trained on JSON tool calls, you trade a small accuracy hit for the round-trip savings.

**Steal:** the principle that *one tool call returning structured data the model can chain in-process* beats *N tool calls each requiring a new prefill*. Even within JSON tool-calling, design tools that compose (e.g. `read_files(paths[])` not five `read_file`s). **Avoid:** the full code-as-action path until ssenrah has its own evals — it requires sandboxing and complicates the loop.

### 4. Plandex

**Architecture.** Terminal client + Go server. The defining feature is "smart context": for each step, only the one or two files actually being edited are loaded into the prompt, while a tree-sitter project map provides the rest. State (plan, diff sandbox, branches) lives server-side.[^plandex-context]

**Token efficiency.** Among the best surveyed for code agents. Files are loaded just-in-time per step, not pre-loaded once and dragged through every turn.

**Latency.** Each step pays a context-selection cost (deciding which files to load) before the LLM call. Net: marginally slower per step than a thin loop, much faster than a fat one once a session runs long.

**Steal:** load-on-demand file context rather than dump-and-pray. **Avoid:** the server/client split — for a single-user harness, the server is just round-trip overhead.

### 5. Claude Code (the system, not the SDK)

**Architecture.** A single-threaded master loop (internally `nO`) calling the Anthropic API, executing tools, feeding results back. Real-time steering through the `h2A` async-message queue lets user input interleave between turns. Sub-agents are spawned via the `Agent` / `Task` tool with depth limits to prevent recursive blow-up.[^claude-code-loop][^promptlayer]

**Token efficiency.** This is the gold standard:
- System prompt, tool definitions, and `CLAUDE.md` are auto-prompt-cached.[^claude-code-loop]
- Read-only tools (`Read`, `Glob`, `Grep`, read-only MCP) execute concurrently in one turn; state-mutating tools (`Edit`, `Write`, `Bash`) serialize.[^claude-code-loop]
- Automatic compaction kicks in near the context limit, summarizing older turns and emitting a `compact_boundary` system message.[^claude-code-loop]
- `ToolSearch` exists specifically to keep tool definitions out of the request when not needed.

**Latency.** Streams the assistant message immediately so users see text before tool calls execute. Parallel read-only tool execution collapses what would be N turns into one. The `effort` knob (`low | medium | high | xhigh | max`) lets the caller dial reasoning depth — `low` is the QIAP setting for trivial steps.[^claude-code-loop]

**Steal:** essentially the entire shape — single loop, prompt caching, parallel read-only tools, on-demand tool loading, automatic compaction, an `effort` dial. This is the reference design for ssenrah. **Avoid:** building a sandboxed permission layer before having a working loop; it is a multi-week distraction.

### 6. Cursor Composer 2 / Cursor 3

**Architecture.** Closed-source. Composer 2 is Cursor's own "frontier model trained for low-latency agentic coding," advertised at 4x speed of similarly-intelligent competitors and "most turns under 30 seconds."[^cursor-composer] Cursor 3 (April 2026) added the Agents Window for parallel agents.[^cursor-3]

**Token efficiency.** Unverifiable from outside but they invest heavily in semantic codebase search to limit context per turn. Self-hosted "cloud agents" keep tool execution local.

**Latency.** The "4x faster" claim is model-level — not directly transferable. The architectural lesson: aggressive parallelism at the agent-spawn level (multiple agents on different tasks) rather than within one loop.

**Steal:** invest in a fast semantic-search tool early; it pays back every turn. **Avoid:** their parallel-agents UX as a first goal — it is a product feature, not a latency primitive.

### 7. Cline / Roo Code

**Architecture.** VS Code extensions. Both grew up emitting tool calls as XML blocks parsed from the assistant's text (`<read_file><path>...</path></read_file>`), then evolved toward native function-calling. Roo Code has now made native tool calling the only supported path; Cline is migrating.[^roo-protocol]

**Token efficiency.** XML mode is poor: the model has to emit verbose tags inside text and the harness has to re-parse. Roo's native mode is fine. Both ship many built-in tools and append tool results verbatim, which inflates context fast.

**Latency.** XML parsing is the visible failure mode — known parser bugs cause loops where the model emits content that *looks* like a nested tool call and the harness mishandles it.[^roo-issue]

**Steal:** the lesson that XML-as-protocol was a workaround for models without function calling; modern Anthropic, OpenAI, and Gemini all support native tools, so just use them. **Avoid:** XML tool dispatch entirely. It is technical debt the moment you ship.

### 8. Anthropic Claude Agent SDK

**Architecture.** A library exposing exactly the loop described in §5, packaged in Python and TypeScript. You get `query()` (yields a stream of `SystemMessage | AssistantMessage | UserMessage | StreamEvent | ResultMessage`), 10+ built-in tools, MCP server connections, lifecycle hooks (`PreToolUse`, `PostToolUse`, `Stop`, `PreCompact`, `SubagentStart`/`Stop`), and a subagent system that gives each subagent a fresh context.[^claude-code-loop]

**Token efficiency.** Inherits all the Claude Code optimizations: caching, parallel read-only tools, `ToolSearch`, automatic compaction.

**Latency.** Adds essentially zero overhead over a hand-rolled loop because the SDK *is* a thin loop. The cost is the dependency surface and the opinionated tool set.

**Steal:** the message-type taxonomy — it is the cleanest event stream of any harness surveyed. ssenrah should mirror `AssistantMessage / UserMessage / ResultMessage` shapes even if not using the SDK. **Avoid:** depending on it if the goal is to *learn* harness internals; once the wrapper is doing the work, the user does not see the mechanics.

### 9. LangGraph

**Architecture.** A graph framework: nodes are functions (often LLM calls), edges are conditional transitions, state is a typed dict updated incrementally. You hand-author the graph; the runtime executes nodes and persists checkpoints.[^langgraph]

**Token efficiency.** Neutral — depends entirely on what nodes do. The state-delta pattern (passing diffs between nodes) is cheaper than full-history passing, but most LLM nodes still send the full message list.

**Latency.** The framework itself is "minimal overhead" per its own benchmarks, but real reports show 15-18s for queries that hit a direct loop in 7-9s, attributable to checkpoint persistence (10-50ms in-memory, up to 500ms cloud) and serialization across nodes.[^langgraph-latency]

**Steal:** the *concept* of a typed shared state. **Avoid:** the framework for QIAP. A graph runtime is for workflows you have already debugged enough to draw. ssenrah's stage 1 is a single node.

### 10. crewAI / AutoGen

**Architecture.** Both are multi-agent-first: you declare roles ("Researcher," "Writer," "Critic"), give each a persona prompt and tools, and the framework runs a turn-taking conversation between them.[^crewai]

**Token efficiency.** Poor. Every agent turn is a full LLM call with the entire group-chat history, so a 4-agent debate over 5 rounds is at minimum 20 calls each carrying the whole transcript. AutoGen benchmarks show ~24% token overhead and ~2.1s per step on 10-step tasks; crewAI is faster (200-400ms steps in simple cases) but still N× a single agent.[^crewai]

**Latency.** Categorically wrong for QIAP. Multi-agent only earns its overhead when subtasks are genuinely independent and parallelizable.

**Steal:** the role-prompt pattern as a way to specialize subagents *that ssenrah spawns explicitly when needed*, not as a default loop shape. **Avoid:** group-chat orchestration. Anthropic's own guidance: "most applications don't need multi-agent systems."[^anthropic-effective]

### 11. Tiny-agents (Hugging Face)

**Architecture.** ~30-line `while` loop over an MCP client. The agent calls the LLM, parses tool calls, dispatches to MCP servers, appends results, loops. Termination conditions: an exit-tool was called, two consecutive non-tool messages, or `MAX_NUM_TURNS` reached.[^tiny-agents]

**Token efficiency.** Whatever the underlying client gives you — no caching layer of its own. Acceptable for a reference impl.

**Latency.** The thinnest loop publicly documented. Every line you add to ssenrah's loop should justify itself against this baseline.

**Steal:** the loop shape verbatim. The exit conditions are well-considered. **Avoid:** thinking the loop is enough — tiny-agents has zero context management, zero parallel tools, zero caching. It is a starting line, not a finish.

### 12. Anthropic "Building Effective Agents"

**Not a harness — a manifesto.** The thesis: "Agents are LLMs autonomously using tools in a loop." The most successful production systems "weren't using complex frameworks or specialized libraries. Instead, they were building with simple, composable patterns." Workflows (predefined code paths) and agents (LLM-directed paths) are different problems; pick the simpler one.[^anthropic-effective]

**Steal:** the entire epistemic stance. Start with the simplest loop. Add only patterns whose value you can measure (routing, parallelization, evaluator-optimizer) once the loop is the bottleneck.

## Synthesis: the leanest viable QIAP loop

The empirical leaders for wall-clock latency per step share four properties:

1. **One thin loop.** No graph runtime, no group chat. Just `while (assistant has tool calls) { run tools; append results; call model }`. Tiny-agents, Claude Code's `nO`, and the Agent SDK all share this shape.
2. **Aggressive prompt caching.** Mark system prompt, tool definitions, and any project context (`CLAUDE.md` equivalent) with `cache_control: ephemeral`. Cache reads are 0.1× input price; on Claude Opus 4.7 that is 90% off prefill cost, which is *also* prefill latency.[^prompt-caching]
3. **Parallel read-only tools.** When the model emits multiple tool_use blocks, fire read-only ones with `Promise.all`. One round trip instead of N is the single biggest QIAP lever after caching.[^claude-code-loop]
4. **Tool-result elision.** Old, large tool outputs are dead weight. Replace observations from earlier turns with a stub (`[tool_result_id=foo elided, 4231 tokens]`) once the model has moved on. This is what Claude Code's auto-compaction does at the macro scale; you can do it at the micro scale every turn.

### A ~30-line minimal loop

```typescript
import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic();

type Tool = { name: string; readOnly: boolean; run: (input: any) => Promise<string> };

export async function qiapLoop(opts: {
  system: string; tools: Tool[]; tool_defs: Anthropic.Tool[]; user: string; maxTurns?: number;
}) {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: opts.user }];
  const toolMap = new Map(opts.tools.map(t => [t.name, t]));

  for (let turn = 0; turn < (opts.maxTurns ?? 25); turn++) {
    const res = await client.messages.create({
      model: "claude-opus-4-7", max_tokens: 4096,
      system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
      tools: opts.tool_defs.map((t, i) =>                                    // cache last tool def
        i === opts.tool_defs.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t),
      messages,
    });
    messages.push({ role: "assistant", content: res.content });
    const calls = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (calls.length === 0) return res;                                       // model finished

    const results = await Promise.all(calls.map(async c => {                  // parallel read-only
      const tool = toolMap.get(c.name)!;
      const out = tool.readOnly ? await tool.run(c.input) : null;             // serialize writes
      return { id: c.tool_use_id, name: c.name, out };
    }));
    for (const r of results) if (r.out === null) r.out = await toolMap.get(r.name)!.run(calls.find(c => c.tool_use_id === r.id)!.input);

    elideOldToolResults(messages);                                            // keep prefill small
    messages.push({ role: "user", content: results.map(r => ({ type: "tool_result", tool_use_id: r.id, content: r.out })) });
  }
}

function elideOldToolResults(msgs: Anthropic.MessageParam[]) {                // stub all but last 2
  const toolMsgs = msgs.filter(m => m.role === "user" && Array.isArray(m.content) && m.content.some((c: any) => c.type === "tool_result"));
  for (const m of toolMsgs.slice(0, -2)) for (const c of m.content as any[]) if (c.type === "tool_result" && typeof c.content === "string" && c.content.length > 200) c.content = `[elided ${c.content.length} bytes]`;
}
```

That is the QIAP target. Every additional concept ssenrah considers — subagents, hooks, plan mode, MCP — should be measured against the latency floor this loop establishes. If a feature adds 200 ms per step and the user runs 30 steps, that is 6 seconds of waiting. Earn each addition.

## Citations

[^aider-faq]: [Aider FAQ — aider.chat](https://aider.chat/docs/faq.html)
[^openhands-arxiv]: [OpenHands: An Open Platform for AI Software Developers as Generalist Agents — arXiv:2407.16741](https://arxiv.org/abs/2407.16741)
[^openhands-index]: [Introducing the OpenHands Index — Jan 28 2026](https://openhands.dev/blog/openhands-index)
[^smolagents-blog]: [Introducing smolagents — Hugging Face](https://huggingface.co/blog/smolagents)
[^plandex-context]: [Plandex — Context Management docs](https://docs.plandex.ai/core-concepts/context-management/)
[^claude-code-loop]: [How the agent loop works — Claude Agent SDK docs](https://code.claude.com/docs/en/agent-sdk/agent-loop)
[^promptlayer]: [Claude Code: Behind-the-scenes of the master agent loop — PromptLayer](https://blog.promptlayer.com/claude-code-behind-the-scenes-of-the-master-agent-loop/)
[^cursor-composer]: [Introducing Cursor 2.0 and Composer — cursor.com](https://cursor.com/blog/2-0)
[^cursor-3]: [Meet the new Cursor (Cursor 3) — cursor.com](https://cursor.com/blog/cursor-3)
[^roo-protocol]: [Native Tool Calling Protocol — RooCodeInc/Roo-Code DeepWiki](https://deepwiki.com/RooCodeInc/Roo-Code/6.2-tool-protocols-(native-and-xml))
[^roo-issue]: [Issue #4426: Improve tool call parser to handle nested tool tags — RooCodeInc/Roo-Code](https://github.com/RooCodeInc/Roo-Code/issues/4426)
[^langgraph]: [LangGraph — langchain.com](https://www.langchain.com/langgraph)
[^langgraph-latency]: [LangGraph in Production: Latency, Replay, and Scale — Aerospike](https://aerospike.com/blog/langgraph-production-latency-replay-scale)
[^crewai]: [CrewAI vs AutoGen comparison — Kanerika / Medium](https://medium.com/@kanerika/crewai-vs-autogen-a-complete-comparison-of-multi-agent-ai-frameworks-3d2cec907231)
[^anthropic-effective]: [Building Effective AI Agents — Anthropic](https://www.anthropic.com/research/building-effective-agents)
[^tiny-agents]: [Tiny Agents: an MCP-powered agent in 50 lines of code — Hugging Face](https://huggingface.co/blog/tiny-agents)
[^prompt-caching]: [Prompt caching — Claude API docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
