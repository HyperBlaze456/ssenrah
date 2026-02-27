# Core Agent System

> `examples/agent/` — The provider-agnostic agentic loop.

## Files

| File | Purpose |
|------|---------|
| `agent.ts` | `Agent` class — main execution loop (~630 lines) |
| `types.ts` | Type definitions for tools, hooks, config, results |
| `tools.ts` | Default filesystem tools (read, list, edit) |
| `index.ts` | Barrel exports |

---

## Agent Class (`agent.ts`)

The `Agent` class implements the canonical LLM agent pattern:

```
accept message → send to LLM → execute tools → append results → repeat
```

### Constructor

```typescript
new Agent(config: AgentConfig)
```

Key config fields:
- `provider: LLMProvider` — LLM backend
- `model: string` — Model identifier
- `tools: ToolDefinition[]` — Available tools
- `systemPrompt?: string` — Injected system instructions
- `maxTurns?: number` — Loop safety cap (default: 20)
- `maxTokens?: number` — Per-turn token limit
- `sessionId?: string` — For checkpoint/event scoping
- `intentRequired?: boolean` — Require intent declarations (default: true)
- `policyProfile?: PolicyProfile` — Governance tier
- `beholder?: Beholder` — Behavioral overseer
- `fallbackProvider?: LLMProvider` — For retry-on-failure
- `toolRegistry?: ToolRegistry` — Tool pack resolver
- `hooks?: AgentRunHook[]` — Pre-run configuration hooks

### Execution Flow

```
Agent.run(prompt, options?)
  │
  ├─ 1. Apply pre-run hooks (modify tools, model, system prompt)
  │
  ├─ 2. Build initial message history
  │     └─ System prompt + user message
  │
  ├─ 3. Enter turn loop (max N turns)
  │     │
  │     ├─ Send history to LLM (chat or chatStream)
  │     │
  │     ├─ Parse response:
  │     │   ├─ Text blocks → accumulate assistant output
  │     │   └─ Tool calls → queue for execution
  │     │
  │     ├─ If no tool calls → break (conversation complete)
  │     │
  │     ├─ Intent validation (if intentRequired enabled):
  │     │   ├─ Parse <intent> blocks from assistant text
  │     │   ├─ Match intents to tool calls by toolName
  │     │   └─ Block unmatched calls → return error as tool result
  │     │
  │     ├─ Policy evaluation (per tool call):
  │     │   ├─ Resolve risk level from intent
  │     │   ├─ PolicyEngine.evaluateToolCall()
  │     │   ├─ allow → proceed
  │     │   ├─ await_user → block (return status)
  │     │   └─ deny → block (return error)
  │     │
  │     ├─ Beholder evaluation (per tool call):
  │     │   ├─ Check rate limit, loops, token budget
  │     │   ├─ ok/warn → proceed
  │     │   ├─ pause → return await_user status
  │     │   └─ kill → terminate run
  │     │
  │     ├─ Execute tool → get result
  │     │   └─ On failure + fallback configured:
  │     │       └─ FallbackAgent.handleFailure() → retry with alt tool
  │     │
  │     ├─ Log events (tool_call, tool_result, intent, policy, etc.)
  │     │
  │     └─ Append tool results to message history → next turn
  │
  ├─ 4. Save checkpoint (terminal state to disk)
  │
  └─ 5. Return TurnResult
```

### TurnResult

```typescript
interface TurnResult {
  status: "completed" | "await_user" | "failed" | "cancelled"
         | "max_turns" | "max_tokens";
  text: string;              // Accumulated assistant output
  toolsUsed: string[];       // Tool names invoked this run
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
  };
  phase?: RuntimePhase;      // Current state machine phase
}
```

### Streaming

When `options.stream` callbacks are provided, text deltas are emitted in real-time via `chatStream()` instead of `chat()`. The final text is still accumulated in the result.

### AbortSignal

Supports external cancellation via `options.signal: AbortSignal`. Checked at each turn boundary. Returns `status: "cancelled"` if aborted.

---

## Tool Definitions (`types.ts`)

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;  // JSON Schema
  run: (input: Record<string, unknown>) => string | Promise<string>;
}
```

Tools are pure functions — no side-channel state. Input is validated against the JSON schema by the LLM, and the `run()` function returns a string result.

### ToolRegistry Interface

```typescript
interface ToolRegistry {
  resolvePacks(packNames: string[]): ToolDefinition[];
}
```

Resolves named "tool packs" (e.g., `"filesystem"`, `"vision-analysis"`) into concrete tool arrays. Used by agent types and spawn tools.

### AgentRunHook

```typescript
type AgentRunHook = (context: AgentRunContext) => void | Promise<void>;
```

Pre-run hooks receive a mutable context and can:
- Override the model
- Inject/replace tools
- Append to the system prompt
- Swap tool registry references

Hooks are composed via `composeHooks()` and run sequentially before the first LLM call.

---

## Default Tools (`tools.ts`)

Three filesystem tools with workspace isolation:

### read_file
- **Input**: `{ path: string }`
- **Behavior**: Reads file contents, blocks symlink traversal outside workspace
- **Risk**: read

### list_files
- **Input**: `{ path: string }` (directory)
- **Behavior**: Lists directory contents with type indicators
- **Risk**: read

### edit_file
- **Input**: `{ path: string, old_string: string, new_string: string }` or `{ path: string, content: string }` (create)
- **Behavior**: Exact string replacement or file creation
- **Risk**: write

All tools enforce a `workspaceRoot` boundary — paths must resolve within the allowed directory.

---

## Session Management

Each agent run is scoped to a `sessionId`. Sessions persist:
- **Checkpoints**: `~/.ssenrah/sessions/<sessionId>/checkpoints/<checkpointId>.json`
- **Events**: `~/.ssenrah/sessions/<sessionId>/events.jsonl`

Session IDs are sanitized (alphanumeric + `._-`) to prevent path traversal.

---

## Token Accounting

The agent tracks cumulative token usage across all turns:

```typescript
totalInput  += response.usage.inputTokens;
totalOutput += response.usage.outputTokens;
```

These totals are:
- Returned in `TurnResult.tokenUsage`
- Fed to the Beholder for budget enforcement
- Available for cost estimation
