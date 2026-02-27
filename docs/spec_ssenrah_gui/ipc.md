# IPC Commands

The contract between the React frontend and the Rust (Tauri) backend. Every command the frontend can invoke, grouped by domain.

**Related**: [schemas.md](schemas.md) for type definitions, [file-io.md](file-io.md) for read/write behavior, [errors.md](errors.md) for error types.

---

## Error Envelope

All commands return `Result<T, IpcError>`. The frontend receives either the success payload or a typed error.

```typescript
type IpcError =
  | { kind: "not_found"; path: string }
  | { kind: "permission_denied"; path: string }
  | { kind: "parse_error"; path: string; message: string }
  | { kind: "write_failed"; path: string; message: string }
  | { kind: "validation_error"; errors: ValidationError[] }
  | { kind: "no_project"; message: string }
  | { kind: "platform_error"; message: string };
```

---

## Config Read/Write

### `read_settings`

Read a `settings.json` file at a given scope.

```typescript
// Parameters
{ scope: ConfigScope }

// ConfigScope = "user" | "project" | "local" | "managed"

// Returns
Result<Settings | null, IpcError>
// null when file does not exist (not an error)
```

**Behavior**: Resolves path via [platform.md](platform.md) rules. Returns `null` for missing files, `parse_error` for malformed JSON.

### `write_settings`

Write a `settings.json` file at a given scope. Uses atomic write.

```typescript
// Parameters
{ scope: WritableScope; settings: Settings }

// WritableScope = "user" | "project" | "local"
// ("managed" is read-only, never written)

// Returns
Result<void, IpcError>
```

**Behavior**: Validates via Zod before writing (see [validation.md](validation.md)). Auto-creates `.claude/` if scope is `project` or `local` and the directory doesn't exist. Uses atomic write per [file-io.md](file-io.md).

### `read_mcp_config`

Read MCP server configuration.

```typescript
// Parameters
{ source: McpSource }

// McpSource = "project" | "user" | "managed"
// project → .claude/.mcp.json
// user    → ~/.claude.json (MCP section only)
// managed → managed-mcp.json

// Returns
Result<McpConfig | null, IpcError>
```

### `write_mcp_config`

Write MCP server configuration.

```typescript
// Parameters
{ source: WritableMcpSource; config: McpConfig }

// WritableMcpSource = "project" | "user"

// Returns
Result<void, IpcError>
```

**Behavior**: For `user` source, performs a partial update — reads existing `~/.claude.json`, replaces only the `mcpServers` key, writes back. Never overwrites non-MCP data in `~/.claude.json`.

### `read_managed_settings`

Read managed (IT-enforced) settings. Always read-only.

```typescript
// Parameters
{}

// Returns
Result<ManagedSettings | null, IpcError>
```

### `read_managed_mcp`

Read managed MCP server configuration. Always read-only.

```typescript
// Parameters
{}

// Returns
Result<ManagedMcp | null, IpcError>
```

---

## Memory (CLAUDE.md)

### `read_memory`

Read a CLAUDE.md file at a given scope.

```typescript
// Parameters
{ scope: MemoryScope }

// MemoryScope = "user" | "project" | "project_root" | "local"
// user         → ~/.claude/CLAUDE.md
// project      → .claude/CLAUDE.md
// project_root → CLAUDE.md (project root)
// local        → .claude/CLAUDE.local.md

// Returns
Result<string | null, IpcError>
// Raw markdown string, null if file doesn't exist
```

### `write_memory`

Write a CLAUDE.md file at a given scope.

```typescript
// Parameters
{ scope: MemoryScope; content: string }

// Returns
Result<void, IpcError>
```

---

## Agents

### `list_agents`

List all agent definition files across scopes.

```typescript
// Parameters
{ scope?: AgentScope }

// AgentScope = "user" | "project"
// Omit scope to list all.

// Returns
Result<AgentEntry[], IpcError>

interface AgentEntry {
  filename: string;       // e.g. "reviewer.md"
  scope: AgentScope;
  frontmatter: AgentFrontmatter;
  bodyPreview: string;    // first 200 chars of markdown body
}
```

### `read_agent`

Read a single agent file.

```typescript
// Parameters
{ scope: AgentScope; filename: string }

// Returns
Result<{ frontmatter: AgentFrontmatter; body: string }, IpcError>
```

### `write_agent`

Write an agent file (create or overwrite).

```typescript
// Parameters
{ scope: AgentScope; filename: string; frontmatter: AgentFrontmatter; body: string }

// Returns
Result<void, IpcError>
```

**Behavior**: Serializes frontmatter as YAML between `---` fences, appends body. Atomic write.

### `delete_agent`

Delete an agent file.

```typescript
// Parameters
{ scope: AgentScope; filename: string }

// Returns
Result<void, IpcError>
```

---

## Skills

### `list_skills`

List all skill definitions across scopes.

```typescript
// Parameters
{ scope?: SkillScope }

// SkillScope = "user" | "project"

// Returns
Result<SkillEntry[], IpcError>

interface SkillEntry {
  directory: string;        // skill directory name
  scope: SkillScope;
  frontmatter: SkillFrontmatter;
  bodyPreview: string;
  supportingFiles: string[];  // filenames in skill directory besides SKILL.md
}
```

### `read_skill`

Read a single skill's SKILL.md.

```typescript
// Parameters
{ scope: SkillScope; directory: string }

// Returns
Result<{ frontmatter: SkillFrontmatter; body: string; supportingFiles: string[] }, IpcError>
```

### `write_skill`

Write a skill's SKILL.md.

```typescript
// Parameters
{ scope: SkillScope; directory: string; frontmatter: SkillFrontmatter; body: string }

// Returns
Result<void, IpcError>
```

### `delete_skill`

Delete an entire skill directory.

```typescript
// Parameters
{ scope: SkillScope; directory: string }

// Returns
Result<void, IpcError>
```

### `read_skill_file`

Read a supporting file from a skill directory.

```typescript
// Parameters
{ scope: SkillScope; directory: string; filename: string }

// Returns
Result<string, IpcError>
```

### `write_skill_file`

Write a supporting file to a skill directory.

```typescript
// Parameters
{ scope: SkillScope; directory: string; filename: string; content: string }

// Returns
Result<void, IpcError>
```

---

## Project Management

### `get_project_info`

Get current project context.

```typescript
// Parameters
{}

// Returns
Result<ProjectInfo, IpcError>

interface ProjectInfo {
  projectRoot: string | null;   // absolute path, null if no project open
  claudeDirExists: boolean;     // whether .claude/ exists
  gitRoot: string | null;       // git repo root if inside one
}
```

### `open_project`

Set the active project root. Triggers file watcher setup.

```typescript
// Parameters
{ path: string }

// Returns
Result<ProjectInfo, IpcError>
```

### `ensure_claude_dir`

Create `.claude/` directory in the project root if it doesn't exist.

```typescript
// Parameters
{}

// Returns
Result<void, IpcError>
```

---

## File Watching

### `subscribe_file_changes`

Register for file change notifications. The backend emits a Tauri event when watched files change externally.

```typescript
// Parameters
{}

// Returns
Result<void, IpcError>

// Emitted event (Tauri event, not IPC return):
interface FileChangeEvent {
  path: string;         // absolute path of changed file
  kind: "created" | "modified" | "deleted";
  scope: ConfigScope;   // which config scope was affected
}
```

**Behavior**: Backend uses `notify` crate to watch all config file paths for the current project and user scope. Debounces rapid changes (100ms). Frontend listens via `listen("file_change", callback)`.

### `unsubscribe_file_changes`

Stop watching for file changes.

```typescript
// Parameters
{}

// Returns
Result<void, IpcError>
```

---

## Validation

### `validate_settings`

Run full validation on a settings object without writing it.

```typescript
// Parameters
{ settings: Settings; scope: ConfigScope }

// Returns
Result<ValidationResult, IpcError>

interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

interface ValidationError {
  path: string;       // JSON path, e.g. "permissions.allow[2]"
  message: string;
  code: string;       // e.g. "invalid_glob", "invalid_regex", "unknown_tool"
}

interface ValidationWarning {
  path: string;
  message: string;
  code: string;       // e.g. "deprecated_field", "unreachable_rule"
}
```

### `validate_permission_rule`

Validate a single permission rule string.

```typescript
// Parameters
{ rule: string }

// Returns
Result<{ valid: boolean; tool: string; specifier: string | null; error: string | null }, IpcError>
```

### `validate_hook_matcher`

Validate a hook matcher regex.

```typescript
// Parameters
{ pattern: string }

// Returns
Result<{ valid: boolean; error: string | null }, IpcError>
```

---

## Effective Config

### `compute_effective_config`

Merge all scopes and return the effective configuration Claude Code would see.

```typescript
// Parameters
{}

// Returns
Result<EffectiveConfig, IpcError>

interface EffectiveConfig {
  settings: Settings;
  sources: Record<string, ConfigScope>;  // JSON path → which scope it came from
  overrides: Override[];                  // list of where higher scopes override lower
}

interface Override {
  path: string;         // JSON path
  effectiveScope: ConfigScope;
  overriddenScopes: ConfigScope[];
  effectiveValue: unknown;
}
```

**Behavior**: See [merging.md](merging.md) for the full algorithm.

---

## Platform

### `get_platform_info`

Detect the current platform and Claude Code installation.

```typescript
// Parameters
{}

// Returns
Result<PlatformInfo, IpcError>

interface PlatformInfo {
  os: "macos" | "linux" | "windows";
  isWsl: boolean;
  shell: string;                    // detected shell path
  claudeCodeInstalled: boolean;
  claudeCodePath: string | null;    // path to claude binary
  configDir: string;                // resolved ~/.claude/ path
  managedSettingsDir: string | null; // OS-specific managed dir
}
```
