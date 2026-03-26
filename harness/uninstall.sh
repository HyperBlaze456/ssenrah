#!/usr/bin/env bash
# ssenrah harness uninstaller — removes hooks from Claude Code settings.
# Usage: bash harness/uninstall.sh

set -euo pipefail

SETTINGS_FILE="$HOME/.claude/settings.json"

echo "ssenrah harness uninstaller"
echo "==========================="
echo ""

if [ ! -f "$SETTINGS_FILE" ]; then
  echo "No Claude Code settings found. Nothing to uninstall."
  exit 0
fi

node -e "
const fs = require('fs');
const path = '$SETTINGS_FILE';
const settings = JSON.parse(fs.readFileSync(path, 'utf-8'));

if (!settings.hooks) {
  console.log('No hooks found in settings. Nothing to remove.');
  process.exit(0);
}

let removed = 0;
for (const [event, entries] of Object.entries(settings.hooks)) {
  const filtered = entries.filter(entry =>
    !entry.hooks?.some(h => h.command?.includes('ssenrah'))
  );
  if (filtered.length !== entries.length) {
    removed++;
    if (filtered.length === 0) {
      delete settings.hooks[event];
    } else {
      settings.hooks[event] = filtered;
    }
  }
}

if (Object.keys(settings.hooks).length === 0) {
  delete settings.hooks;
}

fs.writeFileSync(path, JSON.stringify(settings, null, 2) + '\n');
console.log('Removed ssenrah hooks from ' + removed + ' events.');
"

echo ""
echo "Hooks removed. Event logs at ~/.ssenrah/ are preserved."
echo "To delete event logs: rm -rf ~/.ssenrah/"
