# Example: Provider-Agnostic TypeScript Harness

This folder contains the hackathon harness reference implementation.

## What’s included

- **Provider adapters** (`providers/`)
  - Anthropic (`@anthropic-ai/sdk`)
  - Gemini (`@google/genai`, including vision content blocks)
  - OpenAI-compatible (`fetch`, configurable `baseUrl`)
- **Core agent loop** (`agent/`)
  - Provider-agnostic chat + tool loop
  - Intent gate (tool calls must declare intent)
  - Tool fallback agent on failures
  - Event logging to `~/.ssenrah/sessions/<id>/events.jsonl`
- **Harness safety primitives** (`harness/`)
  - `intent.ts` — parse/validate intent declarations
  - `beholder.ts` — drift/loop/rate/budget oversight
  - `fallback.ts` — constrained retry planner
  - `events.ts` — JSONL logger
- **Vision QA showcase** (`tools/vision-qa.ts`, `skills/vision-qa-agent.ts`)
- **Team mode** (`teams/`)
  - Orchestrator + worker pool
  - Dependency-aware task graph scheduling (`blockedBy`, `priority`)
  - In-memory mailbox for orchestrator/worker coordination
  - Optional shared Beholder monitoring workers
  - Worker restart attempts on kill/timeout

## Scripts

```bash
cd examples
npm install

# Build
npm run build

# Tests
npm test

# Interactive agent CLI
npm run agent -- --provider gemini --model gemini-2.0-flash --overseer
# Streamed TUI mode (default on, disable with --no-stream)
npm run agent -- --provider openai --model gpt-4o --stream
# Disable split-pane live layout if needed
npm run agent -- --no-layout
# Reset persisted CLI preferences
npm run agent -- --reset-prefs
# In-session commands
# /help  /stream on|off  /layout on|off  /panels on|off  /pane ...  /prefs ...  /clear  /exit
# Keyboard shortcuts: Ctrl+L clear, Ctrl+G stream, Ctrl+O layout, Ctrl+B panels

# Harness demo
npm run demo:harness

# Vision QA demo
npm run demo:vision-qa -- ./path/to/screenshot.png "optional context"
```

## Environment variables

- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY` (or `GOOGLE_API_KEY`)
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL` (optional, for OpenAI-compatible endpoints like OpenRouter)
- `OPENROUTER_BASE_URL` (optional alias for OpenRouter)

Optional demo overrides:
- `SSENRAH_PROVIDER=anthropic|gemini|openai`
- `SSENRAH_MODEL=<model-id>`
- `SSENRAH_FALLBACK_MODEL=<model-id>`
