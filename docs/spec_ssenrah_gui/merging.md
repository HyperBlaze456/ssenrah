# Config Merging Algorithm

How multiple configuration scopes are combined into the effective configuration that Claude Code sees. Covers precedence rules, per-field merge semantics, and source attribution.

**Related**: [schemas.md](schemas.md) for type definitions, [ipc.md](ipc.md) for `compute_effective_config`, [state.md](state.md) for how the frontend stores and displays this.

---

## Scope Precedence

From highest to lowest priority:

1. **Managed** — `managed-settings.json` (IT-enforced, read-only)
2. **Local** — `.claude/settings.local.json` (personal, gitignored)
3. **Project** — `.claude/settings.json` (team-shared)
4. **User** — `~/.claude/settings.json` (global defaults)

Higher-priority scopes override lower-priority scopes. The merge starts from user (lowest) and applies each higher scope on top.

---

## Merge Algorithm

```
effective_config = merge(user, project, local, managed):
  result = deep_clone(user ?? {})

  for scope in [project, local, managed]:
    if scope is null:
      continue
    result = merge_scope(result, scope)

  return result
```

### Per-Field Merge Semantics

Not all fields merge the same way. Three strategies:

| Strategy | Behavior | Fields |
|----------|----------|--------|
| **Replace** | Higher scope completely replaces the value | All scalar fields (`model`, `outputStyle`, `language`, `defaultMode`, booleans, numbers, strings) |
| **Array replace** | Higher scope's array replaces lower scope's array entirely | `permissions.allow`, `permissions.deny`, `permissions.ask`, `permissions.additionalDirectories`, `availableModels`, `companyAnnouncements`, `sandbox.excludedCommands`, `sandbox.network.allowedDomains`, `sandbox.network.allowUnixSockets`, `enabledMcpjsonServers`, `disabledMcpjsonServers`, `allowedMcpServers`, `deniedMcpServers` |
| **Deep merge** | Recursively merge object keys; nested objects follow their own field rules | `permissions` (object), `sandbox` (object), `sandbox.network` (object), `hooks` (object), `env` (object), `attribution` (object), `spinnerTipsOverride` (object), `spinnerVerbs` (object), `statusLine` (object), `fileSuggestion` (object) |

### Merge Rules in Detail

#### Replace (scalars)

```
merge_field(base, override):
  if override is defined (not undefined):
    return override
  return base
```

A field set to `null` in a higher scope **removes** it (acts as a delete). A field that is `undefined` (not present in the scope's JSON) is ignored — it doesn't override anything.

#### Array Replace

Arrays are **not** merged element-by-element. If a higher scope defines `permissions.allow`, it completely replaces any lower scope's `permissions.allow`. This matches Claude Code's behavior — permission rules are evaluated as a complete ordered set, not accumulated across scopes.

#### Deep Merge (objects)

For object fields, each key is merged independently using its own strategy:

```
merge_object(base, override):
  result = clone(base)
  for key in override:
    if key not in result:
      result[key] = override[key]
    else:
      result[key] = merge_field(result[key], override[key])
  return result
```

### Hooks Merge

Hooks use **deep merge at the event level, array replace at the group level**.

```
merge_hooks(base_hooks, override_hooks):
  result = clone(base_hooks)
  for event in override_hooks:
    // Higher scope's hook groups for this event replace lower scope's
    result[event] = override_hooks[event]
  return result
```

If the project defines `PreToolUse` hooks and the local scope also defines `PreToolUse` hooks, the local scope's groups completely replace the project's for that event. But a project `PreToolUse` and local `PostToolUse` coexist (different events, no conflict).

### Env Merge

Environment variables use **deep merge** — individual keys are merged, not the whole object:

```
merge_env(base_env, override_env):
  result = clone(base_env)
  for key in override_env:
    if override_env[key] === null:
      delete result[key]          // null removes the variable
    else:
      result[key] = override_env[key]
  return result
```

### MCP Servers Merge

MCP servers from different sources are combined by server name. Same-name servers at higher scopes override lower scopes entirely:

```
merge_mcp(user_mcp, project_mcp, managed_mcp):
  result = clone(user_mcp?.mcpServers ?? {})

  for name, def in project_mcp?.mcpServers ?? {}:
    result[name] = def            // project overrides user

  for name, def in managed_mcp?.mcpServers ?? {}:
    result[name] = def            // managed overrides all

  return { mcpServers: result }
```

---

## Source Attribution

The effective config viewer needs to show where each value came from. The merge algorithm tracks provenance during computation.

```typescript
interface SourceMap {
  // Maps JSON paths to the scope that provided the effective value
  // e.g. { "model": "project", "permissions.allow": "local", "env.ANTHROPIC_API_KEY": "user" }
  [jsonPath: string]: ConfigScope;
}
```

### Building the Source Map

During the merge, every time a field is set or overridden, record the scope:

```
merge_with_attribution(scopes):
  result = {}
  sourceMap = {}

  for scope in [user, project, local, managed]:
    if scope.data is null:
      continue
    for path, value in flatten(scope.data):
      result[path] = value
      sourceMap[path] = scope.name

  return { effective: unflatten(result), sources: sourceMap }
```

### Override Detection

An override occurs when a higher scope replaces a value from a lower scope.

```typescript
interface Override {
  path: string;               // JSON path
  effectiveScope: ConfigScope; // scope that "won"
  overriddenScopes: ConfigScope[]; // scopes whose values were replaced
  effectiveValue: unknown;
}
```

Overrides are computed by checking if multiple scopes define the same path. Only reported when at least two scopes have a value for the same path and they differ.

---

## Effective Config Display

The frontend computes and caches the effective config whenever any scope's data changes:

```
on_any_scope_change():
  { effective, sources, overrides } = compute_effective_config()
  effectiveStore.set({ effective, sources, overrides })
```

Display modes:
- **Structured view** — grouped by domain (permissions, hooks, etc.), each field shows a scope badge
- **JSON view** — raw merged JSON with syntax highlighting, fields color-coded by source scope
- **Diff view** — side-by-side comparison of two scopes

### Scope Colors

| Scope | Color | Badge |
|-------|-------|-------|
| User | Blue | `USR` |
| Project | Green | `PRJ` |
| Local | Orange | `LCL` |
| Managed | Red | `MGD` |

Managed values additionally show a lock icon to indicate they cannot be overridden.
