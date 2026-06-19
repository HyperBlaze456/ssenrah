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
  | "activity" | "general" | "run_trace" | "alerts"
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
  | "PreToolUse" | "PostToolUse" | "PostToolUseFailure" | "PostToolBatch"
  | "PermissionRequest" | "PermissionDenied"
  | "UserPromptSubmit" | "UserPromptExpansion"
  | "Notification"
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
  effortLevel?: "low" | "medium" | "high" | "xhigh";
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

export type ToolCategory =
  | "inspection"
  | "filesystem"
  | "command"
  | "network"
  | "mcp"
  | "coordination"
  | "approval"
  | "other";

export type EffectLevel =
  | "inspection_only"
  | "reasoning_or_coordination"
  | "significant_side_effect"
  | "safety_or_policy"
  | "failure_or_anomaly";

export type BranchKind = "main" | "subagent" | "teammate" | "team" | "system";
export type RunOutcome = "active" | "completed" | "failed" | "cancelled";

export interface AgentEvent {
  id: string;
  schema_version?: number;
  timestamp: string;
  session_id: string;
  transcript_path?: string;
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
  root_run_id?: string;
  parent_run_id?: string;
  spawn_parent_agent_id?: string;
  spawn_parent_event_id?: string;
  branch_kind?: BranchKind;
  task_id?: string;
  task_subject?: string;
  task_name?: string;
  task_description?: string;
  prompt_segment_id?: string;
  duration_ms?: number;
  outcome?: RunOutcome;
  failure_class?: string;
  tool_category?: ToolCategory;
  effect_level?: EffectLevel;
  collapsed_by_default?: boolean;
  teammate_name?: string;
  team_name?: string;
  notification_type?: string;
  notification_message?: string;
  title?: string;
  message?: string;
  prompt?: string;
  expansion_type?: "slash_command" | "mcp_prompt" | string;
  command_name?: string;
  command_args?: string;
  command_source?: string;
  source?: string;
  reason?: string;
  stop_reason?: string;
  exit_reason?: string;
  trigger?: string;
  compact_summary?: string;
  old_cwd?: string;
  new_cwd?: string;
  event?: string;
  worktree_path?: string;
  isolation_mode?: string;
  subagent_id?: string;
  agent_transcript_path?: string;
  mcp_server?: string;
  mcp_server_name?: string;
  elicitation_form?: Record<string, unknown>;
  user_response?: Record<string, unknown>;
  requested_schema?: Record<string, unknown>;
  mode?: string;
  url?: string;
  action?: string;
  content?: unknown;
  elicitation_id?: string;
  permission_suggestions?: Array<Record<string, unknown>>;
  stop_hook_active?: boolean;
  last_assistant_message?: string;
  error_details?: unknown;
  error_type?: string;
  error_message?: string;
  is_interrupt?: boolean;
  tool_calls?: Array<Record<string, unknown>>;
  config_source?: string;
  changed_keys?: string[];
  file_path?: string;
  change_type?: "created" | "modified" | "deleted" | string;
  memory_type?: string;
  load_reason?: string;
  globs?: string[];
  trigger_file_path?: string;
  parent_file_path?: string;
  cost_usd?: number;
  extras?: Record<string, unknown>;
  _raw?: Record<string, unknown>;
}

/** Which agent harness produced an event. */
export type Provider = "claude" | "codex";

/** Detect the provider (harness) for a captured event. */
export function detectProvider(event: AgentEvent): Provider {
  const extrasProvider =
    typeof event.extras?.provider === "string" ? (event.extras.provider as string) : null;
  if (extrasProvider === "codex") return "codex";
  const rawProvider =
    event._raw && typeof event._raw === "object" && "provider" in event._raw
      ? (event._raw as Record<string, unknown>).provider
      : null;
  if (rawProvider === "codex") return "codex";
  if (typeof event.id === "string" && event.id.startsWith("codex:")) return "codex";
  return "claude";
}

/** Pretty label for a Provider value. */
export function formatProviderLabel(provider: Provider): string {
  return provider === "codex" ? "Codex" : "Claude Code";
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

// Plugin registry types (mirror of ~/.claude/plugins/installed_plugins.json)
export interface InstalledPluginEntry {
  scope: string;
  installPath: string;
  version?: string;
  installedAt?: string;
  lastUpdated?: string;
  gitCommitSha?: string;
  [key: string]: unknown;
}

export interface InstalledPluginsFile {
  version?: number;
  plugins?: Record<string, InstalledPluginEntry[]>;
  [key: string]: unknown;
}

// Marketplace registry types (mirror of ~/.claude/plugins/known_marketplaces.json)
export interface KnownMarketplaceEntry {
  source?: {
    source?: string;
    repo?: string;
    [key: string]: unknown;
  };
  installLocation?: string;
  lastUpdated?: string;
  [key: string]: unknown;
}

export type KnownMarketplaces = Record<string, KnownMarketplaceEntry>;

// Panel metadata
export interface PanelMeta {
  id: PanelId;
  label: string;
  icon: string;
  scopes: ConfigScope[];
  /**
   * Which harness this panel applies to. Defaults to ["claude"].
   * Codex doesn't expose configuration through ssenrah, so its track shows
   * monitor panels only.
   */
  providers?: Provider[];
}

export const PANELS: PanelMeta[] = [
  { id: "permissions", label: "Permissions", icon: "Shield", scopes: ["user", "project", "local", "managed"], providers: ["claude"] },
  { id: "hooks", label: "Hooks", icon: "Webhook", scopes: ["user", "project", "local", "managed"], providers: ["claude"] },
  { id: "mcp", label: "MCP Servers", icon: "Server", scopes: ["user", "project", "managed"], providers: ["claude"] },
  { id: "memory", label: "Memory", icon: "Brain", scopes: ["user", "project", "local"], providers: ["claude"] },
  { id: "agents", label: "Agents", icon: "Bot", scopes: ["user", "project"], providers: ["claude"] },
  { id: "skills", label: "Skills", icon: "Sparkles", scopes: ["user", "project"], providers: ["claude"] },
  { id: "plugins", label: "Plugins", icon: "Puzzle", scopes: ["user"], providers: ["claude"] },
  { id: "sandbox", label: "Sandbox", icon: "Box", scopes: ["user", "project", "local", "managed"], providers: ["claude"] },
  { id: "env", label: "Environment", icon: "Variable", scopes: ["user", "project", "local", "managed"], providers: ["claude"] },
  { id: "display", label: "Model & Display", icon: "Palette", scopes: ["user", "project", "local", "managed"], providers: ["claude"] },
  { id: "advanced", label: "Advanced", icon: "Settings", scopes: ["user", "project", "local"], providers: ["claude"] },
  { id: "effective", label: "Effective Config", icon: "Layers", scopes: [], providers: ["claude"] },
];

/** Monitor panels — scope-independent (reads from ~/.ssenrah/) */
export const MONITOR_PANELS: PanelMeta[] = [
  { id: "activity", label: "Activity", icon: "Activity", scopes: [], providers: ["claude", "codex"] },
  { id: "general", label: "General", icon: "DollarSign", scopes: [], providers: ["claude", "codex"] },
  { id: "run_trace", label: "Run Trace", icon: "GitBranch", scopes: [], providers: ["claude", "codex"] },
  { id: "alerts", label: "Alerts", icon: "AlertTriangle", scopes: [], providers: ["claude", "codex"] },
  { id: "reasoning", label: "Reasoning", icon: "Brain", scopes: [], providers: ["claude", "codex"] },
  { id: "anomalies", label: "Anomalies", icon: "Radar", scopes: [], providers: ["claude", "codex"] },
  { id: "verify", label: "Verify", icon: "CheckSquare", scopes: [], providers: ["claude", "codex"] },
];

/** Check if a panel is a monitor panel (scope-independent) */
export function isMonitorPanel(id: PanelId): boolean {
  return MONITOR_PANELS.some((p) => p.id === id);
}

/** Whether the panel renders for the active provider. */
export function panelSupportsProvider(meta: PanelMeta, provider: Provider): boolean {
  if (!meta.providers) return provider === "claude";
  return meta.providers.includes(provider);
}
