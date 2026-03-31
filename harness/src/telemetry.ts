import type { AgentEvent } from "./types.js";

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
        severity: "info",
        summary: `${event.agent_type ?? "Subagent"} stopped`,
        detail: truncateText(
          [event.reason, event.agent_transcript_path].filter(Boolean).join(" · "),
        ),
      };
    case "TaskCreated":
      return {
        operation: "task.create",
        phase: "start",
        severity: "info",
        summary: event.task_subject
          ? `Task created: ${truncateText(event.task_subject, 80)}`
          : "Task created",
        detail: truncateText(event.task_description),
      };
    case "TaskCompleted":
      return {
        operation: "task.complete",
        phase: "end",
        severity: "info",
        summary: event.task_subject
          ? `Task completed: ${truncateText(event.task_subject, 80)}`
          : "Task completed",
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
        detail: truncateText(
          [event.config_source, event.file_path].filter(Boolean).join(" · "),
        ),
      };
    case "CwdChanged":
      return {
        operation: "cwd.change",
        phase: "update",
        severity: "info",
        summary: "Working directory changed",
        detail: truncateText(
          [event.old_cwd, event.new_cwd ?? event.cwd].filter(Boolean).join(" -> "),
        ),
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
        detail: truncateText(
          event.error ?? stringifyUnknown(event.error_details) ?? event.reason,
        ),
      };
    case "Elicitation":
      return {
        operation: "elicitation.request",
        phase: "start",
        severity: "info",
        summary: "Elicitation requested",
        detail: truncateText(
          [event.mode, event.url, event.message].filter(Boolean).join(" · "),
        ),
      };
    case "ElicitationResult":
      return {
        operation: "elicitation.result",
        phase: "end",
        severity: event.action === "cancel" ? "warning" : "info",
        summary: event.action
          ? `Elicitation ${event.action}`
          : "Elicitation completed",
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
        summary: event.notification_type
          ? `Anomaly: ${event.notification_type}`
          : "Anomaly detected",
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

  const sorted = [...actorFiltered].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp),
  );
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

  return [...grouped.values()].sort((left, right) =>
    right.last_timestamp.localeCompare(left.last_timestamp),
  );
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
          (new Date(task.completed_at).getTime() - new Date(task.created_at).getTime()) /
            1000,
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

function formatSeverityTag(severity: TelemetrySeverity): string {
  switch (severity) {
    case "error":
      return "ERROR";
    case "warning":
      return "WARN ";
    case "info":
    default:
      return "INFO ";
  }
}

function formatTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function formatTelemetryTimeline(records: TelemetryRecord[]): string {
  if (records.length === 0) return "No telemetry events found.";

  const lines = ["Time       Sev   Actor           Operation              Detail", "---------  ----  --------------  ---------------------  ------------------------------"];
  for (const record of records) {
    const actor = truncateText(record.actor_label, 14) ?? "main";
    const operation = truncateText(record.operation, 21) ?? record.operation;
    const detail = truncateText(record.detail ?? record.summary, 30) ?? "";
    lines.push(
      `${formatTimestamp(record.timestamp).padEnd(9)}  ${formatSeverityTag(record.severity)}  ${actor.padEnd(14)}  ${operation.padEnd(21)}  ${detail}`,
    );
  }
  return lines.join("\n");
}

export function formatAgentSummaries(agents: AgentSummary[]): string {
  if (agents.length === 0) return "No agent telemetry found.";

  const lines = ["Actor            Kind       Events  Tools  Fail  Tasks  Last", "---------------  ---------  ------  -----  ----  -----  ---------"];
  for (const agent of agents) {
    lines.push(
      `${truncateText(agent.actor_label, 15)?.padEnd(15) ?? "main"}  ${agent.actor_kind.padEnd(9)}  ${String(agent.event_count).padStart(6)}  ${String(agent.tool_calls).padStart(5)}  ${String(agent.failures).padStart(4)}  ${String(agent.tasks_completed).padStart(5)}  ${formatTimestamp(agent.last_timestamp)}`,
    );
  }
  return lines.join("\n");
}

export function formatTaskSummaries(tasks: TaskSummary[]): string {
  if (tasks.length === 0) return "No task telemetry found.";

  const lines = ["Task             Status     Owner           Duration  Subject", "---------------  ---------  --------------  --------  ------------------------------"];
  for (const task of tasks) {
    const duration = task.duration_seconds !== undefined ? `${task.duration_seconds}s` : "-";
    lines.push(
      `${truncateText(task.task_id, 15)?.padEnd(15) ?? "task"}  ${task.status.padEnd(9)}  ${truncateText(task.owner, 14)?.padEnd(14) ?? "main"}  ${duration.padStart(8)}  ${truncateText(task.subject, 30) ?? ""}`,
    );
  }
  return lines.join("\n");
}
