# Teams — Multi-Agent Orchestration

> `examples/teams/` — Dependency-aware task scheduling and worker coordination.

## Files

| File | Purpose | Lines |
|------|---------|-------|
| `team.ts` | `Team` class — main orchestration runtime | ~550 |
| `orchestrator.ts` | Planning, summarization, verification | ~270 |
| `worker.ts` | Task execution agent | ~170 |
| `task-graph.ts` | Dependency-aware DAG with versioned patching | ~780 |
| `types.ts` | Domain model interfaces | ~90 |
| `events.ts` | Team event bus (24 event types) | ~100 |
| `state.ts` | Runtime state tracker + heartbeats | ~170 |
| `mailbox.ts` | Simple inter-agent message queue | ~80 |
| `priority-mailbox.ts` | Typed prioritized messaging with TTL | ~150 |
| `policy.ts` | Runtime policy — flags, caps, trust, phases | ~250 |
| `reconcile.ts` | Adaptive reconciliation loop | ~140 |
| `regression-gates.ts` | MVP rollout quality gates | ~70 |
| `retention.ts` | State snapshots + retention cleanup | ~90 |
| `index.ts` | Barrel exports | ~50 |

**Total: ~3,100 lines**

---

## Architecture Overview

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

---

## Core Design Decision: Task Completion Ownership

> **Workers do NOT mark tasks as completed.** Workers submit their results, but the **orchestrator** owns task completion. Before marking a task done, the orchestrator must verify the work — typically by spawning a separate verifier/tester agent to validate the output.

This separation ensures:
1. Quality gating at the orchestration layer
2. Clear accountability boundaries
3. Ability to reject and re-queue work

### Verification Flow

```
Worker.execute(task)
  → submits result via taskGraph.submitResult()
  → task stays in_progress

Orchestrator.verify(task, registry, provider)
  → spawns verifier agent (if registered) OR uses inline LLM
  → returns { approved: boolean, reason: string }

If approved:  taskGraph.completeTask(taskId)  → status: "done"
If rejected:  taskGraph.rejectTask(taskId)    → status: "deferred"
              taskGraph.requeueTask(taskId)    → status: "pending" (retry)
```

---

## Team Class (`team.ts`)

The `Team` class orchestrates a complete multi-agent run.

### Configuration

```typescript
interface TeamConfig {
  provider: LLMProvider;           // For orchestrator
  workerProvider?: LLMProvider;    // For workers (defaults to provider)
  model: string;                   // Orchestrator model
  workerModel?: string;            // Worker model
  maxWorkers?: number;             // Parallel worker cap
  restartLimit?: number;           // Max worker restarts
  beholder?: Beholder;            // Shared overseer
  toolRegistry?: StaticToolRegistry;
  agentTypeRegistry?: AgentTypeRegistry;
  verifyBeforeComplete?: boolean;  // Enable verification gate
  flags?: Partial<FeatureFlags>;   // MVP feature toggles
  caps?: Partial<SafetyCaps>;      // Resource limits
}
```

### Execution Lifecycle

```
Team.run(goal: string): Promise<TeamResult>

Phase 1: PLANNING
  ├─ Transition: idle → planning
  ├─ OrchestratorAgent.plan(goal) → task array
  ├─ Create TaskGraph (validate DAG)
  └─ Emit: plan_created

Phase 2: EXECUTION LOOP
  ├─ Transition: planning → executing
  └─ While !taskGraph.isComplete():
      │
      ├─ Enforce caps (runtime budget, worker count)
      │
      ├─ Claim ready tasks:
      │   └─ taskGraph.claimReadyTasks(maxWorkers)
      │       → pending tasks with all deps done
      │       → sorted by priority, then declaration order
      │
      ├─ If no tasks claimed:
      │   ├─ Cascade: markBlockedTasksAsFailed()
      │   └─ Reconcile: trigger=dependency_failure
      │
      ├─ Execute batch (parallel):
      │   └─ For each task:
      │       ├─ Create WorkerAgent
      │       ├─ Execute with timeout (AbortController)
      │       ├─ Retry on failure (up to restartLimit)
      │       └─ Emit: worker_attempt_started/finished
      │
      ├─ Process results:
      │   ├─ If verifyBeforeComplete:
      │   │   ├─ taskGraph.submitResult() (stays in_progress)
      │   │   ├─ orchestrator.verify() → approved/rejected
      │   │   ├─ Approved: taskGraph.completeTask()
      │   │   └─ Rejected: taskGraph.rejectTask() → requeueTask()
      │   └─ Else: taskGraph.resolveTask() (direct completion)
      │
      ├─ Cascade failures: markBlockedTasksAsFailed()
      │
      └─ Reconcile loop: trigger=task_resolved

Phase 3: SYNTHESIS
  ├─ Transition: executing → synthesizing
  ├─ OrchestratorAgent.summarize(goal, tasks) → narrative
  ├─ Determine success (all tasks done?)
  ├─ Optional: regression gate evaluation
  ├─ Transition: → completed or failed
  └─ Return TeamResult
```

---

## TaskGraph (`task-graph.ts`)

Dependency-aware DAG with versioned state mutations.

### Core Operations

| Method | Description |
|--------|-------------|
| `claimReadyTasks(limit)` | Get pending tasks with all deps done |
| `resolveTask(result)` | Mark task done or failed (terminal) |
| `submitResult(taskId, result)` | Worker submits; task stays in_progress |
| `completeTask(taskId)` | Orchestrator approves → done |
| `rejectTask(taskId, reason)` | Orchestrator rejects → deferred |
| `requeueTask(taskId)` | Re-queue deferred task → pending |
| `markBlockedTasksAsFailed()` | Cascade-fail tasks blocked by failures |
| `getAwaitingReview()` | Tasks with submitted results pending review |
| `isComplete()` | All tasks in terminal state? |

### Versioned Patching

The graph maintains a `graphVersion` counter. Mutations are applied via typed patches with optimistic concurrency:

```typescript
taskGraph.applyPatch(patch, expectedVersion);
// → PatchResult { success, conflicts?, graphVersion }
```

Patch operations:
- `add_task` — Insert new task (validates no duplication, no cycles)
- `update_task` — Modify existing task fields
- `remove_task` — Delete task (validates no dependents)

### Invariants

- No self-dependencies
- No dependency cycles (detected via DFS)
- All dependency references must resolve to existing tasks
- Terminal statuses (`done`, `failed`) cannot regress
- At least one task required

### Deterministic Replay

```typescript
TaskGraph.replay(initialTasks, mutationEvents) → TaskGraph
```

Replays a sequence of mutation events to reconstruct final state. Validates version consistency at each step. Used for regression gate validation.

---

## Orchestrator (`orchestrator.ts`)

### plan(goal) → TeamTask[]

Prompts the LLM to decompose a goal into tasks:
- Enforces JSON array output
- Max 5 tasks per plan
- Tasks include id, description, optional blockedBy/priority
- Validates dependency references
- Returns normalized `TeamTask[]`

### summarize(goal, tasks) → string

Generates a final narrative from completed task results. Renders a task report and asks the LLM for a concise summary.

### verify(task, registry, provider) → { approved, reason }

Quality gate for worker submissions:
1. If `verifier` agent type is registered → spawn dedicated verifier agent
2. Otherwise → inline verification via orchestrator's LLM
3. Returns approval decision with reasoning
4. Fallback: approves unless response contains "reject"/"fail"

---

## Worker (`worker.ts`)

Executes a single task in isolation:
1. Creates an internal `Agent` instance
2. Builds prompt from task description + coordination inbox
3. Runs agent with timeout + abort signal
4. Sends completion message to orchestrator
5. Returns task with result/error

Workers **never** mark tasks as completed. They submit results and await orchestrator judgment.

---

## Messaging

### TeamMailbox (`mailbox.ts`)
Simple in-memory message buffer:
- `send(message)` — Enqueue
- `list(recipient, includeDelivered?)` — Filter by recipient
- `markDelivered(messageId)` — Track delivery

### PriorityMailbox (`priority-mailbox.ts`)
Rich typed messaging for orchestrator coordination:
- **Priority levels**: critical > high > normal > low
- **Message types**: context, alert, decision_request, directive, progress, needs_context, heartbeat
- **Topics**: For filtering (e.g., `"context"`, `"caps"`)
- **TTL**: Automatic expiration with pruning
- Messages sorted by priority rank, then timestamp

---

## Runtime Policy (`policy.ts`)

Centralized control surface for the team runtime.

### Feature Flags

| Flag | Default | Purpose |
|------|---------|---------|
| `reconcileEnabled` | false | Adaptive planning loop |
| `mutableGraphEnabled` | false | Versioned patch support |
| `priorityMailboxEnabled` | false | Typed priority messaging |
| `traceReplayEnabled` | false | Deterministic replay validation |
| `regressionGatesEnabled` | false | MVP gate evaluation |
| `trustGatingEnabled` | false | Trust-level extension gating |
| `hierarchyEnabled` | false | Subagent spawning |

### Safety Caps

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

### Phase State Machine

```
idle → planning → executing ↔ reconciling → synthesizing → completed
                     ↓                                        ↓
                 await_user ←──────────────────────────── failed
```

### Trust Gating

Extension manifests declare required trust levels:
- `untrusted` < `workspace` < `user` < `managed`
- Untrusted extensions cannot access: write, exec, network, hook, plugin
- Violations throw `PolicyViolation`

---

## Reconciliation Loop (`reconcile.ts`)

Event-driven adaptive runtime adjustments:

| Trigger | Action |
|---------|--------|
| Feature disabled | noop |
| Task cap exceeded | escalate_user |
| needs_context messages | request_context (via PriorityMailbox) |
| Stale heartbeats | escalate_user + critical alert |
| Normal operation | noop (return to executing) |

---

## Regression Gates (`regression-gates.ts`)

MVP rollout quality gates:

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

## State & Retention

### TeamStateTracker (`state.ts`)
Tracks mutable runtime state:
- Worker heartbeats (status, current task, attempts, last seen)
- Event history
- Phase transitions
- Stale worker detection

### Retention (`retention.ts`)
Memory management via snapshots:
- `createTeamStateSnapshot()` — Capture immutable state
- `applyRetentionPolicy()` — Keep last N events, snapshot the rest

---

## Event Bus (`events.ts`)

24 event types covering the full lifecycle:

| Category | Events |
|----------|--------|
| Lifecycle | run_started, run_completed |
| Planning | plan_created |
| Execution | batch_claimed, worker_attempt_started/finished, worker_restarted |
| Tasks | task_resolved, task_verified, tasks_dependency_failed |
| Phases | phase_changed |
| Reconciliation | reconcile_completed |
| Health | heartbeat_stale |
| Gates | regression_gate_evaluated |

Events include schema versioning, actor identification, timestamps, and graph metadata.
