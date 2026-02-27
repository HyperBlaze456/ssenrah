# Error Handling

Error taxonomy, recovery strategies, and user-facing behavior for every error category.

**Related**: [ipc.md](ipc.md) for `IpcError` type, [file-io.md](file-io.md) for file operation details, [validation.md](validation.md) for validation errors.

---

## Error Categories

### 1. File System Errors

#### File Not Found

**When**: Reading a config file that doesn't exist.

**Recovery**: Not an error for optional files. The IPC layer returns `null`, and the frontend treats it as "no config at this scope." If the file is expected to exist (e.g., user clicks "edit" on a listed agent), show a toast: "File was deleted externally."

#### Permission Denied

**When**: Reading or writing a file the process doesn't have access to.

**User message**: "Cannot access {filename} — permission denied. Check file permissions."

**Recovery**: Show error banner on the affected panel. Disable editing for that scope. Offer "Retry" button. On managed settings, this is expected on some platforms — show "Managed settings are controlled by your organization."

#### Corrupt/Malformed JSON

**When**: A config file exists but contains invalid JSON.

**User message**: "Settings file contains invalid JSON (line {n}, column {m}). Open in editor to fix."

**Recovery**:
- Show error banner with parse error details
- Disable the form for that scope (don't display half-parsed data)
- Offer "Open in external editor" button (opens in system default editor)
- Offer "Reset to empty" button (writes `{}` — only if user confirms)
- Continue loading other scopes normally

#### Corrupt/Malformed YAML Frontmatter

**When**: An agent or skill `.md` file has invalid YAML frontmatter.

**User message**: "Agent file has invalid frontmatter. Open in editor to fix."

**Recovery**: Same as corrupt JSON but for the specific agent/skill entry. Other agents/skills remain functional.

#### Disk Full / Write Failed

**When**: Atomic write fails (either temp file creation or rename).

**User message**: "Failed to save — disk may be full or path is read-only."

**Recovery**:
- Keep the unsaved state in the store (don't lose user's work)
- Show persistent error toast with "Retry" button
- If repeated failures, suggest checking disk space

#### File Locked

**When**: Another process has an exclusive lock on the file.

**User message**: "File is locked by another process. Retry in a moment."

**Recovery**: Automatic retry after 1 second, up to 3 attempts. If still locked, show error with "Retry" button.

---

### 2. Concurrent Modification

#### External Change During Edit (No Conflict)

**When**: File watcher detects a change, but the changed fields don't overlap with the user's dirty fields.

**Behavior**: Silent merge. Reload the non-dirty fields from disk. No user notification needed.

#### External Change During Edit (Conflict)

**When**: File watcher detects a change that overlaps with the user's unsaved edits.

**User message**: "Settings were modified externally. Your unsaved changes conflict with the external changes."

**Recovery**: Conflict banner with three options:
- **Keep my changes** — next save will overwrite the external changes for conflicting fields
- **Reload from disk** — discard user's pending edits, load the external version
- **View diff** — open side-by-side comparison showing both versions

See [file-io.md](file-io.md) for the conflict detection mechanism.

#### Stale Write

**When**: The user saves, but between the debounce trigger and the actual write, the file was externally modified.

**Behavior**: The write proceeds (last-writer-wins). This is intentional — the 500ms debounce window is short, and the user's intent was to save. The file watcher will detect our write and not create a false conflict.

---

### 3. Platform Errors

#### Claude Code Not Installed

**When**: `get_platform_info` can't find the `claude` binary.

**User message**: "Claude Code doesn't appear to be installed. The GUI can still edit config files, but some features (like validation) may be limited."

**Recovery**: Non-blocking warning. All file editing works regardless — we don't depend on the Claude Code binary. Just skip features that require it (e.g., future MCP server testing).

#### Wrong/Unknown OS Paths

**When**: Path resolution fails (e.g., can't determine home directory).

**User message**: "Could not determine config directory. Please set CLAUDE_CONFIG_DIR environment variable."

**Recovery**: Show setup dialog asking user to specify the config directory manually.

#### Missing Project Root

**When**: User hasn't opened a project, but switches to project/local scope.

**User message**: "No project open. Open a project to configure project-scoped settings."

**Recovery**: Show project picker. Disable project/local scope tabs until a project is opened.

#### WSL Path Issues

**When**: On Windows, WSL paths don't resolve correctly.

**Detection**: Check if running in WSL context (`/proc/version` contains "microsoft").

**Recovery**: Use WSL-aware path resolution. See [platform.md](platform.md).

---

### 4. Validation Errors

#### Schema Validation Failure

**When**: User input doesn't match the Zod schema.

**User message**: Inline field error (e.g., "Expected a number, got string").

**Recovery**: Block save until fixed. Show the error directly on the offending field. See [validation.md](validation.md) for presentation details.

#### Semantic Validation Failure

**When**: Values are structurally correct but semantically wrong.

**User message**: Context-specific inline error (e.g., "Invalid regex pattern: unterminated group").

**Recovery**: Block save for errors, allow save for warnings. See [validation.md](validation.md).

---

### 5. Application Errors

#### Lockfile Conflict (Multiple Instances)

**When**: Another ssenrah GUI instance is already running.

**User message**: "Another ssenrah instance is already running."

**Recovery**: Show dialog with "Quit" button. Don't allow proceeding — concurrent GUI instances can cause write conflicts.

#### Tauri IPC Failure

**When**: Frontend-to-backend communication fails (should not happen in normal operation).

**User message**: "Internal communication error. Please restart the application."

**Recovery**: Log the error for debugging. Show persistent error banner. "Restart" button.

---

## Error UI Patterns

### Toast Notifications

For transient, non-blocking errors. Auto-dismiss after 5 seconds unless pinned.

```typescript
interface Toast {
  id: string;
  severity: "error" | "warning" | "info";
  title: string;
  message: string;
  action?: { label: string; onClick: () => void };  // e.g., "Retry", "Open Editor"
  persistent?: boolean;   // don't auto-dismiss
}
```

### Error Banners

For errors that affect an entire panel or scope. Displayed at the top of the panel content area.

```typescript
interface ErrorBanner {
  scope: ConfigScope;
  file: string;
  error: IpcError;
  actions: BannerAction[];
}

type BannerAction =
  | { type: "retry" }
  | { type: "open_editor" }
  | { type: "reset_empty" }
  | { type: "dismiss" };
```

### Conflict Banners

For concurrent modification conflicts. Displayed at the top of the panel with a yellow background.

### Inline Field Errors

Red border + error text below the field. See [validation.md](validation.md).

---

## Error Logging

All errors are logged to `{configDir}/.ssenrah/logs/error.log` for debugging:

```
[2026-02-27T14:30:00Z] ERROR file_io: parse_error path=".claude/settings.json" message="Expected property name at line 5, column 3"
[2026-02-27T14:30:05Z] WARN  watcher: conflict scope=project fields=["permissions.allow"]
```

Log rotation: keep last 5 files, max 1MB each.
