# Live harness evidence

Date: 2026-04-02

## Test run
- Command: `cd harness && npm test`
- Result: 9 test files passed, 103 tests passed.
- Duration: ~57s.

## CLI summary snapshot
- Command: `npx tsx harness/src/cli.ts summary`
- Result snapshot:
  - Total events: 1483
  - Sessions: 10
  - Tool uses: 476
  - Errors: 12
  - Subagents: 6
  - Tasks completed: 14
  - Estimated cost: $2387.67

## CLI sessions snapshot
- Largest recorded session in local log sample:
  - Session `6ef49eca`: 869 events, 2484m, estimated $2314.56
- Other high-cost sessions:
  - `521b3790`: 258 events, 24m, estimated $36.46
  - `567f57f9`: 132 events, 37m, estimated $23.49

## CLI anomalies snapshot
- Command: `npx tsx harness/src/cli.ts anomalies`
- Result: 5 anomalies found; 4 critical, 1 warning.
- All surfaced anomalies in this sample were cost spikes over the configured threshold.

## CLI timeline/agents/tasks snapshot
- Timeline view shows normalized operations such as `tool.start`, `tool.success`, `agent.stop`, `session.stop`, `session.end`, and `alert.escalation`.
- Agents view distinguishes `main`, `subagent`, and `system` actors with event/tool/failure/task counts.
- Tasks view lists task completion subjects and owners.
