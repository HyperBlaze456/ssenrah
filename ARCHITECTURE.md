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
- `agent-cli.ts` — interactive REPL with split-pane TUI
- `demo-harness.ts` — harness feature demo
- `demo-vision-qa.ts` — vision QA workflow demo

---

## Layered Architecture

```
Layer 4  │ teams/          Multi-agent orchestration
Layer 3  │ harness/        Safety, governance, observability
Layer 2  │ agent/ + tools/ Core execution loop + capabilities
Layer 1  │ providers/      LLM abstraction
```

All layers above Layer 1 are provider-agnostic — swap the LLM backend by changing one config field.

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

### ChatRequest / ChatResponse

```typescript
interface ChatRequest {
  model: string;
  systemPrompt?: string;
  messages: ChatMessage[];
  tools?: ToolSchema[];
  maxTokens?: number;
  signal?: AbortSignal;
}

interface ChatResponse {
  textBlocks: string[];
  toolCalls: ToolCall[];
  stopReason: "end_turn" | "tool_use" | "max_tokens";
  usage?: { inputTokens: number; outputTokens: number };
}
```

### ChatContentBlock

Flat interface with optional fields, discriminated by `type`:

```typescript
interface ChatContentBlock {
  type: "text" | "tool_use" | "tool_result" | "image";
  text?: string;
  id?: string;             // tool_use
  name?: string;            // tool_use
  input?: Record<string, unknown>;
  toolUseId?: string;       // tool_result
  content?: string;         // tool_result
  isError?: boolean;        // tool_result
  mimeType?: string;        // image
  base64Data?: string;      // image
}
```

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

```typescript
interface TurnResult {
  status: "completed" | "await_user" | "failed" | "cancelled"
         | "max_turns" | "max_tokens";
  text: string;
  toolsUsed: string[];
  tokenUsage: { inputTokens: number; outputTokens: number };
  phase?: RuntimePhase;
}
```

### AgentRunHook

```typescript
type AgentRunHook = (context: AgentRunContext) => void | Promise<void>;
```

Pre-run hooks receive a mutable context and can override the model, inject/replace tools, append to the system prompt, or swap tool registry references. Composed via `composeHooks()` and run sequentially before the first LLM call.

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

### Streaming

When `options.stream` callbacks are provided, text deltas are emitted in real-time via `chatStream()` instead of `chat()`. The final text is still accumulated in the result.

### Session Management

Each agent run is scoped to a `sessionId`. Sessions persist:
- **Checkpoints**: `~/.ssenrah/sessions/<sessionId>/checkpoints/<checkpointId>.json`
- **Events**: `~/.ssenrah/sessions/<sessionId>/events.jsonl`

Session IDs are sanitized (alphanumeric + `._-`) to prevent path traversal.

### Token Accounting

The agent tracks cumulative token usage across all turns. Totals are returned in `TurnResult.tokenUsage`, fed to the Beholder for budget enforcement, and available for cost estimation.

---

## Harness Safety Features

The harness implements a layered safety stack. Every tool call passes through multiple gates:

```
LLM Output
  │
  ▼
┌─────────────────────────┐
│ 1. Intent Validation     │  Does the agent declare WHY it's calling this tool?
│    (intent.ts)           │  Block undeclared tool calls.
└────────────┬────────────┘
             ▼
┌─────────────────────────┐
│ 2. Policy Engine         │  Is this tool call ALLOWED under the active profile?
│    (policy-engine.ts)    │  allow / await_user / deny
└────────────┬────────────┘
             ▼
┌─────────────────────────┐
│ 3. Beholder Oversight    │  Is the agent BEHAVING normally?
│    (beholder.ts)         │  Rate limit, loop detection, budget, drift
└────────────┬────────────┘
             ▼
┌─────────────────────────┐
│ 4. Tool Execution        │
└────────────┬────────────┘
             ▼
┌─────────────────────────┐
│ 5. Fallback Recovery     │  If tool FAILED, try an alternative.
│    (fallback.ts)         │  LLM suggests retry with different tool.
└────────────┬────────────┘
             ▼
┌─────────────────────────┐
│ 6. Event Logging         │  Record everything for audit.
│    (events.ts)           │
└─────────────────────────┘
```

### Intent System (`harness/intent.ts`)

Agents must emit `<intent>` XML blocks before each tool call:

```xml
<intent>
{
  "toolName": "edit_file",
  "purpose": "Add error handling to the login function",
  "expectedOutcome": "File updated with try-catch block",
  "riskLevel": "write"
}
</intent>
```

Risk levels: `read` (query/fetch) · `write` (create/modify) · `exec` (execute/run) · `destructive` (delete/purge/irreversible).

Key functions:
- `parseIntents(text)` — extract `<intent>` blocks from LLM output via regex
- `validateIntents(intents, toolCalls)` — ensure every tool call has a matching intent
- `getIntentSystemPrompt()` — system prompt instructions for intent format

Unmatched calls return an error as the tool result (not a crash). The LLM can self-correct by providing the intent on the next turn.

### Beholder (`harness/beholder.ts`)

Overseer monitoring every tool call:
- **Rate limiting** — sliding 60s window, default 30 calls/min → `pause`
- **Loop detection** — 3+ identical consecutive calls → `kill`
- **Token budget** — exceeding 100k total tokens → `kill`
- **Drift detection** — every 5 calls, LLM evaluates goal alignment. 3 consecutive drift warnings → `kill`

Verdict actions: `ok` (proceed) · `warn` (suspicious, logged) · `pause` (rate limited) · `kill` (terminate).

```typescript
beholder.getStats() → { totalToolCalls, totalTokens, driftCount }
```

### Fallback Agent (`harness/fallback.ts`)

When a tool call fails and a `FallbackAgent` is configured:

1. Prompt a cheap LLM: "This tool failed. Suggest an alternative from the available tools."
2. LLM receives: original intent, error message, previous attempts, available tool names + descriptions.
3. LLM returns `{ toolName, input }`. Execute the suggested tool.
4. If success → return resolved result. If failure → record attempt, loop (up to `maxRetries`, default 3).
5. All retries exhausted → return unresolved summary.

### Checkpoints (`harness/checkpoints.ts`)

Captures agent state at terminal points. Persisted to `~/.ssenrah/sessions/<sessionId>/checkpoints/<id>.json`.

```typescript
interface HarnessCheckpoint {
  schemaVersion: 1;
  checkpointId: string;
  phase: RuntimePhase;
  goal: string;
  summary?: string;
  policyProfile: PolicyProfile;
  pendingTasks: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
```

Functions: `createCheckpoint()`, `saveCheckpoint()`, `loadCheckpoint()`, `loadCheckpointSafe()`, `listCheckpointFiles()`. IDs are sanitized to prevent path traversal.

### Runtime Phase Machine (`harness/runtime-phase.ts`)

Finite state machine tracking agent execution progress:

```
planning ──→ executing ──→ reconciling ──→ completed
    │            │              │
    ├──→ await_user ←──────────┤
    │            │              │
    └──→ failed ←──────────────┘
         await_user ──→ planning
```

Terminal states: `completed`, `failed`. The `RuntimePhaseMachine` class enforces valid transitions and throws `InvalidRuntimePhaseTransitionError` on violations.

### Event Logger (`harness/events.ts`)

JSONL event logger with in-memory buffer + optional file persistence.

```typescript
interface HarnessEvent {
  timestamp: string;       // ISO 8601
  type: string;            // Event type
  agentId: string;         // Which agent
  data: Record<string, unknown>;
}
```

Event types: `intent`, `tool_call`, `tool_result`, `policy`, `beholder_action`, `fallback`, `turn_result`, `error`. Written to `~/.ssenrah/sessions/<sessionId>/events.jsonl`.

### Policy Audit (`harness/policy-audit.ts`)

`detectPolicyBypassIncidents(events)` scans event streams for cases where a policy blocked a tool but the tool was still called later — detecting bypass violations. Returns `PolicyAuditReport` with incident details.

### Risk Status (`harness/risk-status.ts`)

`summarizeRiskStatus(events)` aggregates events to produce a `RiskStatusSnapshot`: highest risk level seen, last policy action, approval status. Used for CLI status displays.

### Hooks (`harness/hooks.ts`)

Utilities for composing pre-run hooks:
- `composeHooks(...hooks)` — run hooks sequentially
- `appendSystemPrompt(context, block)` — add to system prompt
- `mergeToolsByName(current, incoming)` — merge tool arrays by name

### Skills (`harness/skills.ts`)

Markdown-based capability injection. Skills are `.md` files with YAML frontmatter:

```
---
name: Vision QA
description: UI testing skill
---
## Instructions
When analyzing screenshots, ...
```

Key functions: `loadMarkdownSkill(path)` parses the file, `renderSkillPrompt(skill)` formats for injection, `createMarkdownSkillHook()` returns a hook that conditionally injects skill instructions into the system prompt.

### Vision QA Component (`harness/components/vision-qa.ts`)

`createVisionQAHook(options?)` returns a hook that auto-activates on vision-related keywords. On activation: optional model switch, inject screenshot + analysis tools, load vision-qa skill instructions.

---

## Team Orchestration

```
                    ┌──────────────┐
        Goal ──────►│  Team.run()  │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │ Orchestrator  │
                    │   .plan()     │  Decomposes goal → tasks
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │  TaskGraph    │  Validated DAG
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────▼────┐ ┌────▼─────┐ ┌────▼─────┐
        │ Worker 1  │ │ Worker 2  │ │ Worker N  │  Parallel execution
        └─────┬────┘ └────┬─────┘ └────┬─────┘
              │            │            │
              └────────────┼────────────┘
                           │
                    ┌──────▼───────┐
                    │ Orchestrator  │
                    │  .verify()    │  Quality gate
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │ Orchestrator  │
                    │ .summarize()  │  Final narrative
                    └──────────────┘
```

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
- `verify(task, registry, provider)` — verifies worker output. Spawns "verifier" agent type if registered, otherwise uses inline LLM verification. Returns `{ approved, reason }`.

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

**Patch operations:** `add_task` (validates no duplication, no cycles) · `update_task` · `remove_task` (validates no dependents).

**Invariants enforced:** no self-dependencies · no dependency cycles (DFS) · all deps resolve · terminal statuses cannot regress · at least one task.

**Deterministic replay:** `TaskGraph.replay(initialTasks, mutationEvents)` replays a patch sequence to reconstruct final state, validating version consistency at each step.

### Team Event Bus (`teams/events.ts`)

24 event types covering the full lifecycle:

| Category | Events |
|----------|--------|
| Lifecycle | `run_started`, `run_completed` |
| Planning | `plan_created` |
| Execution | `batch_claimed`, `worker_attempt_started`, `worker_attempt_finished`, `worker_restarted` |
| Tasks | `task_resolved`, `task_verified`, `tasks_dependency_failed` |
| Phases | `phase_changed` |
| Reconciliation | `reconcile_completed` |
| Health | `heartbeat_stale` |
| Gates | `regression_gate_evaluated` |

Events include schema versioning, actor identification, timestamps, and graph metadata.

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

## Tool System (`tools/`)

### StaticToolRegistry (`tools/registry.ts`)

Map-based registry: `registerPack(name, tools)` stores named packs; `resolvePacks(names)` resolves into deduped `ToolDefinition[]`.

### Default Packs

| Pack | Tools | Risk Profile | Condition |
|------|-------|-------------|-----------|
| `filesystem` | `read_file`, `list_files`, `edit_file` | standard | Always |
| `screenshot` | `capture_screenshot` | standard | Vision provider configured |
| `vision-analysis` | `analyze_image_qa` | read-only | Vision provider configured |
| `spawn` | `spawn_agent` | (dynamic) | `spawnDeps` provided |
| `tasklist` | `list_tasks`, `get_task`, `submit_result`, `create_task`, `complete_task`, `reject_task` | (dynamic) | `taskToolsDeps` provided |

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

`assertToolPackAllowed(pack, policy)` validates a manifest against the runtime policy's trust gating and throws on violations.

### spawn_agent Tool (`tools/spawn-agent.ts`)

`createSpawnAgentTool(deps)` creates a tool that any agent can call to spawn a subagent:

1. Look up agent type by name in registry
2. Check depth limit (`currentDepth >= maxDepth` blocks infinite recursion)
3. Resolve effective policy (more restrictive of parent/child wins)
4. Resolve tool packs, recursively wiring a child `spawn_agent` with `depth + 1`
5. Create and run child `Agent` instance (parent blocks until child completes)

Safety properties: depth limiting · policy escalation (child can't be less restrictive than parent) · AbortSignal inheritance · type enforcement (must exist in registry).

### Task Tools (`tools/task-tools.ts`)

`createTaskTools(deps)` returns role-gated tools:

| Tool | Worker | Orchestrator | Description |
|------|--------|-------------|-------------|
| `list_tasks` | yes | yes | View all tasks with status |
| `get_task` | yes | yes | Get detailed task info |
| `submit_result` | yes | no | Submit work result |
| `create_task` | no | yes | Create new task with deps |
| `complete_task` | no | yes | Mark task as done |
| `reject_task` | no | yes | Reject submission → deferred |

### Vision Tools (`tools/vision/`)

**capture_screenshot** (`capture-screenshot.ts`) — platform-native screenshot capture:

| Platform | Tool | Method |
|----------|------|--------|
| macOS | `screencapture` | `-x` (PNG), `-i` (interactive) |
| Linux | ImageMagick `import` | root window capture |
| Windows | PowerShell | System.Windows.Forms screen capture |

**analyze_image_ui_qa** (`analyze-image.ts`) — LLM-powered UI/UX quality analysis. Reads image as base64, sends with context to an LLM, parses structured findings:

```typescript
interface QAFinding {
  severity: "critical" | "major" | "minor" | "suggestion";
  category: "layout" | "accessibility" | "consistency" | "ux" | "content";
  description: string;
  location?: string;
  suggestion: string;
}

interface QAReport {
  imagePath: string;
  findings: QAFinding[];
  summary: string;
  analyzedAt: string;
}
```

Falls back to free-text summary if JSON parsing fails.

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

### How Types Flow

1. Registry populated at startup via `AgentTypeRegistry.register(type)`
2. Team receives registry in `TeamConfig.agentTypeRegistry`
3. Orchestrator selects type per task
4. `spawn_agent` tool resolves type → tool packs → creates `Agent` with type config
5. Orchestrator verification checks for `"verifier"` type — spawns if found, inline LLM otherwise

---

## Policy System

### Agent-Level: PolicyEngine (`harness/policy-engine.ts`)

Governs individual tool calls within an agent run. Three profiles:

| Profile | `read` | `write` | `exec` | `destructive` | Cap |
|---------|--------|---------|--------|----------------|-----|
| `local-permissive` | allow | allow | allow | await_user | 250 |
| `strict` | allow | await_user | await_user | await_user | 120 |
| `managed` | allow | await_user | deny | deny | 80 |

Policy actions: `allow` (proceed) · `await_user` (blocked pending human approval) · `deny` (rejected outright).

Additional controls: `allowTools`/`denyTools` sets, configurable `maxToolCalls`, optional `ApprovalHandler` callback that can elevate `await_user` → `allow`.

### Team-Level: RuntimePolicy (`teams/policy.ts`)

**Feature flags** (all default `false`):
`reconcileEnabled`, `mutableGraphEnabled`, `priorityMailboxEnabled`, `traceReplayEnabled`, `regressionGatesEnabled`, `trustGatingEnabled`, `hierarchyEnabled`

**Safety caps** (defaults):

| Cap | Default | Purpose |
|-----|---------|---------|
| `maxTasks` | 20 | Maximum tasks in graph |
| `maxWorkers` | 5 | Parallel worker limit |
| `maxDepth` | 0 | Spawn depth limit |
| `maxRetries` | 2 | Task retry attempts |
| `maxCompensatingTasks` | 3 | Compensating task limit |
| `maxRuntimeMs` | 600,000 (10min) | Total runtime budget |
| `reconcileCooldownMs` | 5,000 | Reconcile loop throttle |
| `heartbeatStalenessMs` | 30,000 | Worker staleness threshold |
| `workerTimeoutMs` | 120,000 (2min) | Per-worker timeout |

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

## Reconcile Loop (`teams/reconcile.ts`)

Event-triggered reconciliation after each batch execution:

1. **Gate** — if `reconcileEnabled` is false, returns `noop`
2. **Cap check** — enforces `maxTasks` cap; violations escalate via `PriorityMailbox`
3. **Context flow** — forwards worker context requests to orchestrator
4. **Heartbeat stale** — identifies stale workers, escalates to user

### Priority Mailbox (`teams/priority-mailbox.ts`)

Typed message queue with priority ordering: `critical > high > normal > low`.

Message types: `context`, `alert`, `decision_request`, `directive`, `progress`, `needs_context`, `heartbeat`. Supports topic filtering and TTL-based expiration with automatic pruning.

### State Tracker (`teams/state.ts`)

Tracks runtime state: tasks, heartbeats, graph version. Workers upsert heartbeats; stale heartbeats are detected by the reconcile loop.

### Retention (`teams/retention.ts`)

`createTeamStateSnapshot()` captures replay-linkable snapshots. `applyRetentionPolicy()` implements snapshot+truncate compaction — keeps last N events in memory, snapshots the rest.

### Regression Gates (`teams/regression-gates.ts`)

`evaluateMvpRegressionGates()` evaluates 6 gates before enabling higher-autonomy phases:

| Gate | What It Checks |
|------|---------------|
| `mutable_graph_enabled` | Feature flag on |
| `reconcile_loop_enabled` | Feature flag on |
| `replay_equivalence` | Replayed state matches final state |
| `cap_enforcement_active` | Always true (enforced at runtime) |
| `heartbeat_policy_active` | Staleness threshold > 0 |
| `trust_gating_active` | Feature flag on |

Returns `RolloutGateReport` with pass/fail per gate and overall result.

---

## Provider Details

| Provider | File | SDK/Method | Streaming |
|----------|------|-----------|-----------|
| Anthropic | `providers/anthropic.ts` | `@anthropic-ai/sdk` | Native `chatStream()` |
| Gemini | `providers/gemini.ts` | `@google/genai` | `generateContentStream` |
| OpenAI | `providers/openai.ts` | Raw `fetch()` (no SDK) | SSE line parsing |

OpenAI provider auto-detects OpenRouter via `sk-or-` prefix. Uses raw `fetch` instead of the official SDK to support OpenAI-compatible endpoints (OpenRouter, local models), avoid SDK version coupling, and handle SSE streaming with precise chunk reconstruction.

---

## Evaluations (`evals/`)

### Baseline Task Set

Five deterministic regression tasks:

| Task ID | Topic | Required Keywords |
|---------|-------|-------------------|
| `runtime-phase` | Phase state machine | planning, executing, reconciling, completed, failed |
| `policy-approval` | Approval gates | await_user, approval, policy |
| `intent-gate` | Intent declarations | intent, toolName, riskLevel |
| `fallback` | Error recovery | fallback, retry, alternative |
| `events` | Event logging | JSONL, tool_call, tool_result |

### Scoring

`scoreBaselineResponses(tasks, responses)` counts matched required keywords (case-insensitive). Score per task: `(matched / total_required) * weight`. Report includes total, max, and normalized (0–1) scores.

```bash
npx ts-node evals/run-baseline.ts --responses responses.json
```

---

## Interactive CLI (`agent-cli.ts`)

Split-pane TUI for interactive agent conversations (~1000 lines).

**6 panels**: Status (elapsed, tokens, risk) · Prompt · Assistant (streamed) · Tasks/Intents · Tool Execution · Event Log.

**Commands**: `/help` · `/stream on|off` · `/layout on|off` · `/panels on|off` · `/pane <name> <weight>` · `/prefs show|reset` · `/clear` · `/exit`.

**Keyboard shortcuts**: Ctrl+L (clear) · Ctrl+G (toggle stream) · Ctrl+O (toggle layout) · Ctrl+B (toggle panels).

Preferences persisted to `~/.ssenrah/agent-cli-preferences.json`.

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

---

## Design Principles

1. **Provider agnosticism** — All LLM interactions flow through `LLMProvider`. Swap backends by changing one config field.

2. **Intent before action** — Agents declare `toolName`, `purpose`, `expectedOutcome`, `riskLevel` before every tool call. Undeclared calls are blocked.

3. **Layered safety stack** — Five independent safety layers (intent → policy → beholder → fallback → events), each composable via hooks.

4. **Orchestrator owns completion** — Workers submit results; only the orchestrator can mark tasks done after verification. Workers can't self-approve.

5. **Predefined agent types** — Static schemas registered at startup. The orchestrator selects the type per task — agents don't dynamically self-configure.

6. **Event-driven auditability** — Structured JSONL logs for every significant action. Compliance auditing via `detectPolicyBypassIncidents()`.

7. **Composable hooks** — Cross-cutting concerns (skills, vision, model overrides) injected via `AgentRunHook` chains without modifying the core loop.

8. **Deterministic state** — Versioned task graphs with optimistic concurrency, recorded mutations, and replay validation.

9. **Policy-driven runtime control** — A single `RuntimePolicy` centralizes feature flags, safety caps, phase transitions, and trust levels.

10. **Progressive safety profiles** — Three governance tiers (`local-permissive` → `strict` → `managed`) scale from development to production.

11. **Resilient execution** — Timeout (AbortController), retry (restart limits), fallback (LLM-guided alternatives), cascade failure, heartbeat monitoring, and reconciliation loop.

12. **Separation of concerns** — Each module has a single responsibility. Communication via well-defined interfaces and events.
