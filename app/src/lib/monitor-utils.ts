import type { AgentEvent, SessionSummary } from "@/types";
import { getAuthoritativeSessionCost } from "@/lib/telemetry";

export type MonitorSeverity = "info" | "warning" | "critical";
export type MonitorBadgeVariant = "secondary" | "outline" | "destructive";
export type AnomalyType =
  | "infinite_loop"
  | "tool_thrashing"
  | "error_cascade"
  | "cost_spike";

export interface MonitorAnomaly {
  type: AnomalyType;
  severity: Exclude<MonitorSeverity, "info">;
  session_id: string;
  timestamp: string;
  message: string;
  evidence: {
    events: string[];
    pattern?: string;
    count?: number;
    window_seconds?: number;
  };
}

export interface EscalationAlertSummary {
  key: string;
  session_id: string;
  rule_name: string;
  condition: string;
  threshold: number | null;
  latest_actual: number | null;
  peak_actual: number | null;
  occurrences: number;
  first_timestamp: string;
  last_timestamp: string;
  message: string;
  severity: Exclude<MonitorSeverity, "info">;
  alerts: AgentEvent[];
}

const LOOP_THRESHOLD = 5;
const THRASH_TOOL_COUNT = 8;
const THRASH_WINDOW_MS = 30000;
const ERROR_CASCADE_COUNT = 5;
const ERROR_CASCADE_WINDOW_MS = 60000;
const COST_SPIKE_USD = 2.0;

function normalizeText(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getEscalationRaw(alert: AgentEvent): Record<string, unknown> {
  return (alert._raw as Record<string, unknown> | undefined) ?? {};
}

export function monitorSeverityRank(severity: MonitorSeverity): number {
  switch (severity) {
    case "critical":
      return 3;
    case "warning":
      return 2;
    case "info":
    default:
      return 1;
  }
}

export function getSeverityBadgeVariant(
  severity: MonitorSeverity,
): MonitorBadgeVariant {
  switch (severity) {
    case "critical":
      return "destructive";
    case "warning":
      return "outline";
    case "info":
    default:
      return "secondary";
  }
}

export function formatSeverityLabel(severity: MonitorSeverity): string {
  switch (severity) {
    case "critical":
      return "Critical";
    case "warning":
      return "Warning";
    case "info":
    default:
      return "Info";
  }
}

export function getEscalationAlertKey(alert: AgentEvent): string {
  const raw = getEscalationRaw(alert);
  const ruleName = String(raw.rule_name ?? "Escalation");
  const condition = String(raw.condition ?? alert.hook_event_type ?? "unknown");
  return `${alert.session_id}::${ruleName}::${condition}`;
}

export function getEscalationAlertSeverity(
  alert: AgentEvent,
  occurrences = 1,
): Exclude<MonitorSeverity, "info"> {
  const raw = getEscalationRaw(alert);
  const threshold = toNumber(raw.threshold);
  const actual = toNumber(raw.actual_value);
  const ratio = threshold && threshold > 0 && actual !== null ? actual / threshold : 1;

  if (occurrences >= 3 || ratio >= 2) return "critical";
  return "warning";
}

export function summarizeEscalationAlerts(
  alerts: AgentEvent[],
): EscalationAlertSummary[] {
  const grouped = new Map<string, EscalationAlertSummary>();

  for (const alert of alerts) {
    const key = getEscalationAlertKey(alert);
    const raw = getEscalationRaw(alert);
    const threshold = toNumber(raw.threshold);
    const actual = toNumber(raw.actual_value);
    const ruleName = String(raw.rule_name ?? "Escalation");
    const condition = String(raw.condition ?? "unknown");

    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        key,
        session_id: alert.session_id,
        rule_name: ruleName,
        condition,
        threshold,
        latest_actual: actual,
        peak_actual: actual,
        occurrences: 1,
        first_timestamp: alert.timestamp,
        last_timestamp: alert.timestamp,
        message: alert.message ?? ruleName,
        severity: getEscalationAlertSeverity(alert),
        alerts: [alert],
      });
      continue;
    }

    existing.occurrences += 1;
    existing.alerts.push(alert);
    if (alert.timestamp < existing.first_timestamp) {
      existing.first_timestamp = alert.timestamp;
    }
    if (alert.timestamp >= existing.last_timestamp) {
      existing.last_timestamp = alert.timestamp;
      existing.latest_actual = actual;
      existing.message = alert.message ?? existing.message;
    }
    if (actual !== null) {
      existing.peak_actual = Math.max(existing.peak_actual ?? actual, actual);
    }
    existing.severity = getEscalationAlertSeverity(alert, existing.occurrences);
  }

  return [...grouped.values()].sort((a, b) => {
    const severityDelta =
      monitorSeverityRank(b.severity) - monitorSeverityRank(a.severity);
    if (severityDelta !== 0) return severityDelta;
    return b.last_timestamp.localeCompare(a.last_timestamp);
  });
}

export function getEventSeverity(event: AgentEvent): MonitorSeverity {
  if (event.hook_event_type === "_escalation") {
    return getEscalationAlertSeverity(event);
  }

  if (
    event.hook_event_type === "PostToolUseFailure" ||
    event.hook_event_type === "StopFailure" ||
    normalizeText(event.error).length > 0
  ) {
    return "critical";
  }

  const message = normalizeText(
    [event.message, event.reason, event.notification_type]
      .filter(Boolean)
      .join(" "),
  );

  if (message.includes("warning") || message.includes("retry")) {
    return "warning";
  }

  return "info";
}

export function getEventFingerprint(event: AgentEvent): string {
  const details = [
    event.tool_name,
    event.message,
    event.error,
    event.reason,
    event.notification_type,
    event.task_subject,
    event.agent_type,
  ]
    .filter(Boolean)
    .map((value) => normalizeText(String(value)))
    .join("::");

  return `${event.session_id}::${event.hook_event_type}::${details}`;
}

export function getSessionSeverity(session: SessionSummary): MonitorSeverity {
  if (session.errors > 0) return "critical";
  if (session.cost_usd >= 5 || session.duration_seconds >= 7200) {
    return "warning";
  }
  return "info";
}

export function getAnomalyKey(anomaly: MonitorAnomaly): string {
  return [
    anomaly.session_id,
    anomaly.type,
    normalizeText(anomaly.evidence.pattern ?? anomaly.message),
  ].join("::");
}

export function detectAnomalies(events: AgentEvent[]): MonitorAnomaly[] {
  const anomalies: MonitorAnomaly[] = [];
  const sessions = new Map<string, AgentEvent[]>();

  for (const event of events) {
    const existing = sessions.get(event.session_id);
    if (existing) {
      existing.push(event);
    } else {
      sessions.set(event.session_id, [event]);
    }
  }

  for (const [sessionId, sessionEvents] of sessions) {
    const toolEvents = sessionEvents.filter(
      (event) => event.hook_event_type === "PostToolUse" && event.tool_name,
    );
    const signatureCounts = new Map<string, number>();

    for (const event of toolEvents) {
      const signature = `${event.tool_name}::${JSON.stringify(event.tool_input ?? {})}`;
      signatureCounts.set(signature, (signatureCounts.get(signature) ?? 0) + 1);
    }

    for (const [signature, count] of signatureCounts) {
      if (count < LOOP_THRESHOLD) continue;
      anomalies.push({
        type: "infinite_loop",
        severity: count >= LOOP_THRESHOLD * 2 ? "critical" : "warning",
        session_id: sessionId,
        timestamp: toolEvents[toolEvents.length - 1]?.timestamp ?? "",
        message: `"${signature.split("::")[0]}" called ${count}× with identical input`,
        evidence: { events: [], pattern: signature.slice(0, 200), count },
      });
    }

    const errors = sessionEvents.filter(
      (event) =>
        event.hook_event_type === "PostToolUseFailure" ||
        event.hook_event_type === "StopFailure",
    );

    for (let index = 0; index < errors.length; index += 1) {
      const start = new Date(errors[index]!.timestamp).getTime();
      let windowCount = 0;
      for (let cursor = index; cursor < errors.length; cursor += 1) {
        if (
          new Date(errors[cursor]!.timestamp).getTime() - start >
          ERROR_CASCADE_WINDOW_MS
        ) {
          break;
        }
        windowCount += 1;
      }

      if (windowCount < ERROR_CASCADE_COUNT) continue;
      anomalies.push({
        type: "error_cascade",
        severity:
          windowCount >= ERROR_CASCADE_COUNT * 2 ? "critical" : "warning",
        session_id: sessionId,
        timestamp: errors[index]!.timestamp,
        message: `${windowCount} errors in ${ERROR_CASCADE_WINDOW_MS / 1000}s`,
        evidence: {
          events: [],
          count: windowCount,
          window_seconds: ERROR_CASCADE_WINDOW_MS / 1000,
        },
      });
      break;
    }

    const toolAndFailures = sessionEvents.filter(
      (event) =>
        event.hook_event_type === "PostToolUse" ||
        event.hook_event_type === "PostToolUseFailure",
    );

    for (let index = 0; index < toolAndFailures.length; index += 1) {
      const start = new Date(toolAndFailures[index]!.timestamp).getTime();
      const window: AgentEvent[] = [];
      const distinctTools = new Set<string>();

      for (let cursor = index; cursor < toolAndFailures.length; cursor += 1) {
        if (
          new Date(toolAndFailures[cursor]!.timestamp).getTime() - start >
          THRASH_WINDOW_MS
        ) {
          break;
        }
        window.push(toolAndFailures[cursor]!);
        if (toolAndFailures[cursor]!.tool_name) {
          distinctTools.add(toolAndFailures[cursor]!.tool_name!);
        }
      }

      if (distinctTools.size < THRASH_TOOL_COUNT || window.length === 0) continue;
      const failures = window.filter(
        (event) => event.hook_event_type === "PostToolUseFailure",
      ).length;
      const failureRate = failures / window.length;
      if (failureRate <= 0.3) continue;

      anomalies.push({
        type: "tool_thrashing",
        severity: failureRate > 0.5 ? "critical" : "warning",
        session_id: sessionId,
        timestamp: window[window.length - 1]?.timestamp ?? "",
        message: `${distinctTools.size} tools in ${THRASH_WINDOW_MS / 1000}s, ${Math.round(failureRate * 100)}% failures`,
        evidence: {
          events: [],
          pattern: [...distinctTools].join(", "),
          count: window.length,
        },
      });
      break;
    }

    const totalCost = getAuthoritativeSessionCost(sessionEvents);
    if (totalCost <= COST_SPIKE_USD) continue;

    anomalies.push({
      type: "cost_spike",
      severity: totalCost > COST_SPIKE_USD * 3 ? "critical" : "warning",
      session_id: sessionId,
      timestamp: sessionEvents[sessionEvents.length - 1]?.timestamp ?? "",
      message: `Session cost $${totalCost.toFixed(2)} exceeds $${COST_SPIKE_USD.toFixed(2)}`,
      evidence: { events: [], count: 1 },
    });
  }

  return anomalies.sort((a, b) => {
    const severityDelta =
      monitorSeverityRank(b.severity) - monitorSeverityRank(a.severity);
    if (severityDelta !== 0) return severityDelta;
    return b.timestamp.localeCompare(a.timestamp);
  });
}
