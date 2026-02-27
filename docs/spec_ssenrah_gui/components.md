# UI Component Architecture

Reusable patterns, panel component contract, scope selector behavior, and layout system.

**Related**: [state.md](state.md) for store integration, [schemas.md](schemas.md) for the types components render, [validation.md](validation.md) for inline error display.

---

## Layout System

### Top-Level Structure

```
┌──────────────────────────────────────────────────────────────┐
│  Header                                                       │
│  [ssenrah logo]      [Project: ~/my-app ▾]    [Settings ⚙]   │
├───────────────┬──────────────────────────────────────────────┤
│  Sidebar      │  MainContent                                  │
│               │                                               │
│  ScopeSelector│  PanelHeader                                  │
│  ───────────  │  ┌──────────────────────────────────────────┐ │
│  ● User       │  │                                          │ │
│  ○ Project    │  │  ActivePanel                              │ │
│  ○ Local      │  │  (varies by domain)                      │ │
│  ○ Managed*   │  │                                          │ │
│               │  │                                          │ │
│  PanelNav     │  │                                          │ │
│  ───────────  │  └──────────────────────────────────────────┘ │
│  Permissions  │                                               │
│  Hooks        │  EffectiveConfigFooter (collapsible)          │
│  MCP          │  ┌──────────────────────────────────────────┐ │
│  Memory       │  │ { merged config preview }                │ │
│  Agents       │  └──────────────────────────────────────────┘ │
│  Skills       │                                               │
│  Plugins      │                                               │
│  Sandbox      │                                               │
│  Env          │                                               │
│  Display      │                                               │
│  Advanced     │                                               │
│  ───────────  │                                               │
│  Effective    │                                               │
└───────────────┴──────────────────────────────────────────────┘
```

\* Managed scope is always read-only. Visual lock icon.

### Layout Components

```typescript
// Root layout
<AppLayout>
  <Header />
  <div className="flex">
    <Sidebar />
    <MainContent>
      <PanelHeader />
      <ActivePanel />            {/* switches based on useUiStore.activePanel */}
      <EffectiveConfigFooter />
    </MainContent>
  </div>
</AppLayout>
```

### Responsive Behavior

- **Sidebar**: Fixed 240px width. Collapsible to icon-only (48px) via toggle or when viewport < 1024px.
- **MainContent**: Fills remaining width.
- **EffectiveConfigFooter**: Default collapsed. Expands to 200px height. Draggable resize handle.

---

## Panel Component Contract

Every domain panel follows the same interface. This enables the layout to swap panels without special-casing.

```typescript
interface PanelProps {
  scope: ConfigScope;          // which scope is being edited
  readOnly: boolean;           // true for managed scope
}

// Every panel component must:
// 1. Read its data from the appropriate store for the given scope
// 2. Render a form/editor for that scope's data
// 3. Call store.update() on user input (triggers debounced save)
// 4. Display validation errors inline (from store.status or local validation)
// 5. Show "empty state" when scope has no data (null)
// 6. Respect readOnly prop (disable all inputs, show lock badges)
```

### Panel Registry

```typescript
const PANELS: Record<PanelId, {
  component: React.ComponentType<PanelProps>;
  label: string;
  icon: string;
  stores: string[];              // which stores this panel reads from
}> = {
  permissions: {
    component: PermissionsPanel,
    label: "Permissions",
    icon: "shield",
    stores: ["settings"],
  },
  hooks: {
    component: HooksPanel,
    label: "Hooks",
    icon: "webhook",
    stores: ["settings"],
  },
  mcp: {
    component: McpPanel,
    label: "MCP Servers",
    icon: "server",
    stores: ["mcp", "settings"],   // settings for MCP policy
  },
  memory: {
    component: MemoryPanel,
    label: "Memory",
    icon: "brain",
    stores: ["memory"],
  },
  agents: {
    component: AgentsPanel,
    label: "Agents",
    icon: "bot",
    stores: ["agents"],
  },
  skills: {
    component: SkillsPanel,
    label: "Skills",
    icon: "sparkles",
    stores: ["skills"],
  },
  plugins: {
    component: PluginsPanel,
    label: "Plugins",
    icon: "puzzle",
    stores: ["settings"],
  },
  sandbox: {
    component: SandboxPanel,
    label: "Sandbox",
    icon: "box",
    stores: ["settings"],
  },
  env: {
    component: EnvPanel,
    label: "Environment",
    icon: "variable",
    stores: ["settings"],
  },
  display: {
    component: DisplayPanel,
    label: "Model & Display",
    icon: "palette",
    stores: ["settings"],
  },
  advanced: {
    component: AdvancedPanel,
    label: "Advanced",
    icon: "settings",
    stores: ["settings"],
  },
  effective: {
    component: EffectivePanel,
    label: "Effective Config",
    icon: "layers",
    stores: ["effective"],
  },
};
```

---

## Scope Selector Behavior

### Visual States

| Scope | Available When | Badge |
|-------|---------------|-------|
| User | Always | Blue dot |
| Project | Project is open | Green dot (filled if file exists, outline if not) |
| Local | Project is open | Orange dot (filled if file exists, outline if not) |
| Managed | Managed settings found | Red dot + lock icon |

### Switching Scopes

When the user clicks a different scope:
1. `useUiStore.setScope(newScope)` updates the active scope
2. The active panel re-renders, reading from the new scope's data in its store
3. If the scope's data hasn't been loaded yet (undefined), trigger a load
4. If switching to managed, all form inputs become read-only

### Scope Availability per Panel

Not all panels support all scopes:

| Panel | User | Project | Local | Managed |
|-------|------|---------|-------|---------|
| Permissions | Y | Y | Y | Y (read-only) |
| Hooks | Y | Y | Y | Y (read-only) |
| MCP | Y | Y | — | Y (read-only) |
| Memory | Y | Y (+ root) | Y | — |
| Agents | Y | Y | — | — |
| Skills | Y | Y | — | — |
| Plugins | Y | — | — | — |
| Sandbox | Y | Y | Y | Y (read-only) |
| Env | Y | Y | Y | Y (read-only) |
| Display | Y | Y | Y | Y (read-only) |
| Advanced | Y | Y | Y | — |
| Effective | all (merged view) | — | — | — |

When a panel doesn't support the selected scope, the scope selector dims that option.

---

## Reusable Components

### ListEditor

Manages ordered string arrays (permission rules, excluded commands, allowed domains, etc.).

```typescript
interface ListEditorProps {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  validate?: (item: string) => { valid: boolean; error?: string };
  readOnly?: boolean;
  sortable?: boolean;           // enable drag-to-reorder
  addLabel?: string;            // "Add rule", "Add domain", etc.
}
```

Features:
- Add item via input field + Enter/button
- Remove item via X button
- Drag-to-reorder (when sortable=true)
- Inline validation on each item
- Empty state message

### KeyValueEditor

Manages `Record<string, string>` objects (env vars, headers, etc.).

```typescript
interface KeyValueEditorProps {
  entries: Record<string, string>;
  onChange: (entries: Record<string, string>) => void;
  keyPlaceholder?: string;      // "Variable name"
  valuePlaceholder?: string;    // "Value"
  keyAutocomplete?: string[];   // suggestions for key field
  maskValues?: boolean;         // hide values (for secrets)
  readOnly?: boolean;
}
```

Features:
- Two-column table: key | value | delete button
- Add row at bottom
- Key autocomplete from suggestions
- Value masking toggle (eye icon)
- Duplicate key detection

### RuleBuilder

Specialized for permission rules (`Tool(specifier)` syntax).

```typescript
interface RuleBuilderProps {
  rules: string[];
  category: "allow" | "ask" | "deny";
  onChange: (rules: string[]) => void;
  readOnly?: boolean;
}
```

Features:
- Tool name dropdown (built-in tools + detected MCP tools)
- Specifier input with glob autocomplete for file-based tools
- Rule preview showing parsed tool + specifier
- Drag-to-reorder
- Visual indicator of rule coverage (what it matches)

### MonacoWrapper

Configured Monaco editor for markdown and JSON editing.

```typescript
interface MonacoWrapperProps {
  value: string;
  onChange: (value: string) => void;
  language: "markdown" | "json" | "yaml" | "shell";
  readOnly?: boolean;
  height?: string | number;
  minimap?: boolean;
  lineNumbers?: boolean;
  jsonSchema?: object;           // JSON Schema for intellisense
}
```

Features:
- Syntax highlighting per language
- JSON Schema validation (for JSON mode)
- Markdown preview toggle
- Line count indicator
- Auto-resize to content (with max height)

### HookEditor

Reusable hook configuration component (used in global hooks panel and inline in agent/skill editors).

```typescript
interface HookEditorProps {
  hooks: Record<HookEvent, HookGroup[]>;
  onChange: (hooks: Record<HookEvent, HookGroup[]>) => void;
  readOnly?: boolean;
  availableEvents?: HookEvent[];   // restrict which events can be configured
}
```

Features:
- Event type selector (dropdown)
- Matcher regex input with validation
- Hook type tabs (command / prompt / agent)
- Command/script editor (MonacoWrapper with shell language)
- Timeout slider with numeric input
- Add/remove hook groups and individual hooks
- Collapsible sections per event type

### ScopeBadge

Inline badge showing which scope a value comes from.

```typescript
interface ScopeBadgeProps {
  scope: ConfigScope;
  locked?: boolean;             // shows lock icon for managed
}
```

Colors: User=blue, Project=green, Local=orange, Managed=red.

---

## Empty States

Each panel has a specific empty state when the scope has no data:

```typescript
interface EmptyStateProps {
  scope: ConfigScope;
  panelName: string;
  onCreateConfig?: () => void;   // only for writable scopes
}
```

Message pattern: "No {panelName} configured at {scope} scope."

With CTA: "Create {scope} configuration" button (calls `ensure_claude_dir` + initializes empty config).

---

## Project Picker

Top-right dropdown for selecting/opening a project.

```typescript
interface ProjectPickerProps {
  currentProject: ProjectInfo | null;
  recentProjects: string[];      // stored in local preferences
  onOpen: (path: string) => void;
  onBrowse: () => void;          // opens native directory picker
}
```

Features:
- Shows current project path (truncated to last 2 segments)
- Recent projects dropdown
- "Browse..." button → native OS directory picker (Tauri dialog)
- "No project" option (user-scope only mode)

---

## Effective Config Footer

Collapsible footer showing the merged effective configuration.

```typescript
interface EffectiveConfigFooterProps {
  expanded: boolean;
  onToggle: () => void;
}
```

When expanded:
- Shows the effective config for the field group matching the active panel
- Color-coded by source scope (scope badges on each value)
- Toggle between structured view and raw JSON view
- Override indicators (strikethrough on overridden values)

When collapsed:
- Single bar: "Effective Config ▸" with scope summary badges
