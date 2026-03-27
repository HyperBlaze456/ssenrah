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
  | "advanced" | "effective"
  | "activity" | "sessions" | "cost" | "alerts"
  | "reasoning" | "anomalies" | "verify";

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
  | "Stop" | "StopFailure" | "SubagentStart" | "SubagentStop"
  | "SessionStart" | "SessionEnd" | "TeammateIdle"
  | "TaskCreated" | "TaskCompleted" | "PreCompact" | "PostCompact"
  | "InstructionsLoaded" | "ConfigChange" | "CwdChanged" | "FileChanged"
  | "WorktreeCreate" | "WorktreeRemove"
  | "Elicitation" | "ElicitationResult";

export interface HookDefinition {
  type: "command" | "http" | "prompt" | "agent";
  command?: string;
  prompt?: string;
  timeout?: number;
  // command hook fields
  async?: boolean;
  shell?: string;
  // http hook fields
  url?: string;
  headers?: Record<string, string>;
  allowedEnvVars?: string[];
  // prompt/agent hook fields
  model?: string;
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
    defaultMode?: "default" | "acceptEdits" | "plan" | "auto" | "dontAsk" | "bypassPermissions";
    disableBypassPermissionsMode?: "disable";
    disableAutoMode?: boolean;
  };
  autoMode?: {
    environment?: string;
    allow?: string[];
    soft_deny?: string[];
  };
  hooks?: Partial<Record<HookEvent, HookGroup[]>>;
  disableAllHooks?: boolean;
  allowManagedHooksOnly?: boolean;
  allowManagedPermissionRulesOnly?: boolean;
  sandbox?: {
    enabled?: boolean;
    enableSandbox?: boolean;
    sandboxMode?: string;
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
    filesystem?: {
      allowRead?: string[];
      allowWrite?: string[];
      allowManagedReadPathsOnly?: boolean;
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
  modelOverrides?: Record<string, string>;
  effortLevel?: "low" | "medium" | "high";
  outputStyle?: string;
  language?: string;
  statusLine?: { type: "command"; command: string } | { type: "http"; url: string; interval?: number };
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
  disallowedTools?: string[];
  agent?: string;
  memory?: "auto" | false;
  enabledPlugins?: Record<string, boolean>;
  extraKnownMarketplaces?: Record<string, unknown>;
  strictKnownMarketplaces?: object[];
  blockedMarketplaces?: object[];
  allowManagedMcpServersOnly?: boolean;
  enableAllProjectMcpServers?: boolean;
  enabledMcpjsonServers?: string[];
  disabledMcpjsonServers?: string[];
  cleanupPeriodDays?: number;
  skipDangerousModePermissionPrompt?: boolean;
  plansDirectory?: string;
  forceLoginMethod?: "claudeai" | "console";
  forceLoginOrgUUID?: string;
  autoUpdatesChannel?: string;
  teammatesMode?: string;
  [key: string]: unknown;
}

// ── Monitor types ──────────────────────────────────────
// Matches harness/src/types.ts AgentEvent

export interface AgentEvent {
  id: string;
  timestamp: string;
  session_id: string;
  hook_event_type: string;
  cwd: string;
  permission_mode?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_use_id?: string;
  tool_response?: unknown;
  error?: string;
  agent_id?: string;
  agent_type?: string;
  model?: string;
  task_id?: string;
  task_subject?: string;
  task_description?: string;
  teammate_name?: string;
  team_name?: string;
  notification_type?: string;
  message?: string;
  source?: string;
  reason?: string;
  cost_usd?: number;
  _raw?: Record<string, unknown>;
}

export interface SessionSummary {
  session_id: string;
  event_count: number;
  first_event: string;
  last_event: string;
  duration_seconds: number;
  tool_uses: number;
  errors: number;
  subagents: number;
  cost_usd: number;
  top_tools: [string, number][];
}

export interface EventSummary {
  total_events: number;
  session_count: number;
  tool_uses: number;
  errors: number;
  subagents: number;
  tasks_completed: number;
  total_cost: number;
  first_event: string | null;
  last_event: string | null;
  top_tools: [string, number][];
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

/** Monitor panels — scope-independent (reads from ~/.ssenrah/) */
export const MONITOR_PANELS: PanelMeta[] = [
  { id: "activity", label: "Activity", icon: "Activity", scopes: [] },
  { id: "sessions", label: "Sessions", icon: "Clock", scopes: [] },
  { id: "cost", label: "Cost", icon: "DollarSign", scopes: [] },
  { id: "alerts", label: "Alerts", icon: "AlertTriangle", scopes: [] },
  { id: "reasoning", label: "Reasoning", icon: "Brain", scopes: [] },
  { id: "anomalies", label: "Anomalies", icon: "Radar", scopes: [] },
  { id: "verify", label: "Verify", icon: "CheckSquare", scopes: [] },
];

/** Check if a panel is a monitor panel (scope-independent) */
export function isMonitorPanel(id: PanelId): boolean {
  return MONITOR_PANELS.some((p) => p.id === id);
}
