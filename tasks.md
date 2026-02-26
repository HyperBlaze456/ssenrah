# Harness Autonomy Gap-Closure Roadmap

Generated: 2026-02-26  
Scope: `examples/` harness  
Execution mode: MVP-first (feature-flagged, no big-bang rewrite)

---

## 1) Gap Matrix (Current → Target)

| Gap | Current Harness Status | MVP Deliverable | Expansion | Advanced |
|---|---|---|---|---|
| Runtime contract | Partial guards, no single contract | Deterministic policy contract + caps + transitions (`teams/policy.ts`) | Adaptive phase routing | Multi-run policy profiles + policy DSL |
| Task graph mutability | Static scheduling + immutable-ish flow | Versioned patching (`expectedVersion`) + invariants + replayable mutation log (`teams/task-graph.ts`) | Compensation/deferred task paths | Multi-writer reconciler optimization |
| Reconcile loop | Manual/implicit only | Event-driven reconcile loop + typed priority mailbox + heartbeat stale handling (`teams/reconcile.ts`) | Hybrid timer+event reconcile | Pluggable reconcile strategies |
| Extensibility trust | Basic hook/tool injection | Trust-gated extension enforcement + toolpack policy bridge (`teams/policy.ts`, `tools/toolpack-policy.ts`) | Signed manifests/pinning | Remote trust attestations |
| Trace/replay | Event logging exists but not orchestration-grade | Runtime event bus + state tracker + graph replay checks (`teams/events.ts`, `teams/state.ts`) | Snapshot+truncate retention | Deterministic sequence replay |
| Release quality gates | Unit tests present | MVP regression-gate evaluator + baseline eval/script | Safety KPIs as release blockers | Autonomy scorecard gates |

---

## 2) Phase Plan

## MVP (Current Delivery Window)

### M-1 Runtime Policy Kernel
- [x] Add deterministic runtime policy contract (`examples/teams/policy.ts`)
- [x] Define default feature flags and safety caps
- [x] Enforce fail-closed illegal transition/cap violations
- [x] Keep hierarchy disabled by default (`hierarchyEnabled=false`, `maxDepth=0`)
- [x] Publish contract doc: `docs/feature-specs/runtime-policy-contract.md`

### M-2 Mutable Event-Sourced Task Graph
- [x] Add versioned patch API with `expectedVersion`
- [x] Add invariant checks (dependency validity, acyclic graph, terminal state protection)
- [x] Add mutation event log with schema versioning
- [x] Add replay helper with final-state equivalence checks

### M-3 Reconcile + Priority Mailbox + Heartbeats
- [x] Add typed priority mailbox (`examples/teams/priority-mailbox.ts`)
- [x] Add runtime state tracker with heartbeats (`examples/teams/state.ts`)
- [x] Add event-trigger reconcile loop (`examples/teams/reconcile.ts`)
- [x] Add heartbeat stale escalation + task cap policy hooks

### M-4 Trust-Gated Extensibility
- [x] Add trust-gated extension policy checks
- [x] Add toolpack-manifest draft format + fixtures
- [x] Add toolpack-to-extension policy bridge

### M-5 Trace / Replay / Regression Gates
- [x] Add runtime event bus (`examples/teams/events.ts`)
- [x] Add MVP regression-gate evaluator (`examples/teams/regression-gates.ts`)
- [x] Keep baseline eval script and scoring (`npm run eval:baseline`)
- [x] Add replay + policy + reconcile + mailbox test coverage

### M-6 Continuity / Checkpointing
- [x] Add checkpoint format + save/load/list helpers (`examples/harness/checkpoint.ts`)
- [x] Export checkpoint APIs via harness index

## Expansion (Post-MVP)
- [ ] Hybrid timer + event reconcile cadence
- [ ] `reconcilable` failure propagation mode (`deferred` tasks + compensation policies)
- [ ] Event snapshot + truncate retention
- [ ] CLI risk/approval panel + audit timeline UI
- [ ] Config-driven harness presets

## Advanced
- [ ] Hierarchical teams/subteams (flag + cap gated)
- [ ] Secure remote execution surfaces
- [ ] Signed/pinned extensions + plugin lifecycle APIs
- [ ] Strict sequence replay equivalence
- [ ] Policy DSL + external policy backend integration

---

## 3) Dependency Map

- M-1 (policy contract) → prerequisite for M-2, M-3, M-4, M-5
- M-2 (mutable graph) → prerequisite for replay checks + reconcile mutations
- M-3 (reconcile/heartbeat/mailbox) → prerequisite for autonomy escalation behavior
- M-4 (trust gating) → prerequisite for enabling dynamic extensions in higher phases
- M-5 (regression gates/evals) → prerequisite for Expansion rollout
- M-6 (checkpointing) → prerequisite for long-run reliability + session continuity

---

## 4) Deferred-by-Design (Explicit Non-MVP)

- Hierarchy/subteam spawning beyond depth 0
- Remote sandbox/remote execution default enablement
- Timer-driven reconcile loop
- Signed extension marketplace / public plugin distribution
- Strict event-sequence replay equivalence

---

## 5) Rollout Gates

### Gate A (MVP foundation complete)
- [x] Build + all tests pass
- [x] Policy transition/cap tests pass
- [x] Mutable graph conflict/replay tests pass
- [x] Toolpack manifest + trust-gate tests pass

### Gate B (MVP autonomy safety)
- [ ] Reconcile stale-heartbeat escalation observed in integration scenario
- [ ] Regression gate report wired into release pipeline
- [ ] Approval bypass incidents = 0 in staged runs

### Gate C (Expansion unlock)
- [ ] Snapshot/retention policy shipped
- [ ] Reconcile + compensation scenarios stable
- [ ] Eval + safety KPI thresholds met

---

## 6) Decision Register

- Ratified decisions: `.omx/plans/open-questions.md`
- Runtime contract source-of-truth: `docs/feature-specs/runtime-policy-contract.md`
