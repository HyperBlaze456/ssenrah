# Runtime Policy Contract (MVP)

Updated: 2026-02-26

## Purpose

Single source of truth for:
- deterministic runtime phase transitions
- feature flags for staged rollout
- safety cap enforcement defaults
- trust-gated extension loading

Implementation reference:
- `examples/teams/policy.ts`

## Deterministic Phase Transitions

Allowed transitions:

- `idle -> planning`
- `planning -> await_approval | executing | failed`
- `await_approval -> executing | failed | idle`
- `executing -> reconciling | synthesizing | failed | await_user`
- `reconciling -> executing | synthesizing | failed | await_user`
- `synthesizing -> completed | failed`
- `completed -> idle`
- `failed -> idle`
- `await_user -> executing | reconciling | failed | idle`

Any illegal transition MUST fail-closed with `PolicyViolation`.

## MVP Feature Flags

Default values (all false by default):

- `reconcileEnabled`
- `mutableGraphEnabled`
- `priorityMailboxEnabled`
- `traceReplayEnabled`
- `regressionGatesEnabled`
- `trustGatingEnabled`
- `hierarchyEnabled`

Hierarchy is explicitly post-MVP (`hierarchyEnabled=false`, `maxDepth=0` by default).

## Safety Caps (MVP Defaults)

- `maxTasks = 20`
- `maxWorkers = 5`
- `maxDepth = 0`
- `maxRetries = 2`
- `maxCompensatingTasks = 3`
- `maxRuntimeMs = 600000`
- `reconcileCooldownMs = 5000`
- `heartbeatStalenessMs = 30000`
- `workerTimeoutMs = 120000`

Cap overflow MUST force policy violation and escalation to user gate.

## Reconcile Triggers (MVP)

MVP model:
- event-driven reconcile (`task_resolved`, dependency failures, worker failure/restart)
- heartbeat-stale trigger

Timer-based polling is deferred to Expansion.

## Replay Guarantee (MVP)

MVP replay guarantee:
- final-state equivalence + patch sequence integrity

Strict byte-for-byte event sequence equivalence is deferred.

## Trust-Gated Extensibility

Trust levels:
- `untrusted < workspace < user < managed`

When `trustGatingEnabled=true`:
- manifest validation required (`name`, semver-like `version`, capabilities list)
- insufficient trust MUST deny load
- `untrusted` blocks privileged capabilities (`write`, `exec`, `network`, `hook`, `plugin`)

