# Leader empirical findings — local harness surfaces exercised during research

Date: 2026-04-02
Scope: direct validation of the current `harness` package using its own tests and CLI commands against locally available `~/.ssenrah/events/events.jsonl` data.

## Commands run

```bash
cd harness && npm test
npx tsx harness/src/cli.ts summary
npx tsx harness/src/cli.ts sessions
npx tsx harness/src/cli.ts anomalies
npx tsx harness/src/cli.ts timeline --limit 40
npx tsx harness/src/cli.ts agents
npx tsx harness/src/cli.ts tasks
npx tsx harness/src/cli.ts cost --session 6ef49eca
npx tsx harness/src/cli.ts verify --session 521b3790
npx tsx harness/src/cli.ts reasoning --session 521b3790 --limit 12
```

## Fresh evidence

### 1) Test suite passes end-to-end
- `cd harness && npm test`
- Result: **9 test files, 103 tests passed**, duration about **57.28s**.
- Evidence categories covered by tests:
  - telemetry
  - verification
  - reasoning extraction
  - cost tracking
  - anomaly detection
  - escalation
  - redaction
  - hook ingestion
  - CLI surfaces

This is strong evidence that the current harness is not just a sketch: the main monitoring/verification features are executable and regression-tested.

### 2) The CLI surfaces already work as a practical operator console
`summary` returned:
- total events: **1483**
- sessions: **10**
- tool uses: **476**
- errors: **12**
- subagents: **6**
- tasks completed: **14**
- top tools: Read 162, Bash 145, Edit 65, TaskUpdate 28, Glob 16
- estimated total cost: **$2387.67**

`timeline`, `agents`, and `tasks` all produced usable derived views from the same underlying log.

### 3) Verification surface is already valuable
`verify --session 521b3790` produced a session audit with:
- duration: **23m 33s**
- total events: **258**
- files edited: **26**
- files read: **46**
- commands run: **11**
- tests run: **0**
- errors: **2**
- unique modified files surfaced explicitly: **13**

This is exactly the kind of human-facing review surface that a harness needs for “what changed, what ran, what failed?”

### 4) Reasoning extraction works on real transcripts
`reasoning --session 521b3790 --limit 12` produced:
- turns: **49**
- reasoning items: **32**
- decisions: **67**
- prompts: **3**
- model: **claude-opus-4-6**

The sample output showed concrete edit/test/verification decisions tied to tool calls, which makes the V-3 “why did the agent do this?” goal realistic rather than aspirational.

### 5) Anomaly detection currently surfaces cost spikes in live data
`anomalies` reported **5 anomalies**, all cost-spike based:
- 4 critical
- 1 warning

This confirms the anomaly pipeline is functioning on real logs. It also suggests the current detection mix is more mature for cost than for loop/thrashing/error-cascade incidents in this dataset.

## Important empirical gap discovered during this run

### Cost accounting inconsistency across CLI surfaces
There is a significant mismatch between event-summed cost views and transcript-derived cost views.

Observed outputs:
- `summary` total estimated cost: **$2387.67**
- `sessions` showed session `6ef49eca` at **$2314.56**
- `cost --session 6ef49eca` showed **$220.08** for the same session

This likely comes from how different CLI paths compute cost:
- `harness/src/hook.ts:256-265` stamps `event.cost_usd` onto `Stop` / `SessionEnd` events.
- `harness/src/cli.ts:108-119` and `163-179` sum `e.cost_usd` across all events in `summary` / `sessions`.
- `harness/src/cli.ts:235-294` recomputes authoritative cost from transcripts via `calculateSessionCost()`.

### Why this matters
For benchmarking and governance, **cost must have one authoritative source**. If dashboard views and session views can overcount relative to transcript-backed cost, then:
- escalation thresholds become noisy
- benchmark comparisons become untrustworthy
- operator dashboards lose credibility

### Recommendation from this empirical finding
Introduce a canonical session-cost rollup that is computed once per session from transcript data, then referenced everywhere else. Do not sum `event.cost_usd` across arbitrary event lists as the user-facing authority.

## What this means for the broader research pack

The repo is already strong in three ways:
1. **It has a real event substrate.**
2. **It has real derived operator surfaces.**
3. **It has real regression coverage.**

The main next step is not “add logging”; it is **tightening measurement authority and benchmark adapters** so the existing telemetry becomes reliable evaluation infrastructure.

## Repo references
- Hook capture + cost stamping + escalation/anomaly fanout: `harness/src/hook.ts:24-29`, `118-198`, `256-282`
- Cost calculation from transcripts: `harness/src/cost.ts:99-167`
- Summary/session cost aggregation: `harness/src/cli.ts:70-121`, `161-196`
- Verification view: `harness/src/verify.ts:98-193`
- Telemetry/task/agent views: `harness/src/telemetry.ts:415-637`
- Anomaly rules + thresholds: `harness/src/anomaly.ts:40-60`, `62-260`
