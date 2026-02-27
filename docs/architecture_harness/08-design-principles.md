# Design Principles

Core architectural decisions and patterns that define ssenrah.

---

## 1. Provider Agnosticism

All LLM interactions flow through a unified `LLMProvider` interface. The agent loop, teams, fallback recovery, and drift detection are completely decoupled from any specific LLM backend.

**Consequence**: Swap from Claude to Gemini to GPT by changing one config field. No agent logic changes.

```
Agent → LLMProvider.chat(request) → ChatResponse
         ↑                            ↑
    Unified types               Unified types
```

---

## 2. Intent Before Action

Agents must explicitly declare their intentions before executing tools. Every tool call requires a matching `<intent>` block that states:
- **What** tool is being called
- **Why** it's being called
- **What** the expected outcome is
- **What** risk level it carries

**Consequence**: Full transparency into agent reasoning. Automated governance can match intents to actions. Undeclared tool calls are blocked, not executed.

---

## 3. Layered Safety Stack

Safety isn't a single gate — it's a stack of independent concerns:

| Layer | Concern | Module |
|-------|---------|--------|
| 1 | Transparency | Intent declarations |
| 2 | Authorization | Policy engine |
| 3 | Behavioral health | Beholder oversight |
| 4 | Error recovery | Fallback agent |
| 5 | Auditability | Event logging |

Each layer can be enabled/disabled independently. They compose via the hook system.

---

## 4. Orchestrator Owns Completion

Workers execute tasks and submit results. But **only the orchestrator** can mark a task as completed. Before doing so, the orchestrator must verify the work — typically by spawning a dedicated verifier agent.

**Consequence**:
- Quality gating at the orchestration layer
- Clear accountability (who approved this result?)
- Ability to reject and re-queue work
- Workers can't "game" the system by self-approving

```
Worker: submit_result(taskId, result)   → task stays in_progress
Orchestrator: verify(task)              → approved or rejected
Orchestrator: complete_task(taskId)     → task moves to done
```

---

## 5. Predefined Agent Types

Agent types are static schemas registered at startup. They define tools, models, prompts, and isolation config. The orchestrator selects the appropriate type per task.

**Consequence**: Agents don't self-configure or dynamically acquire capabilities. Every agent's permissions are known before it starts.

**Anti-pattern avoided**: "Give the agent all tools and let it figure out what to use."

---

## 6. Event-Driven Auditability

Every significant action emits a structured event: intent declarations, policy decisions, tool executions, Beholder verdicts, errors. Events are:
- Written to in-memory buffers (always)
- Persisted to JSONL files (configurable)
- Analyzed for policy bypass detection
- Aggregated for risk status reporting
- Used for regression gate validation

**Consequence**: Full forensic reconstruction of any agent run. Compliance auditing is automated via `detectPolicyBypassIncidents()`.

---

## 7. Composable Hooks

Cross-cutting concerns are injected via `AgentRunHook` chains. Skills, vision capabilities, model overrides, and tool injections are all hooks — composable, orderable, and conditional.

```typescript
const hook = composeHooks(
  createMarkdownSkillHook("vision-qa.md"),
  intentGateHook,
  policyHook
);
```

**Consequence**: Agent configuration is declarative and composable. New capabilities are added without modifying the core loop.

---

## 8. Deterministic State via Versioning

The `TaskGraph` maintains a version counter. Every mutation is:
- Applied via typed patches with optimistic concurrency control
- Recorded as a `TaskGraphMutationEvent` with full audit trail
- Replayable from initial state to reconstruct final state

**Consequence**: Deterministic replay enables regression testing. Version conflicts are detected and reported, not silently merged.

---

## 9. Policy-Driven Runtime Control

A single `RuntimePolicy` centralizes all runtime decisions:
- Feature flags (reconcile, mutable graph, trust gating, etc.)
- Safety caps (max tasks, workers, runtime, retries)
- Phase state machine (valid transitions)
- Trust levels (extension access control)

**Consequence**: All runtime behavior is governed by a single, inspectable policy object. Changing a flag or cap doesn't require code changes.

---

## 10. Progressive Safety Profiles

Three governance tiers scale from development to production:

| Profile | Trust Level | Use Case |
|---------|------------|----------|
| `local-permissive` | High | Local development, trusted agents |
| `strict` | Medium | Staging, semi-trusted agents |
| `managed` | Low | Production, untrusted agents |

**Consequence**: Same agent code runs in development (permissive) and production (managed) with different safety guarantees.

---

## 11. Resilient Execution

Multiple resilience patterns are built in:

| Pattern | Implementation |
|---------|---------------|
| Timeout | AbortController-backed per-worker timeouts |
| Retry | Configurable restart limits for failed workers |
| Fallback | LLM-guided alternative tool suggestions |
| Cascade failure | Blocked tasks automatically fail when deps fail |
| Heartbeat | Stale worker detection via heartbeat tracking |
| Reconciliation | Adaptive loop for runtime adjustments |

---

## 12. Separation of Concerns

Each module has a single responsibility:

- `agent/` — Execute LLM loops
- `providers/` — Translate LLM protocols
- `harness/` — Govern agent behavior
- `teams/` — Coordinate multiple agents
- `tools/` — Define and distribute capabilities
- `agents/` — Define agent blueprints
- `evals/` — Measure quality

No module reaches into another's internals. Communication is via well-defined interfaces and events.
