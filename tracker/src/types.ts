/**
 * Current Claude Code hook event types (April 2026).
 * Reference: https://code.claude.com/docs/en/hooks
 */
export type HookEventType =
  | "SessionStart"
  | "InstructionsLoaded"
  | "UserPromptSubmit"
  | "UserPromptExpansion"
  | "PreToolUse"
  | "PermissionRequest"
  | "PermissionDenied"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "PostToolBatch"
  | "Notification"
  | "SubagentStart"
  | "SubagentStop"
  | "TaskCreated"
  | "Stop"
  | "StopFailure"
  | "TeammateIdle"
  | "TaskCompleted"
  | "ConfigChange"
  | "CwdChanged"
  | "FileChanged"
  | "WorktreeCreate"
  | "WorktreeRemove"
  | "PreCompact"
  | "PostCompact"
  | "SessionEnd"
  | "Elicitation"
  | "ElicitationResult";

/**
 * Base fields present on every hook event payload from Claude Code.
 */
export interface HookBasePayload {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: string;
  permission_mode?: string;
  agent_id?: string;
  agent_type?: string;
}

export type ToolCategory =
  | "inspection"
  | "filesystem"
  | "command"
  | "network"
  | "mcp"
  | "coordination"
  | "approval"
  | "policy"
  | "mutation"
  | "system"
  | "unknown"
  | "other";

export type EffectLevel =
  | "inspection_only"
  | "reasoning_or_coordination"
  | "significant_side_effect"
  | "safety_or_policy"
  | "failure_or_anomaly"
  | "failure"
  | "policy"
  | "read"
  | "write"
  | "execute"
  | "none";

export type BranchKind = "main" | "subagent" | "teammate" | "team" | "system";
export type RunOutcome = "active" | "completed" | "failed" | "cancelled" | "unknown";
export type EventOutcome = RunOutcome;

/**
 * Structured event written to the JSONL log.
 * Accepts ALL fields that hooks provide — we never refuse data.
 */
export interface AgentEvent {
  /** UUID generated at capture time */
  id: string;
  /** Incremented when the normalized event contract changes */
  schema_version: number;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** From hook payload */
  session_id: string;
  transcript_path?: string;
  /** Hook event classification */
  hook_event_type: HookEventType | string;
  /** Current working directory */
  cwd: string;
  /** Permission mode at time of event */
  permission_mode?: string;

  // Tool-specific fields
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_use_id?: string;
  tool_response?: unknown;
  error?: string;

  // Agent/subagent fields
  agent_id?: string;
  agent_type?: string;
  model?: string;
  root_run_id?: string;
  parent_run_id?: string;
  spawn_parent_agent_id?: string;
  spawn_parent_event_id?: string;
  branch_kind?: BranchKind;

  // Task / prompt fields
  task_id?: string;
  task_subject?: string;
  task_name?: string;
  task_description?: string;
  prompt_segment_id?: string;

  // Derived execution metadata
  duration_ms?: number;
  outcome?: RunOutcome;
  failure_class?: string;
  tool_category?: ToolCategory;
  effect_level?: EffectLevel;
  collapsed_by_default?: boolean;

  // Approval / policy lineage when available
  approval_state?: string;
  approval_request_id?: string;
  policy_name?: string;

  // Teammate fields
  teammate_name?: string;
  team_name?: string;

  // Notification fields
  notification_type?: string;
  notification_message?: string;
  title?: string;
  message?: string;
  prompt?: string;

  // UserPromptExpansion (slash command / mcp prompt expansion)
  expansion_type?: "slash_command" | "mcp_prompt" | string;
  command_name?: string;
  command_args?: string;
  command_source?: string;

  // Session lifecycle
  source?: string;
  reason?: string;
  stop_reason?: string;
  exit_reason?: string;
  old_cwd?: string;
  new_cwd?: string;
  event?: string;
  worktree_path?: string;
  agent_transcript_path?: string;

  // Compact events
  trigger?: string;
  compact_summary?: string;

  // MCP / Elicitation (`mcp_server` is the new key, `mcp_server_name` is preserved for back-compat)
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

  // Permissions
  permission_suggestions?: Array<Record<string, unknown>>;

  // Stop / failure events
  stop_hook_active?: boolean;
  last_assistant_message?: string;
  error_details?: unknown;
  error_type?: string;
  error_message?: string;
  is_interrupt?: boolean;

  // PostToolBatch
  tool_calls?: Array<Record<string, unknown>>;

  // Config changes
  config_source?: string;
  changed_keys?: string[];
  file_path?: string;
  change_type?: "created" | "modified" | "deleted" | string;
  memory_type?: string;
  load_reason?: string;
  globs?: string[];
  trigger_file_path?: string;
  parent_file_path?: string;

  // Worktree
  isolation_mode?: string;
  subagent_id?: string;

  // Cost (from Claude Code's built-in cost tracking, added by our adapter)
  cost_usd?: number;

  /** Forward-compatible bag for non-normalized hook keys */
  extras?: Record<string, unknown>;

  /** Raw payload preserved for forward compatibility */
  _raw?: Record<string, unknown>;
}

/**
 * Escalation rule — simple threshold-based alerting.
 * v1: hardcoded in config. v2: YAML DSL.
 */
export interface EscalationRule {
  name: string;
  condition: "session_cost_exceeds" | "session_duration_exceeds" | "error_count_exceeds";
  threshold: number;
  action: "console" | "log";
}

/**
 * Escalation config file shape.
 */
export interface EscalationConfig {
  rules: EscalationRule[];
}

/**
 * Patterns for redacting sensitive data from tool_input.
 */
export interface RedactionPattern {
  /** Human-readable name */
  name: string;
  /** Regex to match against field values */
  pattern: RegExp;
  /** Replacement string */
  replacement: string;
}
