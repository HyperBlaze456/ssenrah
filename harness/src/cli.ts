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
 *   ssenrah tail                 Follow new events in real-time
 */
import { readFileSync, existsSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import type { AgentEvent } from "./types.js";
import { calculateSessionCost, formatCost, formatTokens } from "./cost.js";

const LOG_DIR =
  process.env.SSENRAH_LOG_DIR ??
  join(process.env.HOME ?? "~", ".ssenrah", "events");

const LOG_FILE = join(LOG_DIR, "events.jsonl");

function loadEvents(): AgentEvent[] {
  if (!existsSync(LOG_FILE)) return [];
  const lines = readFileSync(LOG_FILE, "utf-8").split("\n").filter(Boolean);
  const events: AgentEvent[] = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as AgentEvent);
    } catch {
      // Skip malformed lines
    }
  }
  return events;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

// ── Commands ──────────────────────────────────────────

function cmdSummary(): void {
  const events = loadEvents();
  if (events.length === 0) {
    console.log("No events recorded yet. Run Claude Code with ssenrah hooks installed.");
    return;
  }

  const sessions = new Set(events.map((e) => e.session_id));
  const toolUses = events.filter((e) => e.hook_event_type === "PostToolUse");
  const errors = events.filter((e) => e.hook_event_type === "PostToolUseFailure" || e.hook_event_type === "StopFailure");
  const subagents = events.filter((e) => e.hook_event_type === "SubagentStart");
  const tasks = events.filter((e) => e.hook_event_type === "TaskCompleted");

  // Tool usage breakdown
  const toolCounts = new Map<string, number>();
  for (const e of toolUses) {
    const name = e.tool_name ?? "unknown";
    toolCounts.set(name, (toolCounts.get(name) ?? 0) + 1);
  }

  const first = events[0]!;
  const last = events[events.length - 1]!;

  console.log("╔══════════════════════════════════════════╗");
  console.log("║        ssenrah — Agent Activity          ║");
  console.log("╠══════════════════════════════════════════╣");
  console.log(`║  Total events:     ${String(events.length).padStart(6)}               ║`);
  console.log(`║  Sessions:         ${String(sessions.size).padStart(6)}               ║`);
  console.log(`║  Tool uses:        ${String(toolUses.length).padStart(6)}               ║`);
  console.log(`║  Errors:           ${String(errors.length).padStart(6)}               ║`);
  console.log(`║  Subagents:        ${String(subagents.length).padStart(6)}               ║`);
  console.log(`║  Tasks completed:  ${String(tasks.length).padStart(6)}               ║`);
  console.log("╠══════════════════════════════════════════╣");
  console.log(`║  First event: ${formatTimestamp(first.timestamp).padEnd(26)} ║`);
  console.log(`║  Last event:  ${formatTimestamp(last.timestamp).padEnd(26)} ║`);
  console.log("╠══════════════════════════════════════════╣");
  console.log("║  Top tools:                              ║");

  // Cost from events that have cost_usd (Stop/SessionEnd events)
  const totalCost = events.reduce((sum, e) => sum + (e.cost_usd ?? 0), 0);

  const sorted = [...toolCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  for (const [name, count] of sorted) {
    console.log(`║    ${truncate(name, 22).padEnd(22)} ${String(count).padStart(6)} uses  ║`);
  }

  if (totalCost > 0) {
    console.log("╠══════════════════════════════════════════╣");
    console.log(`║  Est. cost:      ${formatCost(totalCost).padStart(10)}               ║`);
  }

  console.log("╚══════════════════════════════════════════╝");
}

function cmdEvents(opts: { type?: string; session?: string; limit?: number }): void {
  let events = loadEvents();

  if (opts.type) {
    events = events.filter((e) => e.hook_event_type === opts.type);
  }
  if (opts.session) {
    events = events.filter((e) => e.session_id.startsWith(opts.session!));
  }

  const limit = opts.limit ?? 20;
  const recent = events.slice(-limit);

  if (recent.length === 0) {
    console.log("No matching events found.");
    return;
  }

  console.log(`Showing ${recent.length} of ${events.length} events:\n`);

  for (const e of recent) {
    const time = formatTimestamp(e.timestamp);
    const type = e.hook_event_type.padEnd(20);
    const detail = e.tool_name
      ? `tool=${e.tool_name}`
      : e.agent_type
        ? `agent=${e.agent_type}`
        : e.task_subject
          ? `task=${truncate(e.task_subject, 30)}`
          : e.notification_type
            ? `notif=${e.notification_type}`
            : e.reason ?? e.source ?? "";

    console.log(`  ${time}  ${type}  ${truncate(detail, 40)}`);
  }
}

function cmdSessions(): void {
  const events = loadEvents();
  const sessions = new Map<string, { count: number; first: string; last: string; types: Set<string>; cost: number }>();

  for (const e of events) {
    const s = sessions.get(e.session_id);
    if (s) {
      s.count++;
      s.last = e.timestamp;
      s.types.add(e.hook_event_type);
      s.cost += e.cost_usd ?? 0;
    } else {
      sessions.set(e.session_id, {
        count: 1,
        first: e.timestamp,
        last: e.timestamp,
        types: new Set([e.hook_event_type]),
        cost: e.cost_usd ?? 0,
      });
    }
  }

  if (sessions.size === 0) {
    console.log("No sessions recorded.");
    return;
  }

  console.log(`${sessions.size} sessions:\n`);

  for (const [id, s] of sessions) {
    const shortId = id.slice(0, 8);
    const duration = new Date(s.last).getTime() - new Date(s.first).getTime();
    const mins = Math.round(duration / 60000);
    const costStr = s.cost > 0 ? `  ${formatCost(s.cost)}` : "";
    console.log(`  ${shortId}  ${String(s.count).padStart(5)} events  ${String(mins).padStart(4)}m  started ${formatTimestamp(s.first)}${costStr}`);
  }
}

function cmdTail(): void {
  if (!existsSync(LOG_FILE)) {
    console.log("No log file yet. Waiting for events...\n");
  }

  console.log("Tailing events (Ctrl+C to stop):\n");

  let lastSize = existsSync(LOG_FILE) ? statSync(LOG_FILE).size : 0;

  setInterval(() => {
    if (!existsSync(LOG_FILE)) return;
    const currentSize = statSync(LOG_FILE).size;
    if (currentSize <= lastSize) return;

    const fd = openSync(LOG_FILE, "r");
    const buf = Buffer.alloc(currentSize - lastSize);
    readSync(fd, buf, 0, buf.length, lastSize);
    closeSync(fd);

    const newLines = buf.toString("utf-8").split("\n").filter(Boolean);
    for (const line of newLines) {
      try {
        const e = JSON.parse(line) as AgentEvent;
        const time = formatTimestamp(e.timestamp);
        const type = e.hook_event_type.padEnd(20);
        const detail = e.tool_name ?? e.agent_type ?? e.notification_type ?? "";
        console.log(`  ${time}  ${type}  ${detail}`);
      } catch {
        // skip
      }
    }

    lastSize = currentSize;
  }, 500);
}

function cmdCost(opts: { session?: string }): void {
  const events = loadEvents();

  // Find sessions with transcript paths from _raw
  const sessionTranscripts = new Map<string, string>();
  for (const e of events) {
    const raw = e._raw as Record<string, unknown> | undefined;
    if (raw?.transcript_path && typeof raw.transcript_path === "string") {
      sessionTranscripts.set(e.session_id, raw.transcript_path);
    }
  }

  if (sessionTranscripts.size === 0) {
    console.log("No sessions with transcript data found.");
    return;
  }

  // Filter to specific session if requested
  const entries = opts.session
    ? [...sessionTranscripts.entries()].filter(([id]) =>
        id.startsWith(opts.session!)
      )
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

    const shortId = sessionId.slice(0, 8);
    grandTotal += cost.cost_usd;

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

// ── Argument parsing ──────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "summary":
    case undefined:
      cmdSummary();
      break;

    case "events": {
      const opts: { type?: string; session?: string; limit?: number } = {};
      for (let i = 1; i < args.length; i++) {
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

    case "cost": {
      const costOpts: { session?: string } = {};
      for (let i = 1; i < args.length; i++) {
        if (args[i] === "--session" && args[i + 1]) costOpts.session = args[++i];
      }
      cmdCost(costOpts);
      break;
    }

    case "tail":
      cmdTail();
      break;

    default:
      console.log("Usage: ssenrah [summary | events | sessions | cost | tail]");
      console.log("");
      console.log("Commands:");
      console.log("  summary              Activity overview (default)");
      console.log("  events               List recent events");
      console.log("    --type TYPE        Filter by hook event type");
      console.log("    --session ID       Filter by session ID (prefix match)");
      console.log("    --limit N          Number of events to show (default: 20)");
      console.log("  sessions             List all sessions");
      console.log("  cost                 Session cost breakdown (from transcripts)");
      console.log("    --session ID       Cost for a specific session");
      console.log("  tail                 Follow new events in real-time");
      break;
  }
}

main();
