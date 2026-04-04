# ssenrah harness — Installation Guide

Agent transparency layer for Claude Code and Codex.

- **Claude Code** is captured through hooks into a local JSONL log with automatic secret redaction.
- **Codex** is auto-ingested from the local `~/.codex` runtime state and rollout transcripts under `~/.codex/sessions/`. No extra hook installation is required.

## Prerequisites

- Node.js 20+
- Claude Code CLI installed

## Install (one command)

```bash
bash harness/install.sh
```

This will:
1. Install npm dependencies
2. Add async hooks to your `~/.claude/settings.json` for 10 event types
3. Preserve any existing hooks you already have

**That's it.** Start a Claude Code session and events will begin logging. Codex sessions are auto-detected from `~/.codex/`.

## Uninstall

```bash
bash harness/uninstall.sh
```

Removes ssenrah hooks from settings. Event logs at `~/.ssenrah/` are preserved.

## Verify It Works

After running any Claude Code or Codex session:

```bash
# Check if events are being captured
npx tsx harness/src/cli.ts summary

# See recent events
npx tsx harness/src/cli.ts events

# Follow events in real-time (run in a separate terminal)
npx tsx harness/src/cli.ts tail
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `summary` | Activity overview — event counts, top tools, session count, cost |
| `events` | List recent events (default: last 20) |
| `events --type PostToolUse` | Filter by hook event type |
| `events --session abc123` | Filter by session ID (prefix match) |
| `events --limit 50` | Show more events |
| `sessions` | List all sessions with event counts, duration, and cost |
| `timeline` | Derived execution timeline across session, agents, tasks, and tools |
| `timeline --session abc123 --limit 50` | Timeline for one session |
| `agents` | Summarize main-agent and subagent activity |
| `tasks` | Summarize task lifecycle and duration |
| `cost` | Detailed session cost breakdown (tokens + estimated USD) |
| `cost --session abc123` | Cost for a specific session |
| `reasoning` | Decision chain from transcripts — thinking, reasoning, tool decisions (V-3) |
| `reasoning --session abc123` | Reasoning for a specific session |
| `anomalies` | Detect agent behavior anomalies — loops, thrashing, cascades, cost spikes (V-4) |
| `anomalies --session abc123` | Check a specific session |
| `verify` | Session verification report — files changed, tests run, errors (V-5) |
| `verify --session abc123` | Verify a specific session |
| `tail` | Follow new events in real-time (Ctrl+C to stop) |

## Where Events Are Stored

Events log to `~/.ssenrah/events/events.jsonl` by default.

Override with the `SSENRAH_LOG_DIR` environment variable:

```bash
SSENRAH_LOG_DIR=/custom/path npx tsx harness/src/cli.ts summary
```

Codex ingestion can be configured with:

```bash
# Point at a non-default Codex home
SSENRAH_CODEX_DIR=/custom/.codex npx tsx harness/src/cli.ts summary

# Or point directly at the sessions directory / a single rollout transcript
SSENRAH_CODEX_DIR=/custom/.codex/sessions npx tsx harness/src/cli.ts summary
SSENRAH_CODEX_DIR=/custom/.codex/sessions/.../rollout-abc.jsonl npx tsx harness/src/cli.ts reasoning

# Disable Codex ingestion entirely
SSENRAH_INCLUDE_CODEX=0 npx tsx harness/src/cli.ts summary
```

## What Gets Captured

Current Claude Code hook event types are captured directly, and Codex sessions are normalized into the same event schema:

- **Session lifecycle**: start, end
- **Tool usage**: pre/post tool use, failures
- **Agents**: subagent start/stop
- **Tasks**: task creation and completion events
- **Notifications**: permission prompts, idle prompts
- **Stop events**: session stop reasons
- **Filesystem/worktree**: cwd, file, and worktree changes
- **Elicitation**: request/result interactions

Each event includes: timestamp, session ID, event type, tool name, agent ID, and all fields the source provides. The full raw payload is preserved in the `_raw` field for forward compatibility.

## Cost Tracking

Session cost is calculated from transcripts:

- **Claude Code**: assistant-message usage blocks in Claude transcripts
- **Codex**: `token_count` snapshots in rollout transcripts

The `cost` command reads transcripts directly and applies model-specific pricing.

Supported models include Claude Opus/Sonnet/Haiku, GPT-5.4 family, and GPT-5.3-Codex-family pricing. Unknown models fall back to Sonnet pricing.

Cost is estimated using API-equivalent pricing — actual cost may differ on flat-rate plans.

## Reasoning Extraction

Reasoning is transcript-backed for both providers:

- **Claude Code**: structured thinking / reasoning / tool-use blocks
- **Codex**: rollout turn contexts, reasoning summaries when present, encrypted-reasoning markers, tool calls, and final assistant outputs

Codex encrypted reasoning is preserved only as an indicator unless the transcript includes a plaintext summary.

## Escalation Rules

Configurable threshold alerts in `~/.ssenrah/escalation.json` (auto-created with defaults on first run):

```json
{
  "rules": [
    { "name": "High session cost", "condition": "session_cost_exceeds", "threshold": 5.00, "action": "log" },
    { "name": "Too many errors", "condition": "error_count_exceeds", "threshold": 10, "action": "log" },
    { "name": "Long-running session", "condition": "session_duration_exceeds", "threshold": 7200, "action": "log" }
  ]
}
```

**Conditions:** `session_cost_exceeds` (USD), `error_count_exceeds` (count), `session_duration_exceeds` (seconds).

**Actions:** `log` (writes an `_escalation` event to the JSONL log), `console` (also writes to stderr).

Edit the thresholds or add/remove rules to match your needs.

## Security: Automatic Redaction

The hook automatically redacts sensitive patterns from `tool_input` before writing to the log:

- API keys (`api_key=...`, `apikey: ...`)
- Bearer tokens (`Authorization: Bearer ...`)
- Passwords (`password=...`, `secret=...`)
- Environment secrets (`ANTHROPIC_API_KEY=...`, `OPENAI_API_KEY=...`, etc.)
- Private key blocks (`-----BEGIN PRIVATE KEY-----`)
- Connection strings (`postgres://...`, `mongodb://...`)

Redacted values appear as `[REDACTED:type]` in the log. Raw payloads in `_raw` are also redacted.

## Uninstall

Remove the `hooks` key from `~/.claude/settings.json`. Optionally delete `~/.ssenrah/` to remove event logs.

## Running Tests

```bash
cd harness/
npm test
```

116 tests across 10 test files: redaction, hook handler, Codex ingestion, CLI, cost tracking, escalation, reasoning extraction, anomaly detection, and session verification.
