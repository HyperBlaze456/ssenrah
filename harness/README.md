# Example: Provider-Agnostic TypeScript Harness

This folder contains the hackathon harness reference implementation.

## What’s included

- **Provider adapters** (`providers/`)
  - Anthropic (`@anthropic-ai/sdk`)
  - Gemini (`@google/genai`, including vision content blocks)
  - OpenAI-compatible (`fetch`, configurable `baseUrl`)
- **Core agent loop** (`agent/`)
  - Provider-agnostic chat + tool loop
  - Provider-native tool calling by default (optional legacy intent gate)
  - Tool fallback agent on failures
  - Event logging to `~/.ssenrah/sessions/<id>/events.jsonl`
- **Harness safety primitives** (`harness/`)
  - `intent.ts` — parse/validate intent declarations
  - `risk-inference.ts` — infer tool risk directly from provider tool calls
  - `mcp-config.ts`, `mcp-stdio-client.ts`, `mcp-runtime.ts` — MCP server loading + stdio transport + runtime tool exposure
  - `beholder.ts` — drift/loop/rate/budget oversight
  - `fallback.ts` — constrained retry planner
  - `events.ts` — JSONL logger
  - `checkpoints.ts` — session checkpoints at `~/.ssenrah/sessions/<sessionId>/checkpoints/*.json`
- **Vision QA showcase**
  - Harness component hook (`harness/components/vision-qa.ts`)
  - Markdown skill (`skills/vision-qa.md`)
  - Split tools (`tools/vision/capture-screenshot.ts`, `tools/vision/analyze-image.ts`)
- **Team mode** (`teams/`)
  - Orchestrator + worker pool
  - Dependency-aware task graph scheduling (`blockedBy`, `priority`)
  - In-memory mailbox for orchestrator/worker coordination
  - Optional shared Beholder monitoring workers
  - Worker restart attempts on kill/timeout

## Scripts

```bash
cd harness
npm install

# Build
npm run build

# Tests
npm test

# Interactive agent CLI
npm run agent -- --provider gemini --model gemini-2.0-flash --overseer
# Enable MCP servers from project config
npm run agent -- --provider gemini --model gemini-2.0-flash --mcp --mcp-config ./.ssenrah/mcp.servers.json
# Streamed response output (default on, disable with --no-stream)
npm run agent -- --provider openai --model gpt-4o --stream
# Live split-pane layout is now opt-in
npm run agent -- --layout
# Keep split-pane layout but avoid full-screen redraws
npm run agent -- --layout-style diff
# Reset persisted CLI preferences
npm run agent -- --reset-prefs
# In-session commands
# /help  /stream on|off  /layout on|off  /layout style full|diff  /panels on|off  /pane ...  /prefs ...  /send  /cancel  /clear  /exit
# Keyboard shortcuts: Ctrl+L clear, Ctrl+G stream, Ctrl+O layout, Ctrl+B panels, Ctrl+J newline
# Multiline prompt: use "\ + Enter" or Ctrl+J to continue, then Enter to submit (or /send)

# Harness demo
npm run demo:harness

# Vision QA demo
npm run demo:vision-qa -- ./path/to/screenshot.png "optional context"
```

## MCP config (`stdio` v1)

Create `.ssenrah/mcp.servers.json` in the project root:

```json
{
  "servers": {
    "docs": {
      "transport": "stdio",
      "command": "${MCP_DOCS_BIN}",
      "args": ["--stdio"],
      "allowlist": {
        "tools": ["search_docs"],
        "toolRisks": {
          "search_docs": "read"
        },
        "resources": ["resource://docs/index"],
        "resourceRisks": {
          "resource://docs/index": "read"
        },
        "prompts": ["summarize_doc"],
        "promptRisks": {
          "summarize_doc": "read"
        }
      }
    }
  }
}
```

Notes:
- `transport` currently supports only `stdio`.
- `${VAR}` placeholders are resolved from environment variables at startup.
- Every allowlisted tool/resource/prompt requires an explicit risk entry.
- Exposed tool names are namespaced (`mcp.<server>.*`) and added via `mcp` + `mcp.<server>` tool packs.

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
