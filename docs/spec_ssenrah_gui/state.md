# Frontend State Management

Zustand store architecture, store shapes, data flow, and derived state.

**Related**: [schemas.md](schemas.md) for the types stored, [file-io.md](file-io.md) for read/write triggers, [merging.md](merging.md) for effective config computation.

---

## Architecture: One Store Per Domain

Each configuration domain has its own Zustand store. This keeps stores focused, enables independent subscriptions, and prevents unnecessary re-renders.

```
useSettingsStore     — settings.json (all scopes)
useMcpStore          — .mcp.json + ~/.claude.json MCP section
useMemoryStore       — CLAUDE.md files
useAgentsStore       — agent .md files
useSkillsStore       — skill SKILL.md files
useEffectiveStore    — computed merged config (derived, read-only)
useProjectStore      — project state (current project, platform info)
useUiStore           — UI state (active panel, active scope, sidebar collapsed)
```

---

## Store Shapes

### `useSettingsStore`

```typescript
interface SettingsStore {
  // Data per scope — null means file doesn't exist, undefined means not yet loaded
  user: Settings | null | undefined;
  project: Settings | null | undefined;
  local: Settings | null | undefined;
  managed: ManagedSettings | null | undefined;

  // Dirty tracking
  dirtyFields: {
    user: Set<string>;
    project: Set<string>;
    local: Set<string>;
  };

  // Loading/error state per scope
  status: Record<ConfigScope, LoadStatus>;

  // Actions
  load: (scope: ConfigScope) => Promise<void>;
  loadAll: () => Promise<void>;
  update: (scope: WritableScope, path: string, value: unknown) => void;
  save: (scope: WritableScope) => Promise<void>;
  reloadFromDisk: (scope: ConfigScope) => void;
  clearDirty: (scope: WritableScope) => void;
}

type LoadStatus =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "loaded" }
  | { state: "error"; error: IpcError };
```

### `useMcpStore`

```typescript
interface McpStore {
  project: McpConfig | null | undefined;
  user: McpConfig | null | undefined;    // MCP section of ~/.claude.json
  managed: ManagedMcp | null | undefined;

  dirtyFields: {
    project: Set<string>;
    user: Set<string>;
  };

  status: Record<McpSource, LoadStatus>;

  load: (source: McpSource) => Promise<void>;
  loadAll: () => Promise<void>;
  addServer: (source: WritableMcpSource, name: string, def: McpServerDefinition) => void;
  updateServer: (source: WritableMcpSource, name: string, def: McpServerDefinition) => void;
  removeServer: (source: WritableMcpSource, name: string) => void;
  save: (source: WritableMcpSource) => Promise<void>;
}
```

### `useMemoryStore`

```typescript
interface MemoryStore {
  user: string | null | undefined;
  project: string | null | undefined;
  projectRoot: string | null | undefined;   // CLAUDE.md at project root
  local: string | null | undefined;

  dirtyScopes: Set<MemoryScope>;
  status: Record<MemoryScope, LoadStatus>;

  load: (scope: MemoryScope) => Promise<void>;
  loadAll: () => Promise<void>;
  update: (scope: MemoryScope, content: string) => void;
  save: (scope: MemoryScope) => Promise<void>;
}
```

### `useAgentsStore`

```typescript
interface AgentsStore {
  user: AgentEntry[] | undefined;
  project: AgentEntry[] | undefined;

  status: Record<AgentScope, LoadStatus>;

  load: (scope: AgentScope) => Promise<void>;
  loadAll: () => Promise<void>;
  readAgent: (scope: AgentScope, filename: string) => Promise<{ frontmatter: AgentFrontmatter; body: string }>;
  writeAgent: (scope: AgentScope, filename: string, frontmatter: AgentFrontmatter, body: string) => Promise<void>;
  deleteAgent: (scope: AgentScope, filename: string) => Promise<void>;
}
```

### `useSkillsStore`

```typescript
interface SkillsStore {
  user: SkillEntry[] | undefined;
  project: SkillEntry[] | undefined;

  status: Record<SkillScope, LoadStatus>;

  load: (scope: SkillScope) => Promise<void>;
  loadAll: () => Promise<void>;
  readSkill: (scope: SkillScope, directory: string) => Promise<{ frontmatter: SkillFrontmatter; body: string; supportingFiles: string[] }>;
  writeSkill: (scope: SkillScope, directory: string, frontmatter: SkillFrontmatter, body: string) => Promise<void>;
  deleteSkill: (scope: SkillScope, directory: string) => Promise<void>;
}
```

### `useEffectiveStore`

Derived (read-only) store that recomputes when any data store changes.

```typescript
interface EffectiveStore {
  config: EffectiveConfig | null;
  loading: boolean;

  recompute: () => Promise<void>;
}
```

This store subscribes to `useSettingsStore`, `useMcpStore`, and `useMemoryStore`. When any of them change, it calls the `compute_effective_config` IPC command and caches the result.

### `useProjectStore`

```typescript
interface ProjectStore {
  info: ProjectInfo | null;
  platformInfo: PlatformInfo | null;

  openProject: (path: string) => Promise<void>;
  refresh: () => Promise<void>;
}
```

### `useUiStore`

```typescript
interface UiStore {
  activePanel: PanelId;
  activeScope: ConfigScope;
  sidebarCollapsed: boolean;
  effectiveConfigExpanded: boolean;

  // Conflict state
  conflicts: ConflictInfo[];

  setPanel: (panel: PanelId) => void;
  setScope: (scope: ConfigScope) => void;
  toggleSidebar: () => void;
  toggleEffectiveConfig: () => void;
  resolveConflict: (id: string, resolution: "keep_mine" | "reload") => void;
}

type PanelId =
  | "permissions"
  | "hooks"
  | "mcp"
  | "memory"
  | "agents"
  | "skills"
  | "plugins"
  | "sandbox"
  | "env"
  | "display"
  | "advanced"
  | "effective";

interface ConflictInfo {
  id: string;
  scope: ConfigScope;
  file: string;
  conflictingFields: string[];
  externalValue: unknown;
  localValue: unknown;
}
```

---

## Data Flow

### Initial Load

```
App mount
  → useProjectStore.openProject(path)
    → IPC: open_project
    → IPC: get_platform_info
    → IPC: subscribe_file_changes
  → All domain stores: loadAll()
    → IPC: read_settings (user, project, local, managed) — in parallel
    → IPC: read_mcp_config (project, user, managed) — in parallel
    → IPC: read_memory (all scopes) — in parallel
    → IPC: list_agents (user, project) — in parallel
    → IPC: list_skills (user, project) — in parallel
  → useEffectiveStore.recompute()
```

### User Edit

```
User changes a form field
  → store.update(scope, path, value)
    → Zustand state updates immediately (optimistic UI)
    → dirtyFields.add(path)
    → Cancel existing debounce timer
    → Start 500ms debounce timer
      → On fire: store.save(scope)
        → Validate via Zod
        → If valid: IPC: write_* command
          → On success: clearDirty(scope)
          → On failure: show error toast, keep dirty state
        → If invalid: show inline errors, do NOT write
  → useEffectiveStore.recompute() (subscribes to changes)
```

### External File Change

```
File watcher detects change
  → Tauri emits "file_change" event
  → Frontend handler:
    → Identify which store/scope is affected
    → Check if store has dirty fields for that scope
      → No dirty fields: reload silently
      → Dirty fields don't overlap: reload non-dirty fields, keep dirty
      → Dirty fields overlap: create ConflictInfo, show conflict banner
  → useEffectiveStore.recompute()
```

### Scope Switch

```
User clicks different scope in sidebar
  → useUiStore.setScope(newScope)
  → Active panel re-renders with data from the new scope
  → If scope data is undefined (not yet loaded):
    → Trigger load for that scope
```

---

## Debounce Implementation

```typescript
// Shared debounce utility used by all writable stores
function createDebouncedSaver(delayMs: number = 500) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  return function scheduleSave(key: string, saveFn: () => Promise<void>) {
    const existing = timers.get(key);
    if (existing) clearTimeout(existing);

    timers.set(key, setTimeout(async () => {
      timers.delete(key);
      await saveFn();
    }, delayMs));
  };
}

// Usage in store:
const debouncedSave = createDebouncedSaver(500);

// In update action:
update: (scope, path, value) => {
  set(/* update state */);
  debouncedSave(`settings-${scope}`, () => get().save(scope));
}
```

---

## Subscriptions Between Stores

```
useSettingsStore ─┐
useMcpStore ──────┼──▶ useEffectiveStore.recompute()
useMemoryStore ───┘

useProjectStore ──▶ All domain stores (triggers loadAll on project change)
```

Subscriptions use Zustand's `subscribe` with selectors to avoid unnecessary recomputation:

```typescript
// In effective store initialization
useSettingsStore.subscribe(
  (state) => [state.user, state.project, state.local, state.managed],
  () => useEffectiveStore.getState().recompute(),
  { equalityFn: shallow }
);
```
