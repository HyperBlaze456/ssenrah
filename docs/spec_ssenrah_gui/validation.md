# Validation Rules

Schema validation, semantic validation, timing, and error presentation.

**Related**: [schemas.md](schemas.md) for Zod schemas, [ipc.md](ipc.md) for validation commands, [errors.md](errors.md) for error handling.

---

## Validation Layers

### Layer 1: Schema Validation (Zod)

Validates structural correctness against the type definitions in [schemas.md](schemas.md).

**What it checks**:
- Required fields are present (e.g., agent `name` and `description`)
- Field types are correct (string, number, boolean, enum values)
- Enum values are valid (e.g., `defaultMode` is `"acceptEdits"` or `"reviewAll"`)
- Array elements match expected shapes
- Nested objects have correct structure
- Conditional requirements (e.g., command hooks must have `command` field, prompt hooks must have `prompt` field)

**What it does NOT check**: Whether values are semantically meaningful (that's Layer 2).

### Layer 2: Semantic Validation

Validates that values are meaningful and correct beyond their type.

#### Permission Rules

```
validate_permission_rule(rule: string):
  // Parse: "ToolName" or "ToolName(specifier)"
  match = rule.match(/^([A-Za-z_]+)(?:\((.+)\))?$/)
  if no match:
    error: "Invalid rule format. Expected: ToolName or ToolName(specifier)"

  tool = match[1]
  specifier = match[2] ?? null

  if tool not in KNOWN_TOOLS:
    warning: "Unknown tool '{tool}'. This may be an MCP tool."
    // Warning, not error — MCP tools have dynamic names

  if specifier:
    validate specifier as glob pattern (for file tools)
    or as command pattern (for Bash)
    error on malformed globs

  return { valid: true, tool, specifier }
```

Known tools: `Bash`, `Read`, `Edit`, `Write`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, `Skill`, `Task`, `NotebookEdit`, `MCPSearch`.

#### Hook Matchers

```
validate_hook_matcher(pattern: string):
  try:
    new RegExp(pattern)
    return { valid: true }
  catch:
    return { valid: false, error: regex_error_message }
```

#### Glob Patterns

Used in permission rule specifiers and sandbox domain allowlists.

```
validate_glob(pattern: string):
  // Check for common mistakes
  if pattern contains unescaped special chars in wrong positions:
    warning: "Pattern may not match as expected"

  // Verify it compiles as a valid glob
  try:
    compile_glob(pattern)
    return { valid: true }
  catch:
    return { valid: false, error: glob_error_message }
```

#### MCP Server Definitions

```
validate_mcp_server(name: string, def: McpServerDefinition):
  errors = []

  if def is stdio:
    if !def.command:
      errors.push("stdio server requires 'command'")
    // Warn if command doesn't look like a valid path/executable

  if def is http:
    if !def.url:
      errors.push("http server requires 'url'")
    if def.url and !is_valid_url(def.url):
      // Allow ${VAR} patterns in URL
      if !contains_env_var_pattern(def.url):
        errors.push("Invalid URL format")

  if def is sse:
    warnings.push("SSE transport is deprecated; consider switching to HTTP")

  // Check env var expansion patterns
  for value in all_string_values(def):
    for match in value.matchAll(/\$\{([^}]+)\}/g):
      if !is_valid_env_var_ref(match[1]):
        errors.push("Invalid env var reference: ${match[1]}")
```

#### Agent Frontmatter

```
validate_agent_frontmatter(fm: AgentFrontmatter):
  errors = []

  if fm.name and !fm.name.match(/^[a-z][a-z0-9-]*$/):
    errors.push("Agent name must be lowercase with hyphens")

  if fm.tools:
    for tool in fm.tools.split(",").map(t => t.trim()):
      // Validate tool names, including Task(agent_type) pattern
      if tool.startsWith("Task("):
        agentType = tool.match(/^Task\((.+)\)$/)?.[1]
        if !agentType:
          errors.push("Invalid Task(agent_type) syntax")

  if fm.maxTurns !== undefined and (fm.maxTurns < 1 or fm.maxTurns > 100):
    errors.push("maxTurns must be between 1 and 100")

  if fm.hooks:
    validate_hooks(fm.hooks)   // reuse hooks validation
```

#### Skill Frontmatter

```
validate_skill_frontmatter(fm: SkillFrontmatter):
  errors = []

  if fm["argument-hint"] and fm["argument-hint"].length > 50:
    warnings.push("Argument hint is long; keep it concise for autocomplete display")

  if fm.context === "fork" and fm["disable-model-invocation"]:
    warnings.push("Forked skills are typically auto-invocable; disable-model-invocation may conflict")
```

---

## Validation Timing

| Trigger | What Runs | Where |
|---------|-----------|-------|
| **On keystroke** (after debounce) | Schema (Zod) + semantic validation on the changed field | Frontend (Zod), backend (semantic via IPC if needed) |
| **On save** (debounced write) | Full schema validation on the entire config | Frontend (Zod) — blocks write if invalid |
| **On load** (file read) | Schema validation on loaded data | Frontend (Zod) — show parse warning if invalid |
| **On explicit validate** (user action) | Full schema + semantic validation | Frontend (Zod) + backend (IPC `validate_settings`) |
| **On scope switch** | None (data is already validated on load) | — |

### Incremental vs. Full

- **Incremental**: On each field change, only the changed field and its parent object are re-validated. This keeps validation fast during editing.
- **Full**: Before writing to disk and on explicit user action, the entire config is validated. This catches cross-field issues (e.g., a `deny` rule that makes an `allow` rule unreachable).

---

## Error Presentation

### Inline Field Errors

Displayed directly below the form field that has the error.

```typescript
interface FieldError {
  path: string;        // JSON path to the field
  message: string;     // human-readable error message
  severity: "error" | "warning";
}
```

- **Errors** (red) — prevent save. Must be fixed before the config can be written.
- **Warnings** (yellow) — don't prevent save. Indicate potential issues.

Visual: Red/yellow border on the field, error message text below in matching color.

### Toast Notifications

Used for errors that aren't tied to a specific field:
- File write failures
- Permission denied
- Concurrent modification detected

### Validation Summary Panel

Available in the effective config viewer. Shows all validation issues across all scopes in a single list, grouped by scope and severity.

```typescript
interface ValidationSummary {
  scope: ConfigScope;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}
```

---

## Cross-Field Validation

Some validations span multiple fields:

### Unreachable Permission Rules

If a `deny` rule matches a superset of an `allow` rule that appears later, the `allow` rule is unreachable (deny is checked first).

```
check_unreachable_rules(permissions):
  for allow_rule in permissions.allow ?? []:
    for deny_rule in permissions.deny ?? []:
      if deny_rule covers allow_rule:
        warning: "Allow rule '{allow_rule}' is unreachable — blocked by deny rule '{deny_rule}'"
```

### MCP Server Conflicts

If the same server name appears in both `enabledMcpjsonServers` and `disabledMcpjsonServers`:

```
check_mcp_conflicts(settings):
  enabled = new Set(settings.enabledMcpjsonServers ?? [])
  disabled = new Set(settings.disabledMcpjsonServers ?? [])
  overlap = intersection(enabled, disabled)
  if overlap.size > 0:
    error: "Server(s) in both enabled and disabled lists: {overlap}"
```

### Hook Timeout Bounds

```
check_hook_timeouts(hooks):
  for event, groups of hooks:
    for group in groups:
      for hook in group.hooks:
        if hook.timeout and hook.timeout > 300000:
          warning: "Hook timeout exceeds 5 minutes — may cause UI freezing"
        if hook.timeout and hook.timeout < 100:
          warning: "Hook timeout under 100ms — may not complete in time"
```
