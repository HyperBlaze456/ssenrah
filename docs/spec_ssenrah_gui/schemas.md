# Config File Schemas

Complete TypeScript types for every Claude Code configuration structure. Zod schemas are derived from these types for runtime validation.

**Related**: [ipc.md](ipc.md) for how these are read/written, [validation.md](validation.md) for validation rules, [merging.md](merging.md) for how scopes combine.

---

## Settings (`settings.json`)

The primary configuration file. Exists at user (`~/.claude/settings.json`), project (`.claude/settings.json`), and local (`.claude/settings.local.json`) scopes.

```typescript
interface Settings {
  // --- Permissions ---
  permissions?: {
    allow?: string[];               // e.g. ["Bash(npm run *)", "Read(src/**)"]
    ask?: string[];
    deny?: string[];                // e.g. ["Read(.env*)", "WebFetch"]
    additionalDirectories?: string[];
    defaultMode?: "acceptEdits" | "reviewAll";
    disableBypassPermissionsMode?: "disable";
  };

  // --- Hooks ---
  hooks?: Record<HookEvent, HookGroup[]>;
  disableAllHooks?: boolean;
  allowManagedHooksOnly?: boolean;

  // --- MCP Policy ---
  allowManagedMcpServersOnly?: boolean;
  enableAllProjectMcpServers?: boolean;
  enabledMcpjsonServers?: string[];
  disabledMcpjsonServers?: string[];
  allowedMcpServers?: McpServerMatcher[];
  deniedMcpServers?: McpServerMatcher[];

  // --- Sandbox ---
  sandbox?: {
    enabled?: boolean;
    autoAllowBashIfSandboxed?: boolean;
    excludedCommands?: string[];
    allowUnsandboxedCommands?: boolean;
    network?: {
      allowedDomains?: string[];        // supports *.example.com
      allowManagedDomainsOnly?: boolean;
      allowUnixSockets?: string[];
      allowAllUnixSockets?: boolean;
      allowLocalBinding?: boolean;
      httpProxyPort?: number;
      socksProxyPort?: number;
    };
    enableWeakerNestedSandbox?: boolean;
  };

  // --- Environment ---
  env?: Record<string, string>;
  apiKeyHelper?: string;
  otelHeadersHelper?: string;
  awsAuthRefresh?: string;
  awsCredentialExport?: string;

  // --- Model & Display ---
  model?: string;
  availableModels?: string[];
  outputStyle?: string;
  language?: string;
  statusLine?: { type: "command"; command: string };
  fileSuggestion?: { type: "command"; command: string };
  respectGitignore?: boolean;
  prefersReducedMotion?: boolean;
  spinnerTipsEnabled?: boolean;
  spinnerTipsOverride?: {
    excludeDefault?: boolean;
    tips?: string[];
  };
  spinnerVerbs?: {
    mode?: "append" | "replace";
    verbs?: string[];
  };
  terminalProgressBarEnabled?: boolean;
  showTurnDuration?: boolean;
  alwaysThinkingEnabled?: boolean;
  attribution?: {
    commit?: string;
    pr?: string;
  };
  companyAnnouncements?: string[];

  // --- Plugins ---
  enabledPlugins?: Record<string, boolean>;   // "name@marketplace" → enabled
  extraKnownMarketplaces?: Record<string, unknown>;
  strictKnownMarketplaces?: object[];
  blockedMarketplaces?: object[];

  // --- Session & Advanced ---
  cleanupPeriodDays?: number;
  plansDirectory?: string;
  forceLoginMethod?: "claudeai" | "console";
  forceLoginOrgUUID?: string;
  autoUpdatesChannel?: string;
  teammatesMode?: string;
}
```

### Hook Sub-Types

```typescript
type HookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "PermissionRequest"
  | "UserPromptSubmit"
  | "Notification"
  | "Stop"
  | "SubagentStart"
  | "SubagentStop"
  | "SessionStart"
  | "SessionEnd"
  | "TeammateIdle"
  | "TaskCompleted"
  | "PreCompact";

interface HookGroup {
  matcher?: string;                 // regex pattern (optional — omit to match all)
  hooks: HookDefinition[];
}

interface HookDefinition {
  type: "command" | "prompt" | "agent";
  command?: string;                 // for type: "command"
  prompt?: string;                  // for type: "prompt" — supports $ARGUMENTS
  timeout?: number;                 // milliseconds, default varies by type
}
```

### MCP Server Matcher

```typescript
type McpServerMatcher =
  | { serverName: string }
  | { serverCommand: string[] }     // exact command+args match for stdio
  | { serverUrl: string };          // wildcard URL match for remote
```

---

## McpConfig (`.mcp.json`)

Project-scoped MCP server definitions.

```typescript
interface McpConfig {
  mcpServers: Record<string, McpServerDefinition>;
}

type McpServerDefinition =
  | McpStdioServer
  | McpHttpServer
  | McpSseServer;

interface McpStdioServer {
  type?: "stdio";                   // default if omitted
  command: string;
  args?: string[];
  env?: Record<string, string>;     // supports ${VAR} and ${VAR:-default}
}

interface McpHttpServer {
  type: "http";
  url: string;                      // supports ${VAR} expansion
  headers?: Record<string, string>;
  oauth?: {
    clientId: string;
    callbackPort?: number;
  };
}

interface McpSseServer {
  type: "sse";                      // deprecated
  url: string;
  headers?: Record<string, string>;
}
```

### Environment Variable Expansion

MCP configs support variable expansion in `command`, `args`, `env` values, `url`, and `headers` values:

- `${VAR}` — expand environment variable, error if unset
- `${VAR:-default}` — expand with fallback value

---

## UserConfig (`~/.claude.json`)

User-level config file. We only read/write the `mcpServers` section. Other keys (OAuth tokens, caches) are preserved but not managed.

```typescript
interface UserConfig {
  mcpServers?: Record<string, McpServerDefinition>;
  // Other keys exist but are opaque to us — preserve on write
  [key: string]: unknown;
}
```

---

## AgentFrontmatter (agent `.md` YAML)

Parsed from YAML frontmatter in `.claude/agents/*.md` and `~/.claude/agents/*.md`.

```typescript
interface AgentFrontmatter {
  name: string;                               // required, lowercase with hyphens
  description: string;                        // required
  tools?: string;                             // CSV of tool names
  disallowedTools?: string;                   // CSV of denied tools
  model?: "sonnet" | "opus" | "haiku" | "inherit";
  permissionMode?: "default" | "acceptEdits" | "dontAsk" | "bypassPermissions" | "plan";
  maxTurns?: number;
  skills?: string[];
  mcpServers?: string[] | Record<string, McpServerDefinition>;
  hooks?: Record<HookEvent, HookGroup[]>;     // same schema as global hooks
  memory?: "user" | "project" | "local";
  background?: boolean;
  isolation?: "worktree";
}
```

---

## SkillFrontmatter (skill `SKILL.md` YAML)

Parsed from YAML frontmatter in `.claude/skills/*/SKILL.md` and `~/.claude/skills/*/SKILL.md`.

```typescript
interface SkillFrontmatter {
  name?: string;                              // defaults to directory name
  description?: string;
  "argument-hint"?: string;                   // e.g. "[issue-number]"
  "disable-model-invocation"?: boolean;
  "user-invocable"?: boolean;                 // default true
  "allowed-tools"?: string;                   // CSV
  model?: string;
  context?: "fork";
  agent?: string;                             // agent type for forked context
  hooks?: Record<HookEvent, HookGroup[]>;
}
```

---

## PluginManifest (`plugin.json`)

```typescript
interface PluginManifest {
  name: string;                               // kebab-case
  version: string;                            // semver
  description: string;
  author?: { name: string; email?: string; url?: string };
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
  commands?: string | string[];               // command file paths
  agents?: string | string[];                 // agent file paths
  skills?: string | string[];                 // skill directory paths
  hooks?: string | Record<HookEvent, HookGroup[]>;
  mcpServers?: string | Record<string, McpServerDefinition>;
  lspServers?: string | Record<string, unknown>;
  outputStyles?: string | string[];
}
```

---

## ManagedSettings (`managed-settings.json`)

IT-enforced settings. Read-only in the GUI. Same shape as `Settings` but every field is treated as an override that cannot be changed by lower scopes.

```typescript
type ManagedSettings = Settings;
// Semantic difference: values here override all other scopes
// GUI displays these as locked/read-only with a badge
```

---

## ManagedMcp (`managed-mcp.json`)

IT-enforced MCP servers. Read-only.

```typescript
type ManagedMcp = McpConfig;
// Same shape as McpConfig, displayed as locked in GUI
```

---

## Zod Schemas

Each TypeScript type has a corresponding Zod schema for runtime validation. Schemas are exported from `packages/config-schema/` and used both in the frontend (form validation) and referenced by the Rust backend (via generated JSON Schema).

Naming convention: `<TypeName>Schema`

```typescript
// Example derivation pattern
import { z } from "zod";

export const HookDefinitionSchema = z.object({
  type: z.enum(["command", "prompt", "agent"]),
  command: z.string().optional(),
  prompt: z.string().optional(),
  timeout: z.number().positive().optional(),
}).refine(
  (h) => {
    if (h.type === "command") return !!h.command;
    if (h.type === "prompt") return !!h.prompt;
    return true;
  },
  { message: "command hooks require 'command', prompt hooks require 'prompt'" }
);

export const HookGroupSchema = z.object({
  matcher: z.string().optional(),
  hooks: z.array(HookDefinitionSchema).min(1),
});

export const PermissionRuleSchema = z.string().regex(
  /^[A-Za-z_]+(\(.*\))?$/,
  "Permission rule must be ToolName or ToolName(specifier)"
);

export const SettingsSchema = z.object({
  permissions: z.object({
    allow: z.array(PermissionRuleSchema).optional(),
    ask: z.array(PermissionRuleSchema).optional(),
    deny: z.array(PermissionRuleSchema).optional(),
    additionalDirectories: z.array(z.string()).optional(),
    defaultMode: z.enum(["acceptEdits", "reviewAll"]).optional(),
    disableBypassPermissionsMode: z.literal("disable").optional(),
  }).optional(),
  // ... (all other fields follow the same pattern)
}).partial();

// Full schema exports:
// SettingsSchema, McpConfigSchema, McpServerDefinitionSchema,
// AgentFrontmatterSchema, SkillFrontmatterSchema, PluginManifestSchema,
// ManagedSettingsSchema, ManagedMcpSchema, UserConfigSchema
```

### JSON Schema Generation

Zod schemas are converted to JSON Schema (via `zod-to-json-schema`) for:
1. Rust-side validation using `jsonschema` crate
2. Monaco Editor intellisense in raw JSON editing mode
3. Documentation generation
