# ssenrah harness — Installation Guide

Agent transparency layer for Claude Code. Captures every hook event to a local JSONL log with automatic secret redaction.

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

**That's it.** Start a Claude Code session and events will begin logging.

## Uninstall

```bash
bash harness/uninstall.sh
```

Removes ssenrah hooks from settings. Event logs at `~/.ssenrah/` are preserved.

## Verify It Works

After running any Claude Code session:

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
| `cost` | Detailed session cost breakdown (tokens + estimated USD) |
| `cost --session abc123` | Cost for a specific session |
| `tail` | Follow new events in real-time (Ctrl+C to stop) |

## Where Events Are Stored

Events log to `~/.ssenrah/events/events.jsonl` by default.

Override with the `SSENRAH_LOG_DIR` environment variable:

```bash
SSENRAH_LOG_DIR=/custom/path npx tsx harness/src/cli.ts summary
```

## What Gets Captured

All 10 registered hook event types, including:

- **Session lifecycle**: start, end
- **Tool usage**: pre/post tool use, failures
- **Agents**: subagent start/stop
- **Tasks**: task completion events
- **Notifications**: permission prompts, idle prompts
- **Stop events**: session stop reasons

Each event includes: timestamp, session ID, event type, tool name, agent ID, and all fields the hook provides. The full raw payload is preserved in the `_raw` field for forward compatibility.

## Cost Tracking

Session cost is calculated from Claude Code transcript files (token usage per API call). The `cost` command reads transcripts directly and applies model-specific pricing.

Supported models: Claude Opus 4.6, Sonnet 4.6, Haiku 4.5. Unknown models fall back to Sonnet pricing.

Cost is estimated using API-equivalent pricing — actual cost may differ on flat-rate plans.

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

55 tests across 5 test files: redaction patterns, hook handler, CLI commands, cost tracking, and escalation engine.
