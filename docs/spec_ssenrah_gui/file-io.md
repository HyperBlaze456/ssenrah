# File Operations

How the GUI reads and writes Claude Code configuration files. Covers path resolution, read/write strategies, atomic writes, auto-creation, and concurrency.

**Related**: [platform.md](platform.md) for OS-specific paths, [ipc.md](ipc.md) for the IPC commands that trigger these operations, [errors.md](errors.md) for failure handling.

---

## Path Resolution

All paths are resolved by the Rust backend. The frontend never constructs filesystem paths — it passes a scope enum and the backend resolves to an absolute path.

### Resolution Table

| Scope | File | Resolution |
|-------|------|------------|
| user | `settings.json` | `{configDir}/settings.json` |
| project | `settings.json` | `{projectRoot}/.claude/settings.json` |
| local | `settings.local.json` | `{projectRoot}/.claude/settings.local.json` |
| managed | `managed-settings.json` | OS-specific (see [platform.md](platform.md)) |
| project | `.mcp.json` | `{projectRoot}/.claude/.mcp.json` |
| user | `~/.claude.json` | `{homeDir}/.claude.json` |
| managed | `managed-mcp.json` | OS-specific (see [platform.md](platform.md)) |
| user | `CLAUDE.md` | `{configDir}/CLAUDE.md` |
| project | `CLAUDE.md` | `{projectRoot}/.claude/CLAUDE.md` |
| project_root | `CLAUDE.md` | `{projectRoot}/CLAUDE.md` |
| local | `CLAUDE.local.md` | `{projectRoot}/.claude/CLAUDE.local.md` |
| user | agents | `{configDir}/agents/` |
| project | agents | `{projectRoot}/.claude/agents/` |
| user | skills | `{configDir}/skills/` |
| project | skills | `{projectRoot}/.claude/skills/` |

Where:
- `{configDir}` = `~/.claude/` (or `$CLAUDE_CONFIG_DIR` if set)
- `{projectRoot}` = the active project directory
- `{homeDir}` = user home directory

---

## Read Strategy

### When Reads Happen

1. **Project open** — read all config files for the project and user scopes
2. **File watcher notification** — re-read the specific changed file
3. **Scope switch** — re-read if the store doesn't have cached data for that scope
4. **Manual refresh** — user clicks refresh (re-reads all files for current scope)

### Read Behavior

```
read_file(path):
  if file does not exist:
    return null                    // not an error — scope may not have this file
  if file is not readable (permission denied):
    return IpcError::permission_denied

  content = read file contents

  if JSON file:
    parse JSON
    if parse fails:
      return IpcError::parse_error   // with line/column if available
    return parsed object

  if Markdown file (CLAUDE.md, agents, skills):
    return raw string              // frontmatter parsing is done separately
```

### Missing File vs. Error

A missing file is **not an error**. Many config files are optional — a project may not have `.claude/settings.json` or `.claude/.mcp.json`. The frontend treats `null` as "this scope has no configuration" and shows an empty form.

A file that exists but is malformed **is an error**. The frontend shows a parse error banner with the option to open the file in an external editor.

---

## Write Strategy

### Atomic Write

All writes use temp-file + rename to prevent Claude Code from reading partial data.

```
atomic_write(path, content):
  temp_path = path + ".ssenrah-tmp"

  write content to temp_path
  if write fails:
    delete temp_path (best-effort)
    return IpcError::write_failed

  rename temp_path → path
  if rename fails:
    delete temp_path (best-effort)
    return IpcError::write_failed

  return Ok
```

The temp file uses the `.ssenrah-tmp` suffix so it's clearly identifiable and won't be picked up by Claude Code.

### Debounced Auto-Save

The frontend debounces writes with a **500ms** delay from the last user input.

```
on_user_input(field, value):
  update store immediately (optimistic UI)
  cancel any pending debounce timer for this scope+file
  start new 500ms timer:
    on_timer_fire:
      serialize store → config object
      validate (see validation.md)
      if valid:
        invoke write_* IPC command
      if invalid:
        show validation errors inline
        do NOT write (keep pending state in store)
```

### Write Ordering

If multiple writes are debounced for the same file, only the last one executes. If writes target different files (e.g., `settings.json` and `.mcp.json`), they execute independently.

---

## Auto-Create Behavior

### `.claude/` Directory

Created automatically when:
- The user makes their first edit to any project-scoped or local-scoped config
- The user explicitly creates an agent or skill at project scope

**Not** created when:
- The user only reads/views project config (read operations never create directories)
- The project has no `.claude/` and the user hasn't edited anything

### New Config Files

Created automatically when:
- A write targets a file that doesn't exist yet (e.g., first project `settings.json`)
- Parent directory (`.claude/`) is created first if needed

### Agent/Skill Directories

- `agents/` directory is created under `.claude/` or `~/.claude/` when the first agent is created at that scope
- `skills/<name>/` directory is created when a new skill is created

---

## Concurrency

### External Changes While GUI Has Pending Edits

Scenario: The user is editing permissions in the GUI (unsaved, debounce pending), and Claude Code writes to the same `settings.json`.

**Behavior**:

1. File watcher detects the external change
2. Backend emits `file_change` event to frontend
3. Frontend compares the external change with its pending (unsaved) state
4. **If the changed fields don't overlap** with pending edits: merge silently — reload the non-conflicting fields, keep pending edits
5. **If the changed fields overlap**: show a conflict banner with options:
   - "Keep my changes" — discard external changes for conflicting fields, write on next save
   - "Reload from disk" — discard pending edits, load external version
   - "Open diff" — show side-by-side comparison

### Conflict Detection

Conflict detection is field-level, not file-level. The store tracks which fields have been modified since last save (`dirtyFields: Set<string>`). On external change, only dirty fields are checked for conflicts.

```typescript
interface PendingState {
  dirtyFields: Set<string>;         // JSON paths modified by user
  lastSavedVersion: Settings;       // snapshot at last successful write/read
  currentVersion: Settings;         // live store state with user edits
}
```

### Multiple GUI Instances

Not supported. Only one ssenrah GUI instance should be running per user session. The backend uses a lockfile (`{configDir}/.ssenrah.lock`) to detect and warn about duplicate instances. Second instance shows "Another instance is running" and exits.

---

## File Watcher Setup

### Watched Paths

When a project is opened, the backend sets up watchers for:

| Path | Events |
|------|--------|
| `{configDir}/settings.json` | modify, create, delete |
| `{projectRoot}/.claude/settings.json` | modify, create, delete |
| `{projectRoot}/.claude/settings.local.json` | modify, create, delete |
| `{projectRoot}/.claude/.mcp.json` | modify, create, delete |
| `{homeDir}/.claude.json` | modify |
| `{configDir}/CLAUDE.md` | modify, create, delete |
| `{projectRoot}/.claude/CLAUDE.md` | modify, create, delete |
| `{projectRoot}/CLAUDE.md` | modify, create, delete |
| `{projectRoot}/.claude/CLAUDE.local.md` | modify, create, delete |
| `{configDir}/agents/` | modify, create, delete (recursive) |
| `{projectRoot}/.claude/agents/` | modify, create, delete (recursive) |
| `{configDir}/skills/` | modify, create, delete (recursive) |
| `{projectRoot}/.claude/skills/` | modify, create, delete (recursive) |

### Debouncing

File watcher events are debounced at **100ms** to coalesce rapid filesystem events (some editors write in multiple steps). This is separate from the 500ms write debounce.

### Self-Write Filtering

The backend ignores file change events that result from its own atomic writes. It tracks "in-flight" writes and suppresses corresponding watcher events for those paths within a 200ms window after the write completes.
