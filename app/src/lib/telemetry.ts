import { exists, readTextFile } from "@tauri-apps/plugin-fs";
import type { AgentEvent } from "@/types";

export type TelemetrySeverity = "info" | "warning" | "error";
export type TelemetryPhase = "start" | "success" | "failure" | "end" | "update" | "event";
export type TelemetryActorKind = "main" | "subagent" | "teammate" | "system";

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

export type FlowStatus = "active" | "completed" | "failed";

export interface FlowGroup {
  key: string;
  task_id?: string;
  label: string;
  status: FlowStatus;
  first_timestamp: string;
  last_timestamp: string;
  step_count: number;
  tool_count: number;
  failures: number;
  records: TelemetryRecord[];
}

export interface ActorFlow {
  actor_id: string;
  actor_label: string;
  actor_kind: TelemetryActorKind;
  status: FlowStatus;
  first_timestamp: string;
  last_timestamp: string;
  step_count: number;
  tool_count: number;
  failures: number;
  groups: FlowGroup[];
}

export interface ToolDecision {
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id: string;
}

export interface ReasoningStep {
  timestamp: string;
  model: string;
  thinking?: string;
  reasoning?: string;
  decisions: ToolDecision[];
}

export interface UserPrompt {
  timestamp: string;
  content: string;
}

export interface DecisionChain {
  session_id: string;
  transcript_path: string;
  prompts: UserPrompt[];
  steps: ReasoningStep[];
  summary: {
    total_turns: number;
    total_thinking_blocks: number;
    total_reasoning_blocks: number;
    total_decisions: number;
    total_user_prompts: number;
    models_used: string[];
  };
}

export interface FileChange {
  file_path: string;
  action: "edit" | "write" | "read";
  timestamp: string;
  tool_use_id?: string;
}

export interface CommandExecution {
  command: string;
  timestamp: string;
  is_test: boolean;
  failed: boolean;
  tool_use_id?: string;
}

export interface SessionVerification {
  session_id: string;
  files_changed: FileChange[];
  files_modified: string[];
  commands: CommandExecution[];
  test_runs: CommandExecution[];
  errors: Array<{ timestamp: string; tool_name?: string; error: string }>;
  summary: {
    total_events: number;
    files_edited: number;
    files_written: number;
    files_read: number;
    commands_run: number;
    tests_run: number;
    tests_failed: number;
    errors: number;
    duration_seconds: number;
  };
}

export interface SessionCost {
  session_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  total_tokens: number;
  cost_usd: number;
}

interface TranscriptEntry {
  type: string;
  sessionId?: string;
  timestamp?: string;
  message?: {
    id?: string;
    model?: string;
    role?: string;
    usage?: Record<string, number>;
    content?:
      | string
      | Array<{
          type: string;
          text?: string;
          thinking?: string;
          name?: string;
          id?: string;
          input?: Record<string, unknown>;
        }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface ModelPricing {
  input: number;
  output: number;
  cache_read: number;
  cache_creation: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-6": { input: 15, output: 75, cache_read: 1.5, cache_creation: 18.75 },
  "claude-sonnet-4-6": { input: 3, output: 15, cache_read: 0.3, cache_creation: 3.75 },
  "claude-haiku-4-5": { input: 0.8, output: 4, cache_read: 0.08, cache_creation: 1 },
};

const FALLBACK_PRICING = MODEL_PRICING["claude-sonnet-4-6"];

const TEST_PATTERNS = [
  /\bnpm\s+test\b/,
  /\bnpx\s+(vitest|jest|mocha|ava)\b/,
  /\bvitest\s+run\b/,
  /\bjest\b/,
  /\bpytest\b/,
  /\bcargo\s+test\b/,
  /\bgo\s+test\b/,
  /\bmake\s+test\b/,
];

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

function getActor(event: AgentEvent): {
  actor_id: string;
  actor_label: string;
  actor_kind: TelemetryActorKind;
} {
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
    event.mcp_server ??
    event.mcp_server_name ??
    event.url ??
    event.new_cwd ??
    event.trigger_file_path ??
    event.parent_file_path
  );
}

/** Resolved task subject — the new `task_name` field falls back to legacy `task_subject`. */
function getTaskSubject(event: AgentEvent): string | undefined {
  return event.task_name ?? event.task_subject;
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
        detail: truncateText(
          [event.exit_reason, event.reason, event.source].filter(Boolean).join(" · "),
        ),
      };
    case "UserPromptSubmit":
      return {
        operation: "prompt.submit",
        phase: "event",
        severity: "info",
        summary: "User prompt submitted",
        detail: truncateText(event.prompt ?? event.message),
      };
    case "UserPromptExpansion":
      return {
        operation: "prompt.expand",
        phase: "event",
        severity: "info",
        summary: event.command_name
          ? `Slash command: /${event.command_name}`
          : event.expansion_type === "mcp_prompt"
            ? "MCP prompt expanded"
            : "Prompt expanded",
        detail: truncateText(
          [event.command_args, event.command_source, event.prompt].filter(Boolean).join(" · "),
        ),
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
    case "PostToolBatch":
      return {
        operation: "tool.batch",
        phase: "end",
        severity: "info",
        summary: `Tool batch resolved (${event.tool_calls?.length ?? 0})`,
        detail: truncateText(
          event.tool_calls
            ?.map((call) => (typeof call.tool_name === "string" ? call.tool_name : "?"))
            .join(", "),
        ),
      };
    case "PermissionRequest":
      return {
        operation: "permission.request",
        phase: "event",
        severity: "warning",
        summary: "Permission requested",
        detail: summarizeToolInput(event),
      };
    case "PermissionDenied":
      return {
        operation: "permission.denied",
        phase: "failure",
        severity: "warning",
        summary: `${event.tool_name ?? "Tool"} denied`,
        detail: summarizeToolInput(event),
      };
    case "Notification":
      return {
        operation: "notification",
        phase: "event",
        severity: "info",
        summary: event.title ?? event.notification_type ?? "Notification",
        detail: truncateText(event.notification_message ?? event.message),
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
        severity: "info",
        summary: `${event.agent_type ?? "Subagent"} stopped`,
        detail: truncateText([event.reason, event.agent_transcript_path].filter(Boolean).join(" · ")),
      };
    case "TaskCreated": {
      const subject = getTaskSubject(event);
      return {
        operation: "task.create",
        phase: "start",
        severity: "info",
        summary: subject ? `Task created: ${truncateText(subject, 80)}` : "Task created",
        detail: truncateText(event.task_description),
      };
    }
    case "TaskCompleted": {
      const subject = getTaskSubject(event);
      return {
        operation: "task.complete",
        phase: "end",
        severity: "info",
        summary: subject ? `Task completed: ${truncateText(subject, 80)}` : "Task completed",
        detail: truncateText(event.task_description),
      };
    }
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
        detail: truncateText(
          [event.config_source, event.file_path, event.changed_keys?.join(", ")]
            .filter(Boolean)
            .join(" · "),
        ),
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
        summary: event.change_type
          ? `File ${event.change_type}`
          : event.event
            ? `File ${event.event}`
            : "File changed",
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
        severity: event.stop_reason || event.reason ? "warning" : "info",
        summary: "Session stopped",
        detail: truncateText(
          [event.stop_reason, event.reason, event.last_assistant_message]
            .filter(Boolean)
            .join(" · "),
        ),
      };
    case "StopFailure":
      return {
        operation: "session.stop_failure",
        phase: "failure",
        severity: "error",
        summary: event.error_type ? `Session stop failed: ${event.error_type}` : "Session stop failed",
        detail: truncateText(
          event.error_message ??
            event.error ??
            stringifyUnknown(event.error_details) ??
            event.reason,
        ),
      };
    case "Elicitation":
      return {
        operation: "elicitation.request",
        phase: "start",
        severity: "info",
        summary: event.mcp_server
          ? `Elicitation requested (${event.mcp_server})`
          : "Elicitation requested",
        detail: truncateText(
          [event.mode, event.url, event.message, stringifyUnknown(event.elicitation_form)]
            .filter(Boolean)
            .join(" · "),
        ),
      };
    case "ElicitationResult":
      return {
        operation: "elicitation.result",
        phase: "end",
        severity: event.action === "cancel" || event.action === "decline" ? "warning" : "info",
        summary: event.action ? `Elicitation ${event.action}` : "Elicitation completed",
        detail: stringifyUnknown(event.user_response ?? event.content),
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
  const sessionQuery = options.session;
  const sessionFiltered = sessionQuery
    ? events.filter((event) => event.session_id.startsWith(sessionQuery))
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
        transcript_paths: [record.transcript_path, record.agent_transcript_path].filter(
          Boolean,
        ) as string[],
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
    if (record.model && !existing.models_used.includes(record.model)) {
      existing.models_used.push(record.model);
    }
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
  const sessionQuery = options.session;
  const filtered = sessionQuery
    ? events.filter((event) => event.session_id.startsWith(sessionQuery))
    : events;

  const tasks = new Map<string, TaskSummary>();
  for (const event of filtered) {
    const subject = getTaskSubject(event);
    if (!event.task_id && !subject) continue;
    const taskKey = event.task_id ?? `${event.session_id}:${subject}`;
    const owner = event.teammate_name ?? getActor(event).actor_label;
    const existing = tasks.get(taskKey);
    if (!existing) {
      tasks.set(taskKey, {
        session_id: event.session_id,
        task_id: taskKey,
        subject: subject ?? taskKey,
        description: event.task_description,
        owner,
        team_name: event.team_name,
        created_at: event.hook_event_type === "TaskCreated" ? event.timestamp : undefined,
        completed_at: event.hook_event_type === "TaskCompleted" ? event.timestamp : undefined,
        status: event.hook_event_type === "TaskCompleted" ? "completed" : "created",
      });
      continue;
    }

    existing.subject = subject ?? existing.subject;
    existing.description = event.task_description ?? existing.description;
    existing.owner = event.teammate_name ?? existing.owner;
    existing.team_name = event.team_name ?? existing.team_name;
    if (event.hook_event_type === "TaskCreated") {
      existing.created_at = existing.created_at ?? event.timestamp;
    }
    if (event.hook_event_type === "TaskCompleted") {
      existing.completed_at = event.timestamp;
      existing.status = "completed";
    }
  }

  for (const task of tasks.values()) {
    if (task.created_at && task.completed_at) {
      task.duration_seconds = Math.max(
        0,
        Math.round(
          (new Date(task.completed_at).getTime() - new Date(task.created_at).getTime()) / 1000,
        ),
      );
    }
  }

  return [...tasks.values()].sort((left, right) => {
    const leftTs = left.completed_at ?? left.created_at ?? "";
    const rightTs = right.completed_at ?? right.created_at ?? "";
    return rightTs.localeCompare(leftTs);
  });
}

function deriveFlowStatus(records: TelemetryRecord[]): FlowStatus {
  if (records.some((record) => record.severity === "error")) return "failed";

  const lastRecord = records[records.length - 1];
  if (!lastRecord) return "active";

  if (records.some((record) => record.operation === "task.complete")) return "completed";
  if (lastRecord.phase === "end" || lastRecord.phase === "success") return "completed";
  return "active";
}

function normalizeTaskLabel(record: TelemetryRecord): string | undefined {
  if (!record.task_id) return undefined;

  if (record.summary.startsWith("Task created: ")) {
    return record.summary.slice("Task created: ".length);
  }
  if (record.summary.startsWith("Task completed: ")) {
    return record.summary.slice("Task completed: ".length);
  }
  return record.task_id;
}

export function deriveActorFlows(records: TelemetryRecord[]): ActorFlow[] {
  const actors = new Map<string, ActorFlow>();

  for (const record of records) {
    const actorKey = record.actor_id;
    const existingActor = actors.get(actorKey);

    if (!existingActor) {
      actors.set(actorKey, {
        actor_id: record.actor_id,
        actor_label: record.actor_label,
        actor_kind: record.actor_kind,
        status: record.severity === "error" ? "failed" : "active",
        first_timestamp: record.timestamp,
        last_timestamp: record.timestamp,
        step_count: 1,
        tool_count: record.operation.startsWith("tool.") ? 1 : 0,
        failures: record.severity === "error" ? 1 : 0,
        groups: [],
      });
    } else {
      existingActor.step_count += 1;
      if (record.operation.startsWith("tool.")) existingActor.tool_count += 1;
      if (record.severity === "error") existingActor.failures += 1;
      if (record.timestamp < existingActor.first_timestamp) {
        existingActor.first_timestamp = record.timestamp;
      }
      if (record.timestamp > existingActor.last_timestamp) {
        existingActor.last_timestamp = record.timestamp;
      }
    }

    const actor = actors.get(actorKey)!;
    const groupKey = record.task_id ?? `unscoped:${record.actor_id}`;
    let group = actor.groups.find((item) => item.key === groupKey);
    if (!group) {
      group = {
        key: groupKey,
        task_id: record.task_id,
        label: normalizeTaskLabel(record) ?? "Session / unscoped flow",
        status: record.severity === "error" ? "failed" : "active",
        first_timestamp: record.timestamp,
        last_timestamp: record.timestamp,
        step_count: 0,
        tool_count: 0,
        failures: 0,
        records: [],
      };
      actor.groups.push(group);
    }

    group.records.push(record);
    group.step_count += 1;
    if (record.operation.startsWith("tool.")) group.tool_count += 1;
    if (record.severity === "error") group.failures += 1;
    if (record.timestamp < group.first_timestamp) group.first_timestamp = record.timestamp;
    if (record.timestamp > group.last_timestamp) group.last_timestamp = record.timestamp;

    const nextLabel = normalizeTaskLabel(record);
    if (nextLabel && group.label === "Session / unscoped flow") {
      group.label = nextLabel;
    }
  }

  return [...actors.values()]
    .map((actor): ActorFlow => {
      const groups: FlowGroup[] = actor.groups
        .map((group) => {
          const sortedRecords = [...group.records].sort((left, right) =>
            left.timestamp.localeCompare(right.timestamp),
          );
          return {
            ...group,
            records: sortedRecords,
            status: deriveFlowStatus(sortedRecords),
          };
        })
        .sort((left, right) => left.first_timestamp.localeCompare(right.first_timestamp));

      return {
        ...actor,
        groups,
        status: groups.some((group) => group.status === "failed")
          ? "failed"
          : groups.every((group) => group.status === "completed")
            ? "completed"
            : "active",
      };
    })
    .sort((left, right) => left.first_timestamp.localeCompare(right.first_timestamp));
}

export function getScopedEvents(events: AgentEvent[], focusedSessionIds: string[]): AgentEvent[] {
  if (focusedSessionIds.length === 0) return events;
  return events.filter((event) => focusedSessionIds.includes(event.session_id));
}

export function getSessionIdsByRecency(events: AgentEvent[], focusedSessionIds: string[] = []): string[] {
  const lastBySession = new Map<string, string>();
  for (const event of events) {
    const existing = lastBySession.get(event.session_id);
    if (!existing || event.timestamp > existing) {
      lastBySession.set(event.session_id, event.timestamp);
    }
  }

  const candidates =
    focusedSessionIds.length > 0
      ? focusedSessionIds.filter((sessionId) => lastBySession.has(sessionId))
      : [...lastBySession.keys()];

  return candidates.sort((left, right) =>
    (lastBySession.get(right) ?? "").localeCompare(lastBySession.get(left) ?? ""),
  );
}

export function getPrimarySessionId(
  events: AgentEvent[],
  focusedSessionIds: string[] = [],
): string | undefined {
  return getSessionIdsByRecency(events, focusedSessionIds)[0];
}

export function getSessionTranscriptPath(
  events: AgentEvent[],
  sessionId: string | undefined,
): string | undefined {
  if (!sessionId) return undefined;

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event || event.session_id !== sessionId) continue;
    if (typeof event.transcript_path === "string" && event.transcript_path) {
      return event.transcript_path;
    }
    const raw = event._raw as Record<string, unknown> | undefined;
    if (typeof raw?.transcript_path === "string" && raw.transcript_path) {
      return raw.transcript_path;
    }
  }

  return undefined;
}

function groupIntoTurns(entries: TranscriptEntry[]): Map<string, TranscriptEntry[]> {
  const turns = new Map<string, TranscriptEntry[]>();

  for (const entry of entries) {
    if (entry.type !== "assistant") continue;
    const msgId = entry.message?.id;
    if (!msgId) continue;

    const group = turns.get(msgId);
    if (group) {
      group.push(entry);
    } else {
      turns.set(msgId, [entry]);
    }
  }

  return turns;
}

function turnToStep(entries: TranscriptEntry[]): ReasoningStep {
  const first = entries[0]!;
  const model = first.message?.model ?? "unknown";
  const timestamp = first.timestamp ?? new Date().toISOString();

  let thinking: string | undefined;
  let reasoning: string | undefined;
  const decisions: ToolDecision[] = [];

  for (const entry of entries) {
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (block.type === "thinking" && block.thinking) {
        thinking = thinking ? `${thinking}\n${block.thinking}` : block.thinking;
      } else if (block.type === "text" && block.text) {
        reasoning = reasoning ? `${reasoning}\n${block.text}` : block.text;
      } else if (block.type === "tool_use" && block.name) {
        decisions.push({
          tool_name: block.name,
          tool_input: block.input ?? {},
          tool_use_id: block.id ?? "",
        });
      }
    }
  }

  return { timestamp, model, thinking, reasoning, decisions };
}

function extractPrompts(entries: TranscriptEntry[]): UserPrompt[] {
  const prompts: UserPrompt[] = [];

  for (const entry of entries) {
    if (entry.type !== "user") continue;

    const timestamp = entry.timestamp ?? "";
    const message = entry.message;
    let content = "";

    if (typeof message?.content === "string") {
      content = message.content;
    } else if (Array.isArray(message?.content)) {
      content = message.content
        .filter((block) => block.type === "text" && block.text)
        .map((block) => block.text)
        .join("\n");
    }

    if (content.trim()) {
      prompts.push({ timestamp, content: content.trim() });
    }
  }

  return prompts;
}

function parseTranscriptEntries(content: string): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as TranscriptEntry);
    } catch {
      // Skip malformed lines.
    }
  }
  return entries;
}

export async function readDecisionChain(transcriptPath: string): Promise<DecisionChain | null> {
  try {
    const fileExists = await exists(transcriptPath);
    if (!fileExists) return null;
    const content = await readTextFile(transcriptPath);
    const entries = parseTranscriptEntries(content);
    if (entries.length === 0) return null;

    const sessionId = entries.find((entry) => entry.sessionId)?.sessionId ?? "unknown";
    const turns = groupIntoTurns(entries);
    const steps: ReasoningStep[] = [];

    for (const [, group] of turns) {
      const step = turnToStep(group);
      if (step.thinking || step.reasoning || step.decisions.length > 0) {
        steps.push(step);
      }
    }

    const prompts = extractPrompts(entries);
    const modelsUsed = [...new Set(steps.map((step) => step.model).filter((model) => model !== "unknown"))];

    return {
      session_id: sessionId,
      transcript_path: transcriptPath,
      prompts,
      steps,
      summary: {
        total_turns: steps.length,
        total_thinking_blocks: steps.filter((step) => step.thinking).length,
        total_reasoning_blocks: steps.filter((step) => step.reasoning).length,
        total_decisions: steps.reduce((count, step) => count + step.decisions.length, 0),
        total_user_prompts: prompts.length,
        models_used: modelsUsed,
      },
    };
  } catch {
    return null;
  }
}

function isTestCommand(command: string): boolean {
  return TEST_PATTERNS.some((pattern) => pattern.test(command));
}

function extractFileChanges(events: AgentEvent[]): FileChange[] {
  const changes: FileChange[] = [];

  for (const event of events) {
    if (event.hook_event_type !== "PostToolUse" || !event.tool_name) continue;

    const input = event.tool_input ?? {};
    const filePath = (input.file_path as string | undefined) ?? (input.path as string | undefined);
    if (!filePath) continue;

    let action: FileChange["action"] | undefined;
    switch (event.tool_name) {
      case "Edit":
        action = "edit";
        break;
      case "Write":
        action = "write";
        break;
      case "Read":
        action = "read";
        break;
      default:
        continue;
    }

    changes.push({
      file_path: filePath,
      action,
      timestamp: event.timestamp,
      tool_use_id: event.tool_use_id,
    });
  }

  return changes;
}

function extractCommands(events: AgentEvent[]): CommandExecution[] {
  const commands: CommandExecution[] = [];

  const bashEvents = events.filter(
    (event) =>
      (event.hook_event_type === "PostToolUse" || event.hook_event_type === "PostToolUseFailure") &&
      event.tool_name === "Bash",
  );

  for (const event of bashEvents) {
    const input = event.tool_input ?? {};
    const command = (input.command as string) ?? "";
    if (!command) continue;

    commands.push({
      command,
      timestamp: event.timestamp,
      is_test: isTestCommand(command),
      failed: event.hook_event_type === "PostToolUseFailure",
      tool_use_id: event.tool_use_id,
    });
  }

  return commands;
}

function extractErrors(events: AgentEvent[]): Array<{ timestamp: string; tool_name?: string; error: string }> {
  const errors: Array<{ timestamp: string; tool_name?: string; error: string }> = [];

  for (const event of events) {
    if (event.hook_event_type === "PostToolUseFailure" || event.hook_event_type === "StopFailure") {
      errors.push({
        timestamp: event.timestamp,
        tool_name: event.tool_name,
        error: event.error ?? "Unknown error",
      });
    }
  }

  return errors;
}

export function verifySession(events: AgentEvent[], sessionId: string): SessionVerification {
  const sessionEvents = events.filter((event) => event.session_id === sessionId);

  const fileChanges = extractFileChanges(sessionEvents);
  const commands = extractCommands(sessionEvents);
  const errors = extractErrors(sessionEvents);
  const modifications = fileChanges.filter((change) => change.action === "edit" || change.action === "write");
  const filesModified = [...new Set(modifications.map((change) => change.file_path))];
  const testRuns = commands.filter((command) => command.is_test);

  let duration = 0;
  if (sessionEvents.length >= 2) {
    const first = new Date(sessionEvents[0]!.timestamp).getTime();
    const last = new Date(sessionEvents[sessionEvents.length - 1]!.timestamp).getTime();
    duration = Math.round((last - first) / 1000);
  }

  return {
    session_id: sessionId,
    files_changed: fileChanges,
    files_modified: filesModified,
    commands,
    test_runs: testRuns,
    errors,
    summary: {
      total_events: sessionEvents.length,
      files_edited: fileChanges.filter((change) => change.action === "edit").length,
      files_written: fileChanges.filter((change) => change.action === "write").length,
      files_read: fileChanges.filter((change) => change.action === "read").length,
      commands_run: commands.length,
      tests_run: testRuns.length,
      tests_failed: testRuns.filter((command) => command.failed).length,
      errors: errors.length,
      duration_seconds: duration,
    },
  };
}

function getPricing(model: string): ModelPricing {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model]!;
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(key)) return pricing;
  }
  return FALLBACK_PRICING!;
}

export async function readSessionCost(
  transcriptPath: string,
  sessionId: string,
): Promise<SessionCost | null> {
  try {
    const fileExists = await exists(transcriptPath);
    if (!fileExists) return null;

    const content = await readTextFile(transcriptPath);
    const entries = parseTranscriptEntries(content);

    let model = "unknown";
    const totals = {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    };
    let hasUsage = false;

    for (const entry of entries) {
      if (entry.type !== "assistant") continue;
      const message = entry.message;
      if (!message) continue;

      if (model === "unknown" && typeof message.model === "string") {
        model = message.model;
      }

      const usage = message.usage as Record<string, number> | undefined;
      if (!usage) continue;

      hasUsage = true;
      totals.input_tokens += usage.input_tokens ?? 0;
      totals.output_tokens += usage.output_tokens ?? 0;
      totals.cache_read_input_tokens += usage.cache_read_input_tokens ?? 0;
      totals.cache_creation_input_tokens += usage.cache_creation_input_tokens ?? 0;
    }

    if (!hasUsage) return null;

    const pricing = getPricing(model);
    const costUsd =
      (totals.input_tokens / 1_000_000) * pricing.input +
      (totals.output_tokens / 1_000_000) * pricing.output +
      (totals.cache_read_input_tokens / 1_000_000) * pricing.cache_read +
      (totals.cache_creation_input_tokens / 1_000_000) * pricing.cache_creation;

    const totalTokens =
      totals.input_tokens +
      totals.output_tokens +
      totals.cache_read_input_tokens +
      totals.cache_creation_input_tokens;

    return {
      session_id: sessionId,
      model,
      ...totals,
      total_tokens: totalTokens,
      cost_usd: Math.round(costUsd * 10000) / 10000,
    };
  } catch {
    return null;
  }
}

export type RunTraceCategory =
  | "inspection_only"
  | "reasoning_or_coordination"
  | "significant_side_effect"
  | "safety_or_policy"
  | "failure_or_anomaly";

export type RunTraceNodeKind =
  | "session"
  | "prompt"
  | "task"
  | "tool"
  | "agent"
  | "inspection_block"
  | "policy"
  | "failure"
  | "event";

export type RunTraceLaneKind = "main" | "subagent" | "teammate";

export interface PromptSlice {
  id: string;
  label: string;
  prompt: string;
  start_timestamp: string;
  end_timestamp?: string;
  event_count: number;
}

export interface RunTraceNode {
  id: string;
  lane_id: string;
  actor_id: string;
  prompt_slice_id?: string;
  kind: RunTraceNodeKind;
  category: RunTraceCategory;
  title: string;
  subtitle?: string;
  status: FlowStatus;
  start_timestamp: string;
  end_timestamp: string;
  duration_ms: number;
  collapsed_by_default: boolean;
  event_ids: string[];
  tool_names: string[];
  task_ids: string[];
  transcript_paths: string[];
}

export interface RunTraceLane {
  id: string;
  actor_id: string;
  label: string;
  kind: RunTraceLaneKind;
  parent_lane_id?: string;
  branch_summary_node_id?: string;
  collapsed_by_default: boolean;
  event_count: number;
  inspection_event_count: number;
  significant_event_count: number;
  failure_count: number;
  start_timestamp: string;
  end_timestamp: string;
  duration_ms: number;
  nodes: RunTraceNode[];
}

export interface RunTraceSummary {
  session_id: string;
  first_timestamp: string;
  last_timestamp: string;
  duration_seconds: number;
  total_cost_usd: number;
  prompt_count: number;
  branch_count: number;
  expanded_branch_count: number;
  collapsed_helper_count: number;
  subagent_count: number;
  teammate_count: number;
  top_tools: [string, number][];
  models_used: string[];
  severity: TelemetrySeverity;
}

export interface RunTraceModel {
  session_id: string;
  summary: RunTraceSummary;
  prompt_slices: PromptSlice[];
  selected_prompt_slice_id?: string;
  lanes: RunTraceLane[];
  raw_events: AgentEvent[];
}

export interface RunTraceInspectorAction {
  event_id: string;
  timestamp: string;
  severity: TelemetrySeverity;
  label: string;
  detail?: string;
  tool_name?: string;
}

export interface RunTraceInspector {
  lane: RunTraceLane;
  node: RunTraceNode;
  prompt_slice?: PromptSlice;
  transcript_path?: string;
  models_used: string[];
  ownership: {
    actor_label: string;
    actor_kind: RunTraceLaneKind;
    parent_lane_id?: string;
    task_ids: string[];
  };
  significant_actions: RunTraceInspectorAction[];
  inspection_actions: RunTraceInspectorAction[];
  raw_records: TelemetryRecord[];
}

const INSPECTION_TOOLS = new Set([
  "Read",
  "Grep",
  "Glob",
  "LS",
  "Find",
  "Search",
  "SearchFiles",
]);

const TERMINAL_COST_EVENTS = new Set(["Stop", "SessionEnd"]);
const POLICY_EVENT_TYPES = new Set(["PermissionRequest", "Elicitation", "ElicitationResult", "_escalation"]);
const FAILURE_EVENT_TYPES = new Set(["PostToolUseFailure", "StopFailure", "_anomaly", "_parse_error"]);
function toTimestampMs(timestamp: string): number {
  return new Date(timestamp).getTime();
}

function getEventTimelineBounds(events: AgentEvent[]): { start: string; end: string } | null {
  if (events.length === 0) return null;
  const sorted = [...events].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  return {
    start: sorted[0]!.timestamp,
    end: sorted[sorted.length - 1]!.timestamp,
  };
}

function getEventDurationMs(events: AgentEvent[]): number {
  const bounds = getEventTimelineBounds(events);
  if (!bounds) return 0;
  return Math.max(0, toTimestampMs(bounds.end) - toTimestampMs(bounds.start));
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function isInspectionTool(toolName: string | undefined): boolean {
  return Boolean(toolName && INSPECTION_TOOLS.has(toolName));
}

function getToolCategory(event: AgentEvent): string {
  if (event.tool_category) return event.tool_category;
  if (!event.tool_name) return "event";
  if (isInspectionTool(event.tool_name)) return "inspection";
  if (event.tool_name === "Bash") return "command";
  if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(event.tool_name)) return "mutation";
  return "significant";
}

function getRunTraceCategory(event: AgentEvent): RunTraceCategory {
  if (event.failure_class || FAILURE_EVENT_TYPES.has(event.hook_event_type)) {
    return "failure_or_anomaly";
  }
  if (POLICY_EVENT_TYPES.has(event.hook_event_type)) {
    return "safety_or_policy";
  }
  if (event.hook_event_type === "PostToolUse" && isInspectionTool(event.tool_name)) {
    return "inspection_only";
  }
  if (
    event.hook_event_type === "PostToolUse" ||
    event.hook_event_type === "FileChanged" ||
    event.hook_event_type === "WorktreeCreate" ||
    event.hook_event_type === "WorktreeRemove"
  ) {
    return getToolCategory(event) === "inspection"
      ? "inspection_only"
      : "significant_side_effect";
  }
  return "reasoning_or_coordination";
}

function isInspectionOnlyEvent(event: AgentEvent): boolean {
  return getRunTraceCategory(event) === "inspection_only";
}

function getNodeKind(event: AgentEvent): RunTraceNodeKind {
  switch (event.hook_event_type) {
    case "SessionStart":
    case "SessionEnd":
    case "Stop":
      return "session";
    case "UserPromptSubmit":
      return "prompt";
    case "TaskCreated":
    case "TaskCompleted":
      return "task";
    case "SubagentStart":
    case "SubagentStop":
      return "agent";
    case "PermissionRequest":
    case "Elicitation":
    case "ElicitationResult":
    case "_escalation":
      return "policy";
    case "PostToolUseFailure":
    case "StopFailure":
    case "_anomaly":
    case "_parse_error":
      return "failure";
    case "PostToolUse":
      return "tool";
    default:
      return "event";
  }
}

function getNodeStatus(event: AgentEvent): FlowStatus {
  if (FAILURE_EVENT_TYPES.has(event.hook_event_type) || event.error) return "failed";
  if (event.hook_event_type === "TaskCompleted" || event.hook_event_type === "SubagentStop") {
    return "completed";
  }
  return "active";
}

function getPromptSlicesForSession(events: AgentEvent[], sessionId: string): PromptSlice[] {
  const sessionEvents = [...events]
    .filter((event) => event.session_id === sessionId)
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));

  const promptEvents = sessionEvents.filter(
    (event) => event.hook_event_type === "UserPromptSubmit" && (event.prompt ?? event.message),
  );

  return promptEvents.map((event, index) => {
    const nextPrompt = promptEvents[index + 1];
    const startTimestamp = event.timestamp;
    const endTimestamp = nextPrompt?.timestamp;
    const eventCount = sessionEvents.filter((candidate) => {
      if (candidate.timestamp < startTimestamp) return false;
      if (endTimestamp && candidate.timestamp >= endTimestamp) return false;
      return true;
    }).length;

    return {
      id: event.prompt_segment_id ?? event.id ?? `${sessionId}:prompt:${index + 1}`,
      label: `Prompt ${index + 1}`,
      prompt: (event.prompt ?? event.message ?? "").trim(),
      start_timestamp: startTimestamp,
      end_timestamp: endTimestamp,
      event_count: eventCount,
    };
  });
}

function getPromptSliceIdForEvent(event: AgentEvent, promptSlices: PromptSlice[]): string | undefined {
  if (event.prompt_segment_id) return event.prompt_segment_id;
  return promptSlices.find((slice) => {
    if (event.timestamp < slice.start_timestamp) return false;
    if (slice.end_timestamp && event.timestamp >= slice.end_timestamp) return false;
    return true;
  })?.id;
}

function getSessionEvents(events: AgentEvent[], sessionId: string): AgentEvent[] {
  return [...events]
    .filter((event) => event.session_id === sessionId)
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

function getTopTools(events: AgentEvent[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const event of events) {
    if (event.hook_event_type !== "PostToolUse" && event.hook_event_type !== "PostToolUseFailure") {
      continue;
    }
    const toolName = event.tool_name ?? "unknown";
    counts.set(toolName, (counts.get(toolName) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 6);
}

export function getAuthoritativeSessionCost(events: AgentEvent[], sessionId?: string): number {
  const relevant = sessionId
    ? events.filter((event) => event.session_id === sessionId)
    : events;

  if (relevant.length === 0) return 0;

  const costEvents = relevant.filter((event) => typeof event.cost_usd === "number");
  if (costEvents.length === 0) return 0;

  const terminal = costEvents.filter((event) => TERMINAL_COST_EVENTS.has(event.hook_event_type));
  const source = terminal.length > 0 ? terminal : costEvents;
  const sorted = [...source].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  return sorted[sorted.length - 1]?.cost_usd ?? 0;
}

export function getAuthoritativeTotalCost(events: AgentEvent[]): number {
  const sessionIds = [...new Set(events.map((event) => event.session_id))];
  return sessionIds.reduce((sum, sessionId) => sum + getAuthoritativeSessionCost(events, sessionId), 0);
}

function shouldExpandActorBranch(
  actorKind: RunTraceLaneKind,
  events: AgentEvent[],
): boolean {
  if (actorKind === "main" || actorKind === "teammate") return true;
  if (events.some((event) => getRunTraceCategory(event) === "failure_or_anomaly")) return true;
  if (events.some((event) => getRunTraceCategory(event) === "safety_or_policy")) return true;
  if (
    events.some(
      (event) =>
        event.hook_event_type === "PostToolUse" &&
        !isInspectionOnlyEvent(event) &&
        getRunTraceCategory(event) !== "reasoning_or_coordination",
    )
  ) {
    return true;
  }
  if (events.some((event) => event.team_name || event.hook_event_type === "TeammateIdle")) return true;
  if (events.filter((event) => event.hook_event_type === "PostToolUse").length >= 8) return true;
  return getEventDurationMs(events) >= 45_000;
}

function flushInspectionBuffer(
  laneId: string,
  actorId: string,
  promptSliceId: string | undefined,
  inspectionBuffer: AgentEvent[],
  nodes: RunTraceNode[],
): void {
  if (inspectionBuffer.length === 0) return;

  const first = inspectionBuffer[0]!;
  const last = inspectionBuffer[inspectionBuffer.length - 1]!;
  const toolNames = uniqueStrings(inspectionBuffer.map((event) => event.tool_name));
  const transcriptPaths = uniqueStrings(
    inspectionBuffer.flatMap((event) => [event.agent_transcript_path, event.transcript_path]),
  );

  nodes.push({
    id: `${laneId}:inspection:${first.id}`,
    lane_id: laneId,
    actor_id: actorId,
    prompt_slice_id: promptSliceId,
    kind: "inspection_block",
    category: "inspection_only",
    title: `${inspectionBuffer.length} inspection step${inspectionBuffer.length === 1 ? "" : "s"}`,
    subtitle: toolNames.length > 0 ? toolNames.join(" · ") : "Read-only activity",
    status: "completed",
    start_timestamp: first.timestamp,
    end_timestamp: last.timestamp,
    duration_ms: Math.max(0, toTimestampMs(last.timestamp) - toTimestampMs(first.timestamp)),
    collapsed_by_default: true,
    event_ids: inspectionBuffer.map((event) => event.id),
    tool_names: toolNames,
    task_ids: uniqueStrings(inspectionBuffer.map((event) => event.task_id)),
    transcript_paths: transcriptPaths,
  });
}

function makeEventNode(
  laneId: string,
  actorId: string,
  promptSliceId: string | undefined,
  event: AgentEvent,
): RunTraceNode {
  const record = deriveTelemetryRecord(event);
  const transcriptPaths = uniqueStrings([event.agent_transcript_path, event.transcript_path]);
  return {
    id: `${laneId}:${event.id}`,
    lane_id: laneId,
    actor_id: actorId,
    prompt_slice_id: promptSliceId,
    kind: getNodeKind(event),
    category: getRunTraceCategory(event),
    title: record.summary,
    subtitle: record.detail,
    status: getNodeStatus(event),
    start_timestamp: event.timestamp,
    end_timestamp: event.timestamp,
    duration_ms: event.duration_ms ?? 0,
    collapsed_by_default: Boolean(event.collapsed_by_default),
    event_ids: [event.id],
    tool_names: uniqueStrings([event.tool_name]),
    task_ids: uniqueStrings([event.task_id]),
    transcript_paths: transcriptPaths,
  };
}

function deriveLaneNodes(
  laneId: string,
  actorId: string,
  events: AgentEvent[],
  promptSlices: PromptSlice[],
): RunTraceNode[] {
  const nodes: RunTraceNode[] = [];
  const inspectionBuffer: AgentEvent[] = [];

  const flush = (promptSliceId?: string) => {
    flushInspectionBuffer(laneId, actorId, promptSliceId, [...inspectionBuffer], nodes);
    inspectionBuffer.length = 0;
  };

  for (const event of events) {
    const promptSliceId = getPromptSliceIdForEvent(event, promptSlices);
    if (isInspectionOnlyEvent(event)) {
      inspectionBuffer.push(event);
      continue;
    }
    flush(promptSliceId);
    nodes.push(makeEventNode(laneId, actorId, promptSliceId, event));
  }

  flush();

  return nodes.sort((left, right) => left.start_timestamp.localeCompare(right.start_timestamp));
}

function makeBranchSummaryNode(
  laneId: string,
  actorId: string,
  actorLabel: string,
  actorEvents: AgentEvent[],
  promptSlices: PromptSlice[],
  collapsedByDefault: boolean,
): RunTraceNode {
  const first = actorEvents[0]!;
  const last = actorEvents[actorEvents.length - 1]!;
  const inspectionCount = actorEvents.filter(isInspectionOnlyEvent).length;
  const significantCount = actorEvents.length - inspectionCount;
  return {
    id: `${laneId}:branch:${first.id}`,
    lane_id: laneId,
    actor_id: actorId,
    prompt_slice_id: getPromptSliceIdForEvent(first, promptSlices),
    kind: "agent",
    category: collapsedByDefault ? "inspection_only" : "reasoning_or_coordination",
    title: collapsedByDefault ? `${actorLabel} helper` : `Spawned ${actorLabel}`,
    subtitle: collapsedByDefault
      ? `${inspectionCount} read-only step${inspectionCount === 1 ? "" : "s"}`
      : `${significantCount} significant · ${inspectionCount} inspection`,
    status: actorEvents.some((event) => getNodeStatus(event) === "failed") ? "failed" : "completed",
    start_timestamp: first.timestamp,
    end_timestamp: last.timestamp,
    duration_ms: Math.max(0, toTimestampMs(last.timestamp) - toTimestampMs(first.timestamp)),
    collapsed_by_default: collapsedByDefault,
    event_ids: actorEvents.map((event) => event.id),
    tool_names: uniqueStrings(actorEvents.map((event) => event.tool_name)),
    task_ids: uniqueStrings(actorEvents.map((event) => event.task_id)),
    transcript_paths: uniqueStrings(
      actorEvents.flatMap((event) => [event.agent_transcript_path, event.transcript_path]),
    ),
  };
}

function getLaneKind(actorKind: TelemetryActorKind): RunTraceLaneKind {
  switch (actorKind) {
    case "teammate":
      return "teammate";
    case "subagent":
      return "subagent";
    case "system":
    case "main":
    default:
      return "main";
  }
}

function buildRunTraceSummary(
  sessionEvents: AgentEvent[],
  promptSlices: PromptSlice[],
  lanes: RunTraceLane[],
): RunTraceSummary {
  const mainLane = lanes.find((lane) => lane.kind === "main");
  const subagentLanes = lanes.filter((lane) => lane.kind === "subagent");
  const teammateLanes = lanes.filter((lane) => lane.kind === "teammate");
  const expandedLanes = lanes.filter((lane) => lane.kind !== "main");
  const collapsedHelperCount =
    mainLane?.nodes.filter((node) => node.kind === "agent" && node.collapsed_by_default).length ?? 0;
  const severity = sessionEvents.some((event) => getRunTraceCategory(event) === "failure_or_anomaly")
    ? "error"
    : sessionEvents.some((event) => getRunTraceCategory(event) === "safety_or_policy")
      ? "warning"
      : "info";

  return {
    session_id: sessionEvents[0]!.session_id,
    first_timestamp: sessionEvents[0]!.timestamp,
    last_timestamp: sessionEvents[sessionEvents.length - 1]!.timestamp,
    duration_seconds: Math.round(getEventDurationMs(sessionEvents) / 1000),
    total_cost_usd: getAuthoritativeSessionCost(sessionEvents),
    prompt_count: promptSlices.length,
    branch_count: Math.max(0, lanes.length - 1),
    expanded_branch_count: expandedLanes.length,
    collapsed_helper_count: collapsedHelperCount,
    subagent_count: subagentLanes.length + collapsedHelperCount,
    teammate_count: teammateLanes.length,
    top_tools: getTopTools(sessionEvents),
    models_used: uniqueStrings(sessionEvents.map((event) => event.model)),
    severity,
  };
}

export function deriveRunTraceModel(
  events: AgentEvent[],
  sessionId: string,
  options: { promptSliceId?: string } = {},
): RunTraceModel | null {
  const sessionEvents = getSessionEvents(events, sessionId);
  if (sessionEvents.length === 0) return null;

  const promptSlices = getPromptSlicesForSession(sessionEvents, sessionId);
  const selectedPromptSlice = options.promptSliceId
    ? promptSlices.find((slice) => slice.id === options.promptSliceId)
    : undefined;
  const visibleEvents = selectedPromptSlice
    ? sessionEvents.filter((event) => {
        if (event.timestamp < selectedPromptSlice.start_timestamp) return false;
        if (selectedPromptSlice.end_timestamp && event.timestamp >= selectedPromptSlice.end_timestamp) {
          return false;
        }
        return true;
      })
    : sessionEvents;

  const actorMap = new Map<
    string,
    {
      actor_id: string;
      actor_label: string;
      actor_kind: RunTraceLaneKind;
      events: AgentEvent[];
    }
  >();

  for (const event of visibleEvents) {
    const actor = getActor(event);
    const laneKind = getLaneKind(actor.actor_kind);
    const actorId = laneKind === "main" ? `main:${sessionId}` : actor.actor_id;
    const actorLabel = laneKind === "main" ? "main" : actor.actor_label;
    const existing = actorMap.get(actorId);
    if (existing) {
      existing.events.push(event);
      continue;
    }
    actorMap.set(actorId, {
      actor_id: actorId,
      actor_label: actorLabel,
      actor_kind: laneKind,
      events: [event],
    });
  }

  const mainLaneId = `${sessionId}:lane:main`;
  const mainActor = actorMap.get(`main:${sessionId}`) ?? {
    actor_id: `main:${sessionId}`,
    actor_label: "main",
    actor_kind: "main" as const,
    events: visibleEvents.filter((event) => getLaneKind(getActor(event).actor_kind) === "main"),
  };

  const mainLaneNodes = deriveLaneNodes(mainLaneId, mainActor.actor_id, mainActor.events, promptSlices);
  const lanes: RunTraceLane[] = [];

  const auxiliaryActors = [...actorMap.values()]
    .filter((actor) => actor.actor_id !== mainActor.actor_id)
    .sort((left, right) => left.events[0]!.timestamp.localeCompare(right.events[0]!.timestamp));

  for (const actor of auxiliaryActors) {
    const expand = shouldExpandActorBranch(actor.actor_kind, actor.events);
    const branchSummary = makeBranchSummaryNode(
      mainLaneId,
      actor.actor_id,
      actor.actor_label,
      actor.events,
      promptSlices,
      !expand,
    );
    mainLaneNodes.push(branchSummary);

    if (!expand) continue;

    const nodes = deriveLaneNodes(`${sessionId}:lane:${actor.actor_id}`, actor.actor_id, actor.events, promptSlices);
    const bounds = getEventTimelineBounds(actor.events)!;
    lanes.push({
      id: `${sessionId}:lane:${actor.actor_id}`,
      actor_id: actor.actor_id,
      label: actor.actor_label,
      kind: actor.actor_kind,
      parent_lane_id: mainLaneId,
      branch_summary_node_id: branchSummary.id,
      collapsed_by_default: false,
      event_count: actor.events.length,
      inspection_event_count: actor.events.filter(isInspectionOnlyEvent).length,
      significant_event_count: actor.events.filter((event) => !isInspectionOnlyEvent(event)).length,
      failure_count: actor.events.filter((event) => getRunTraceCategory(event) === "failure_or_anomaly").length,
      start_timestamp: bounds.start,
      end_timestamp: bounds.end,
      duration_ms: getEventDurationMs(actor.events),
      nodes,
    });
  }

  mainLaneNodes.sort((left, right) => left.start_timestamp.localeCompare(right.start_timestamp));
  const mainBounds = getEventTimelineBounds(mainActor.events) ?? getEventTimelineBounds(visibleEvents)!;
  const mainLane: RunTraceLane = {
    id: mainLaneId,
    actor_id: mainActor.actor_id,
    label: "main",
    kind: "main",
    collapsed_by_default: false,
    event_count: mainActor.events.length,
    inspection_event_count: mainActor.events.filter(isInspectionOnlyEvent).length,
    significant_event_count: mainActor.events.filter((event) => !isInspectionOnlyEvent(event)).length,
    failure_count: mainActor.events.filter((event) => getRunTraceCategory(event) === "failure_or_anomaly").length,
    start_timestamp: mainBounds.start,
    end_timestamp: mainBounds.end,
    duration_ms: getEventDurationMs(mainActor.events),
    nodes: mainLaneNodes,
  };

  const orderedLanes = [
    mainLane,
    ...lanes.sort((left, right) => left.start_timestamp.localeCompare(right.start_timestamp)),
  ];

  return {
    session_id: sessionId,
    summary: buildRunTraceSummary(visibleEvents, promptSlices, orderedLanes),
    prompt_slices: promptSlices,
    selected_prompt_slice_id: selectedPromptSlice?.id,
    lanes: orderedLanes,
    raw_events: visibleEvents,
  };
}

export function deriveRunTraceSummary(
  events: AgentEvent[],
  sessionId: string,
): RunTraceSummary | null {
  return deriveRunTraceModel(events, sessionId)?.summary ?? null;
}

export function getDefaultRunTraceNodeId(model: RunTraceModel | null): string | undefined {
  if (!model) return undefined;
  return model.lanes.flatMap((lane) => lane.nodes).find((node) => !node.collapsed_by_default)?.id
    ?? model.lanes[0]?.nodes[0]?.id;
}

export function buildRunTraceInspector(
  model: RunTraceModel,
  nodeId: string,
): RunTraceInspector | null {
  const lane = model.lanes.find((candidate) => candidate.nodes.some((node) => node.id === nodeId));
  if (!lane) return null;

  const node = lane.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return null;

  const eventLookup = new Map(model.raw_events.map((event) => [event.id, event]));
  const rawEvents = node.event_ids
    .map((eventId) => eventLookup.get(eventId))
    .filter((event): event is AgentEvent => Boolean(event))
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const rawRecords = rawEvents.map(deriveTelemetryRecord);

  const significantActions = rawEvents
    .filter((event) => getRunTraceCategory(event) !== "inspection_only")
    .map((event): RunTraceInspectorAction => {
      const record = deriveTelemetryRecord(event);
      return {
        event_id: event.id,
        timestamp: event.timestamp,
        severity: record.severity,
        label: record.summary,
        detail: record.detail,
        tool_name: event.tool_name,
      };
    });

  const inspectionActions = rawEvents
    .filter(isInspectionOnlyEvent)
    .map((event): RunTraceInspectorAction => {
      const record = deriveTelemetryRecord(event);
      return {
        event_id: event.id,
        timestamp: event.timestamp,
        severity: record.severity,
        label: record.summary,
        detail: record.detail,
        tool_name: event.tool_name,
      };
    });

  return {
    lane,
    node,
    prompt_slice: model.prompt_slices.find((slice) => slice.id === node.prompt_slice_id),
    transcript_path: node.transcript_paths[0],
    models_used: uniqueStrings(rawEvents.map((event) => event.model)),
    ownership: {
      actor_label: lane.label,
      actor_kind: lane.kind,
      parent_lane_id: lane.parent_lane_id,
      task_ids: node.task_ids,
    },
    significant_actions: significantActions,
    inspection_actions: inspectionActions,
    raw_records: rawRecords,
  };
}

export function formatDurationCompact(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}
