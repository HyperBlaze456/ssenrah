/**
 * All 22 Claude Code hook event types (March 2026).
 * Reference: https://code.claude.com/docs/en/hooks
 */
export type HookEventType =
  | "SessionStart"
  | "InstructionsLoaded"
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PermissionRequest"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "Notification"
  | "SubagentStart"
  | "SubagentStop"
  | "Stop"
  | "StopFailure"
  | "TeammateIdle"
  | "TaskCompleted"
  | "ConfigChange"
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

/**
 * Structured event written to the JSONL log.
 * Accepts ALL fields that hooks provide — we never refuse data.
 */
export interface AgentEvent {
  /** UUID generated at capture time */
  id: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** From hook payload */
  session_id: string;
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

  // Task fields (from TaskCompleted)
  task_id?: string;
  task_subject?: string;
  task_description?: string;

  // Teammate fields
  teammate_name?: string;
  team_name?: string;

  // Notification fields
  notification_type?: string;
  message?: string;

  // Session lifecycle
  source?: string;
  reason?: string;

  // Compact events
  trigger?: string;
  compact_summary?: string;

  // MCP/Elicitation
  mcp_server_name?: string;

  // Stop events
  stop_hook_active?: boolean;
  last_assistant_message?: string;

  // Config changes
  config_source?: string;
  file_path?: string;

  // Cost (from Claude Code's built-in cost tracking, added by our adapter)
  cost_usd?: number;

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
