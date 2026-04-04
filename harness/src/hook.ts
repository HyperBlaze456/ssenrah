#!/usr/bin/env node
/**
 * ssenrah-hook — Single entrypoint for all Claude Code hook events.
 *
 * Reads the hook payload from stdin (JSON), redacts sensitive fields,
 * and appends a structured event line to the JSONL log file.
 *
 * Usage in .claude/settings.json:
 *   "hooks": {
 *     "PostToolUse": [{ "type": "command", "command": "ssenrah-hook", "async": true }],
 *     "SessionStart": [{ "type": "command", "command": "ssenrah-hook", "async": true }],
 *     ...
 *   }
 */
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { checkAnomalies } from "./anomaly.js";
import { calculateSessionCost } from "./cost.js";
import { checkEscalation } from "./escalation.js";
import { redactPayload } from "./redact.js";
import type {
  AgentEvent,
  BranchKind,
  EffectLevel,
  HookEventType,
  RunOutcome,
  ToolCategory,
} from "./types.js";

const SCHEMA_VERSION = 3;
const LOG_DIR =
  process.env.SSENRAH_LOG_DIR ?? join(process.env.HOME ?? "~", ".ssenrah", "events");
const LOG_FILE = join(LOG_DIR, "events.jsonl");

const NORMALIZED_KEYS = new Set([
  "session_id",
  "transcript_path",
  "cwd",
  "hook_event_name",
  "permission_mode",
  "tool_name",
  "tool_input",
  "tool_use_id",
  "tool_response",
  "error",
  "agent_id",
  "agent_type",
  "model",
  "root_run_id",
  "parent_run_id",
  "spawn_parent_agent_id",
  "spawn_parent_event_id",
  "branch_kind",
  "task_id",
  "task_subject",
  "task_description",
  "prompt_segment_id",
  "duration_ms",
  "outcome",
  "failure_class",
  "tool_category",
  "effect_level",
  "collapsed_by_default",
  "approval_state",
  "approval_request_id",
  "policy_name",
  "teammate_name",
  "team_name",
  "notification_type",
  "title",
  "message",
  "prompt",
  "source",
  "reason",
  "trigger",
  "compact_summary",
  "mcp_server_name",
  "stop_hook_active",
  "last_assistant_message",
  "config_source",
  "file_path",
  "memory_type",
  "load_reason",
  "globs",
  "trigger_file_path",
  "parent_file_path",
  "old_cwd",
  "new_cwd",
  "event",
  "worktree_path",
  "agent_transcript_path",
  "requested_schema",
  "mode",
  "url",
  "action",
  "content",
  "elicitation_id",
  "error_details",
  "cost_usd",
]);

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

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function parsePayload(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractExtras(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (NORMALIZED_KEYS.has(key)) continue;
    extras[key] = value;
  }
  return Object.keys(extras).length > 0 ? extras : undefined;
}

function normalizeToolName(toolName: string | undefined): string {
  return toolName?.trim().toLowerCase() ?? "";
}

function deriveToolCategory(payload: Record<string, unknown>): ToolCategory | undefined {
  const toolName = normalizeToolName(payload.tool_name as string | undefined);
  if (!toolName) {
    const hookEventType = String(payload.hook_event_name ?? "");
    if (
      hookEventType === "UserPromptSubmit" ||
      hookEventType === "TaskCreated" ||
      hookEventType === "TaskCompleted" ||
      hookEventType === "SubagentStart" ||
      hookEventType === "SubagentStop"
    ) {
      return "coordination";
    }
    if (hookEventType === "PermissionRequest" || hookEventType.startsWith("Elicitation")) {
      return "approval";
    }
    return undefined;
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

function deriveEffectLevel(payload: Record<string, unknown>, toolCategory: ToolCategory | undefined): EffectLevel | undefined {
  const hookEventType = String(payload.hook_event_name ?? "");
  if (
    hookEventType === "PostToolUseFailure" ||
    hookEventType === "StopFailure" ||
    hookEventType === "_parse_error"
  ) {
    return "failure_or_anomaly";
  }
  if (
    hookEventType === "PermissionRequest" ||
    hookEventType === "Elicitation" ||
    hookEventType === "ElicitationResult"
  ) {
    return "safety_or_policy";
  }
  if (toolCategory === "inspection") return "inspection_only";
  if (toolCategory === "filesystem" || hookEventType === "FileChanged") {
    return "significant_side_effect";
  }
  if (toolCategory === "command" || toolCategory === "network" || toolCategory === "mcp") {
    return "significant_side_effect";
  }
  if (toolCategory === "approval") {
    return "safety_or_policy";
  }
  if (
    hookEventType === "UserPromptSubmit" ||
    hookEventType === "TaskCreated" ||
    hookEventType === "TaskCompleted" ||
    hookEventType === "SubagentStart" ||
    hookEventType === "SubagentStop" ||
    hookEventType === "SessionStart" ||
    hookEventType === "SessionEnd" ||
    hookEventType === "Stop"
  ) {
    return "reasoning_or_coordination";
  }
  if (toolCategory === "coordination") return "reasoning_or_coordination";
  return "reasoning_or_coordination";
}

function deriveBranchKind(payload: Record<string, unknown>): BranchKind {
  if (typeof payload.branch_kind === "string") {
    return payload.branch_kind as BranchKind;
  }
  if (payload.agent_id) return "subagent";
  if (payload.team_name) return "team";
  if (payload.teammate_name) return "teammate";
  if (String(payload.hook_event_name ?? "").startsWith("_")) return "system";
  return "main";
}

function deriveOutcome(payload: Record<string, unknown>): RunOutcome | undefined {
  const hookEventType = String(payload.hook_event_name ?? "");
  if (hookEventType === "PostToolUseFailure" || hookEventType === "StopFailure") return "failed";
  if (hookEventType === "SubagentStop") {
    const reason = String(payload.reason ?? "").toLowerCase();
    if (reason.includes("cancel")) return "cancelled";
    if (reason.includes("fail") || reason.includes("error")) return "failed";
    return "completed";
  }
  if (hookEventType === "SessionEnd" || hookEventType === "TaskCompleted") return "completed";
  if (hookEventType === "Stop") {
    const reason = String(payload.reason ?? "").toLowerCase();
    if (reason.includes("cancel")) return "cancelled";
    return "completed";
  }
  if (hookEventType === "SubagentStart" || hookEventType === "TaskCreated" || hookEventType === "SessionStart") {
    return "active";
  }
  return undefined;
}

function toAgentEvent(payload: Record<string, unknown>): AgentEvent {
  const toolCategory =
    (payload.tool_category as ToolCategory | undefined) ?? deriveToolCategory(payload);
  const effectLevel =
    (payload.effect_level as EffectLevel | undefined) ?? deriveEffectLevel(payload, toolCategory);
  const branchKind = deriveBranchKind(payload);
  const failureClass =
    (payload.failure_class as string | undefined) ??
    (String(payload.hook_event_name ?? "").includes("Failure") ? String(payload.hook_event_name) : undefined);

  return {
    id: randomUUID(),
    schema_version: SCHEMA_VERSION,
    timestamp: new Date().toISOString(),
    session_id: String(payload.session_id ?? "unknown"),
    transcript_path: payload.transcript_path as string | undefined,
    hook_event_type: String(payload.hook_event_name ?? "unknown") as HookEventType,
    cwd: String(payload.cwd ?? ""),
    permission_mode: payload.permission_mode as string | undefined,

    // Tool fields
    tool_name: payload.tool_name as string | undefined,
    tool_input: payload.tool_input as Record<string, unknown> | undefined,
    tool_use_id: payload.tool_use_id as string | undefined,
    tool_response: payload.tool_response as unknown,
    error: payload.error as string | undefined,

    // Agent fields
    agent_id: payload.agent_id as string | undefined,
    agent_type: payload.agent_type as string | undefined,
    model: payload.model as string | undefined,
    root_run_id: (payload.root_run_id as string | undefined) ?? String(payload.session_id ?? "unknown"),
    parent_run_id: payload.parent_run_id as string | undefined,
    spawn_parent_agent_id: payload.spawn_parent_agent_id as string | undefined,
    spawn_parent_event_id: payload.spawn_parent_event_id as string | undefined,
    branch_kind: branchKind,

    // Task fields
    task_id: payload.task_id as string | undefined,
    task_subject: payload.task_subject as string | undefined,
    task_description: payload.task_description as string | undefined,
    prompt_segment_id: payload.prompt_segment_id as string | undefined,

    // Derived execution metadata
    duration_ms: payload.duration_ms as number | undefined,
    outcome: (payload.outcome as RunOutcome | undefined) ?? deriveOutcome(payload),
    failure_class: failureClass,
    tool_category: toolCategory,
    effect_level: effectLevel,
    collapsed_by_default:
      (payload.collapsed_by_default as boolean | undefined) ??
      (effectLevel === "inspection_only" ||
        (branchKind === "subagent" && effectLevel === "reasoning_or_coordination")),
    approval_state: payload.approval_state as string | undefined,
    approval_request_id: payload.approval_request_id as string | undefined,
    policy_name: payload.policy_name as string | undefined,

    // Teammate fields
    teammate_name: payload.teammate_name as string | undefined,
    team_name: payload.team_name as string | undefined,

    // Notification
    notification_type: payload.notification_type as string | undefined,
    title: payload.title as string | undefined,
    message: payload.message as string | undefined,
    prompt: payload.prompt as string | undefined,

    // Session lifecycle
    source: payload.source as string | undefined,
    reason: payload.reason as string | undefined,
    old_cwd: payload.old_cwd as string | undefined,
    new_cwd: payload.new_cwd as string | undefined,
    event: payload.event as string | undefined,
    worktree_path: payload.worktree_path as string | undefined,
    agent_transcript_path: payload.agent_transcript_path as string | undefined,

    // Compact
    trigger: payload.trigger as string | undefined,
    compact_summary: payload.compact_summary as string | undefined,

    // MCP
    mcp_server_name: payload.mcp_server_name as string | undefined,
    requested_schema: payload.requested_schema as Record<string, unknown> | undefined,
    mode: payload.mode as string | undefined,
    url: payload.url as string | undefined,
    action: payload.action as string | undefined,
    content: payload.content as unknown,
    elicitation_id: payload.elicitation_id as string | undefined,

    // Stop
    stop_hook_active: payload.stop_hook_active as boolean | undefined,
    last_assistant_message: payload.last_assistant_message as string | undefined,
    error_details: payload.error_details as unknown,

    // Config
    config_source:
      (payload.config_source as string | undefined) ?? (payload.source as string | undefined),
    file_path: payload.file_path as string | undefined,
    memory_type: payload.memory_type as string | undefined,
    load_reason: payload.load_reason as string | undefined,
    globs: payload.globs as string[] | undefined,
    trigger_file_path: payload.trigger_file_path as string | undefined,
    parent_file_path: payload.parent_file_path as string | undefined,

    extras: extractExtras(payload),
    _raw: payload,
  };
}

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function appendEvent(event: AgentEvent): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
  const line = JSON.stringify(stripUndefined(event as unknown as Record<string, unknown>)) + "\n";
  appendFileSync(LOG_FILE, line, "utf-8");
}

async function main(): Promise<void> {
  const raw = await readStdin();
  if (!raw.trim()) {
    return;
  }

  const payload = parsePayload(raw);

  if (payload === null) {
    const errorEvent: AgentEvent = {
      id: randomUUID(),
      schema_version: SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      session_id: "unknown",
      hook_event_type: "_parse_error",
      cwd: "",
      error: "Failed to parse hook payload JSON",
      outcome: "failed",
      failure_class: "parse_error",
      effect_level: "failure_or_anomaly",
      branch_kind: "system",
      _raw: { raw_input: raw.slice(0, 2000) },
    };
    appendEvent(errorEvent);
    return;
  }

  const redacted = redactPayload(payload);
  const event = toAgentEvent(redacted);

  if (
    (event.hook_event_type === "Stop" || event.hook_event_type === "SessionEnd") &&
    typeof payload.transcript_path === "string"
  ) {
    const cost = calculateSessionCost(payload.transcript_path as string);
    if (cost) {
      event.cost_usd = cost.cost_usd;
    }
  }

  appendEvent(event);

  try {
    checkEscalation(event.session_id);
  } catch {
    // Never let escalation failures crash the hook
  }

  try {
    checkAnomalies(event.session_id);
  } catch {
    // Never let anomaly detection crash the hook
  }
}

main().catch((err) => {
  process.stderr.write(`ssenrah-hook error: ${err}\n`);
  process.exit(0);
});
