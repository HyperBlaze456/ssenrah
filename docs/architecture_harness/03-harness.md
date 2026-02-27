# Harness — Safety & Governance Primitives

> `examples/harness/` — The safety stack that governs agent behavior.

## Files

| File | Purpose | Lines |
|------|---------|-------|
| `intent.ts` | Intent declaration & validation | ~100 |
| `policy-engine.ts` | Tool access governance (profiles) | ~150 |
| `beholder.ts` | Behavioral monitoring & oversight | ~170 |
| `fallback.ts` | LLM-guided error recovery | ~100 |
| `events.ts` | Structured JSONL event logging | ~90 |
| `checkpoints.ts` | Persistent session state snapshots | ~180 |
| `runtime-phase.ts` | Execution phase state machine | ~80 |
| `policy-audit.ts` | Policy bypass detection | ~70 |
| `risk-status.ts` | Aggregate risk telemetry | ~90 |
| `hooks.ts` | Pre-run hook composition utilities | ~40 |
| `skills.ts` | Markdown skill system | ~100 |
| `components/vision-qa.ts` | Vision QA harness component | ~100 |
| `checkpoint.ts` | Backward-compat shim | ~5 |
| `index.ts` | Barrel exports | ~15 |

---

## Safety Stack

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

---

## Intent System (`intent.ts`)

Agents must explicitly declare their intentions before executing tools. This forces transparency and enables automated governance.

### Intent Declaration Format

The LLM embeds JSON blocks in its response text:

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

### Risk Levels

| Level | Meaning | Examples |
|-------|---------|---------|
| `read` | Query / fetch | read_file, list_files |
| `write` | Create / modify | edit_file, write_file |
| `exec` | Execute / run | run_command, spawn_agent |
| `destructive` | Delete / purge / irreversible | delete_file, drop_table |

### Key Functions

- `parseIntents(text)` — Extract `<intent>` blocks from LLM output via regex
- `validateIntents(intents, toolCalls)` — Ensure every tool call has a matching intent
- `getIntentSystemPrompt()` — System prompt instructions for intent format

### Behavior on Mismatch

If a tool call has no matching intent, the agent returns an error as the tool result (not a crash). The LLM can then self-correct by providing the intent on the next turn.

---

## Policy Engine (`policy-engine.ts`)

Runtime governance that maps risk levels to approval decisions.

### Policy Profiles

| Profile | read | write | exec | destructive | Max Calls |
|---------|------|-------|------|-------------|-----------|
| `local-permissive` | allow | allow | allow | await_user | 250 |
| `strict` | allow | await_user | await_user | await_user | 120 |
| `managed` | allow | await_user | deny | deny | 80 |

### Policy Actions

- **allow** — Tool call proceeds
- **await_user** — Blocked pending human approval
- **deny** — Rejected outright

### Approval Handler

An optional callback for interactive approval:

```typescript
type ApprovalHandler = (request: ApprovalRequest) => "approve" | "reject";
```

When a policy decision is `await_user` and a handler is registered, the handler is invoked. An `"approve"` response elevates the decision to `allow`.

### Tool Whitelists/Blacklists

- `allowTools: string[]` — Always allow these tools regardless of profile
- `denyTools: string[]` — Always deny these tools regardless of profile

---

## Beholder Oversight (`beholder.ts`)

Named after the all-seeing D&D creature, the Beholder monitors agent behavior for anomalies at runtime.

### Checks (evaluated per tool call)

| Check | Threshold | Action |
|-------|-----------|--------|
| Token budget exceeded | `maxTokenBudget` (default 100k) | **kill** |
| Rate limit exceeded | `maxToolCallsPerMinute` (default 30) | **pause** |
| Loop detected | 3+ identical consecutive calls | **kill** |
| LLM drift detected | `maxConsecutiveDrift` (default 3) | **kill** (or **warn** if below threshold) |

### Verdict Actions

- **ok** — Normal behavior
- **warn** — Suspicious but continue (logged)
- **pause** — Temporarily halt (rate limit)
- **kill** — Terminate agent execution

### Drift Detection (Optional)

If configured with a provider, the Beholder periodically (every 5 tool calls) sends recent intent history to an LLM and asks: "Is this agent still aligned with its goal?" Returns `{"aligned": true/false, "reason": "..."}`.

### Statistics

```typescript
beholder.getStats() → {
  totalToolCalls: number;
  totalTokens: number;
  driftCount: number;
}
```

---

## Fallback Recovery (`fallback.ts`)

When a tool execution fails, the fallback agent uses an LLM to suggest and execute alternative approaches.

### Flow

```
Tool call fails
  → FallbackAgent.handleFailure(failedCall, error, availableTools)
    → Loop (up to maxRetries):
        → Prompt LLM: "This failed. Suggest an alternative tool."
        → LLM returns: { toolName, input }
        → Execute suggested tool
        → If success → return { resolved: true, result }
        → If failure → record attempt, continue loop
    → All retries exhausted → return { resolved: false, summary }
```

The fallback LLM receives:
- Original intent (purpose, expected outcome, risk level)
- Error message
- Previous attempt history
- Available tool names and descriptions

---

## Event System (`events.ts`)

All significant actions are logged as structured events.

### Event Types

| Type | Emitted When |
|------|-------------|
| `intent` | Intent declaration parsed |
| `tool_call` | Tool invocation started |
| `tool_result` | Tool execution completed |
| `policy` | Policy decision made |
| `beholder_action` | Beholder verdict issued |
| `fallback` | Fallback recovery attempted |
| `turn_result` | Agent turn completed |
| `error` | Error occurred |

### Event Structure

```typescript
interface HarnessEvent {
  timestamp: string;       // ISO 8601
  type: string;            // Event type
  agentId: string;         // Which agent
  data: Record<string, unknown>;  // Event-specific payload
}
```

### Persistence

`EventLogger` writes events to:
1. In-memory buffer (always)
2. JSONL file (if `filePath` configured)

---

## Checkpoints (`checkpoints.ts`)

Persistent session state snapshots for recovery and audit.

### Checkpoint Schema (v1)

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

### Storage

- Path: `~/.ssenrah/sessions/<sessionId>/checkpoints/<checkpointId>.json`
- IDs are sanitized to prevent path traversal
- Safe loading with validation (malformed files return `null`)

---

## Runtime Phase Machine (`runtime-phase.ts`)

Finite state machine tracking agent execution progress.

### States & Transitions

```
planning ──→ executing ──→ reconciling ──→ completed
    │            │              │
    ├──→ await_user ←──────────┤
    │            │              │
    └──→ failed ←──────────────┘
         await_user ──→ planning
```

Terminal states: `completed`, `failed`

The `RuntimePhaseMachine` class enforces valid transitions and throws `InvalidRuntimePhaseTransitionError` on violations.

---

## Supporting Modules

### Policy Audit (`policy-audit.ts`)
Scans event streams to detect when policy decisions were bypassed — i.e., when a tool was blocked by policy but executed anyway within the same turn. Returns `PolicyAuditReport` with incident details.

### Risk Status (`risk-status.ts`)
Aggregates events to produce a `RiskStatusSnapshot`: highest risk level seen, last policy action, approval status. Used for CLI status displays.

### Hooks (`hooks.ts`)
Utilities for composing pre-run hooks:
- `composeHooks(...hooks)` — Run hooks sequentially
- `appendSystemPrompt(context, block)` — Add to system prompt
- `mergeToolsByName(current, incoming)` — Merge tool arrays by name

### Skills (`skills.ts`)
Markdown-based capability injection:
- Load `.md` files with YAML frontmatter
- Parse into `MarkdownSkill` (name, metadata, instructions)
- Create hooks that inject skill instructions into system prompts
- Supports conditional activation (e.g., "activate when user mentions vision")

### Vision QA Component (`components/vision-qa.ts`)
Harness hook for vision-based UI testing:
- Auto-activates on vision-related keywords
- Injects screenshot + analysis tools
- Loads vision-qa skill instructions
- Optional model override for vision-capable models
