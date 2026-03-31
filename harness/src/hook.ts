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
import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { redactPayload } from "./redact.js";
import { calculateSessionCost } from "./cost.js";
import { checkEscalation } from "./escalation.js";
import { checkAnomalies } from "./anomaly.js";
import type { AgentEvent, HookEventType } from "./types.js";

const SCHEMA_VERSION = 2;
const LOG_DIR =
  process.env.SSENRAH_LOG_DIR ??
  join(process.env.HOME ?? "~", ".ssenrah", "events");

const LOG_FILE = join(LOG_DIR, "events.jsonl");

/**
 * Read all of stdin as a string.
 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/**
 * Parse the hook payload from stdin. Returns null on failure.
 */
function parsePayload(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Convert a raw hook payload into a structured AgentEvent.
 */
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
  "task_id",
  "task_subject",
  "task_description",
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
]);

function extractExtras(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (NORMALIZED_KEYS.has(key)) continue;
    extras[key] = value;
  }
  return Object.keys(extras).length > 0 ? extras : undefined;
}

function toAgentEvent(payload: Record<string, unknown>): AgentEvent {
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

    // Task fields
    task_id: payload.task_id as string | undefined,
    task_subject: payload.task_subject as string | undefined,
    task_description: payload.task_description as string | undefined,

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
      (payload.config_source as string | undefined) ??
      (payload.source as string | undefined),
    file_path: payload.file_path as string | undefined,
    memory_type: payload.memory_type as string | undefined,
    load_reason: payload.load_reason as string | undefined,
    globs: payload.globs as string[] | undefined,
    trigger_file_path: payload.trigger_file_path as string | undefined,
    parent_file_path: payload.parent_file_path as string | undefined,

    extras: extractExtras(payload),

    // Preserve raw for forward compatibility
    _raw: payload,
  };
}

/**
 * Remove undefined fields from an object to keep JSONL compact.
 */
function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Append an event to the JSONL log file.
 */
function appendEvent(event: AgentEvent): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
  const line = JSON.stringify(stripUndefined(event as unknown as Record<string, unknown>)) + "\n";
  appendFileSync(LOG_FILE, line, "utf-8");
}

/**
 * Main: read stdin → parse → redact → structure → append.
 */
async function main(): Promise<void> {
  const raw = await readStdin();
  if (!raw.trim()) {
    // Empty stdin — hook called with no payload. Silently exit.
    return;
  }

  const payload = parsePayload(raw);

  if (payload === null) {
    // Malformed JSON — log the raw string as a parse error event.
    const errorEvent: AgentEvent = {
      id: randomUUID(),
      schema_version: SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      session_id: "unknown",
      hook_event_type: "_parse_error",
      cwd: "",
      error: "Failed to parse hook payload JSON",
      _raw: { raw_input: raw.slice(0, 2000) },
    };
    appendEvent(errorEvent);
    return;
  }

  const redacted = redactPayload(payload);
  const event = toAgentEvent(redacted);

  // On Stop/SessionEnd: calculate session cost from transcript
  const eventType = event.hook_event_type;
  if (
    (eventType === "Stop" || eventType === "SessionEnd") &&
    typeof payload.transcript_path === "string"
  ) {
    const cost = calculateSessionCost(payload.transcript_path as string);
    if (cost) {
      event.cost_usd = cost.cost_usd;
    }
  }

  appendEvent(event);

  // Evaluate escalation rules against accumulated session state
  try {
    checkEscalation(event.session_id);
  } catch {
    // Never let escalation failures crash the hook
  }

  // Run anomaly detection
  try {
    checkAnomalies(event.session_id);
  } catch {
    // Never let anomaly detection crash the hook
  }
}

main().catch((err) => {
  // Last resort: never crash the hook process.
  // Write error to stderr (visible in Claude Code verbose mode).
  process.stderr.write(`ssenrah-hook error: ${err}\n`);
  process.exit(0); // Exit 0 so Claude Code doesn't treat this as a hook failure.
});
