# Hooks

Hooks are lifecycle callbacks that execute at specific points in the agent harness.

## Planned Hook Events (v0.3+)
- `PreToolUse` — Before a tool is executed
- `PostToolUse` — After a tool completes
- `SessionStart` — When a new session begins
- `SessionEnd` — When a session ends

## Configuration
Hook definitions will be loaded from this directory as markdown files with YAML frontmatter.
