# ssenrah GUI — Harness Configuration App

## Goal

A desktop GUI application that lets anyone visually configure agent harnesses — starting with **Claude Code**, expanding to Codex CLI and others. No terminal knowledge required. Open a project, point-and-click your harness's components to modify them comfortably.

---

## Target: Claude Code Configuration Surface

Claude Code stores configuration across multiple files and scopes. This is what we manage — **every configurable surface, exhaustively**.

### Files We Read/Write

| File | Location | Scope | What It Controls |
|------|----------|-------|------------------|
| `settings.json` | `~/.claude/` | User (global) | Permissions, model, hooks, env, sandbox, display |
| `settings.json` | `.claude/` | Project (shared) | Same, scoped to project |
| `settings.local.json` | `.claude/` | Project (personal) | Personal overrides, gitignored |
| `managed-settings.json` | System dirs | Managed (IT) | Org-enforced policies (read-only display) |
| `CLAUDE.md` | `~/.claude/` | User | Global memory/instructions |
| `CLAUDE.md` | Project root or `.claude/` | Project | Project memory/instructions |
| `CLAUDE.local.md` | `.claude/` | Personal | Personal memory, gitignored |
| `.mcp.json` | `.claude/` | Project | Project-scoped MCP servers |
| `~/.claude.json` | User home | User | User/local-scoped MCP servers, OAuth, caches |
| `managed-mcp.json` | System dirs | Managed (IT) | Org-enforced MCP servers (read-only display) |
| `agents/*.md` | `~/.claude/agents/` | User | User-level subagents |
| `agents/*.md` | `.claude/agents/` | Project | Project-level subagents |
| `skills/*/SKILL.md` | `~/.claude/skills/` | User | User-level skills |
| `skills/*/SKILL.md` | `.claude/skills/` | Project | Project-level skills |
| `commands/*.md` | `.claude/commands/` | Project | Legacy commands (skill compat) |

### Scope Precedence (highest to lowest)

1. **Managed** — `managed-settings.json`, MDM, registry (IT-enforced, read-only in our GUI)
2. **CLI arguments** — session-only (out of scope for persistent GUI config)
3. **Local** — `.claude/settings.local.json`, `CLAUDE.local.md` (personal, gitignored)
4. **Project** — `.claude/settings.json`, `.claude/CLAUDE.md` (team-shared)
5. **User** — `~/.claude/settings.json`, `~/.claude/CLAUDE.md` (global)

---

## Configuration Domains (Complete)

Every configurable thing in Claude Code, organized by GUI panel.

### 1. Permissions

Visual rule builder for the `permissions` object in `settings.json`.

| Setting | Type | Description |
|---------|------|-------------|
| `permissions.allow` | `string[]` | Rules that auto-approve (e.g. `Bash(npm run *)`, `Read(src/**)`) |
| `permissions.ask` | `string[]` | Rules that prompt the user |
| `permissions.deny` | `string[]` | Rules that block (e.g. `Read(.env*)`, `WebFetch`) |
| `permissions.additionalDirectories` | `string[]` | Extra dirs Claude can access |
| `permissions.defaultMode` | `enum` | `acceptEdits` or `reviewAll` |
| `permissions.disableBypassPermissionsMode` | `string` | `"disable"` to prevent bypass mode |

**Rule syntax**: `Tool`, `Tool(specifier)`, `Tool(glob pattern)`. Tools include: `Bash`, `Read`, `Edit`, `Write`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, `Skill`, `Task`, `NotebookEdit`, `MCPSearch`, and any MCP tool names.

**GUI elements**:
- Table with Allow / Ask / Deny columns
- Add rule dialog with tool dropdown + pattern input with glob autocomplete
- Drag-to-reorder (evaluation is first-match-wins; deny checked first, then ask, then allow)
- Rule validation (highlight invalid patterns)

### 2. Hooks

Visual lifecycle hook builder for the `hooks` object in `settings.json`.

**Hook Events** (all of them):

| Event | Matcher Input | When It Fires |
|-------|---------------|---------------|
| `PreToolUse` | Tool name | Before Claude uses any tool |
| `PostToolUse` | Tool name | After successful tool use |
| `PostToolUseFailure` | Tool name | After failed tool use |
| `PermissionRequest` | Tool name | When a permission dialog shows |
| `UserPromptSubmit` | (none) | When user submits a prompt |
| `Notification` | (none) | When Claude Code sends notifications |
| `Stop` | (none) | When Claude attempts to stop |
| `SubagentStart` | Agent type name | When a subagent begins |
| `SubagentStop` | Agent type name | When a subagent completes |
| `SessionStart` | (none) | At session start |
| `SessionEnd` | (none) | At session end |
| `TeammateIdle` | (none) | When a team agent is about to idle |
| `TaskCompleted` | (none) | When a task is marked completed |
| `PreCompact` | (none) | Before conversation compaction |

**Hook Types**:
- `command` — shell command, receives JSON on stdin, exit codes control behavior
- `prompt` — LLM-evaluated prompt with `$ARGUMENTS` placeholder
- `agent` — agentic verifier with tools for complex validation

**Hook Configuration Shape**:
```json
{
  "hooks": {
    "EventName": [
      {
        "matcher": "regex pattern",
        "hooks": [
          {
            "type": "command | prompt | agent",
            "command": "script path or shell command",
            "timeout": 60000
          }
        ]
      }
    ]
  }
}
```

**Exit code semantics** (for `command` type):
- `0` — allow / no opinion
- `1` — error (hook itself failed)
- `2` — block the action (PreToolUse: reject tool call; Stop: force continue)

**Additional hook settings**:
- `disableAllHooks` (boolean) — kill switch
- `allowManagedHooksOnly` (boolean) — restrict to managed hooks only

**GUI elements**:
- Event picker dropdown
- Matcher regex input with validation
- Hook type selector (command / prompt / agent)
- Command/script editor with syntax highlighting
- Test button (dry-run hook with sample input JSON)
- Async toggle for background hooks
- Timeout configuration

### 3. MCP Servers

Manager for MCP server configurations across `.mcp.json` and `~/.claude.json`.

**Transport types**:

| Transport | Config Shape |
|-----------|-------------|
| `stdio` | `{ command, args[], env{} }` |
| `http` | `{ type: "http", url, headers{}, oauth? }` |
| `sse` (deprecated) | `{ type: "sse", url, headers{} }` |

**OAuth configuration** (for HTTP servers):
- `clientId`, `callbackPort`
- Client secret stored in system keychain (not in config)

**Scopes**: local (default, stored in `~/.claude.json`), project (`.mcp.json`, version-controlled), user (`~/.claude.json`)

**Environment variable expansion** in `.mcp.json`:
- `${VAR}` — expand env var
- `${VAR:-default}` — expand with fallback
- Supported in: `command`, `args`, `env`, `url`, `headers`

**MCP policy settings** (in `settings.json`):
| Setting | Type | Description |
|---------|------|-------------|
| `allowManagedMcpServersOnly` | `boolean` | Lock to managed servers only |
| `enableAllProjectMcpServers` | `boolean` | Auto-approve project servers |
| `enabledMcpjsonServers` | `string[]` | Whitelist specific project servers |
| `disabledMcpjsonServers` | `string[]` | Blacklist specific project servers |
| `allowedMcpServers` | `object[]` | Allowlist by name/command/URL pattern |
| `deniedMcpServers` | `object[]` | Denylist by name/command/URL pattern |

**Allowlist/denylist entry shapes**:
- `{ serverName: "..." }` — match by config name
- `{ serverCommand: ["cmd", "arg1", ...] }` — exact command match for stdio
- `{ serverUrl: "https://*.example.com/*" }` — wildcard URL match for remote

**GUI elements**:
- Server list with status indicators (connected/disconnected/error)
- Add server wizard (transport type selector → config form)
- Scope selector (local / project / user)
- Environment variable expansion preview
- OAuth configuration panel (client ID, callback port)
- Policy tab for allowlist/denylist management
- Import from Claude Desktop button

### 4. Memory (CLAUDE.md)

Rich editor for memory/instruction files at all scopes.

**Files**:
- `~/.claude/CLAUDE.md` — user (global)
- `CLAUDE.md` (project root) or `.claude/CLAUDE.md` — project
- `.claude/CLAUDE.local.md` — local (personal, gitignored)

**Behavior**: Loaded at session start. First 200 lines of auto-memory MEMORY.md are injected into context.

**GUI elements**:
- Monaco-powered markdown editor with live preview
- Scope tabs (User / Project / Local) with visual indicators for which exist
- Merge preview showing effective memory (all scopes combined, with scope labels)
- Template snippets for common patterns (coding conventions, tool restrictions, project context)
- Line count indicator (warn when approaching context budget)

### 5. Subagents

Editor for custom subagent definitions (`.claude/agents/` and `~/.claude/agents/`).

**Frontmatter fields** (complete):

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `name` | Yes | `string` | Unique identifier (lowercase, hyphens) |
| `description` | Yes | `string` | When Claude should delegate to this agent |
| `tools` | No | `string` (CSV) | Allowed tools. Inherits all if omitted. Supports `Task(agent_type)` to restrict spawnable subagents |
| `disallowedTools` | No | `string` (CSV) | Tools to deny (removed from inherited list) |
| `model` | No | `enum` | `sonnet`, `opus`, `haiku`, `inherit` (default: `inherit`) |
| `permissionMode` | No | `enum` | `default`, `acceptEdits`, `dontAsk`, `bypassPermissions`, `plan` |
| `maxTurns` | No | `number` | Max agentic turns before stopping |
| `skills` | No | `string[]` | Skills to preload into agent context at startup |
| `mcpServers` | No | `string[] | object` | MCP servers available to this agent (by name or inline def) |
| `hooks` | No | `object` | Lifecycle hooks scoped to this agent (same schema as global hooks) |
| `memory` | No | `enum` | `user`, `project`, `local` — enables persistent cross-session memory |
| `background` | No | `boolean` | Always run as background task (default: `false`) |
| `isolation` | No | `enum` | `worktree` — run in isolated git worktree |

**Body**: Markdown system prompt for the agent.

**Scopes**: CLI `--agents` flag (session, not persisted) > `.claude/agents/` (project) > `~/.claude/agents/` (user) > plugin `agents/`

**GUI elements**:
- Agent list with scope badges (user / project / plugin)
- Visual form for frontmatter fields (dropdowns, checkboxes, multi-selects)
- Tool picker (checkbox list of all available tools, with `Task(type)` sub-selector)
- Monaco editor for system prompt markdown body
- Inline hooks editor (same component as global hooks, scoped to agent)
- Memory scope selector with directory path preview
- "Generate with Claude" button (like `/agents` command)
- Preview: rendered agent card showing name, description, model, tool count

### 6. Skills

Editor for skill definitions (`.claude/skills/*/SKILL.md` and `~/.claude/skills/*/SKILL.md`).

**Frontmatter fields** (complete):

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `name` | No | `string` | Display name. Defaults to directory name |
| `description` | Recommended | `string` | When to use. Claude uses this for auto-invocation |
| `argument-hint` | No | `string` | Hint shown in autocomplete (e.g. `[issue-number]`) |
| `disable-model-invocation` | No | `boolean` | `true` = only user can invoke via `/name` |
| `user-invocable` | No | `boolean` | `false` = hidden from `/` menu, only Claude can invoke |
| `allowed-tools` | No | `string` (CSV) | Tools Claude can use without permission when skill active |
| `model` | No | `string` | Model override when skill is active |
| `context` | No | `enum` | `fork` = run in isolated subagent context |
| `agent` | No | `string` | Subagent type to use when `context: fork` (default: `general-purpose`) |
| `hooks` | No | `object` | Hooks scoped to skill lifecycle |

**Body**: Markdown instructions, supports:
- `$ARGUMENTS` / `$ARGUMENTS[N]` / `$N` — argument substitution
- `${CLAUDE_SESSION_ID}` — session ID substitution
- `` !`command` `` — dynamic context injection (shell command runs before sending to Claude)

**Supporting files**: Reference docs, templates, scripts alongside SKILL.md in skill directory.

**Scopes**: Enterprise (managed) > Personal (`~/.claude/skills/`) > Project (`.claude/skills/`) > Plugin

**GUI elements**:
- Skill list with invocation mode indicators (user-only / auto / both)
- Visual form for frontmatter
- Monaco editor for skill markdown body
- Supporting file manager (add/remove/edit files in skill directory)
- Argument substitution preview
- Test invocation panel (simulate `/skill-name arg1 arg2`)

### 7. Plugins

Browser and manager for Claude Code plugins.

**Plugin settings** in `settings.json`:

| Setting | Type | Description |
|---------|------|-------------|
| `enabledPlugins` | `object` | `{ "name@marketplace": boolean }` |
| `extraKnownMarketplaces` | `object` | Additional marketplace sources |
| `strictKnownMarketplaces` | `object[]` | Allowed marketplaces only |
| `blockedMarketplaces` | `object[]` | Blocked marketplace sources |

**Plugin manifest** (`plugin.json`):

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Plugin identifier (kebab-case) |
| `version` | `string` | Semver version |
| `description` | `string` | What the plugin does |
| `author` | `object` | `{ name, email, url }` |
| `homepage` | `string` | Documentation URL |
| `repository` | `string` | Source code URL |
| `license` | `string` | License identifier |
| `keywords` | `string[]` | Discovery tags |
| `commands` | `string | string[]` | Command file paths |
| `agents` | `string | string[]` | Agent file paths |
| `skills` | `string | string[]` | Skill directory paths |
| `hooks` | `string | object` | Hook config path or inline |
| `mcpServers` | `string | object` | MCP config path or inline |
| `lspServers` | `string | object` | LSP server config |
| `outputStyles` | `string | string[]` | Output style paths |

**Plugin components**: skills, agents, hooks, MCP servers, LSP servers

**Installation scopes**: user, project, local, managed

**GUI elements**:
- Installed plugins list with enable/disable toggles
- Plugin detail view showing bundled components (skills, agents, hooks, MCP, LSP)
- Marketplace configuration (add/remove sources, allowlist/blocklist)
- Install/uninstall with scope selector
- Update checker

### 8. Sandbox

Visual configurator for the `sandbox` object in `settings.json`.

| Setting | Type | Description |
|---------|------|-------------|
| `sandbox.enabled` | `boolean` | Enable sandboxing |
| `sandbox.autoAllowBashIfSandboxed` | `boolean` | Auto-allow Bash when sandboxed |
| `sandbox.excludedCommands` | `string[]` | Commands exempt from sandbox |
| `sandbox.allowUnsandboxedCommands` | `boolean` | Allow running unsandboxed commands |
| `sandbox.network.allowedDomains` | `string[]` | Whitelisted domains (supports `*.example.com`) |
| `sandbox.network.allowManagedDomainsOnly` | `boolean` | Lock to managed domains |
| `sandbox.network.allowUnixSockets` | `string[]` | Allowed Unix socket paths |
| `sandbox.network.allowAllUnixSockets` | `boolean` | Allow all Unix sockets |
| `sandbox.network.allowLocalBinding` | `boolean` | Allow binding to localhost |
| `sandbox.network.httpProxyPort` | `number` | HTTP proxy port |
| `sandbox.network.socksProxyPort` | `number` | SOCKS proxy port |
| `sandbox.enableWeakerNestedSandbox` | `boolean` | Allow weaker sandbox for nested processes |

**GUI elements**:
- Toggle switches for boolean settings
- Domain allowlist with wildcard pattern editor
- Command exclusion list
- Unix socket path list
- Network panel with proxy configuration
- Visual diagram showing what's sandboxed vs. open

### 9. Environment Variables

Key-value editor for `env` and related settings in `settings.json`.

**Settings**:

| Setting | Type | Description |
|---------|------|-------------|
| `env` | `object` | Key-value environment variables |
| `apiKeyHelper` | `string` | Script to generate API keys |
| `otelHeadersHelper` | `string` | Script to generate OTEL headers |
| `awsAuthRefresh` | `string` | AWS SSO refresh command |
| `awsCredentialExport` | `string` | AWS credential generation script |

**Known Claude Code environment variables** (exhaustive):

Authentication:
- `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_CUSTOM_HEADERS`
- `ANTHROPIC_MODEL`, `ANTHROPIC_FOUNDRY_API_KEY`, `ANTHROPIC_FOUNDRY_BASE_URL`
- `AWS_BEARER_TOKEN_BEDROCK`

Feature toggles:
- `CLAUDE_CODE_ENABLE_TELEMETRY`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY`
- `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS`, `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`
- `CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`
- `DISABLE_AUTOUPDATER`, `DISABLE_ERROR_REPORTING`, `DISABLE_TELEMETRY`

Limits:
- `CLAUDE_CODE_MAX_OUTPUT_TOKENS`, `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS`
- `BASH_MAX_OUTPUT_LENGTH`, `BASH_DEFAULT_TIMEOUT_MS`
- `MAX_THINKING_TOKENS`, `MAX_MCP_OUTPUT_TOKENS`
- `MCP_TIMEOUT`, `MCP_TOOL_TIMEOUT`
- `SLASH_COMMAND_TOOL_CHAR_BUDGET`

Operational:
- `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_TMPDIR`
- `CLAUDE_CODE_ORGANIZATION_UUID`, `CLAUDE_CODE_ACCOUNT_UUID`
- `CLAUDE_CODE_USER_EMAIL`, `CLAUDE_CODE_HIDE_ACCOUNT_INFO`
- `CLAUDE_CODE_SHELL`, `CLAUDE_CODE_EFFORT_LEVEL`
- `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`
- `ENABLE_TOOL_SEARCH` (`auto`, `auto:<N>`, `true`, `false`)

**GUI elements**:
- Key-value table with add/remove
- Known-variable autocomplete with descriptions
- Helper script path selectors with file picker
- Categorized view (auth / toggles / limits / operational)
- Sensitive value masking for API keys

### 10. Model & Display

Visual settings for model selection, output style, and UI customization.

| Setting | Type | Description |
|---------|------|-------------|
| `model` | `string` | Default model (e.g. `claude-sonnet-4-6`) |
| `availableModels` | `string[]` | Restrict model selection |
| `outputStyle` | `string` | Output verbosity (`Explanatory`, etc.) |
| `language` | `string` | Response language |
| `statusLine.type` | `string` | `"command"` |
| `statusLine.command` | `string` | Script for status line |
| `fileSuggestion.type` | `string` | `"command"` |
| `fileSuggestion.command` | `string` | Script for file suggestions |
| `respectGitignore` | `boolean` | Honor .gitignore in file operations |
| `prefersReducedMotion` | `boolean` | Reduce animations |
| `spinnerTipsEnabled` | `boolean` | Show tips during spinner |
| `spinnerTipsOverride.excludeDefault` | `boolean` | Replace default tips |
| `spinnerTipsOverride.tips` | `string[]` | Custom tip strings |
| `spinnerVerbs.mode` | `enum` | `append` or `replace` |
| `spinnerVerbs.verbs` | `string[]` | Custom spinner verbs |
| `terminalProgressBarEnabled` | `boolean` | Show terminal progress bar |
| `showTurnDuration` | `boolean` | Display turn timing |
| `alwaysThinkingEnabled` | `boolean` | Force extended thinking |
| `attribution.commit` | `string` | Git commit attribution text |
| `attribution.pr` | `string` | PR attribution text |
| `companyAnnouncements` | `string[]` | Org-wide announcements |

**GUI elements**:
- Model dropdown with available models
- Output style selector
- Attribution template editor with variable previews
- Spinner customization (tips, verbs)
- Toggle switches for boolean display settings

### 11. Session & Advanced

Remaining settings that don't fit other panels.

| Setting | Type | Description |
|---------|------|-------------|
| `cleanupPeriodDays` | `number` | Session cleanup interval |
| `plansDirectory` | `string` | Where plans are stored |
| `forceLoginMethod` | `string` | `claudeai` or `console` |
| `forceLoginOrgUUID` | `string` | Forced org UUID |
| `autoUpdatesChannel` | `string` | `stable` or other channels |
| `teammatesMode` | `string` | `in-process` |

### 12. Scope Visualizer (Effective Config)

A read-only panel showing the **merged effective configuration** Claude Code actually sees.

**Functionality**:
- Merge all scopes following Claude Code precedence rules
- Color-code each setting by its source scope
- Highlight overrides (where a higher-priority scope overrides a lower one)
- Show managed settings (read-only, from IT)
- JSON view (raw merged output) and structured view (per-domain breakdown)
- Diff mode: compare two scopes side by side

---

## Tech Stack

### Core

| Layer | Choice | Why |
|-------|--------|-----|
| **Framework** | **Tauri v2** | ~5MB bundle, Rust backend for filesystem, native OS integration |
| **Frontend** | **React + TypeScript** | Ecosystem maturity, component libraries |
| **UI Library** | **shadcn/ui + Tailwind CSS** | Beautiful defaults, fully customizable, zero runtime |
| **State** | **Zustand** | Minimal, TypeScript-native |
| **Editor** | **Monaco Editor** | VS Code's editor for CLAUDE.md, agents, skills |
| **Build** | **Vite** | Fast HMR, native Tauri integration |

### Backend (Tauri/Rust side)

| Concern | Approach |
|---------|----------|
| **File I/O** | Tauri fs plugin — read/write config files with proper permissions |
| **File watching** | Rust `notify` crate — detect external changes, reload |
| **JSON validation** | `serde_json` + custom schema types — validate settings before write |
| **Config merging** | Rust-side merge logic — compute effective config with precedence |
| **Shell detection** | Detect OS, shell, Claude Code install path |
| **Atomic writes** | Write to temp file, then rename — prevent partial reads by Claude Code |

### Why Tauri over Electron?

- **Bundle size**: ~5MB vs ~150MB+
- **Memory**: ~30MB vs ~150MB+
- **Security**: Rust backend, no Node.js in production
- **Native feel**: Uses OS webview
- **File access**: Tauri plugins give controlled, permissioned filesystem access

### Why not a web app?

- Need direct filesystem access to `~/.claude/`, `.claude/`, etc.
- Must work offline
- Desktop app gives tray icon, OS notifications, file watchers

---

## Connectivity to Claude Code

### Primary: Direct Filesystem

The app reads and writes the same files Claude Code uses. No IPC, no API — just shared files on disk.

```
ssenrah GUI ──writes──▶ ~/.claude/settings.json
                        .claude/settings.json
                        .claude/settings.local.json
                        .claude/.mcp.json
                        ~/.claude.json
                        CLAUDE.md / .claude/CLAUDE.md / CLAUDE.local.md
                        .claude/agents/*.md
                        ~/.claude/agents/*.md
                        .claude/skills/*/SKILL.md
                        ~/.claude/skills/*/SKILL.md

Claude Code ──reads───▶ (same files at startup / on reload)
```

**File watching** ensures bidirectional awareness:
- GUI watches for external changes (user edits in terminal, Claude Code modifies its own config)
- GUI writes atomically (write-to-temp + rename) to avoid partial reads

### Future: Claude Code as MCP Server

Claude Code can run as an MCP server (`claude mcp serve`). In a future iteration:
- Query Claude Code's current effective config via MCP tools
- Trigger config reload without restarting the session
- Read active session state (current model, active hooks, loaded plugins)

### Future: ssenrah Plugin for Claude Code

A Claude Code plugin that:
- Exposes a `/ssenrah` slash command to open the GUI from within Claude Code
- Syncs runtime state back to the GUI

---

## Project Structure

```
ssenrah/
├── README.md
├── CLAUDE.md
├── PLAN-GUI.md                 ← this file
├── examples/                   ← existing harness examples (TypeScript)
├── docs/                       ← architecture docs
│
├── app/                        ← the GUI application
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   │
│   ├── src/                    ← React frontend
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── ui/             ← shadcn components
│   │   │   ├── permissions/    ← permission rule builder
│   │   │   ├── hooks/          ← hooks configurator
│   │   │   ├── mcp/            ← MCP server manager
│   │   │   ├── memory/         ← CLAUDE.md editor
│   │   │   ├── agents/         ← subagent editor
│   │   │   ├── skills/         ← skill editor
│   │   │   ├── plugins/        ← plugin browser
│   │   │   ├── sandbox/        ← sandbox configurator
│   │   │   ├── env/            ← environment variable editor
│   │   │   ├── display/        ← model & display settings
│   │   │   ├── visualizer/     ← effective config viewer
│   │   │   └── layout/         ← sidebar, header, scope selector, project picker
│   │   ├── lib/
│   │   │   ├── config/         ← config parsing, merging, validation
│   │   │   ├── schemas/        ← TypeScript types for all Claude Code settings
│   │   │   ├── file-watcher/   ← file change detection bridge
│   │   │   └── store/          ← Zustand stores (one per domain)
│   │   └── types/              ← shared TypeScript types
│   │
│   └── src-tauri/              ← Rust backend
│       ├── Cargo.toml
│       ├── src/
│       │   ├── main.rs
│       │   ├── commands/       ← Tauri commands (read/write/merge config)
│       │   ├── watcher/        ← filesystem watcher (notify crate)
│       │   └── schema/         ← config validation and merging
│       └── tauri.conf.json
│
└── packages/                   ← shared packages (future)
    └── config-schema/          ← Claude Code config types, reusable across tools
```

---

## UI Layout

```
┌──────────────────────────────────────────────────────────┐
│  ssenrah                    [Project: ~/my-app ▾]   [⚙]  │
├───────────┬──────────────────────────────────────────────┤
│           │                                              │
│ Scope     │  [Panel Title]                               │
│ ───────── │                                              │
│ ● User    │  ┌────────────────────────────────────────┐  │
│ ○ Project │  │                                        │  │
│ ○ Local   │  │  (Panel-specific content:               │  │
│           │  │   forms, tables, editors, etc.)         │  │
│ Panels    │  │                                        │  │
│ ───────── │  │                                        │  │
│ Perms     │  │                                        │  │
│ Hooks     │  │                                        │  │
│ MCP       │  │                                        │  │
│ Memory    │  │                                        │  │
│ Agents    │  │                                        │  │
│ Skills    │  └────────────────────────────────────────┘  │
│ Plugins   │                                              │
│ Sandbox   │  [Effective Config]  (collapsible footer)    │
│ Env       │  ┌────────────────────────────────────────┐  │
│ Display   │  │ { merged JSON preview, color-coded     │  │
│ Advanced  │  │   by source scope }                    │  │
│ ───────── │  └────────────────────────────────────────┘  │
│ Effective │                                              │
│           │                                              │
└───────────┴──────────────────────────────────────────────┘
```

---

## Distribution

**GitHub Releases** — primary distribution method.
- Build for macOS (arm64, x64), Linux (x64, arm64), Windows (x64)
- Tauri's built-in updater for auto-updates
- `.dmg` for macOS, `.AppImage` / `.deb` for Linux, `.msi` for Windows

**Homebrew** — future, once stable.

---

## Config Schema Maintenance

Claude Code does not publish a formal JSON schema. We maintain our own TypeScript types and Zod schemas derived from the official documentation. These live in `packages/config-schema/` and are the source of truth for:
- Frontend form generation
- Rust-side validation
- Effective config merging logic

When Claude Code releases updates, we update our schemas by diffing against the [official settings docs](https://code.claude.com/docs/en/settings) and the [hooks reference](https://code.claude.com/docs/en/hooks).
