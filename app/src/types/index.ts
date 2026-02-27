// Config scopes
export type ConfigScope = "user" | "project" | "local" | "managed";
export type WritableScope = "user" | "project" | "local";
export type McpSource = "project" | "user" | "managed";
export type WritableMcpSource = "project" | "user";
export type MemoryScope = "user" | "project" | "project_root" | "local";
export type AgentScope = "user" | "project";
export type SkillScope = "user" | "project";

// Panel IDs matching the sidebar nav
export type PanelId =
  | "permissions" | "hooks" | "mcp" | "memory" | "agents"
  | "skills" | "plugins" | "sandbox" | "env" | "display"
  | "advanced" | "effective";

// Load status
export type LoadStatus =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "loaded" }
  | { state: "error"; error: IpcError };

// IPC error from Rust backend
export type IpcError =
  | { kind: "not_found"; path: string }
  | { kind: "permission_denied"; path: string }
  | { kind: "parse_error"; path: string; message: string }
  | { kind: "write_failed"; path: string; message: string }
  | { kind: "validation_error"; errors: ValidationError[] }
  | { kind: "no_project"; message: string }
  | { kind: "platform_error"; message: string };

export interface ValidationError {
  path: string;
  message: string;
  code: string;
}

export interface ValidationWarning {
  path: string;
  message: string;
  code: string;
}

export interface PlatformInfo {
  os: "macos" | "linux" | "windows";
  isWsl: boolean;
  shell: string;
  claudeCodeInstalled: boolean;
  claudeCodePath: string | null;
  configDir: string;
  managedSettingsDir: string | null;
}

export interface ProjectInfo {
  projectRoot: string | null;
  claudeDirExists: boolean;
  gitRoot: string | null;
}

export interface ConflictInfo {
  id: string;
  scope: ConfigScope;
  file: string;
  conflictingFields: string[];
  externalValue: unknown;
  localValue: unknown;
}

// Hook types
export type HookEvent =
  | "PreToolUse" | "PostToolUse" | "PostToolUseFailure"
  | "PermissionRequest" | "UserPromptSubmit" | "Notification"
  | "Stop" | "SubagentStart" | "SubagentStop"
  | "SessionStart" | "SessionEnd" | "TeammateIdle"
  | "TaskCompleted" | "PreCompact";

export interface HookDefinition {
  type: "command" | "prompt" | "agent";
  command?: string;
  prompt?: string;
  timeout?: number;
}

export interface HookGroup {
  matcher?: string;
  hooks: HookDefinition[];
}

// Settings (partial - will be completed with Zod schemas later)
export interface Settings {
  permissions?: {
    allow?: string[];
    ask?: string[];
    deny?: string[];
    additionalDirectories?: string[];
    defaultMode?: "acceptEdits" | "reviewAll";
    disableBypassPermissionsMode?: "disable";
  };
  hooks?: Partial<Record<HookEvent, HookGroup[]>>;
  disableAllHooks?: boolean;
  allowManagedHooksOnly?: boolean;
  sandbox?: {
    enabled?: boolean;
    autoAllowBashIfSandboxed?: boolean;
    excludedCommands?: string[];
    allowUnsandboxedCommands?: boolean;
    network?: {
      allowedDomains?: string[];
      allowManagedDomainsOnly?: boolean;
      allowUnixSockets?: string[];
      allowAllUnixSockets?: boolean;
      allowLocalBinding?: boolean;
      httpProxyPort?: number;
      socksProxyPort?: number;
    };
    enableWeakerNestedSandbox?: boolean;
  };
  env?: Record<string, string>;
  apiKeyHelper?: string;
  otelHeadersHelper?: string;
  awsAuthRefresh?: string;
  awsCredentialExport?: string;
  model?: string;
  availableModels?: string[];
  outputStyle?: string;
  language?: string;
  statusLine?: { type: "command"; command: string };
  fileSuggestion?: { type: "command"; command: string };
  respectGitignore?: boolean;
  prefersReducedMotion?: boolean;
  spinnerTipsEnabled?: boolean;
  spinnerTipsOverride?: { excludeDefault?: boolean; tips?: string[] };
  spinnerVerbs?: { mode?: "append" | "replace"; verbs?: string[] };
  terminalProgressBarEnabled?: boolean;
  showTurnDuration?: boolean;
  alwaysThinkingEnabled?: boolean;
  attribution?: { commit?: string; pr?: string };
  companyAnnouncements?: string[];
  enabledPlugins?: Record<string, boolean>;
  extraKnownMarketplaces?: Record<string, unknown>;
  strictKnownMarketplaces?: object[];
  blockedMarketplaces?: object[];
  allowManagedMcpServersOnly?: boolean;
  enableAllProjectMcpServers?: boolean;
  enabledMcpjsonServers?: string[];
  disabledMcpjsonServers?: string[];
  cleanupPeriodDays?: number;
  plansDirectory?: string;
  forceLoginMethod?: "claudeai" | "console";
  forceLoginOrgUUID?: string;
  autoUpdatesChannel?: string;
  teammatesMode?: string;
  [key: string]: unknown;
}

// Panel metadata
export interface PanelMeta {
  id: PanelId;
  label: string;
  icon: string;
  scopes: ConfigScope[];
}

export const PANELS: PanelMeta[] = [
  { id: "permissions", label: "Permissions", icon: "Shield", scopes: ["user", "project", "local", "managed"] },
  { id: "hooks", label: "Hooks", icon: "Webhook", scopes: ["user", "project", "local", "managed"] },
  { id: "mcp", label: "MCP Servers", icon: "Server", scopes: ["user", "project", "managed"] },
  { id: "memory", label: "Memory", icon: "Brain", scopes: ["user", "project", "local"] },
  { id: "agents", label: "Agents", icon: "Bot", scopes: ["user", "project"] },
  { id: "skills", label: "Skills", icon: "Sparkles", scopes: ["user", "project"] },
  { id: "plugins", label: "Plugins", icon: "Puzzle", scopes: ["user"] },
  { id: "sandbox", label: "Sandbox", icon: "Box", scopes: ["user", "project", "local", "managed"] },
  { id: "env", label: "Environment", icon: "Variable", scopes: ["user", "project", "local", "managed"] },
  { id: "display", label: "Model & Display", icon: "Palette", scopes: ["user", "project", "local", "managed"] },
  { id: "advanced", label: "Advanced", icon: "Settings", scopes: ["user", "project", "local"] },
  { id: "effective", label: "Effective Config", icon: "Layers", scopes: [] },
];
