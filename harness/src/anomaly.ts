/**
 * Anomaly detection engine — pattern-based detection of agent misbehavior.
 *
 * V-4: "Auto-detect anomalies (hallucination, infinite loops, cost spikes)
 *       and alert."
 *
 * Detectors analyze the event log for patterns that indicate problems:
 * - Repeated identical tool calls (infinite loops)
 * - Rapid tool switching without progress (thrashing)
 * - Cascading errors in a short window
 * - Session cost exceeding growth rate thresholds
 */
import { readFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentEvent } from "./types.js";

export type AnomalyType =
  | "infinite_loop"
  | "tool_thrashing"
  | "error_cascade"
  | "cost_spike";

export type AnomalySeverity = "warning" | "critical";

export interface Anomaly {
  type: AnomalyType;
  severity: AnomalySeverity;
  session_id: string;
  timestamp: string;
  message: string;
  evidence: {
    events: string[];       // event IDs involved
    pattern?: string;       // description of the detected pattern
    count?: number;         // repetition count
    window_seconds?: number; // time window analyzed
  };
}

export interface AnomalyConfig {
  /** Trigger after N identical tool calls in a session (default: 5) */
  loop_repeat_threshold: number;
  /** Trigger after N distinct tools in M seconds with no progress (default: 8 tools in 30s) */
  thrash_tool_count: number;
  thrash_window_seconds: number;
  /** Trigger after N errors in M seconds (default: 5 errors in 60s) */
  error_cascade_count: number;
  error_cascade_window_seconds: number;
  /** Trigger when session cost exceeds this USD value (default: 2.00) */
  cost_spike_threshold_usd: number;
}

export const DEFAULT_ANOMALY_CONFIG: AnomalyConfig = {
  loop_repeat_threshold: 5,
  thrash_tool_count: 8,
  thrash_window_seconds: 30,
  error_cascade_count: 5,
  error_cascade_window_seconds: 60,
  cost_spike_threshold_usd: 2.0,
};

/**
 * Detect infinite loops: same tool_name + tool_input appearing repeatedly.
 */
function detectInfiniteLoops(
  events: AgentEvent[],
  config: AnomalyConfig
): Anomaly[] {
  const anomalies: Anomaly[] = [];

  // Group by session
  const sessions = new Map<string, AgentEvent[]>();
  for (const e of events) {
    const list = sessions.get(e.session_id);
    if (list) list.push(e);
    else sessions.set(e.session_id, [e]);
  }

  for (const [sessionId, sessionEvents] of sessions) {
    const toolEvents = sessionEvents.filter(
      (e) => e.hook_event_type === "PostToolUse" && e.tool_name
    );

    // Track consecutive identical calls
    const signatureCounts = new Map<string, { count: number; ids: string[] }>();

    for (const e of toolEvents) {
      const sig = `${e.tool_name}::${JSON.stringify(e.tool_input ?? {})}`;
      const entry = signatureCounts.get(sig);
      if (entry) {
        entry.count++;
        entry.ids.push(e.id);
      } else {
        signatureCounts.set(sig, { count: 1, ids: [e.id] });
      }
    }

    for (const [sig, { count, ids }] of signatureCounts) {
      if (count >= config.loop_repeat_threshold) {
        const toolName = sig.split("::")[0]!;
        anomalies.push({
          type: "infinite_loop",
          severity: count >= config.loop_repeat_threshold * 2 ? "critical" : "warning",
          session_id: sessionId,
          timestamp: toolEvents[toolEvents.length - 1]?.timestamp ?? new Date().toISOString(),
          message: `Tool "${toolName}" called ${count} times with identical input`,
          evidence: {
            events: ids.slice(-10),
            pattern: sig.slice(0, 200),
            count,
          },
        });
      }
    }
  }

  return anomalies;
}

/**
 * Detect tool thrashing: rapid switching between many tools with no progress.
 * Progress is defined as a tool_use that isn't immediately followed by a failure.
 */
function detectToolThrashing(
  events: AgentEvent[],
  config: AnomalyConfig
): Anomaly[] {
  const anomalies: Anomaly[] = [];

  const sessions = new Map<string, AgentEvent[]>();
  for (const e of events) {
    const list = sessions.get(e.session_id);
    if (list) list.push(e);
    else sessions.set(e.session_id, [e]);
  }

  for (const [sessionId, sessionEvents] of sessions) {
    const toolAndErrorEvents = sessionEvents.filter(
      (e) =>
        e.hook_event_type === "PostToolUse" ||
        e.hook_event_type === "PostToolUseFailure"
    );

    // Sliding window
    for (let i = 0; i < toolAndErrorEvents.length; i++) {
      const windowStart = new Date(toolAndErrorEvents[i]!.timestamp).getTime();
      const windowEnd = windowStart + config.thrash_window_seconds * 1000;

      const windowEvents = [];
      const distinctTools = new Set<string>();

      for (let j = i; j < toolAndErrorEvents.length; j++) {
        const t = new Date(toolAndErrorEvents[j]!.timestamp).getTime();
        if (t > windowEnd) break;
        windowEvents.push(toolAndErrorEvents[j]!);
        if (toolAndErrorEvents[j]!.tool_name) {
          distinctTools.add(toolAndErrorEvents[j]!.tool_name!);
        }
      }

      if (distinctTools.size >= config.thrash_tool_count) {
        // Check for failures in the window
        const failures = windowEvents.filter(
          (e) => e.hook_event_type === "PostToolUseFailure"
        );
        const failureRate = failures.length / windowEvents.length;

        if (failureRate > 0.3) {
          anomalies.push({
            type: "tool_thrashing",
            severity: failureRate > 0.5 ? "critical" : "warning",
            session_id: sessionId,
            timestamp: windowEvents[windowEvents.length - 1]?.timestamp ?? new Date().toISOString(),
            message: `${distinctTools.size} distinct tools in ${config.thrash_window_seconds}s with ${(failureRate * 100).toFixed(0)}% failure rate`,
            evidence: {
              events: windowEvents.map((e) => e.id).slice(-10),
              pattern: [...distinctTools].join(", "),
              count: windowEvents.length,
              window_seconds: config.thrash_window_seconds,
            },
          });
          // Skip past this window to avoid duplicate detections
          i += windowEvents.length - 1;
          break;
        }
      }
    }
  }

  return anomalies;
}

/**
 * Detect error cascades: many failures in a short time window.
 */
function detectErrorCascades(
  events: AgentEvent[],
  config: AnomalyConfig
): Anomaly[] {
  const anomalies: Anomaly[] = [];

  const sessions = new Map<string, AgentEvent[]>();
  for (const e of events) {
    const list = sessions.get(e.session_id);
    if (list) list.push(e);
    else sessions.set(e.session_id, [e]);
  }

  for (const [sessionId, sessionEvents] of sessions) {
    const errors = sessionEvents.filter(
      (e) =>
        e.hook_event_type === "PostToolUseFailure" ||
        e.hook_event_type === "StopFailure"
    );

    for (let i = 0; i < errors.length; i++) {
      const windowStart = new Date(errors[i]!.timestamp).getTime();
      const windowEnd = windowStart + config.error_cascade_window_seconds * 1000;

      const windowErrors = [];
      for (let j = i; j < errors.length; j++) {
        const t = new Date(errors[j]!.timestamp).getTime();
        if (t > windowEnd) break;
        windowErrors.push(errors[j]!);
      }

      if (windowErrors.length >= config.error_cascade_count) {
        anomalies.push({
          type: "error_cascade",
          severity: windowErrors.length >= config.error_cascade_count * 2 ? "critical" : "warning",
          session_id: sessionId,
          timestamp: windowErrors[windowErrors.length - 1]?.timestamp ?? new Date().toISOString(),
          message: `${windowErrors.length} errors in ${config.error_cascade_window_seconds}s`,
          evidence: {
            events: windowErrors.map((e) => e.id).slice(-10),
            pattern: windowErrors.map((e) => e.tool_name ?? e.hook_event_type).join(" → "),
            count: windowErrors.length,
            window_seconds: config.error_cascade_window_seconds,
          },
        });
        // Skip past this window
        i += windowErrors.length - 1;
        break;
      }
    }
  }

  return anomalies;
}

/**
 * Detect cost spikes: session cost exceeding threshold.
 */
function detectCostSpikes(
  events: AgentEvent[],
  config: AnomalyConfig
): Anomaly[] {
  const anomalies: Anomaly[] = [];

  const sessions = new Map<string, AgentEvent[]>();
  for (const e of events) {
    const list = sessions.get(e.session_id);
    if (list) list.push(e);
    else sessions.set(e.session_id, [e]);
  }

  for (const [sessionId, sessionEvents] of sessions) {
    const totalCost = sessionEvents.reduce(
      (sum, e) => sum + (e.cost_usd ?? 0),
      0
    );

    if (totalCost > config.cost_spike_threshold_usd) {
      const costEvents = sessionEvents.filter((e) => e.cost_usd && e.cost_usd > 0);
      anomalies.push({
        type: "cost_spike",
        severity: totalCost > config.cost_spike_threshold_usd * 3 ? "critical" : "warning",
        session_id: sessionId,
        timestamp: costEvents[costEvents.length - 1]?.timestamp ?? sessionEvents[sessionEvents.length - 1]?.timestamp ?? new Date().toISOString(),
        message: `Session cost $${totalCost.toFixed(2)} exceeds threshold $${config.cost_spike_threshold_usd.toFixed(2)}`,
        evidence: {
          events: costEvents.map((e) => e.id).slice(-5),
          count: costEvents.length,
        },
      });
    }
  }

  return anomalies;
}

/**
 * Run all anomaly detectors against an event log.
 */
export function detectAnomalies(
  events: AgentEvent[],
  config: AnomalyConfig = DEFAULT_ANOMALY_CONFIG
): Anomaly[] {
  const all: Anomaly[] = [
    ...detectInfiniteLoops(events, config),
    ...detectToolThrashing(events, config),
    ...detectErrorCascades(events, config),
    ...detectCostSpikes(events, config),
  ];

  // Sort by timestamp descending
  all.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return all;
}

function getLogDir(): string {
  return (
    process.env.SSENRAH_LOG_DIR ??
    join(process.env.HOME ?? "~", ".ssenrah", "events")
  );
}

/**
 * Load events from the JSONL log file.
 */
function loadEventsFromLog(): AgentEvent[] {
  const logFile = join(getLogDir(), "events.jsonl");
  if (!existsSync(logFile)) return [];

  const lines = readFileSync(logFile, "utf-8").split("\n").filter(Boolean);
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

/**
 * Run anomaly detection for a session and log any findings.
 * Called by the hook after appending an event.
 */
export function checkAnomalies(sessionId: string): void {
  const events = loadEventsFromLog();
  const sessionEvents = events.filter((e) => e.session_id === sessionId);
  if (sessionEvents.length < 3) return; // Not enough data

  const anomalies = detectAnomalies(sessionEvents);
  if (anomalies.length === 0) return;

  const logDir = getLogDir();
  const logFile = join(logDir, "events.jsonl");
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }

  for (const anomaly of anomalies) {
    // Check if we already logged this type for this session (avoid duplicates)
    const alreadyLogged = events.some(
      (e) =>
        e.hook_event_type === "_anomaly" &&
        e.session_id === sessionId &&
        e.notification_type === anomaly.type
    );
    if (alreadyLogged) continue;

    const anomalyEvent: Partial<AgentEvent> = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      hook_event_type: "_anomaly",
      cwd: "",
      notification_type: anomaly.type,
      message: anomaly.message,
      _raw: anomaly as unknown as Record<string, unknown>,
    };

    appendFileSync(logFile, JSON.stringify(anomalyEvent) + "\n", "utf-8");
  }
}

/**
 * Format anomalies for CLI display.
 */
export function formatAnomalies(anomalies: Anomaly[]): string {
  if (anomalies.length === 0) {
    return "No anomalies detected.";
  }

  const lines: string[] = [];
  lines.push("╔══════════════════════════════════════════════════════╗");
  lines.push("║        ssenrah — Anomaly Detection (V-4)            ║");
  lines.push("╠══════════════════════════════════════════════════════╣");
  lines.push(`║  Anomalies found: ${String(anomalies.length).padEnd(34)} ║`);

  const critical = anomalies.filter((a) => a.severity === "critical").length;
  const warning = anomalies.filter((a) => a.severity === "warning").length;
  lines.push(`║  Critical: ${String(critical).padEnd(41)} ║`);
  lines.push(`║  Warning:  ${String(warning).padEnd(41)} ║`);
  lines.push("╚══════════════════════════════════════════════════════╝");
  lines.push("");

  for (const a of anomalies) {
    const icon = a.severity === "critical" ? "🔴" : "🟡";
    const time = new Date(a.timestamp).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

    lines.push(`  ${icon} [${a.type}] ${a.message}`);
    lines.push(`     Session: ${a.session_id.slice(0, 8)}  Time: ${time}`);
    if (a.evidence.pattern) {
      const pat = a.evidence.pattern.length > 80
        ? a.evidence.pattern.slice(0, 80) + "…"
        : a.evidence.pattern;
      lines.push(`     Pattern: ${pat}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
