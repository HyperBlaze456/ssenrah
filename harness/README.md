# ssenrah — Agent Harness

A provider-agnostic runtime for building, governing, and orchestrating LLM agents that use tools.

This document explains how the harness manages agent context, tool calling, and multi-agent coordination at the implementation level — not as abstract protocol descriptions, but as the concrete message-passing and lifecycle machinery that makes agents work.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [The Two Agent Types](#the-two-agent-types)
3. [Agent Context Management](#agent-context-management)
4. [Tool Calling Mechanics](#tool-calling-mechanics)
5. [Multi-Agent Coordination](#multi-agent-coordination)
6. [Governance Layer](#governance-layer)

---

## Architecture Overview

```
┌───────────────────────────────────────────────────────────────────────────┐
│                          Team.run(goal)                                   │
│                                                                           │
│  ┌────────────────────────┐    ┌────────────────────────────────────────┐ │
│  │   OrchestratorAgent    │    │          Infrastructure                │ │
│  │                        │    │                                        │ │
│  │  plan(goal)            │    │  TaskGraph ─── dependency DAG          │ │
│  │  verify(task)          │    │  TeamMailbox ── message passing        │ │
│  │  summarize(goal,tasks) │    │  TeamStateTracker ── runtime state     │ │
│  │                        │    │  RuntimePolicy ── phase FSM + caps     │ │
│  │  Uses LLMProvider      │    │  TeamEventBus ── structured events     │ │
│  │  (no tools, text only) │    │  ReconcileLoop ── failure recovery     │ │
│  └──────────┬─────────────┘    │  McpRuntime ── external tool servers   │ │
│             │                  └────────────────────────────────────────┘ │
│             │ spawns                                                      │
│             ▼                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │  WorkerAgent pool  (1..maxWorkers concurrent)                        │ │
│  │                                                                      │ │
│  │  Each WorkerAgent wraps an Agent instance:                           │ │
│  │  ┌─────────────────────────────────────────────────────────────┐     │ │
│  │  │  Agent (the core agentic loop)                              │     │ │
│  │  │                                                             │     │ │
│  │  │  LLMProvider ──► chat/chatStream                            │     │ │
│  │  │  ToolDefinition[] ──► name, schema, run()                   │     │ │
│  │  │  PolicyEngine ──► per-call governance                       │     │ │
│  │  │  Beholder ──► rate/loop/drift/budget monitoring             │     │ │
│  │  │  EventLogger ──► JSONL event trail                          │     │ │
│  │  │  Message[] history ──► the running conversation             │     │ │
│  │  └─────────────────────────────────────────────────────────────┘     │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────┘
```

**Key design principle:** The orchestrator is a *text-only planner* — it never uses tools. Workers are *tool-using executors* — they never plan the overall goal. The orchestrator owns task completion; workers only submit results.

---

## The Two Agent Types

### 1. OrchestratorAgent — The Planner

The orchestrator is a thin LLM wrapper with **no tool loop**. It makes single-shot `provider.chat()` calls and parses structured JSON from the response. It has three responsibilities:

**Plan** — Decompose a goal into a DAG of tasks:
```
provider.chat({
  systemPrompt: "You are an orchestrator. Return a JSON array of tasks...",
  messages: [{ role: "user", content: goal }],
})
→ parse JSON → validate → TeamTask[]
```

**Verify** — Check a worker's submitted result before marking it done:
```
provider.chat({
  messages: [{ role: "user", content: "Verify this result: ..." }],
})
→ parse { approved: boolean, reason: string }
```
If a "verifier" agent type is registered, spawns a dedicated verifier Agent instead of using inline verification.

**Summarize** — Synthesize all completed tasks into a final report:
```
provider.chat({
  messages: [{ role: "user", content: "Goal: ... Task results: ..." }],
})
→ text summary
```

**Lifecycle:**
```
                     plan(goal)
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
      TeamTask       TeamTask       TeamTask
      (pending)      (pending)      (pending)
          │              │              │
          └──────┬───────┘              │
                 │ (workers execute)    │
                 ▼                      ▼
          verify(task)           verify(task)
          ┌────┴────┐           ┌────┴────┐
        approved  rejected    approved  rejected
          │         │           │         │
        done    requeue       done     failed
                 (retry)
          └──────────┬──────────┘
                     ▼
              summarize(goal, tasks)
                     │
                     ▼
                 TeamResult
```

### 2. Agent (WorkerAgent wraps this) — The Executor

The Agent is the core agentic loop. It holds a conversation with an LLM and executes tools until the LLM stops requesting them.

**Lifecycle of a single `agent.run(userMessage)` call:**

```
       ┌─ userMessage pushed to history
       │
       ▼
  ┌──────────────────────────────────────────────────┐
  │  TURN LOOP  (while turns < maxTurns)             │
  │                                                  │
  │  1. Check AbortSignal                            │
  │                                                  │
  │  2. Send to LLM:                                 │
  │     provider.chat({                              │
  │       model, systemPrompt,                       │
  │       messages: [...history],                    │
  │       tools: [{ name, description, inputSchema   │
  │                }],                               │
  │       maxTokens, signal                          │
  │     })                                           │
  │           │                                      │
  │           ▼                                      │
  │  3. Parse ChatResponse:                          │
  │     - textBlocks[] → assistant text              │
  │     - toolCalls[] → requested tool invocations   │
  │     - stopReason → end_turn | tool_use |         │
  │                     max_tokens                   │
  │           │                                      │
  │           ▼                                      │
  │  4. Push assistant message to history:           │
  │     { role: "assistant",                         │
  │       content: [                                 │
  │         { type: "text", text: "..." },           │
  │         { type: "tool_use", id, name, input }    │
  │     ]}                                           │
  │           │                                      │
  │           ▼                                      │
  │  5. If no tool calls → BREAK (done)              │
  │     If max_tokens → return max_tokens status     │
  │           │                                      │
  │           ▼                                      │
  │  6. [Optional] Intent gate:                      │
  │     Parse <intent> tags from text                │
  │     Validate every toolCall has a matching intent │
  │     Block unmatched calls with error results     │
  │           │                                      │
  │           ▼                                      │
  │  7. For each toolCall:                           │
  │     a. Infer risk level (override → intent →     │
  │        heuristic)                                │
  │     b. PolicyEngine.evaluateToolCall()           │
  │        → allow / await_user / deny               │
  │     c. Beholder.evaluate() if attached           │
  │        → ok / warn / pause / kill                │
  │     d. Execute: tool.run(input) → string         │
  │     e. On error + fallbackAgent configured:      │
  │        FallbackAgent.handleFailure()             │
  │           │                                      │
  │           ▼                                      │
  │  8. Push tool results to history:                │
  │     { role: "user",                              │
  │       content: [                                 │
  │         { type: "tool_result",                   │
  │           toolUseId, content, isError }           │
  │     ]}                                           │
  │           │                                      │
  │           └───────── loop back to step 1         │
  └──────────────────────────────────────────────────┘
       │
       ▼
  TurnResult { status, response, toolsUsed, usage }
```

**Terminal states:** `completed` (LLM stopped calling tools), `max_turns` (safety cap), `max_tokens` (response truncated), `cancelled` (AbortSignal fired), `failed` (policy denied or Beholder killed), `await_user` (policy requires human approval).

---

## Agent Context Management

### System Prompt Assembly

The system prompt is built in layers, from static config through dynamic hooks:

```
1. Base system prompt          (AgentConfig.systemPrompt or default)
2. + Intent instructions       (if intentRequired: true)
3. + Hook modifications        (AgentRunHook[] run before each turn)
   └── Skill injection         (createMarkdownSkillHook appends skill prompt)
   └── Tool injection          (hooks can add/replace tools via mergeToolsByName)
   └── Model override          (hooks can swap model via settings.model)
```

Hooks receive `AgentRunHookContext` — a mutable view of `{ model, systemPrompt, tools }` — and can modify all three before the loop starts.

### Conversation History (the "context window")

The `Message[]` history array is the agent's memory. It uses the provider-agnostic `ChatMessage` format:

```typescript
type Message = {
  role: "user" | "assistant";
  content: string | ChatContentBlock[];
};
```

Content blocks are a discriminated union:

| type | Fields | Who produces it |
|------|--------|-----------------|
| `text` | `text` | LLM response |
| `tool_use` | `id`, `name`, `input` | LLM response |
| `tool_result` | `toolUseId`, `content`, `isError` | Harness (after executing tool) |
| `image` | `mimeType`, `base64Data` | User/tool (vision inputs) |

**History growth pattern per turn:**
```
[user: "do X"]                                          ← initial
[user: "do X"] [assistant: text + tool_use]             ← LLM responds
[user: "do X"] [assistant: text + tool_use] [user: tool_result]  ← harness appends results
... (loop continues, history grows linearly)
```

The full history is sent to the provider on every turn. There is no built-in compaction — the harness relies on the provider's context window. The `maxTurns` cap (default 20) is the primary guard against unbounded context growth.

### Long-Term Memory: Checkpoints

Checkpoints are JSON snapshots saved at the end of each `agent.run()` call:

```
~/.ssenrah/sessions/<sessionId>/checkpoints/<checkpointId>.json
```

```typescript
{
  schemaVersion: 1,
  checkpointId: "1709...-completed",
  phase: "completed",
  goal: "the original user message",
  summary: "truncated response (500 chars max)",
  policyProfile: "local-permissive",
  metadata: { status, reason, toolsUsed, usage }
}
```

Checkpoints enable session resumption — `loadCheckpointSafe()` can reload them for recovery flows. They record *what happened*, not the full conversation — the history itself is not persisted to disk (it lives in-memory for the duration of `agent.run()`).

### MCP Server Context

MCP servers inject tools into the agent's context dynamically at Team startup:

```
.ssenrah/mcp.servers.json → loadMcpHarnessConfig()
   → McpRuntime.start()
      → connect to each server process (stdio transport)
      → listTools() / listResources() / listPrompts()
      → filter through allowlists
      → wrap as ToolDefinition[] with namespaced names:
        "mcp.<server>.<capability>.<name>"
        e.g. "mcp.filesystem.tool.read_file"
      → register as tool packs in StaticToolRegistry
      → inject risk overrides from annotations/config
```

The MCP tools appear identically to built-in tools from the agent's perspective. Their `run()` closures call back to the MCP client.

### Skills

Skills are markdown files with optional YAML frontmatter that get injected as system prompt blocks:

```markdown
---
name: vision-qa
description: Visual question answering
---
You can analyze images using the vision tools...
```

`createMarkdownSkillHook(skillPath, { activateWhen })` returns an `AgentRunHook` that conditionally appends the skill instructions to the system prompt. Skills don't add tools — they're pure prompt augmentation that guide the agent's behavior with existing tools.

---

## Tool Calling Mechanics

### Tool Definition Schema

Every tool is a `ToolDefinition`:

```typescript
{
  name: string;              // unique identifier
  description: string;       // shown to the LLM
  inputSchema: {             // JSON Schema object
    type: "object",
    properties: { ... },
    required: [...]
  };
  run: (input) => string;   // execution function
}
```

**What the LLM sees** (sent as `tools` in the API request):
```json
{ "name": "read_file", "description": "Read the contents of...", "inputSchema": { ... } }
```

**What the LLM produces** (in its response):
```json
{ "type": "tool_use", "id": "call_abc", "name": "read_file", "input": { "path": "src/main.ts" } }
```

**What the harness executes:**
```typescript
const result: string = await tool.run({ path: "src/main.ts" });
```

**What goes back to the LLM** (as the next user message):
```json
{ "type": "tool_result", "toolUseId": "call_abc", "content": "file contents...", "isError": false }
```

### Tool Resolution

Tools are resolved at agent construction time through one of three paths:

```
AgentConfig.tools               → direct tool array (highest priority)
AgentConfig.toolPacks           → resolved via ToolRegistry.resolvePacks()
(neither)                       → defaultTools (read_file, list_files, edit_file)
```

The `StaticToolRegistry` maps pack names to tool arrays:

| Pack | Tools |
|------|-------|
| `filesystem` | `read_file`, `list_files`, `edit_file` |
| `screenshot` | `capture_screenshot` |
| `vision-analysis` | `analyze_image_qa` |
| `spawn` | `spawn_agent` |
| `tasklist` | `list_tasks`, `get_task`, `submit_result` (worker) or `create_task`, `complete_task`, `reject_task` (orchestrator) |
| `mcp.<server>` | dynamically discovered from MCP servers |

All tools are deduped by name (last-write-wins) before being sent to the provider.

### Provider Abstraction

All LLM backends implement a single interface:

```typescript
interface LLMProvider {
  name: string;
  chat(params: ChatRequest): Promise<ChatResponse>;
  chatStream?(params: ChatRequest, callbacks?: ChatStreamCallbacks): Promise<ChatResponse>;
}
```

The harness includes three implementations (`anthropic`, `gemini`, `openai`) that normalize each provider's native format into the unified `ChatRequest`/`ChatResponse` types. The agent loop never touches provider-specific types.

---

## Multi-Agent Coordination

### Team Execution Flow

The `Team` class coordinates an `OrchestratorAgent` and a pool of `WorkerAgent`s through a phased pipeline:

```
 Phase 1: PLANNING
 ─────────────────
 OrchestratorAgent.plan(goal) → TeamTask[]
 TaskGraph constructed (validates DAG, detects cycles)
 RuntimePolicy transitions to "planning"

 Phase 2: EXECUTING
 ──────────────────
 while (!taskGraph.isComplete()):
   batch = taskGraph.claimReadyTasks(maxWorkers)   // respects dependencies
   Promise.allSettled(batch.map(task =>
     executeWithRestart(createWorker, task, timeout, restartLimit, mailbox)
   ))
   → resolve/submit results in TaskGraph
   → [if verifyBeforeComplete] orchestrator.verify() each result
     → approved: taskGraph.completeTask()
     → rejected: taskGraph.rejectTask() → requeue for retry
   → markBlockedTasksAsFailed()                    // cascade dependency failures
   → reconcileLoop.run()                           // failure recovery decisions

 Phase 3: SYNTHESIZING
 ─────────────────────
 OrchestratorAgent.summarize(goal, completedTasks) → summary
 → TeamResult { tasks, summary, success, messages, runtimeState, events }
```

### Message Passing: TeamMailbox

Agents communicate through an in-memory mailbox, not through shared context:

```
Worker → Mailbox → "orchestrator"     (task completion/failure notifications)
"orchestrator" → Mailbox → Worker     (attempt notifications, coordination context)
```

Workers check their inbox at execution start. Undelivered messages addressed to a worker ID are rendered into the execution prompt as a "Coordination inbox" section. Messages are marked delivered after reading to avoid re-processing.

This is fundamentally different from protocol-level agent communication (like A2A or ADK). There is no serialized envelope, no routing layer, no discovery. It's a simple addressed message queue within a single process.

### Task Graph: Dependency-Aware Scheduling

The `TaskGraph` is a versioned, mutable DAG with optimistic concurrency control:

```
                   ┌──── t1 (pending) ────┐
                   │                      │
                   ▼                      ▼
            t2 (pending)          t3 (pending, blockedBy: [t1])
                   │
                   ▼
            t4 (pending, blockedBy: [t2, t3])
```

**Scheduling:** `claimReadyTasks(limit)` finds tasks where all dependencies are `done`, sorts by priority then insertion order, claims up to `limit`, and transitions them to `in_progress`.

**Versioned patches:** Every mutation goes through `applyPatch()`:
```typescript
applyPatch(patch: TaskGraphPatch, expectedVersion: number) → TaskGraphPatchResult
```
If `expectedVersion !== graphVersion`, the patch is rejected with a conflict. This enables deterministic replay — `TaskGraph.replay(initialTasks, events)` can reconstruct the graph from its mutation history.

**Task status machine:**
```
pending ──► in_progress ──► done       (terminal)
                │
                ├──► failed            (terminal)
                │
                └──► deferred ──► pending  (requeue for retry)
```

Workers can only transition to `done` (status "done" on their result) or `failed`. The orchestrator owns `completeTask()`, `rejectTask()`, and `requeueTask()`.

### Subagent Spawning

Any agent with the `spawn` tool pack can create child agents:

```
Parent Agent
  └── spawn_agent({ agentType: "explorer", prompt: "find all config files" })
       │
       ├── Look up "explorer" in AgentTypeRegistry
       ├── Check depth limit (currentDepth < maxDepth)
       ├── Resolve effective policy (max of parent and child)
       ├── Resolve tool packs for child (from agent type config)
       ├── If child has "spawn" pack, wire recursive spawn tool with depth + 1
       ├── Create child Agent instance
       ├── agent.run(prompt) → blocks parent until child completes
       └── Return child's response as tool result string
```

Depth limiting prevents infinite spawn chains. Policy escalation ensures children are never less restricted than parents.

---

## Governance Layer

### Policy Engine

Three profiles with increasing restrictiveness:

| Profile | read | write | exec | destructive |
|---------|------|-------|------|-------------|
| `local-permissive` | allow | allow | allow | await_user |
| `strict` | allow | await_user | await_user | await_user |
| `managed` | allow | await_user | deny | deny |

Plus: per-tool allow/deny lists, tool-call count cap (250/120/80 by profile), and an `ApprovalHandler` callback for programmatic approval.

### Beholder (Overseer)

The Beholder monitors agent behavior across the entire tool-calling session:

- **Rate limiting** — kills if >N tool calls per minute
- **Loop detection** — kills on 3+ identical consecutive tool calls
- **Token budget** — kills if cumulative tokens exceed budget
- **Drift detection** — every 5 tool calls, asks a separate LLM whether recent intents are goal-aligned. Consecutive drift warnings escalate to kill.

### Intent Gate

When `intentRequired: true`, the agent must emit `<intent>` XML tags in its text *before* any tool call in the same response. Each intent declares:

```json
{ "toolName": "edit_file", "purpose": "...", "expectedOutcome": "...", "riskLevel": "write" }
```

Tool calls without matching intents are blocked — the harness returns error tool_results instead of executing them. This forces the LLM to reason about its actions before taking them.

### Fallback Agent

When a tool call fails and a `fallbackProvider` is configured, a secondary LLM attempts recovery:

```
Original call fails → FallbackAgent.handleFailure()
  → Ask fallback LLM: "This failed. Here are available tools. Suggest alternative."
  → LLM suggests { toolName, input }
  → Execute alternative tool
  → If still failing, retry up to maxRetries
  → Return FallbackResult { resolved, result, attempts }
```

### Runtime Policy (Team-level)

The Team's `RuntimePolicy` enforces phase transitions (planning → executing → synthesizing → completed/failed → idle), worker caps, timeout budgets, and feature flags for regression gates, trace replay, mutable graphs, and reconciliation loops.
