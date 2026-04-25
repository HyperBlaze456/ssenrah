#!/usr/bin/env bash
# ssenrah tracker uninstaller — removes hooks from Claude Code settings.
# Usage: bash tracker/uninstall.sh

set -euo pipefail

SETTINGS_FILE="$HOME/.claude/settings.json"

echo "ssenrah tracker uninstaller"
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
  // Match either current ssenrah-hook references or any direct path to our hook.ts file.
  const filtered = entries
    .map(entry => {
      if (!entry || !Array.isArray(entry.hooks)) return entry;
      const hooks = entry.hooks.filter(h => {
        const cmd = h && typeof h.command === 'string' ? h.command : '';
        return !cmd.includes('ssenrah') && !/(?:harness|tracker)\/src\/hook\.ts/.test(cmd);
      });
      return { ...entry, hooks };
    })
    .filter(entry => Array.isArray(entry.hooks) && entry.hooks.length > 0);

  if (filtered.length !== entries.length || JSON.stringify(filtered) !== JSON.stringify(entries)) {
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
