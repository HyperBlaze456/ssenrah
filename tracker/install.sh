#!/usr/bin/env bash
# ssenrah tracker installer — hooks into Claude Code automatically.
# Usage: bash tracker/install.sh

set -euo pipefail

TRACKER_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK_DIST="$TRACKER_DIR/dist/hook.js"
SETTINGS_FILE="$HOME/.claude/settings.json"

echo "ssenrah tracker installer"
echo "========================="
echo ""

# 1. Check prerequisites
if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js is required. Install it from https://nodejs.org"
  exit 1
fi

if ! command -v npx &>/dev/null; then
  echo "ERROR: npx not found. Install Node.js 16+ which includes npx."
  exit 1
fi

echo "[1/4] Prerequisites OK (node $(node -v))"

# 2. Install npm dependencies and compile to dist/
#    The hook runs the compiled JS via `node` — NOT `npx tsx` — so each of the
#    many per-tool-call hook processes starts instantly instead of re-transpiling
#    the TypeScript source (and its esbuild dependency) from scratch every time.
echo "[2/4] Installing dependencies & building..."
cd "$TRACKER_DIR"
npm install --silent 2>/dev/null
npm run build --silent 2>/dev/null
echo "      Done."

# 3. Verify the compiled hook exists
if [ ! -f "$HOOK_DIST" ]; then
  echo "ERROR: Build output not found at $HOOK_DIST (did 'npm run build' fail?)"
  exit 1
fi
echo "[3/4] Hook built at $HOOK_DIST"

# 4. Patch Claude Code settings
echo "[4/4] Adding hooks to Claude Code settings..."

if [ ! -f "$SETTINGS_FILE" ]; then
  mkdir -p "$(dirname "$SETTINGS_FILE")"
  echo '{}' > "$SETTINGS_FILE"
  echo "      Created $SETTINGS_FILE"
fi

# Use node to safely merge hooks into existing settings
# Migration safety: prune any stale ssenrah entries (e.g. old `harness/src/hook.ts`)
# before we add the current `tracker/src/hook.ts` registration.
node -e "
const fs = require('fs');
const path = '$SETTINGS_FILE';
const hookCmd = 'node $HOOK_DIST';

const settings = JSON.parse(fs.readFileSync(path, 'utf-8'));

const hookEntry = (cmd) => [{ hooks: [{ type: 'command', command: cmd, async: true }] }];

// Curated event set. Every registered event spawns a separate hook process when
// it fires, so we deliberately omit the high-frequency duplicates that used to
// multiply per tool call:
//   - PreToolUse      -> PostToolUse already records the call (with its result)
//   - PostToolBatch   -> redundant with the individual PostToolUse events
//   - FileChanged/CwdChanged/UserPromptExpansion/InstructionsLoaded -> noisy and
//     derivable from the events we do keep
// What remains captures the full session/tool/agent lifecycle at roughly one
// process per tool call instead of four or five.
const events = [
  'SessionStart', 'SessionEnd',
  'UserPromptSubmit',
  'PostToolUse', 'PostToolUseFailure',
  'PermissionRequest', 'PermissionDenied',
  'SubagentStart', 'SubagentStop',
  'TaskCreated', 'TaskCompleted',
  'Notification',
  'Stop', 'StopFailure',
  'PreCompact', 'PostCompact'
];

if (!settings.hooks) settings.hooks = {};

let added = 0;
let migrated = 0;
let skipped = 0;
for (const event of events) {
  const existing = settings.hooks[event];
  if (existing && Array.isArray(existing)) {
    // Strip any prior ssenrah entry so we always end up with a single, current hook.
    const before = existing.length;
    const filtered = existing
      .map((entry) => {
        if (!entry || !Array.isArray(entry.hooks)) return entry;
        const isSsenrah = (cmd) => cmd && (cmd.includes('ssenrah') || cmd.includes('hook.ts') || cmd.includes('hook.js'));
        const hooks = entry.hooks.filter((h) => !isSsenrah(h.command));
        return { ...entry, hooks };
      })
      .filter((entry) => Array.isArray(entry.hooks) && entry.hooks.length > 0);

    const wasSsenrah = (cmd) => cmd && (cmd.includes('ssenrah') || cmd.includes('hook.ts') || cmd.includes('hook.js'));
    if (before !== filtered.length || existing.some((entry) => Array.isArray(entry.hooks) && entry.hooks.some((h) => wasSsenrah(h.command)))) {
      migrated++;
    }

    settings.hooks[event] = [...filtered, ...hookEntry(hookCmd)];
    added++;
  } else {
    settings.hooks[event] = hookEntry(hookCmd);
    added++;
  }
}

fs.writeFileSync(path, JSON.stringify(settings, null, 2) + '\n');
const migrationNote = migrated > 0 ? ' (migrated ' + migrated + ' stale entries)' : '';
console.log('      Registered ssenrah hooks for ' + added + ' events' + migrationNote);
"

echo ""
echo "Installation complete!"
echo ""
echo "Events will be captured to: ~/.ssenrah/events/events.jsonl"
echo ""
echo "CLI commands (run from repo root):"
echo "  npx tsx tracker/src/cli.ts summary       — activity overview"
echo "  npx tsx tracker/src/cli.ts events        — list recent events"
echo "  npx tsx tracker/src/cli.ts sessions      — list all sessions"
echo "  npx tsx tracker/src/cli.ts tail          — follow events live"
echo "  npx tsx tracker/src/cli.ts codex status  — Codex ingestion diagnostics"
echo "  npx tsx tracker/src/cli.ts codex sync    — import Codex sessions into the JSONL log"
echo ""
echo "Start a new Claude Code session to begin capturing events."
