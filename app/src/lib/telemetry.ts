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
        detail: truncateText([event.reason, event.agent_transcript_path].filter(Boolean).join(" · ")),
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
