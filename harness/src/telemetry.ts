import type {
  AgentEvent,
  BranchKind,
  EffectLevel,
  RunOutcome,
  ToolCategory,
} from "./types.js";

export type TelemetrySeverity = "info" | "warning" | "error";
export type TelemetryPhase = "start" | "success" | "failure" | "end" | "update" | "event";
export type TelemetryActorKind = "main" | "subagent" | "teammate" | "system";
export type RunCategory =
  | "inspection_only"
  | "reasoning_or_coordination"
  | "significant_side_effect"
  | "safety_or_policy"
  | "failure_or_anomaly";
export type RunNodeKind = "event" | "prompt" | "task" | "branch" | "inspection_block";

export interface TelemetryRecord {
  event_id: string;
  schema_version: number;
  timestamp: string;
  session_id: string;
  hook_event_type: string;
  operation: string;
  phase: TelemetryPhase;
  severity: TelemetrySeverity;
  actor_id: string;
  actor_label: string;
  actor_kind: TelemetryActorKind;
  task_id?: string;
  tool_name?: string;
  model?: string;
  resource?: string;
  summary: string;
  detail?: string;
  transcript_path?: string;
  agent_transcript_path?: string;
}

export interface AgentSummary {
  session_id: string;
  actor_id: string;
  actor_label: string;
  actor_kind: TelemetryActorKind;
  event_count: number;
  tool_calls: number;
  failures: number;
  tasks_created: number;
  tasks_completed: number;
  first_timestamp: string;
  last_timestamp: string;
  models_used: string[];
  transcript_paths: string[];
}

export interface TaskSummary {
  session_id: string;
  task_id: string;
  subject: string;
  description?: string;
  owner: string;
  team_name?: string;
  created_at?: string;
  completed_at?: string;
  duration_seconds?: number;
  status: "created" | "completed";
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

export interface SessionCostSummary {
  session_id: string;
  cost_usd: number;
  source_event_id?: string;
  source_timestamp?: string;
}

export interface PromptSlice {
  id: string;
  session_id: string;
  label: string;
  prompt: string;
  prompt_event_id: string;
  start_timestamp: string;
  end_timestamp?: string;
  event_count: number;
  event_ids: string[];
}

export interface RunTraceNode {
  id: string;
  lane_id: string;
  kind: RunNodeKind;
  actor_id: string;
  actor_label: string;
  actor_kind: TelemetryActorKind;
  branch_kind: BranchKind;
  timestamp: string;
  end_timestamp?: string;
  duration_ms?: number;
  label: string;
  summary: string;
  detail?: string;
  category: RunCategory;
  tool_category: ToolCategory;
  effect_level: EffectLevel;
  outcome?: RunOutcome;
  significant: boolean;
  collapsed_by_default: boolean;
  event_ids: string[];
  task_id?: string;
  prompt_slice_id?: string;
  child_lane_id?: string;
  inspection_count?: number;
}

export interface RunTraceLane {
  id: string;
  actor_id: string;
  actor_label: string;
  actor_kind: TelemetryActorKind;
  branch_kind: BranchKind;
  parent_lane_id?: string;
  parent_node_id?: string;
  expanded: boolean;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  event_count: number;
  node_count: number;
  nodes: RunTraceNode[];
}

export interface RunTrace {
  session_id: string;
  root_run_id: string;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  cost_usd: number;
  event_count: number;
  error_count: number;
  branch_count: number;
  expanded_branch_count: number;
  collapsed_branch_count: number;
  prompt_slices: PromptSlice[];
  prompt_slice_id?: string;
  lanes: RunTraceLane[];
  nodes: RunTraceNode[];
}

export interface NodeInspectorData {
  node: RunTraceNode;
  lane: RunTraceLane;
  prompt_slice?: PromptSlice;
  raw_events: AgentEvent[];
  significant_events: AgentEvent[];
  inspection_events: AgentEvent[];
}

interface EventClassification {
  category: RunCategory;
  tool_category: ToolCategory;
  effect_level: EffectLevel;
  branch_kind: BranchKind;
  outcome?: RunOutcome;
  significant: boolean;
  collapsed_by_default: boolean;
}

interface ActorIdentity {
  actor_id: string;
  actor_label: string;
  actor_kind: TelemetryActorKind;
}

interface ActorContext extends ActorIdentity {
  lane_id: string;
  branch_kind: BranchKind;
  events: AgentEvent[];
  classifications: EventClassification[];
  started_at: string;
  ended_at: string;
  duration_ms: number;
  expanded: boolean;
}

const INSPECTION_TOOL_NAMES = new Set([
  "read",
  "grep",
  "glob",
  "ls",
  "list",
  "find",
  "search",
  "tree",
  "view",
]);
const FILESYSTEM_TOOL_NAMES = new Set(["edit", "write", "multiedit", "apply_patch"]);
const COMMAND_TOOL_NAMES = new Set(["bash", "shell", "command", "terminal"]);
const NETWORK_TOOL_NAMES = new Set(["webfetch", "fetch", "http", "curl"]);
const MCP_TOOL_NAMES = new Set(["mcp"]);
const COLLAPSED_BRANCH_MAX_EVENTS = 8;
const COLLAPSED_BRANCH_MAX_DURATION_MS = 2 * 60 * 1000;
const INSPECTION_BLOCK_MIN_SIZE = 2;

function truncateText(value: string | undefined, max = 120): string | undefined {
  if (!value) return undefined;
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function stringifyUnknown(value: unknown, max = 120): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return truncateText(value, max);
  try {
    return truncateText(JSON.stringify(value), max);
  } catch {
    return undefined;
  }
}

function normalizeToolName(toolName: string | undefined): string {
  return toolName?.trim().toLowerCase() ?? "";
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function getActor(event: AgentEvent): ActorIdentity {
  if (event.agent_id) {
    return {
      actor_id: event.agent_id,
      actor_label: event.agent_type
        ? `${event.agent_type}:${event.agent_id.slice(0, 8)}`
        : `agent:${event.agent_id.slice(0, 8)}`,
      actor_kind: "subagent",
    };
  }

  if (event.teammate_name) {
    return {
      actor_id: `teammate:${event.teammate_name}`,
      actor_label: event.teammate_name,
      actor_kind: "teammate",
    };
  }

  if (event.hook_event_type.startsWith("_")) {
    return {
      actor_id: `system:${event.session_id}`,
      actor_label: "system",
      actor_kind: "system",
    };
  }

  return {
    actor_id: `main:${event.session_id}`,
    actor_label: "main",
    actor_kind: "main",
  };
}

function getBranchKind(event: AgentEvent, actorKind: TelemetryActorKind): BranchKind {
  if (event.branch_kind) return event.branch_kind;
  if (event.team_name) return "team";
  switch (actorKind) {
    case "subagent":
      return "subagent";
    case "teammate":
      return "teammate";
    case "system":
      return "system";
    default:
      return "main";
  }
}

function deriveToolCategory(event: AgentEvent): ToolCategory {
  if (event.tool_category) return event.tool_category;

  const toolName = normalizeToolName(event.tool_name);
  if (!toolName) {
    switch (event.hook_event_type) {
      case "UserPromptSubmit":
      case "TaskCreated":
      case "TaskCompleted":
      case "SubagentStart":
      case "SubagentStop":
      case "SessionStart":
      case "SessionEnd":
      case "Stop":
      case "Notification":
      case "TeammateIdle":
        return "coordination";
      case "PermissionRequest":
      case "Elicitation":
      case "ElicitationResult":
        return "approval";
      default:
        return "other";
    }
  }

  if (INSPECTION_TOOL_NAMES.has(toolName) || toolName.includes("read") || toolName.includes("grep")) {
    return "inspection";
  }
  if (FILESYSTEM_TOOL_NAMES.has(toolName) || toolName.includes("edit") || toolName.includes("write")) {
    return "filesystem";
  }
  if (COMMAND_TOOL_NAMES.has(toolName)) return "command";
  if (NETWORK_TOOL_NAMES.has(toolName) || toolName.includes("web")) return "network";
  if (MCP_TOOL_NAMES.has(toolName) || toolName.includes("mcp")) return "mcp";
  if (toolName.includes("task") || toolName.includes("agent")) return "coordination";
  return "other";
}

function deriveEffectLevel(event: AgentEvent, toolCategory: ToolCategory): EffectLevel {
  if (event.effect_level) return event.effect_level;

  switch (event.hook_event_type) {
    case "PostToolUseFailure":
    case "StopFailure":
    case "_anomaly":
    case "_escalation":
    case "_parse_error":
      return "failure_or_anomaly";
    case "PermissionRequest":
    case "Elicitation":
    case "ElicitationResult":
      return "safety_or_policy";
    case "UserPromptSubmit":
    case "TaskCreated":
    case "TaskCompleted":
    case "SubagentStart":
    case "SubagentStop":
    case "SessionStart":
    case "SessionEnd":
    case "Stop":
    case "Notification":
    case "TeammateIdle":
      return "reasoning_or_coordination";
    case "FileChanged":
    case "WorktreeCreate":
    case "WorktreeRemove":
      return "significant_side_effect";
    default:
      break;
  }

  switch (toolCategory) {
    case "inspection":
      return "inspection_only";
    case "filesystem":
    case "command":
    case "network":
    case "mcp":
      return "significant_side_effect";
    case "approval":
      return "safety_or_policy";
    default:
      return "reasoning_or_coordination";
  }
}

function deriveOutcome(event: AgentEvent): RunOutcome | undefined {
  if (event.outcome) return event.outcome;

  switch (event.hook_event_type) {
    case "PostToolUseFailure":
    case "StopFailure":
    case "_parse_error":
      return "failed";
    case "TaskCompleted":
    case "SessionEnd":
      return "completed";
    case "Stop":
    case "SubagentStop": {
      const reason = event.reason?.toLowerCase() ?? "";
      if (reason.includes("cancel")) return "cancelled";
      if (reason.includes("fail") || reason.includes("error")) return "failed";
      return "completed";
    }
    case "SessionStart":
    case "SubagentStart":
    case "TaskCreated":
      return "active";
    default:
      return undefined;
  }
}

export function classifyEvent(event: AgentEvent): EventClassification {
  const actor = getActor(event);
  const toolCategory = deriveToolCategory(event);
  const effectLevel = deriveEffectLevel(event, toolCategory);
  const branchKind = getBranchKind(event, actor.actor_kind);
  const outcome = deriveOutcome(event);
  const category = effectLevel as RunCategory;
  const significant =
    category === "significant_side_effect" ||
    category === "safety_or_policy" ||
    category === "failure_or_anomaly";
  const collapsedByDefault =
    event.collapsed_by_default ??
    (category === "inspection_only" ||
      (actor.actor_kind === "subagent" && category === "reasoning_or_coordination"));

  return {
    category,
    tool_category: toolCategory,
    effect_level: effectLevel,
    branch_kind: branchKind,
    outcome,
    significant,
    collapsed_by_default: collapsedByDefault,
  };
}

function summarizeToolInput(event: AgentEvent): string | undefined {
  const toolInput = event.tool_input;
  if (!toolInput) return undefined;

  const knownPath =
    (toolInput.file_path as string | undefined) ??
    (toolInput.path as string | undefined) ??
    (toolInput.target_file as string | undefined);
  if (knownPath) return truncateText(knownPath, 120);

  const command = toolInput.command as string | undefined;
  if (command) return truncateText(command, 120);

  const query = (toolInput.query as string | undefined) ?? (toolInput.pattern as string | undefined);
  if (query) return truncateText(query, 120);

  const keys = Object.keys(toolInput);
  return keys.length > 0 ? `keys=${keys.join(",")}` : undefined;
}

function getResource(event: AgentEvent): string | undefined {
  return (
    event.file_path ??
    event.worktree_path ??
    event.tool_name ??
    event.mcp_server_name ??
    event.url ??
    event.new_cwd ??
    event.trigger_file_path ??
    event.parent_file_path
  );
}

function getOperationParts(event: AgentEvent): {
  operation: string;
  phase: TelemetryPhase;
  severity: TelemetrySeverity;
  summary: string;
  detail?: string;
} {
  switch (event.hook_event_type) {
    case "SessionStart":
      return {
        operation: "session.start",
        phase: "start",
        severity: "info",
        summary: "Session started",
        detail: truncateText([event.source, event.model].filter(Boolean).join(" · ")),
      };
    case "SessionEnd":
      return {
        operation: "session.end",
        phase: "end",
        severity: "info",
        summary: "Session ended",
        detail: truncateText([event.reason, event.source].filter(Boolean).join(" · ")),
      };
    case "UserPromptSubmit":
      return {
        operation: "prompt.submit",
        phase: "event",
        severity: "info",
        summary: "User prompt submitted",
        detail: truncateText(event.prompt ?? event.message),
      };
    case "InstructionsLoaded":
      return {
        operation: "instructions.load",
        phase: "event",
        severity: "info",
        summary: "Instructions loaded",
        detail: truncateText(
          [
            event.memory_type,
            event.load_reason,
            event.trigger_file_path,
            event.parent_file_path,
            event.globs?.join(", "),
          ]
            .filter(Boolean)
            .join(" · "),
        ),
      };
    case "PreToolUse":
      return {
        operation: "tool.start",
        phase: "start",
        severity: "info",
        summary: `${event.tool_name ?? "Tool"} started`,
        detail: summarizeToolInput(event),
      };
    case "PostToolUse":
      return {
        operation: "tool.success",
        phase: "success",
        severity: "info",
        summary: `${event.tool_name ?? "Tool"} completed`,
        detail: summarizeToolInput(event),
      };
    case "PostToolUseFailure":
      return {
        operation: "tool.failure",
        phase: "failure",
        severity: "error",
        summary: `${event.tool_name ?? "Tool"} failed`,
        detail: truncateText(event.error ?? summarizeToolInput(event)),
      };
    case "PermissionRequest":
      return {
        operation: "permission.request",
        phase: "event",
        severity: "warning",
        summary: "Permission requested",
        detail: summarizeToolInput(event),
      };
    case "Notification":
      return {
        operation: "notification",
        phase: "event",
        severity: "info",
        summary: event.title ?? event.notification_type ?? "Notification",
        detail: truncateText(event.message),
      };
    case "SubagentStart":
      return {
        operation: "agent.start",
        phase: "start",
        severity: "info",
        summary: `${event.agent_type ?? "Subagent"} started`,
        detail: truncateText(event.agent_transcript_path),
      };
    case "SubagentStop":
      return {
        operation: "agent.stop",
        phase: "end",
        severity: deriveOutcome(event) === "failed" ? "error" : "info",
        summary: `${event.agent_type ?? "Subagent"} stopped`,
        detail: truncateText([event.reason, event.agent_transcript_path].filter(Boolean).join(" · ")),
      };
    case "TaskCreated":
      return {
        operation: "task.create",
        phase: "start",
        severity: "info",
        summary: event.task_subject ? `Task created: ${truncateText(event.task_subject, 80)}` : "Task created",
        detail: truncateText(event.task_description),
      };
    case "TaskCompleted":
      return {
        operation: "task.complete",
        phase: "end",
        severity: "info",
        summary: event.task_subject ? `Task completed: ${truncateText(event.task_subject, 80)}` : "Task completed",
        detail: truncateText(event.task_description),
      };
    case "TeammateIdle":
      return {
        operation: "teammate.idle",
        phase: "event",
        severity: "warning",
        summary: `${event.teammate_name ?? "Teammate"} idle`,
        detail: truncateText(event.message),
      };
    case "ConfigChange":
      return {
        operation: "config.change",
        phase: "update",
        severity: "info",
        summary: "Configuration changed",
        detail: truncateText([event.config_source, event.file_path].filter(Boolean).join(" · ")),
      };
    case "CwdChanged":
      return {
        operation: "cwd.change",
        phase: "update",
        severity: "info",
        summary: "Working directory changed",
        detail: truncateText([event.old_cwd, event.new_cwd ?? event.cwd].filter(Boolean).join(" -> ")),
      };
    case "FileChanged":
      return {
        operation: "file.change",
        phase: "update",
        severity: "info",
        summary: event.event ? `File ${event.event}` : "File changed",
        detail: truncateText(event.file_path),
      };
    case "WorktreeCreate":
      return {
        operation: "worktree.create",
        phase: "start",
        severity: "info",
        summary: "Worktree created",
        detail: truncateText(event.worktree_path),
      };
    case "WorktreeRemove":
      return {
        operation: "worktree.remove",
        phase: "end",
        severity: "info",
        summary: "Worktree removed",
        detail: truncateText(event.worktree_path),
      };
    case "PreCompact":
      return {
        operation: "compact.start",
        phase: "start",
        severity: "warning",
        summary: "Compaction starting",
        detail: truncateText([event.trigger, event.compact_summary].filter(Boolean).join(" · ")),
      };
    case "PostCompact":
      return {
        operation: "compact.end",
        phase: "end",
        severity: "info",
        summary: "Compaction finished",
        detail: truncateText([event.trigger, event.compact_summary].filter(Boolean).join(" · ")),
      };
    case "Stop":
      return {
        operation: "session.stop",
        phase: "end",
        severity: event.reason ? "warning" : "info",
        summary: "Session stopped",
        detail: truncateText([event.reason, event.last_assistant_message].filter(Boolean).join(" · ")),
      };
    case "StopFailure":
      return {
        operation: "session.stop_failure",
        phase: "failure",
        severity: "error",
        summary: "Session stop failed",
        detail: truncateText(event.error ?? stringifyUnknown(event.error_details) ?? event.reason),
      };
    case "Elicitation":
      return {
        operation: "elicitation.request",
        phase: "start",
        severity: "info",
        summary: "Elicitation requested",
        detail: truncateText([event.mode, event.url, event.message].filter(Boolean).join(" · ")),
      };
    case "ElicitationResult":
      return {
        operation: "elicitation.result",
        phase: "end",
        severity: event.action === "cancel" ? "warning" : "info",
        summary: event.action ? `Elicitation ${event.action}` : "Elicitation completed",
        detail: stringifyUnknown(event.content),
      };
    case "_escalation":
      return {
        operation: "alert.escalation",
        phase: "event",
        severity: "warning",
        summary: "Escalation alert",
        detail: truncateText(event.message),
      };
    case "_anomaly":
      return {
        operation: "alert.anomaly",
        phase: "event",
        severity: "warning",
        summary: event.notification_type ? `Anomaly: ${event.notification_type}` : "Anomaly detected",
        detail: truncateText(event.message),
      };
    case "_parse_error":
      return {
        operation: "ingest.parse_error",
        phase: "failure",
        severity: "error",
        summary: "Hook payload parse error",
        detail: truncateText(event.error),
      };
    default:
      return {
        operation: `event.${event.hook_event_type.toLowerCase()}`,
        phase: "event",
        severity: event.error ? "error" : "info",
        summary: event.hook_event_type,
        detail: truncateText(event.message ?? event.reason ?? event.prompt),
      };
  }
}

export function deriveTelemetryRecord(event: AgentEvent): TelemetryRecord {
  const actor = getActor(event);
  const details = getOperationParts(event);
  return {
    event_id: event.id,
    schema_version: event.schema_version ?? 1,
    timestamp: event.timestamp,
    session_id: event.session_id,
    hook_event_type: event.hook_event_type,
    operation: details.operation,
    phase: details.phase,
    severity: details.severity,
    actor_id: actor.actor_id,
    actor_label: actor.actor_label,
    actor_kind: actor.actor_kind,
    task_id: event.task_id,
    tool_name: event.tool_name,
    model: event.model,
    resource: getResource(event),
    summary: details.summary,
    detail: details.detail,
    transcript_path: event.transcript_path,
    agent_transcript_path: event.agent_transcript_path,
  };
}

export function deriveTelemetryTimeline(
  events: AgentEvent[],
  options: { session?: string; actor?: string; limit?: number } = {},
): TelemetryRecord[] {
  const sessionFiltered = options.session
    ? events.filter((event) => event.session_id.startsWith(options.session!))
    : events;
  const records = sessionFiltered.map(deriveTelemetryRecord);
  const actorQuery = options.actor?.toLowerCase();
  const actorFiltered = actorQuery
    ? records.filter(
        (record) =>
          record.actor_id.toLowerCase().includes(actorQuery) ||
          record.actor_label.toLowerCase().includes(actorQuery),
      )
    : records;

  const sorted = [...actorFiltered].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  return options.limit ? sorted.slice(-options.limit) : sorted;
}

export function summarizeAgents(
  events: AgentEvent[],
  options: { session?: string } = {},
): AgentSummary[] {
  const records = deriveTelemetryTimeline(events, { session: options.session });
  const grouped = new Map<string, AgentSummary>();

  for (const record of records) {
    const key = `${record.session_id}::${record.actor_id}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        session_id: record.session_id,
        actor_id: record.actor_id,
        actor_label: record.actor_label,
        actor_kind: record.actor_kind,
        event_count: 1,
        tool_calls: record.operation.startsWith("tool.") ? 1 : 0,
        failures: record.severity === "error" ? 1 : 0,
        tasks_created: record.operation === "task.create" ? 1 : 0,
        tasks_completed: record.operation === "task.complete" ? 1 : 0,
        first_timestamp: record.timestamp,
        last_timestamp: record.timestamp,
        models_used: record.model ? [record.model] : [],
        transcript_paths: [record.transcript_path, record.agent_transcript_path].filter(Boolean) as string[],
      });
      continue;
    }

    existing.event_count += 1;
    if (record.operation.startsWith("tool.")) existing.tool_calls += 1;
    if (record.severity === "error") existing.failures += 1;
    if (record.operation === "task.create") existing.tasks_created += 1;
    if (record.operation === "task.complete") existing.tasks_completed += 1;
    if (record.timestamp < existing.first_timestamp) existing.first_timestamp = record.timestamp;
    if (record.timestamp > existing.last_timestamp) existing.last_timestamp = record.timestamp;
    if (record.model && !existing.models_used.includes(record.model)) existing.models_used.push(record.model);
    for (const transcriptPath of [record.transcript_path, record.agent_transcript_path]) {
      if (transcriptPath && !existing.transcript_paths.includes(transcriptPath)) {
        existing.transcript_paths.push(transcriptPath);
      }
    }
  }

  return [...grouped.values()].sort((left, right) => right.last_timestamp.localeCompare(left.last_timestamp));
}

export function summarizeTasks(
  events: AgentEvent[],
  options: { session?: string } = {},
): TaskSummary[] {
  const filtered = options.session
    ? events.filter((event) => event.session_id.startsWith(options.session!))
    : events;
  const tasks = new Map<string, TaskSummary>();

  for (const event of filtered) {
    if (!event.task_id && !event.task_subject) continue;
    const taskKey = event.task_id ?? `${event.session_id}:${event.task_subject}`;
    const owner = event.teammate_name ?? getActor(event).actor_label;
    const existing = tasks.get(taskKey);
    if (!existing) {
      tasks.set(taskKey, {
        session_id: event.session_id,
        task_id: taskKey,
        subject: event.task_subject ?? taskKey,
        description: event.task_description,
        owner,
        team_name: event.team_name,
        created_at: event.hook_event_type === "TaskCreated" ? event.timestamp : undefined,
        completed_at: event.hook_event_type === "TaskCompleted" ? event.timestamp : undefined,
        status: event.hook_event_type === "TaskCompleted" ? "completed" : "created",
      });
      continue;
    }

    existing.subject = event.task_subject ?? existing.subject;
    existing.description = event.task_description ?? existing.description;
    existing.owner = event.teammate_name ?? existing.owner;
    existing.team_name = event.team_name ?? existing.team_name;
    if (event.hook_event_type === "TaskCreated") existing.created_at = existing.created_at ?? event.timestamp;
    if (event.hook_event_type === "TaskCompleted") {
      existing.completed_at = event.timestamp;
      existing.status = "completed";
    }
  }

  for (const task of tasks.values()) {
    if (task.created_at && task.completed_at) {
      task.duration_seconds = Math.max(
        0,
        Math.round((new Date(task.completed_at).getTime() - new Date(task.created_at).getTime()) / 1000),
      );
    }
  }

  return [...tasks.values()].sort((left, right) => {
    const leftTs = left.completed_at ?? left.created_at ?? "";
    const rightTs = right.completed_at ?? right.created_at ?? "";
    return rightTs.localeCompare(leftTs);
  });
}

export function getAuthoritativeSessionCostSummary(
  events: AgentEvent[],
  sessionId: string,
): SessionCostSummary {
  const snapshots = events
    .filter((event) => event.session_id === sessionId && typeof event.cost_usd === "number")
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));

  if (snapshots.length === 0) {
    return { session_id: sessionId, cost_usd: 0 };
  }

  const latest = snapshots[snapshots.length - 1]!;
  return {
    session_id: sessionId,
    cost_usd: latest.cost_usd ?? 0,
    source_event_id: latest.id,
    source_timestamp: latest.timestamp,
  };
}

export function getAuthoritativeSessionCost(events: AgentEvent[], sessionId: string): number {
  return getAuthoritativeSessionCostSummary(events, sessionId).cost_usd;
}

export function getAuthoritativeTotalCost(events: AgentEvent[]): number {
  return unique(events.map((event) => event.session_id)).reduce(
    (sum, sessionId) => sum + getAuthoritativeSessionCost(events, sessionId),
    0,
  );
}

export function summarizeSessions(events: AgentEvent[]): SessionSummary[] {
  const grouped = new Map<string, { events: AgentEvent[]; tools: Map<string, number> }>();

  for (const event of events) {
    let bucket = grouped.get(event.session_id);
    if (!bucket) {
      bucket = { events: [], tools: new Map() };
      grouped.set(event.session_id, bucket);
    }
    bucket.events.push(event);
    if (event.hook_event_type === "PostToolUse" && event.tool_name) {
      bucket.tools.set(event.tool_name, (bucket.tools.get(event.tool_name) ?? 0) + 1);
    }
  }

  const sessions: SessionSummary[] = [];
  for (const [sessionId, bucket] of grouped) {
    const first = bucket.events[0]!;
    const last = bucket.events[bucket.events.length - 1]!;
    sessions.push({
      session_id: sessionId,
      event_count: bucket.events.length,
      first_event: first.timestamp,
      last_event: last.timestamp,
      duration_seconds: Math.max(
        0,
        Math.round((new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime()) / 1000),
      ),
      tool_uses: bucket.events.filter((event) => event.hook_event_type === "PostToolUse").length,
      errors: bucket.events.filter(
        (event) => event.hook_event_type === "PostToolUseFailure" || event.hook_event_type === "StopFailure",
      ).length,
      subagents: bucket.events.filter((event) => event.hook_event_type === "SubagentStart").length,
      cost_usd: getAuthoritativeSessionCost(events, sessionId),
      top_tools: [...bucket.tools.entries()].sort((left, right) => right[1] - left[1]).slice(0, 5),
    });
  }

  return sessions.sort((left, right) => new Date(right.first_event).getTime() - new Date(left.first_event).getTime());
}

export function computeSummary(events: AgentEvent[]): EventSummary {
  if (events.length === 0) {
    return {
      total_events: 0,
      session_count: 0,
      tool_uses: 0,
      errors: 0,
      subagents: 0,
      tasks_completed: 0,
      total_cost: 0,
      first_event: null,
      last_event: null,
      top_tools: [],
    };
  }

  const sessions = summarizeSessions(events);
  const toolUses = events.filter((event) => event.hook_event_type === "PostToolUse");
  const errors = events.filter(
    (event) => event.hook_event_type === "PostToolUseFailure" || event.hook_event_type === "StopFailure",
  );
  const subagents = events.filter((event) => event.hook_event_type === "SubagentStart");
  const tasks = events.filter((event) => event.hook_event_type === "TaskCompleted");
  const toolCounts = new Map<string, number>();
  for (const event of toolUses) {
    const name = event.tool_name ?? "unknown";
    toolCounts.set(name, (toolCounts.get(name) ?? 0) + 1);
  }

  return {
    total_events: events.length,
    session_count: sessions.length,
    tool_uses: toolUses.length,
    errors: errors.length,
    subagents: subagents.length,
    tasks_completed: tasks.length,
    total_cost: getAuthoritativeTotalCost(events),
    first_event: events[0]?.timestamp ?? null,
    last_event: events[events.length - 1]?.timestamp ?? null,
    top_tools: [...toolCounts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 10),
  };
}

export function derivePromptSlices(events: AgentEvent[], sessionId: string): PromptSlice[] {
  const sessionEvents = [...events]
    .filter((event) => event.session_id === sessionId)
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const promptEvents = sessionEvents.filter((event) => event.hook_event_type === "UserPromptSubmit");

  return promptEvents.map((event, index) => {
    const nextPrompt = promptEvents[index + 1];
    const eventIds = sessionEvents
      .filter((candidate) => candidate.timestamp >= event.timestamp)
      .filter((candidate) => !nextPrompt || candidate.timestamp < nextPrompt.timestamp)
      .map((candidate) => candidate.id);
    return {
      id: `prompt:${event.id}`,
      session_id: sessionId,
      label: truncateText(event.prompt ?? event.message ?? "Prompt", 48) ?? "Prompt",
      prompt: (event.prompt ?? event.message ?? "Prompt").trim() || "Prompt",
      prompt_event_id: event.id,
      start_timestamp: event.timestamp,
      end_timestamp: nextPrompt?.timestamp,
      event_count: eventIds.length,
      event_ids: eventIds,
    };
  });
}

function getPromptSliceId(promptSlices: PromptSlice[], event: AgentEvent): string | undefined {
  if (event.prompt_segment_id) return event.prompt_segment_id;
  for (const slice of promptSlices) {
    const startsAfterSlice = event.timestamp >= slice.start_timestamp;
    const beforeNext = !slice.end_timestamp || event.timestamp < slice.end_timestamp;
    if (startsAfterSlice && beforeNext) return slice.id;
  }
  return undefined;
}

function shouldExpandActor(actor: ActorContext): boolean {
  if (actor.actor_kind !== "subagent") return true;
  if (actor.events.some((event) => event.team_name || event.teammate_name)) return true;
  if (actor.classifications.some((classification) => classification.significant)) return true;
  if (actor.events.some((event) => event.tool_name && classifyEvent(event).tool_category !== "inspection")) return true;
  if (actor.duration_ms > COLLAPSED_BRANCH_MAX_DURATION_MS) return true;
  if (actor.events.length > COLLAPSED_BRANCH_MAX_EVENTS) return true;
  return false;
}

function buildActorContexts(events: AgentEvent[]): ActorContext[] {
  const grouped = new Map<string, { actor: ActorIdentity; events: AgentEvent[] }>();

  for (const event of events) {
    const actor = getActor(event);
    let bucket = grouped.get(actor.actor_id);
    if (!bucket) {
      bucket = { actor, events: [] };
      grouped.set(actor.actor_id, bucket);
    }
    bucket.events.push(event);
  }

  return [...grouped.values()]
    .map(({ actor, events }) => {
      const sortedEvents = [...events].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
      const classifications = sortedEvents.map(classifyEvent);
      const startedAt = sortedEvents[0]!.timestamp;
      const endedAt = sortedEvents[sortedEvents.length - 1]!.timestamp;
      const durationMs = Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime());
      const branchKind = getBranchKind(sortedEvents[0]!, actor.actor_kind);
      const laneId = actor.actor_kind === "main" ? "lane:main" : `lane:${actor.actor_id}`;
      const draft: ActorContext = {
        ...actor,
        lane_id: laneId,
        branch_kind: branchKind,
        events: sortedEvents,
        classifications,
        started_at: startedAt,
        ended_at: endedAt,
        duration_ms: durationMs,
        expanded: true,
      };
      draft.expanded = shouldExpandActor(draft);
      return draft;
    })
    .sort((left, right) => left.started_at.localeCompare(right.started_at));
}

function eventToNode(event: AgentEvent, promptSlices: PromptSlice[]): RunTraceNode {
  const actor = getActor(event);
  const classification = classifyEvent(event);
  const record = deriveTelemetryRecord(event);
  const promptSliceId = getPromptSliceId(promptSlices, event);
  const kind: RunNodeKind =
    event.hook_event_type === "UserPromptSubmit"
      ? "prompt"
      : event.hook_event_type === "TaskCreated" || event.hook_event_type === "TaskCompleted"
        ? "task"
        : "event";

  return {
    id: `node:${event.id}`,
    lane_id: actor.actor_kind === "main" ? "lane:main" : `lane:${actor.actor_id}`,
    kind,
    actor_id: actor.actor_id,
    actor_label: actor.actor_label,
    actor_kind: actor.actor_kind,
    branch_kind: classification.branch_kind,
    timestamp: event.timestamp,
    label: record.summary,
    summary: record.detail ?? record.summary,
    detail: record.detail,
    category: classification.category,
    tool_category: classification.tool_category,
    effect_level: classification.effect_level,
    outcome: classification.outcome,
    significant: classification.significant,
    collapsed_by_default: classification.collapsed_by_default,
    event_ids: [event.id],
    task_id: event.task_id,
    prompt_slice_id: promptSliceId,
  };
}

function inspectionBlockNode(events: AgentEvent[], laneId: string, promptSlices: PromptSlice[]): RunTraceNode {
  const first = events[0]!;
  const last = events[events.length - 1]!;
  const actor = getActor(first);
  const toolSummary = unique(events.map((event) => event.tool_name ?? event.hook_event_type)).join(" · ");
  return {
    id: `node:block:${first.id}`,
    lane_id: laneId,
    kind: "inspection_block",
    actor_id: actor.actor_id,
    actor_label: actor.actor_label,
    actor_kind: actor.actor_kind,
    branch_kind: getBranchKind(first, actor.actor_kind),
    timestamp: first.timestamp,
    end_timestamp: last.timestamp,
    duration_ms: Math.max(0, new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime()),
    label: `${events.length} inspection steps`,
    summary: toolSummary,
    detail: truncateText(unique(events.map((event) => summarizeToolInput(event)).filter(Boolean) as string[]).join(" · "), 180),
    category: "inspection_only",
    tool_category: "inspection",
    effect_level: "inspection_only",
    significant: false,
    collapsed_by_default: true,
    event_ids: events.map((event) => event.id),
    task_id: first.task_id,
    prompt_slice_id: getPromptSliceId(promptSlices, first),
    inspection_count: events.length,
  };
}

function buildLaneNodes(actor: ActorContext, promptSlices: PromptSlice[]): RunTraceNode[] {
  const nodes: RunTraceNode[] = [];
  let inspectionBuffer: AgentEvent[] = [];

  const flushInspection = () => {
    if (inspectionBuffer.length === 0) return;
    if (inspectionBuffer.length >= INSPECTION_BLOCK_MIN_SIZE) {
      nodes.push(inspectionBlockNode(inspectionBuffer, actor.lane_id, promptSlices));
    } else {
      inspectionBuffer.forEach((event) => nodes.push(eventToNode(event, promptSlices)));
    }
    inspectionBuffer = [];
  };

  for (const event of actor.events) {
    const classification = classifyEvent(event);
    if (classification.category === "inspection_only") {
      inspectionBuffer.push(event);
      continue;
    }
    flushInspection();
    nodes.push(eventToNode(event, promptSlices));
  }

  flushInspection();
  return nodes;
}

function collapsedBranchNode(actor: ActorContext, promptSlices: PromptSlice[]): RunTraceNode {
  const first = actor.events[0]!;
  return {
    id: `node:collapsed:${actor.actor_id}`,
    lane_id: "lane:main",
    kind: "branch",
    actor_id: actor.actor_id,
    actor_label: actor.actor_label,
    actor_kind: actor.actor_kind,
    branch_kind: actor.branch_kind,
    timestamp: first.timestamp,
    end_timestamp: actor.ended_at,
    duration_ms: actor.duration_ms,
    label: `${actor.actor_label} (collapsed)`,
    summary: `${actor.events.length} inspection steps`,
    detail: truncateText(unique(actor.events.map((event) => event.tool_name ?? event.hook_event_type)).join(" · "), 180),
    category: "inspection_only",
    tool_category: "inspection",
    effect_level: "inspection_only",
    significant: false,
    collapsed_by_default: true,
    outcome: actor.classifications[actor.classifications.length - 1]?.outcome,
    event_ids: actor.events.map((event) => event.id),
    prompt_slice_id: getPromptSliceId(promptSlices, first),
    inspection_count: actor.events.length,
  };
}

function expandedBranchNode(actor: ActorContext, promptSlices: PromptSlice[]): RunTraceNode {
  const first = actor.events[0]!;
  const significantCount = actor.classifications.filter((classification) => classification.significant).length;
  return {
    id: `node:branch:${actor.actor_id}`,
    lane_id: "lane:main",
    kind: "branch",
    actor_id: actor.actor_id,
    actor_label: actor.actor_label,
    actor_kind: actor.actor_kind,
    branch_kind: actor.branch_kind,
    timestamp: first.timestamp,
    end_timestamp: actor.ended_at,
    duration_ms: actor.duration_ms,
    label: `${actor.actor_label} branch`,
    summary: `${actor.events.length} steps · ${significantCount} significant`,
    detail: truncateText(unique(actor.events.map((event) => event.task_subject ?? event.tool_name ?? event.reason).filter(Boolean) as string[]).join(" · "), 180),
    category: significantCount > 0 ? "significant_side_effect" : "reasoning_or_coordination",
    tool_category: significantCount > 0 ? "coordination" : "inspection",
    effect_level: significantCount > 0 ? "significant_side_effect" : "reasoning_or_coordination",
    significant: significantCount > 0,
    collapsed_by_default: false,
    outcome: actor.classifications[actor.classifications.length - 1]?.outcome,
    event_ids: actor.events.map((event) => event.id),
    prompt_slice_id: getPromptSliceId(promptSlices, first),
    child_lane_id: actor.lane_id,
  };
}

export function deriveRunTrace(
  events: AgentEvent[],
  options: { session?: string; promptSliceId?: string } = {},
): RunTrace | null {
  const sorted = [...events].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const sessionId = options.session ?? sorted[sorted.length - 1]?.session_id;
  if (!sessionId) return null;

  const sessionEvents = sorted.filter((event) => event.session_id === sessionId);
  if (sessionEvents.length === 0) return null;

  const promptSlices = derivePromptSlices(sorted, sessionId);
  const filteredEvents =
    options.promptSliceId
      ? sessionEvents.filter((event) =>
          promptSlices.find((slice) => slice.id === options.promptSliceId)?.event_ids.includes(event.id),
        )
      : sessionEvents;
  if (filteredEvents.length === 0) return null;

  const relevantPromptSlices =
    options.promptSliceId
      ? promptSlices.filter((slice) => slice.id === options.promptSliceId)
      : promptSlices;

  const actorContexts = buildActorContexts(filteredEvents);
  const mainActor = actorContexts.find((actor) => actor.actor_kind === "main");
  if (!mainActor) return null;

  const mainNodes = buildLaneNodes(mainActor, relevantPromptSlices);
  const lanes: RunTraceLane[] = [];
  const branchActors = actorContexts.filter((actor) => actor.actor_id !== mainActor.actor_id);

  for (const actor of branchActors) {
    if (actor.expanded) {
      const branchNode = expandedBranchNode(actor, relevantPromptSlices);
      mainNodes.push(branchNode);
      const laneNodes = buildLaneNodes(actor, relevantPromptSlices);
      lanes.push({
        id: actor.lane_id,
        actor_id: actor.actor_id,
        actor_label: actor.actor_label,
        actor_kind: actor.actor_kind,
        branch_kind: actor.branch_kind,
        parent_lane_id: "lane:main",
        parent_node_id: branchNode.id,
        expanded: true,
        started_at: actor.started_at,
        ended_at: actor.ended_at,
        duration_ms: actor.duration_ms,
        event_count: actor.events.length,
        node_count: laneNodes.length,
        nodes: laneNodes,
      });
    } else {
      mainNodes.push(collapsedBranchNode(actor, relevantPromptSlices));
    }
  }

  const sortedMainNodes = mainNodes.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  lanes.unshift({
    id: "lane:main",
    actor_id: mainActor.actor_id,
    actor_label: mainActor.actor_label,
    actor_kind: mainActor.actor_kind,
    branch_kind: "main",
    expanded: true,
    started_at: filteredEvents[0]!.timestamp,
    ended_at: filteredEvents[filteredEvents.length - 1]!.timestamp,
    duration_ms: Math.max(
      0,
      new Date(filteredEvents[filteredEvents.length - 1]!.timestamp).getTime() -
        new Date(filteredEvents[0]!.timestamp).getTime(),
    ),
    event_count: mainActor.events.length,
    node_count: sortedMainNodes.length,
    nodes: sortedMainNodes,
  });

  return {
    session_id: sessionId,
    root_run_id: filteredEvents[0]!.root_run_id ?? sessionId,
    started_at: filteredEvents[0]!.timestamp,
    ended_at: filteredEvents[filteredEvents.length - 1]!.timestamp,
    duration_seconds: Math.max(
      0,
      Math.round(
        (new Date(filteredEvents[filteredEvents.length - 1]!.timestamp).getTime() -
          new Date(filteredEvents[0]!.timestamp).getTime()) /
          1000,
      ),
    ),
    cost_usd: getAuthoritativeSessionCost(events, sessionId),
    event_count: filteredEvents.length,
    error_count: filteredEvents.filter((event) => classifyEvent(event).category === "failure_or_anomaly").length,
    branch_count: branchActors.length,
    expanded_branch_count: branchActors.filter((actor) => actor.expanded).length,
    collapsed_branch_count: branchActors.filter((actor) => !actor.expanded).length,
    prompt_slices: relevantPromptSlices,
    prompt_slice_id: options.promptSliceId,
    lanes,
    nodes: lanes.flatMap((lane) => lane.nodes),
  };
}

export function deriveNodeInspectorData(
  runTrace: RunTrace,
  events: AgentEvent[],
  nodeId: string,
): NodeInspectorData | null {
  const lane = runTrace.lanes.find((candidate) => candidate.nodes.some((node) => node.id === nodeId));
  if (!lane) return null;
  const node = lane.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return null;

  const rawEvents = events
    .filter((event) => node.event_ids.includes(event.id))
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const significantEvents = rawEvents.filter((event) => classifyEvent(event).significant);
  const inspectionEvents = rawEvents.filter((event) => classifyEvent(event).category === "inspection_only");

  return {
    node,
    lane,
    prompt_slice: runTrace.prompt_slices.find((slice) => slice.id === node.prompt_slice_id),
    raw_events: rawEvents,
    significant_events: significantEvents,
    inspection_events: inspectionEvents,
  };
}

function formatSeverityTag(severity: TelemetrySeverity): string {
  switch (severity) {
    case "error":
      return "ERROR";
    case "warning":
      return "WARN ";
    default:
      return "INFO ";
  }
}

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function formatTelemetryTimeline(records: TelemetryRecord[]): string {
  if (records.length === 0) return "No telemetry events found.";

  const lines = [
    "Time       Sev   Actor           Operation              Detail",
    "---------  ----  --------------  ---------------------  ------------------------------",
  ];
  for (const record of records) {
    const actor = truncateText(record.actor_label, 14) ?? "main";
    const operation = truncateText(record.operation, 21) ?? record.operation;
    const detail = truncateText(record.detail ?? record.summary, 30) ?? "";
    lines.push(
      `${formatTime(record.timestamp).padEnd(9)}  ${formatSeverityTag(record.severity)}  ${actor.padEnd(14)}  ${operation.padEnd(21)}  ${detail}`,
    );
  }
  return lines.join("\n");
}

export function formatAgentSummaries(agents: AgentSummary[]): string {
  if (agents.length === 0) return "No agent telemetry found.";

  const lines = [
    "Actor            Kind       Events  Tools  Fail  Tasks  Last",
    "---------------  ---------  ------  -----  ----  -----  ---------",
  ];
  for (const agent of agents) {
    lines.push(
      `${truncateText(agent.actor_label, 15)?.padEnd(15) ?? "main"}  ${agent.actor_kind.padEnd(9)}  ${String(agent.event_count).padStart(6)}  ${String(agent.tool_calls).padStart(5)}  ${String(agent.failures).padStart(4)}  ${String(agent.tasks_completed).padStart(5)}  ${formatTime(agent.last_timestamp)}`,
    );
  }
  return lines.join("\n");
}

export function formatTaskSummaries(tasks: TaskSummary[]): string {
  if (tasks.length === 0) return "No task telemetry found.";

  const lines = [
    "Task             Status     Owner           Duration  Subject",
    "---------------  ---------  --------------  --------  ------------------------------",
  ];
  for (const task of tasks) {
    const duration = task.duration_seconds !== undefined ? `${task.duration_seconds}s` : "-";
    lines.push(
      `${truncateText(task.task_id, 15)?.padEnd(15) ?? "task"}  ${task.status.padEnd(9)}  ${truncateText(task.owner, 14)?.padEnd(14) ?? "main"}  ${duration.padStart(8)}  ${truncateText(task.subject, 30) ?? ""}`,
    );
  }
  return lines.join("\n");
}

export function formatRunTraceSummary(runTrace: RunTrace): string {
  const shortSession = `${runTrace.session_id.slice(0, 8)}…${runTrace.session_id.slice(-4)}`;
  const lines = [
    `Run trace for ${shortSession}`,
    `Window: ${runTrace.started_at} → ${runTrace.ended_at} (${runTrace.duration_seconds}s)`,
    `Cost: $${runTrace.cost_usd.toFixed(runTrace.cost_usd < 1 ? 4 : 2)} · Branches: ${runTrace.branch_count} (${runTrace.expanded_branch_count} expanded, ${runTrace.collapsed_branch_count} collapsed)`,
  ];

  if (runTrace.prompt_slices.length > 0) {
    lines.push("Prompt slices:");
    for (const slice of runTrace.prompt_slices) {
      lines.push(`  • ${slice.label} (${slice.event_count} events)`);
    }
  }

  lines.push("Lanes:");
  for (const lane of runTrace.lanes) {
    lines.push(
      `  ${lane.actor_label} [${lane.actor_kind}] ${lane.node_count} nodes / ${lane.event_count} events${lane.expanded ? "" : " (collapsed)"}`,
    );
    for (const node of lane.nodes) {
      const detail = truncateText(node.summary, 72) ?? "";
      lines.push(
        `    - ${formatTime(node.timestamp)} ${node.kind.padEnd(16)} ${truncateText(node.label, 26) ?? node.label}${detail ? ` · ${detail}` : ""}`,
      );
    }
  }

  return lines.join("\n");
}
