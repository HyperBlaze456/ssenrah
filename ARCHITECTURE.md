# ssenrah Architecture Reference

Developer reference for the ssenrah agent harness. All implementation lives under `examples/`.

---

## Directory Structure

```
examples/
  agent/           Core Agent class, tools, types
  agents/          AgentType schema and AgentTypeRegistry
  harness/         Safety: Beholder, Intent, Checkpoints, Events, Policy, Skills, Hooks
    components/    Composable harness components (e.g. VisionQA hook)
  providers/       LLMProvider abstraction: Anthropic, Gemini, OpenAI adapters
  teams/           Orchestrator, Worker, TaskGraph, Mailbox, Policy, State, Reconcile
  tools/           StaticToolRegistry, spawn_agent, task-tools, toolpack manifests
    toolpacks/     JSON manifest files for tool packs
    vision/        Vision tools (capture-screenshot, analyze-image)
  tests/           30 Jest test suites (229 tests)
  evals/           Baseline evaluation framework
  skills/          Markdown skill documents
```

Entry points:
- `index.ts` — single-agent and team demos
- `agent-cli.ts` — interactive REPL
- `demo-harness.ts` — harness feature demo

---

## Core Abstractions

### LLMProvider (`providers/types.ts`)

The central interface. Every LLM backend implements:

```typescript
interface LLMProvider {
  name: string;
  chat(params: ChatRequest): Promise<ChatResponse>;
  chatStream?(params: ChatRequest, callbacks?: ChatStreamCallbacks): Promise<ChatResponse>;
}
```

Three concrete providers: `AnthropicProvider`, `GeminiProvider`, `OpenAIProvider`. Created via `createProvider(config)` factory (`providers/index.ts`).

### ToolDefinition (`agent/types.ts`)

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (input: Record<string, unknown>) => Promise<string> | string;
}
```

### AgentConfig (`agent/types.ts`)

Comprehensive config covering provider, model, tools (direct or via packs), hooks, policy, intent gating, fallback, checkpoints, and abort signal.

### TurnResult (`agent/types.ts`)

Result of a single agent run with status (`completed|await_user|failed|cancelled|max_turns|max_tokens`), phase tracking, token usage, and tools used.

---

## Agent Loop (`agent/agent.ts`)

`Agent.run(userMessage)` implements the core loop:

1. **Pre-run hooks** — all registered `AgentRunHook` functions execute in sequence. Hooks can mutate `AgentRunSettings` (model, system prompt, tools).
2. **Push user message** — appended to conversation history.
3. **Main loop** (up to `maxTurns`, default 20):
   - **Abort check** — if `AbortSignal` aborted, return `cancelled`.
   - **LLM call** — `provider.chat()` or `provider.chatStream()` with full history.
   - **Build assistant message** — normalizes text and tool_use blocks.
   - **No tool calls = done** — pure text response ends the loop.
   - **Intent gate** — if `intentRequired`, parse `<intent>` blocks, validate every tool call has a matching intent. Unmatched calls are blocked.
   - **Per-tool-call**:
     - **Policy evaluation** — `PolicyEngine.evaluateToolCall()` checks risk, caps, allow/deny lists.
     - **Beholder check** — rate limits, loop detection, token budget, drift alignment.
     - **Tool execution** — find tool by name, call `tool.run(input)`.
     - **Fallback recovery** — if tool failed and `FallbackAgent` configured, retry up to 3 times.
   - **Feed results back** — tool results pushed as user message, loop continues.
4. **Finalization** — log event, persist checkpoint, return `TurnResult`.

---

## Team Orchestration

### Flow (`teams/team.ts`)

`Team.run(goal)` orchestrates the full workflow:

1. **Plan** — `runtimePolicy.transition("planning")`, orchestrator decomposes goal into `TeamTask[]`, creates `TaskGraph`.
2. **Execute** — while-loop until `taskGraph.isComplete()`:
   - `taskGraph.claimReadyTasks(maxWorkers)` — gets dependency-resolved, priority-sorted batch.
   - `Promise.allSettled()` runs workers in parallel with restart-on-failure.
   - Results flow through submit → verify → complete (or direct resolve).
   - After each batch: mark dependency-failed tasks, run reconcile loop, process mailbox.
3. **Synthesize** — orchestrator summarizes results, evaluate regression gates.
4. **Return** — `TeamResult` with tasks, summary, events, and gate report.

### OrchestratorAgent (`teams/orchestrator.ts`)

- `plan(goal)` — LLM decomposes goal into JSON task array (max 5 tasks).
- `summarize(goal, tasks)` — synthesizes final summary from all task results.
- `verify(task, registry, provider)` — verifies worker output. Spawns "verifier" agent type if registered, otherwise uses inline LLM verification.

### WorkerAgent (`teams/worker.ts`)

Wraps a full `Agent` instance with its own system prompt, tool registry, and tool packs.
- `execute(task, signal, mailbox)` — runs the inner agent on the task description.
- Does NOT mark tasks as completed — only returns results. Orchestrator owns completion.
- Accepts optional injected `toolRegistry` and `toolPacks` for spawn/tasklist support.

### TaskGraph (`teams/task-graph.ts`)

Versioned mutable DAG of `TeamTask` nodes with dependency tracking.

**Key operations:**
- `claimReadyTasks(n)` — claim dependency-resolved tasks in priority order
- `resolveTask(result)` — direct path: set terminal status
- `submitResult(taskId, result)` — worker submits, stays `in_progress`
- `completeTask(taskId)` — orchestrator marks `done` (requires submitted result)
- `rejectTask(taskId, reason)` — sets `deferred` (non-terminal)
- `requeueTask(taskId)` — moves `deferred` back to `pending`
- `getAwaitingReview()` — tasks with submitted results pending review
- `markBlockedTasksAsFailed()` — transitive dependency failure propagation

All mutations go through `applyPatch()` with optimistic concurrency (version conflicts), invariant validation (no cycles, no dangling deps, no terminal-to-non-terminal), and recorded `TaskGraphMutationEvent`s.

---

## Task Lifecycle

```
pending ──→ in_progress ──→ done
                │
                ├──→ failed
                │
                └──→ deferred ──→ pending (requeue)
```

**Full verified flow:**
1. **Pending** — created by orchestrator during planning
2. **Claimed** — `claimReadyTasks()` marks `in_progress`
3. **Worker submits** — `submitResult()` sets result, stays `in_progress`
4. **Orchestrator verifies** — `getAwaitingReview()` finds tasks to review
5. **Complete** — `completeTask()` marks `done`
6. **Or reject** — `rejectTask()` marks `deferred`, then `requeueTask()` back to `pending`

**Direct path** (when `verifyBeforeComplete` is false): `resolveTask()` sets terminal status directly.

---

## Tool System (`tools/registry.ts`)

### StaticToolRegistry

Map-based registry: `registerPack(name, tools)` stores named packs; `resolvePacks(names)` resolves into deduped `ToolDefinition[]`.

### Default Packs

| Pack | Tools | Condition |
|------|-------|-----------|
| `filesystem` | `read_file`, `list_files`, `edit_file` | Always |
| `screenshot` | `capture_screenshot` | Vision provider configured |
| `vision-analysis` | `analyze_image_qa` | Vision provider configured |
| `spawn` | `spawn_agent` | `spawnDeps` provided |
| `tasklist` | `list_tasks`, `get_task`, `submit_result`, `create_task`, `complete_task`, `reject_task` | `taskToolsDeps` provided |

Filesystem tools are sandboxed via `resolveSafePath()` which enforces lexical containment and rejects symlink traversal.

### Toolpack Manifests (`tools/manifest.ts`)

```typescript
interface ToolPackManifest {
  schemaVersion: 1;
  name: string;
  description: string;
  tools: string[];
  riskProfile: "read-only" | "standard" | "privileged";
  tags?: string[];
}
```

Risk profiles map to capabilities via the toolpack-policy bridge (`tools/toolpack-policy.ts`):
- `read-only` → `[read, trace]`
- `standard` → `[read, write, trace]`
- `privileged` → `[read, write, exec, network, trace]`

---

## Agent Type System (`agents/`)

### AgentType (`agents/agent-types.ts`)

Predefined schema — users define agent types with specific tool sets, models, and isolation:

```typescript
interface AgentType {
  name: string;
  description: string;
  model: string;
  systemPrompt?: string;
  toolPacks?: string[];        // defaults to ["filesystem"]
  isolation?: AgentTypeIsolation;
  maxTurns?: number;
  intentRequired?: boolean;
  policyProfile?: PolicyProfile;
}

interface AgentTypeIsolation {
  readOnly?: boolean;
  toolPacks?: string[];
  maxTurns?: number;
  maxDepth?: number;           // max recursive spawn depth (default 1)
  workspaceRoot?: string;
}
```

### AgentTypeRegistry (`agents/registry.ts`)

Simple `Map<string, AgentType>` with `register()`, `get()`, `list()`, `has()`.

### spawn_agent Tool (`tools/spawn-agent.ts`)

`createSpawnAgentTool(deps)` creates a tool that any agent can call to spawn a subagent:

1. Look up agent type by name in registry
2. Check depth limit (`currentDepth >= maxDepth` blocks infinite recursion)
3. Resolve effective policy (more restrictive of parent/child wins)
4. Resolve tool packs, recursively wiring a child `spawn_agent` with `depth + 1`
5. Create and run child `Agent` instance (parent blocks until child completes)

### Task Tools (`tools/task-tools.ts`)

`createTaskTools(deps)` returns role-gated tools:
- **Workers**: `list_tasks`, `get_task`, `submit_result`
- **Orchestrator**: `list_tasks`, `get_task`, `create_task`, `complete_task`, `reject_task`

---

## Policy System

### Agent-Level: PolicyEngine (`harness/policy-engine.ts`)

Governs individual tool calls within an agent run. Three profiles:

| Profile | `read` | `write` | `exec` | `destructive` | Cap |
|---------|--------|---------|--------|----------------|-----|
| `local-permissive` | allow | allow | allow | await_user | 250 |
| `strict` | allow | await_user | await_user | await_user | 120 |
| `managed` | allow | await_user | deny | deny | 80 |

Additional controls: `allowTools`/`denyTools` sets, configurable `maxToolCalls`, optional `ApprovalHandler`.

### Team-Level: RuntimePolicy (`teams/policy.ts`)

**Feature flags** (all default `false`):
`reconcileEnabled`, `mutableGraphEnabled`, `priorityMailboxEnabled`, `traceReplayEnabled`, `regressionGatesEnabled`, `trustGatingEnabled`, `hierarchyEnabled`

**Safety caps** (defaults):
`maxTasks: 20`, `maxWorkers: 5`, `maxDepth: 0`, `maxRetries: 2`, `maxRuntimeMs: 600000`, `workerTimeoutMs: 120000`

**Phase state machine** — deterministic transitions:
```
idle → planning → await_approval|executing|failed
executing → reconciling|synthesizing|failed|await_user
reconciling → executing|synthesizing|failed|await_user
synthesizing → completed|failed
completed → idle
failed → idle
```
Invalid transitions throw `PolicyViolation`.

### Trust-Gated Extensibility (`teams/policy.ts`)

Trust levels: `untrusted < workspace < user < managed`

When `trustGatingEnabled` is on, extensions must declare required trust level and capabilities. `untrusted` contexts block `write`, `exec`, `network`, `hook`, `plugin`.

---

## Harness Safety Features

### Beholder (`harness/beholder.ts`)

Overseer monitoring every tool call:
- **Rate limiting** — sliding 60s window, default 30 calls/min → `pause`
- **Loop detection** — 3+ identical consecutive calls → `kill`
- **Token budget** — exceeding 100k total tokens → `kill`
- **Drift detection** — every 5 calls, LLM evaluates goal alignment. 3 consecutive drift warnings → `kill`

### Intent System (`harness/intent.ts`)

Agents must emit `<intent>` XML blocks declaring `toolName`, `purpose`, `expectedOutcome`, `riskLevel` before each tool call. Unmatched calls are blocked with error messages fed back.

### Checkpoints (`harness/checkpoints.ts`)

Captures agent state at terminal points. Persisted to `~/.ssenrah/sessions/<sessionId>/checkpoints/<id>.json`. Functions: `createCheckpoint()`, `saveCheckpoint()`, `loadCheckpoint()`, `listCheckpointFiles()`.

### Event Logger (`harness/events.ts`)

JSONL event logger. Event types: `intent`, `tool_call`, `tool_result`, `policy`, `beholder_action`, `fallback`, `turn_result`, `error`. Written to `~/.ssenrah/sessions/<sessionId>/events.jsonl`.

### Policy Audit (`harness/policy-audit.ts`)

`detectPolicyBypassIncidents(events)` scans event streams for cases where a policy blocked a tool but the tool was still called later — detecting bypass violations.

### Fallback Agent (`harness/fallback.ts`)

When a tool call fails, asks a cheap LLM to suggest alternative tool calls, retrying up to 3 times.

---

## Reconcile Loop (`teams/reconcile.ts`)

Event-triggered reconciliation after each batch execution:

1. **Gate** — if `reconcileEnabled` is false, returns `noop`
2. **Cap check** — enforces `maxTasks` cap; violations escalate via `PriorityMailbox`
3. **Context flow** — forwards worker context requests to orchestrator
4. **Heartbeat stale** — identifies stale workers, escalates to user

### Priority Mailbox (`teams/priority-mailbox.ts`)

Typed message queue with priority ordering: `critical > context > status > info`.

### State Tracker (`teams/state.ts`)

Tracks runtime state: tasks, heartbeats, graph version. Workers upsert heartbeats; stale heartbeats are detected by the reconcile loop.

### Retention (`teams/retention.ts`)

`createTeamStateSnapshot()` captures replay-linkable snapshots. `applyRetentionPolicy()` implements snapshot+truncate compaction.

### Regression Gates (`teams/regression-gates.ts`)

`evaluateMvpRegressionGates()` evaluates 6 gates before enabling higher-autonomy phases: `mutable_graph_enabled`, `reconcile_loop_enabled`, `replay_equivalence`, `cap_enforcement_active`, `heartbeat_policy_active`, `trust_gating_active`.

---

## Provider Details

| Provider | File | SDK/Method | Streaming |
|----------|------|-----------|-----------|
| Anthropic | `providers/anthropic.ts` | `@anthropic-ai/sdk` | Native `chatStream()` |
| Gemini | `providers/gemini.ts` | `@google/genai` | `generateContentStream` |
| OpenAI | `providers/openai.ts` | Raw `fetch()` (no SDK) | SSE line parsing |

OpenAI provider auto-detects OpenRouter via `sk-or-` prefix.

---

## Testing

**30 test suites, 229 tests.** Run with:

```bash
cd examples && npm test
```

All tests are pure unit tests — no LLM calls. Provider tests mock API responses.

| Category | Suites |
|----------|--------|
| Core Agent | `agent.test.ts`, `tools.test.ts` |
| Providers | `providers.test.ts` |
| Team Orchestration | `team-graph.test.ts`, `team-runtime.test.ts`, `team-policy.test.ts` |
| Task Graph | `task-graph-mutable.test.ts`, `task-graph-review.test.ts` |
| Policy | `policy-engine.test.ts`, `policy-audit.test.ts`, `toolpack-policy.test.ts` |
| Harness Safety | `harness.test.ts`, `guard-order.test.ts`, `gates.test.ts`, `regression-gates.test.ts` |
| Runtime | `runtime-phase.test.ts`, `reconcile-loop.test.ts`, `risk-status.test.ts` |
| Agent Types | `agent-type-registry.test.ts`, `spawn-agent.test.ts` |
| Task Tools | `task-tools.test.ts` |
| Checkpoints | `checkpoint.test.ts`, `checkpoints.test.ts` |
| Other | `priority-mailbox.test.ts`, `skill-system.test.ts`, `vision-qa.test.ts`, `toolpack-manifest.test.ts`, `retention.test.ts`, `event-schema-compat.test.ts`, `eval-baseline.test.ts` |

---

## Environment

- Requires `ANTHROPIC_API_KEY` (and optionally `GEMINI_API_KEY`, `OPENAI_API_KEY`)
- Default models: `claude-opus-4-6` (agent), `claude-haiku-4-5-20251001` (orchestrator)
- Build: `npm run build` (tsc → `dist/`)
- Dev: `npm run dev` (ts-node `index.ts`)
- REPL: `npm run agent` (ts-node `agent-cli.ts`)
