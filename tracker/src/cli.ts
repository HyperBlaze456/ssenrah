#!/usr/bin/env node
/**
 * ssenrah CLI — Read and query the agent event log.
 *
 * Commands:
 *   ssenrah summary              Recent activity summary
 *   ssenrah events               List recent events
 *   ssenrah events --type X      Filter by hook event type
 *   ssenrah events --session Y   Filter by session ID
 *   ssenrah sessions             List all sessions with event counts
 *   ssenrah timeline             Derived execution timeline
 *   ssenrah trace                Run-centric multi-agent trace
 *   ssenrah agents               Agent/subagent activity summary
 *   ssenrah tasks                Task lifecycle summary
 *   ssenrah tail                 Follow new events in real-time
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { detectAnomalies, formatAnomalies } from "./anomaly.js";
import { getCodexStatus, loadCodexEvents, syncCodexEvents } from "./codex.js";
import { calculateSessionCost, formatCost, formatTokens } from "./cost.js";
import { extractDecisionChain, formatDecisionChain } from "./reasoning.js";
import {
  deriveRunTrace,
  deriveTelemetryTimeline,
  formatAgentSummaries,
  formatRunTrace,
  formatTaskSummaries,
  formatTelemetryTimeline,
  getAuthoritativeSessionCost,
  summarizeAgents,
  summarizeTasks,
} from "./telemetry.js";
import type { AgentEvent } from "./types.js";
import { formatVerification, verifySession } from "./verify.js";

const LOG_DIR = process.env.SSENRAH_LOG_DIR ?? join(process.env.HOME ?? "~", ".ssenrah", "events");
const LOG_FILE = join(LOG_DIR, "events.jsonl");

interface EventSummary {
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

interface SessionSummary {
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

function loadEvents(): AgentEvent[] {
  const events: AgentEvent[] = [];

  if (existsSync(LOG_FILE)) {
    const lines = readFileSync(LOG_FILE, "utf-8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        events.push(JSON.parse(line) as AgentEvent);
      } catch {
        // Skip malformed lines
      }
    }
  }

  events.push(...loadCodexEvents());
  return events.sort((left, right) => {
    const timestampCompare = left.timestamp.localeCompare(right.timestamp);
    return timestampCompare !== 0 ? timestampCompare : left.id.localeCompare(right.id);
  });
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function truncate(str: string, max: number): string {
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

function findTranscriptPaths(events: AgentEvent[]): Map<string, string> {
  const sessionTranscripts = new Map<string, string>();
  for (const event of events) {
    if (event.transcript_path) {
      sessionTranscripts.set(event.session_id, event.transcript_path);
      continue;
    }
    const raw = event._raw as Record<string, unknown> | undefined;
    if (typeof raw?.transcript_path === "string") {
      sessionTranscripts.set(event.session_id, raw.transcript_path);
    }
  }
  return sessionTranscripts;
}

function computeSummary(events: AgentEvent[]): EventSummary {
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

  const sessions = new Set(events.map((event) => event.session_id));
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
    session_count: sessions.size,
    tool_uses: toolUses.length,
    errors: errors.length,
    subagents: subagents.length,
    tasks_completed: tasks.length,
    total_cost: [...sessions].reduce(
      (sum, sessionId) => sum + getAuthoritativeSessionCost(events, sessionId),
      0,
    ),
    first_event: events[0]?.timestamp ?? null,
    last_event: events[events.length - 1]?.timestamp ?? null,
    top_tools: [...toolCounts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 10),
  };
}

function summarizeSessions(events: AgentEvent[]): SessionSummary[] {
  const groupedSessions = new Map<string, { events: AgentEvent[]; tools: Map<string, number> }>();

  for (const event of events) {
    let grouped = groupedSessions.get(event.session_id);
    if (!grouped) {
      grouped = { events: [], tools: new Map() };
      groupedSessions.set(event.session_id, grouped);
    }
    grouped.events.push(event);
    if (event.hook_event_type === "PostToolUse" && event.tool_name) {
      grouped.tools.set(event.tool_name, (grouped.tools.get(event.tool_name) ?? 0) + 1);
    }
  }

  const sessions: SessionSummary[] = [];
  for (const [sessionId, grouped] of groupedSessions) {
    const first = grouped.events[0]!;
    const last = grouped.events[grouped.events.length - 1]!;
    sessions.push({
      session_id: sessionId,
      event_count: grouped.events.length,
      first_event: first.timestamp,
      last_event: last.timestamp,
      duration_seconds: Math.max(
        0,
        Math.round((new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime()) / 1000),
      ),
      tool_uses: grouped.events.filter((event) => event.hook_event_type === "PostToolUse").length,
      errors: grouped.events.filter(
        (event) => event.hook_event_type === "PostToolUseFailure" || event.hook_event_type === "StopFailure",
      ).length,
      subagents: grouped.events.filter((event) => event.hook_event_type === "SubagentStart").length,
      cost_usd: getAuthoritativeSessionCost(events, sessionId),
      top_tools: [...grouped.tools.entries()].sort((left, right) => right[1] - left[1]).slice(0, 5),
    });
  }

  return sessions.sort((left, right) => new Date(right.first_event).getTime() - new Date(left.first_event).getTime());
}

function cmdSummary(): void {
  const events = loadEvents();
  if (events.length === 0) {
    console.log("No events recorded yet. Run Claude Code with ssenrah hooks installed or use Codex with local logs enabled.");
    return;
  }

  const summary = computeSummary(events);
  const first = events[0]!;
  const last = events[events.length - 1]!;

  console.log("╔══════════════════════════════════════════╗");
  console.log("║        ssenrah — Agent Activity          ║");
  console.log("╠══════════════════════════════════════════╣");
  console.log(`║  Total events:     ${String(summary.total_events).padStart(6)}               ║`);
  console.log(`║  Sessions:         ${String(summary.session_count).padStart(6)}               ║`);
  console.log(`║  Tool uses:        ${String(summary.tool_uses).padStart(6)}               ║`);
  console.log(`║  Errors:           ${String(summary.errors).padStart(6)}               ║`);
  console.log(`║  Subagents:        ${String(summary.subagents).padStart(6)}               ║`);
  console.log(`║  Tasks completed:  ${String(summary.tasks_completed).padStart(6)}               ║`);
  console.log("╠══════════════════════════════════════════╣");
  console.log(`║  First event: ${formatTimestamp(first.timestamp).padEnd(26)} ║`);
  console.log(`║  Last event:  ${formatTimestamp(last.timestamp).padEnd(26)} ║`);
  console.log("╠══════════════════════════════════════════╣");
  console.log("║  Top tools:                              ║");

  for (const [name, count] of summary.top_tools.slice(0, 5)) {
    console.log(`║    ${truncate(name, 22).padEnd(22)} ${String(count).padStart(6)} uses  ║`);
  }

  if (summary.total_cost > 0) {
    console.log("╠══════════════════════════════════════════╣");
    console.log(`║  Est. cost:      ${formatCost(summary.total_cost).padStart(10)}               ║`);
  }

  console.log("╚══════════════════════════════════════════╝");
}

function cmdEvents(opts: { type?: string; session?: string; limit?: number }): void {
  let events = loadEvents();

  if (opts.type) {
    events = events.filter((event) => event.hook_event_type === opts.type);
  }
  if (opts.session) {
    events = events.filter((event) => event.session_id.startsWith(opts.session!));
  }

  const limit = opts.limit ?? 20;
  const recent = events.slice(-limit);

  if (recent.length === 0) {
    console.log("No matching events found.");
    return;
  }

  console.log(`Showing ${recent.length} of ${events.length} events:\n`);

  for (const event of recent) {
    const time = formatTimestamp(event.timestamp);
    const type = event.hook_event_type.padEnd(20);
    const detail = event.tool_name
      ? `tool=${event.tool_name}`
      : event.agent_type
        ? `agent=${event.agent_type}`
        : event.task_subject
          ? `task=${truncate(event.task_subject, 30)}`
          : event.notification_type
            ? `notif=${event.notification_type}`
            : event.reason ?? event.source ?? "";

    console.log(`  ${time}  ${type}  ${truncate(detail, 40)}`);
  }
}

function cmdSessions(): void {
  const sessions = summarizeSessions(loadEvents());

  if (sessions.length === 0) {
    console.log("No sessions recorded.");
    return;
  }

  console.log(`${sessions.length} sessions:\n`);
  for (const session of sessions) {
    const shortId = session.session_id.slice(0, 8);
    const mins = Math.round(session.duration_seconds / 60);
    const costStr = session.cost_usd > 0 ? `  ${formatCost(session.cost_usd)}` : "";
    console.log(`  ${shortId}  ${String(session.event_count).padStart(5)} events  ${String(mins).padStart(4)}m  started ${formatTimestamp(session.first_event)}${costStr}`);
  }
}

function cmdTail(): void {
  console.log("Tailing events (Ctrl+C to stop):\n");
  const seenEventIds = new Set(loadEvents().map((event) => event.id));

  setInterval(() => {
    const newEvents = loadEvents().filter((event) => !seenEventIds.has(event.id));
    for (const event of newEvents) {
      const time = formatTimestamp(event.timestamp);
      const type = event.hook_event_type.padEnd(20);
      const detail = event.tool_name ?? event.agent_type ?? event.notification_type ?? "";
      console.log(`  ${time}  ${type}  ${detail}`);
      seenEventIds.add(event.id);
    }
  }, 500);
}

function cmdCost(opts: { session?: string }): void {
  const events = loadEvents();
  const sessionTranscripts = findTranscriptPaths(events);

  if (sessionTranscripts.size === 0) {
    console.log("No sessions with transcript data found.");
    return;
  }

  const entries = opts.session
    ? [...sessionTranscripts.entries()].filter(([id]) => id.startsWith(opts.session!))
    : [...sessionTranscripts.entries()];

  if (entries.length === 0) {
    console.log("No matching sessions found.");
    return;
  }

  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║            ssenrah — Session Cost Report            ║");
  console.log("╠══════════════════════════════════════════════════════╣");

  let grandTotal = 0;
  for (const [sessionId, transcriptPath] of entries) {
    const cost = calculateSessionCost(transcriptPath);
    if (!cost) continue;

    grandTotal += cost.cost_usd;
    const shortId = sessionId.slice(0, 8);
    console.log(`║  Session: ${shortId}                                      ║`);
    console.log(`║    Model:          ${cost.model.padEnd(32)} ║`);
    console.log(`║    Input tokens:   ${formatTokens(cost.input_tokens).padEnd(32)} ║`);
    console.log(`║    Output tokens:  ${formatTokens(cost.output_tokens).padEnd(32)} ║`);
    console.log(`║    Cache read:     ${formatTokens(cost.cache_read_input_tokens).padEnd(32)} ║`);
    console.log(`║    Cache created:  ${formatTokens(cost.cache_creation_input_tokens).padEnd(32)} ║`);
    console.log(`║    Total tokens:   ${formatTokens(cost.total_tokens).padEnd(32)} ║`);
    console.log(`║    Est. cost:      ${formatCost(cost.cost_usd).padEnd(32)} ║`);
    console.log("╠══════════════════════════════════════════════════════╣");
  }

  console.log(`║  Grand total:      ${formatCost(grandTotal).padEnd(32)} ║`);
  console.log("╚══════════════════════════════════════════════════════╝");
}

function cmdVerify(opts: { session?: string }): void {
  const events = loadEvents();
  if (events.length === 0) {
    console.log("No events recorded yet.");
    return;
  }

  let sessionId: string;
  if (opts.session) {
    const match = events.find((event) => event.session_id.startsWith(opts.session!));
    if (!match) {
      console.log("No matching session found.");
      return;
    }
    sessionId = match.session_id;
  } else {
    const sessions = [...new Set(events.map((event) => event.session_id))];
    sessionId = sessions[sessions.length - 1]!;
  }

  console.log(formatVerification(verifySession(events, sessionId)));
}

function cmdAnomalies(opts: { session?: string }): void {
  let events = loadEvents();
  if (opts.session) {
    events = events.filter((event) => event.session_id.startsWith(opts.session!));
  }

  if (events.length === 0) {
    console.log("No events found.");
    return;
  }

  console.log(formatAnomalies(detectAnomalies(events)));
}

function cmdReasoning(opts: { session?: string; limit?: number }): void {
  const events = loadEvents();
  const sessionTranscripts = findTranscriptPaths(events);

  if (sessionTranscripts.size === 0) {
    console.log("No sessions with transcript data found.");
    return;
  }

  const entries = opts.session
    ? [...sessionTranscripts.entries()].filter(([id]) => id.startsWith(opts.session!))
    : [...sessionTranscripts.entries()].slice(-1);

  if (entries.length === 0) {
    console.log("No matching sessions found.");
    return;
  }

  for (const [, transcriptPath] of entries) {
    const chain = extractDecisionChain(transcriptPath);
    if (!chain) {
      console.log("No reasoning data found in transcript.");
      continue;
    }

    if (opts.limit && chain.steps.length > opts.limit) {
      chain.steps = chain.steps.slice(-opts.limit);
    }

    console.log(formatDecisionChain(chain));
  }
}

function cmdTimeline(opts: { session?: string; actor?: string; limit?: number }): void {
  console.log(formatTelemetryTimeline(deriveTelemetryTimeline(loadEvents(), opts)));
}

function cmdAgents(opts: { session?: string }): void {
  console.log(formatAgentSummaries(summarizeAgents(loadEvents(), opts)));
}

function cmdTasks(opts: { session?: string }): void {
  console.log(formatTaskSummaries(summarizeTasks(loadEvents(), opts)));
}

function cmdCodex(args: string[]): void {
  const sub = args[0];
  if (!sub || sub === "help" || sub === "--help") {
    console.log("Usage: ssenrah codex <status | sync>");
    console.log("");
    console.log("  status                Show where Codex data is being read from and what's there");
    console.log("  sync                  Import all detected Codex sessions into the JSONL log");
    console.log("    --since ISO_TIME    Only sync events at or after the given timestamp");
    console.log("    --codex-dir PATH    Override SSENRAH_CODEX_DIR for this run");
    console.log("    --log PATH          Override the destination JSONL log file");
    return;
  }

  if (sub === "status") {
    let codexInput: string | undefined;
    for (let i = 1; i < args.length; i += 1) {
      if (args[i] === "--codex-dir" && args[i + 1]) codexInput = args[++i];
    }
    const status = getCodexStatus(codexInput);
    console.log("ssenrah — Codex status");
    console.log("======================");
    console.log(`  Enabled:                  ${status.enabled ? "yes" : "no"}`);
    console.log(`  Resolved Codex home:      ${status.resolved ? "yes" : "no"}`);
    if (status.codex_dir) console.log(`  Codex dir:                ${status.codex_dir}`);
    if (status.sessions_dir) console.log(`  Sessions dir:             ${status.sessions_dir}`);
    if (status.state_db) console.log(`  State DB:                 ${status.state_db}`);
    console.log(`  Rollout files:            ${status.rollout_count}`);
    console.log(`  Threads (state DB):       ${status.thread_count}`);
    if (status.latest_thread_updated_at) {
      console.log(`  Latest thread updated:    ${status.latest_thread_updated_at}`);
    }
    if (status.recent_threads.length > 0) {
      console.log("");
      console.log("  Recent threads:");
      for (const thread of status.recent_threads) {
        const archived = thread.archived ? " [archived]" : "";
        console.log(`    ${thread.id.slice(0, 12)}  ${thread.model ?? "?".padEnd(20)}  ${thread.updated_at}${archived}`);
        if (thread.title) console.log(`      ${truncate(thread.title, 70)}`);
      }
    }
    if (status.notes.length > 0) {
      console.log("");
      console.log("  Notes:");
      for (const note of status.notes) console.log(`    - ${note}`);
    }
    return;
  }

  if (sub === "sync") {
    let since: string | undefined;
    let codexInput: string | undefined;
    let logFile: string | undefined;
    for (let i = 1; i < args.length; i += 1) {
      if (args[i] === "--since" && args[i + 1]) since = args[++i];
      else if (args[i] === "--codex-dir" && args[i + 1]) codexInput = args[++i];
      else if (args[i] === "--log" && args[i + 1]) logFile = args[++i];
    }

    const result = syncCodexEvents({ codexInput, logFile, since });
    console.log("ssenrah — Codex sync");
    console.log("====================");
    console.log(`  Log file:                 ${result.log_file}`);
    console.log(`  Detected Codex events:    ${result.total_codex_events}`);
    console.log(`  Appended (new):           ${result.appended}`);
    console.log(`  Skipped (already synced): ${result.skipped_existing}`);
    if (result.skipped_filtered > 0) {
      console.log(`  Skipped (--since filter): ${result.skipped_filtered}`);
    }
    return;
  }

  console.log(`Unknown codex subcommand: ${sub}`);
  console.log("Try: ssenrah codex --help");
}

function cmdTrace(opts: { session?: string; prompt?: string }): void {
  const events = loadEvents();
  const sessions = summarizeSessions(events);
  const sessionQuery = opts.session;
  const sessionId = sessionQuery
    ? sessions.find((session) => session.session_id.startsWith(sessionQuery!))?.session_id
    : sessions[0]?.session_id;

  if (!sessionId) {
    console.log("No matching session found.");
    return;
  }

  const runTrace = deriveRunTrace(events, sessionId, { promptSliceId: opts.prompt });
  if (!runTrace) {
    console.log("No run trace available for that session.");
    return;
  }

  console.log(formatRunTrace(runTrace));
}

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case undefined:
    case "summary":
      cmdSummary();
      break;

    case "events": {
      const opts: { type?: string; session?: string; limit?: number } = {};
      for (let i = 1; i < args.length; i += 1) {
        if (args[i] === "--type" && args[i + 1]) opts.type = args[++i];
        else if (args[i] === "--session" && args[i + 1]) opts.session = args[++i];
        else if (args[i] === "--limit" && args[i + 1]) opts.limit = parseInt(args[++i]!, 10);
      }
      cmdEvents(opts);
      break;
    }

    case "sessions":
      cmdSessions();
      break;

    case "timeline": {
      const opts: { session?: string; actor?: string; limit?: number } = {};
      for (let i = 1; i < args.length; i += 1) {
        if (args[i] === "--session" && args[i + 1]) opts.session = args[++i];
        else if (args[i] === "--actor" && args[i + 1]) opts.actor = args[++i];
        else if (args[i] === "--limit" && args[i + 1]) opts.limit = parseInt(args[++i]!, 10);
      }
      cmdTimeline(opts);
      break;
    }

    case "trace":
    case "run-trace": {
      const opts: { session?: string; prompt?: string } = {};
      for (let i = 1; i < args.length; i += 1) {
        if (args[i] === "--session" && args[i + 1]) opts.session = args[++i];
        else if (args[i] === "--prompt" && args[i + 1]) opts.prompt = args[++i];
      }
      cmdTrace(opts);
      break;
    }

    case "agents": {
      const opts: { session?: string } = {};
      for (let i = 1; i < args.length; i += 1) {
        if (args[i] === "--session" && args[i + 1]) opts.session = args[++i];
      }
      cmdAgents(opts);
      break;
    }

    case "tasks": {
      const opts: { session?: string } = {};
      for (let i = 1; i < args.length; i += 1) {
        if (args[i] === "--session" && args[i + 1]) opts.session = args[++i];
      }
      cmdTasks(opts);
      break;
    }

    case "cost": {
      const opts: { session?: string } = {};
      for (let i = 1; i < args.length; i += 1) {
        if (args[i] === "--session" && args[i + 1]) opts.session = args[++i];
      }
      cmdCost(opts);
      break;
    }

    case "tail":
      cmdTail();
      break;

    case "reasoning": {
      const opts: { session?: string; limit?: number } = {};
      for (let i = 1; i < args.length; i += 1) {
        if (args[i] === "--session" && args[i + 1]) opts.session = args[++i];
        else if (args[i] === "--limit" && args[i + 1]) opts.limit = parseInt(args[++i]!, 10);
      }
      cmdReasoning(opts);
      break;
    }

    case "anomalies": {
      const opts: { session?: string } = {};
      for (let i = 1; i < args.length; i += 1) {
        if (args[i] === "--session" && args[i + 1]) opts.session = args[++i];
      }
      cmdAnomalies(opts);
      break;
    }

    case "verify": {
      const opts: { session?: string } = {};
      for (let i = 1; i < args.length; i += 1) {
        if (args[i] === "--session" && args[i + 1]) opts.session = args[++i];
      }
      cmdVerify(opts);
      break;
    }

    case "codex":
      cmdCodex(args.slice(1));
      break;

    default:
      console.log("Usage: ssenrah [summary | events | sessions | timeline | trace | agents | tasks | cost | reasoning | anomalies | verify | tail | codex]");
      console.log("");
      console.log("Commands:");
      console.log("  summary              Activity overview (default)");
      console.log("  events               List recent events");
      console.log("    --type TYPE        Filter by hook event type");
      console.log("    --session ID       Filter by session ID (prefix match)");
      console.log("    --limit N          Number of events to show (default: 20)");
      console.log("  sessions             List all sessions");
      console.log("  timeline             Normalized event timeline");
      console.log("    --session ID       Filter by session ID (prefix match)");
      console.log("    --actor ID         Filter by actor id/label");
      console.log("    --limit N          Number of timeline rows to show");
      console.log("  trace                Run-centric multi-agent trace");
      console.log("    --session ID       Filter by session ID (prefix match)");
      console.log("    --prompt ID        Filter to a prompt slice id");
      console.log("  agents               Summarize activity by main agent/subagent");
      console.log("    --session ID       Filter by session ID (prefix match)");
      console.log("  tasks                Summarize task lifecycle");
      console.log("    --session ID       Filter by session ID (prefix match)");
      console.log("  cost                 Session cost breakdown (from transcripts)");
      console.log("    --session ID       Cost for a specific session");
      console.log("  reasoning            Decision chain from transcripts");
      console.log("    --session ID       Reasoning for a specific session");
      console.log("    --limit N          Max turns to display (default: all)");
      console.log("  anomalies            Detect agent behavior anomalies");
      console.log("    --session ID       Check a specific session");
      console.log("  verify               Session verification report");
      console.log("    --session ID       Verify a specific session");
      console.log("  tail                 Follow new events in real-time");
      console.log("  codex                Codex bridge (status / sync into the JSONL log)");
      console.log("    status             Show resolved Codex paths, schema, and recent threads");
      console.log("    sync               Append all detected Codex events into ~/.ssenrah/events.jsonl");
      break;
  }
}

main();
