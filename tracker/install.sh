#!/usr/bin/env bash
# ssenrah tracker installer — hooks into Claude Code automatically.
# Usage: bash tracker/install.sh

set -euo pipefail

TRACKER_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK_SCRIPT="$TRACKER_DIR/src/hook.ts"
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

# 2. Install npm dependencies
echo "[2/4] Installing dependencies..."
cd "$TRACKER_DIR"
npm install --silent 2>/dev/null
echo "      Done."

# 3. Verify hook script exists
if [ ! -f "$HOOK_SCRIPT" ]; then
  echo "ERROR: Hook script not found at $HOOK_SCRIPT"
  exit 1
fi
echo "[3/4] Hook script found at $HOOK_SCRIPT"

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
const hookCmd = 'npx tsx $HOOK_SCRIPT';

const settings = JSON.parse(fs.readFileSync(path, 'utf-8'));

const hookEntry = (cmd) => [{ hooks: [{ type: 'command', command: cmd, async: true }] }];

// Full event surface that the tracker can interpret as of April 2026.
const events = [
  'SessionStart', 'SessionEnd',
  'InstructionsLoaded',
  'UserPromptSubmit', 'UserPromptExpansion',
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PostToolBatch',
  'PermissionRequest', 'PermissionDenied',
  'SubagentStart', 'SubagentStop',
  'TaskCreated', 'TaskCompleted',
  'Notification',
  'Stop', 'StopFailure',
  'TeammateIdle',
  'ConfigChange', 'CwdChanged', 'FileChanged',
  'WorktreeCreate', 'WorktreeRemove',
  'PreCompact', 'PostCompact',
  'Elicitation', 'ElicitationResult'
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
        const hooks = entry.hooks.filter((h) => !h.command || !h.command.includes('ssenrah') && !h.command.includes('hook.ts'));
        return { ...entry, hooks };
      })
      .filter((entry) => Array.isArray(entry.hooks) && entry.hooks.length > 0);

    if (before !== filtered.length || existing.some((entry) => Array.isArray(entry.hooks) && entry.hooks.some((h) => h.command && (h.command.includes('ssenrah') || h.command.includes('hook.ts'))))) {
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
