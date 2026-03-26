#!/usr/bin/env bash
# ssenrah harness installer — hooks into Claude Code automatically.
# Usage: bash harness/install.sh

set -euo pipefail

HARNESS_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK_SCRIPT="$HARNESS_DIR/src/hook.ts"
SETTINGS_FILE="$HOME/.claude/settings.json"

echo "ssenrah harness installer"
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
cd "$HARNESS_DIR"
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
node -e "
const fs = require('fs');
const path = '$SETTINGS_FILE';
const hookCmd = 'npx tsx $HOOK_SCRIPT';

const settings = JSON.parse(fs.readFileSync(path, 'utf-8'));

const hookEntry = (cmd) => [{ hooks: [{ type: 'command', command: cmd, async: true }] }];

const events = [
  'SessionStart', 'SessionEnd',
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'SubagentStart', 'SubagentStop',
  'TaskCompleted', 'Notification', 'Stop'
];

if (!settings.hooks) settings.hooks = {};

let added = 0;
let skipped = 0;
for (const event of events) {
  if (settings.hooks[event]) {
    // Check if ssenrah hook is already registered
    const hasSsenrah = settings.hooks[event].some(entry =>
      entry.hooks?.some(h => h.command?.includes('ssenrah'))
    );
    if (hasSsenrah) {
      skipped++;
      continue;
    }
    // Append to existing hooks for this event
    settings.hooks[event].push(...hookEntry(hookCmd));
  } else {
    settings.hooks[event] = hookEntry(hookCmd);
  }
  added++;
}

fs.writeFileSync(path, JSON.stringify(settings, null, 2) + '\n');
console.log('      Added ssenrah hooks for ' + added + ' events' + (skipped > 0 ? ' (' + skipped + ' already installed)' : ''));
"

echo ""
echo "Installation complete!"
echo ""
echo "Events will be captured to: ~/.ssenrah/events/events.jsonl"
echo ""
echo "CLI commands (run from repo root):"
echo "  npx tsx harness/src/cli.ts summary     — activity overview"
echo "  npx tsx harness/src/cli.ts events      — list recent events"
echo "  npx tsx harness/src/cli.ts sessions    — list all sessions"
echo "  npx tsx harness/src/cli.ts tail        — follow events live"
echo ""
echo "Start a new Claude Code session to begin capturing events."
