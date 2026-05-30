/**
 * Escalation engine — configurable threshold-based alerting.
 *
 * Loads rules from ~/.ssenrah/escalation.json, evaluates them against
 * accumulated session state, and fires alerts via console or log.
 */
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { EscalationRule, EscalationConfig, AgentEvent } from "./types.js";
import { appendLogLine, readRecentEvents } from "./log-store.js";
import { getAuthoritativeSessionCost } from "./telemetry.js";

function getConfigDir(): string {
  return join(process.env.HOME ?? "~", ".ssenrah");
}

function getConfigPath(): string {
  return join(getConfigDir(), "escalation.json");
}

/** Session state computed from the event log. */
export interface SessionState {
  session_id: string;
  cost_usd: number;
  duration_seconds: number;
  error_count: number;
  event_count: number;
}

/** Fired when a rule threshold is exceeded. */
export interface EscalationAlert {
  rule_name: string;
  condition: string;
  threshold: number;
  actual_value: number;
  session_id: string;
}

/** Default rules created on first run. */
const DEFAULT_RULES: EscalationRule[] = [
  {
    name: "High session cost",
    condition: "session_cost_exceeds",
    threshold: 5.0,
    action: "log",
  },
  {
    name: "Too many errors",
    condition: "error_count_exceeds",
    threshold: 10,
    action: "log",
  },
  {
    name: "Long-running session",
    condition: "session_duration_exceeds",
    threshold: 7200, // 2 hours in seconds
    action: "log",
  },
];

/**
 * Load escalation config from disk.
 * Creates default config if it doesn't exist.
 */
export function loadEscalationConfig(): EscalationConfig {
  if (!existsSync(getConfigPath())) {
    createDefaultConfig();
  }

  try {
    const raw = readFileSync(getConfigPath(), "utf-8");
    const parsed = JSON.parse(raw) as EscalationConfig;
    if (!Array.isArray(parsed.rules)) {
      return { rules: DEFAULT_RULES };
    }
    return parsed;
  } catch {
    // Corrupted config — fall back to defaults
    return { rules: DEFAULT_RULES };
  }
}

/**
 * Write the default escalation config to disk.
 */
export function createDefaultConfig(): void {
  if (!existsSync(getConfigDir())) {
    mkdirSync(getConfigDir(), { recursive: true });
  }
  const config: EscalationConfig = { rules: DEFAULT_RULES };
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/**
 * Compute session state from the event log for a given session.
 */
export function computeSessionState(
  events: AgentEvent[],
  sessionId: string
): SessionState {
  const sessionEvents = events.filter((e) => e.session_id === sessionId);

  if (sessionEvents.length === 0) {
    return {
      session_id: sessionId,
      cost_usd: 0,
      duration_seconds: 0,
      error_count: 0,
      event_count: 0,
    };
  }

  const first = sessionEvents[0]!;
  const last = sessionEvents[sessionEvents.length - 1]!;
  const duration =
    (new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime()) /
    1000;

  const errorCount = sessionEvents.filter(
    (e) =>
      e.hook_event_type === "PostToolUseFailure" ||
      e.hook_event_type === "StopFailure"
  ).length;

  const totalCost = getAuthoritativeSessionCost(sessionEvents, sessionId);

  return {
    session_id: sessionId,
    cost_usd: totalCost,
    duration_seconds: Math.round(duration),
    error_count: errorCount,
    event_count: sessionEvents.length,
  };
}

/**
 * Evaluate escalation rules against session state.
 * Returns alerts for any rules whose thresholds are exceeded.
 */
export function evaluateRules(
  rules: EscalationRule[],
  state: SessionState
): EscalationAlert[] {
  const alerts: EscalationAlert[] = [];

  for (const rule of rules) {
    let actual: number;

    switch (rule.condition) {
      case "session_cost_exceeds":
        actual = state.cost_usd;
        break;
      case "session_duration_exceeds":
        actual = state.duration_seconds;
        break;
      case "error_count_exceeds":
        actual = state.error_count;
        break;
      default:
        continue; // Unknown condition — skip
    }

    if (actual > rule.threshold) {
      alerts.push({
        rule_name: rule.name,
        condition: rule.condition,
        threshold: rule.threshold,
        actual_value: actual,
        session_id: state.session_id,
      });
    }
  }

  return alerts;
}

/**
 * Fire escalation alerts — write to console (stderr) and/or append to log.
 */
export function fireAlerts(
  alerts: EscalationAlert[],
  rules: EscalationRule[]
): void {
  const ruleMap = new Map(rules.map((r) => [r.name, r]));

  for (const alert of alerts) {
    const rule = ruleMap.get(alert.rule_name);
    const action = rule?.action ?? "log";

    const message = `[ESCALATION] ${alert.rule_name}: ${alert.condition} threshold ${alert.threshold} exceeded (actual: ${alert.actual_value}) for session ${alert.session_id.slice(0, 8)}`;

    if (action === "console") {
      process.stderr.write(message + "\n");
    }

    // Always log escalation events (both "console" and "log" actions)
    const escalationEvent: Partial<AgentEvent> = {
      id: randomUUID(),
      schema_version: 2,
      timestamp: new Date().toISOString(),
      session_id: alert.session_id,
      hook_event_type: "_escalation",
      cwd: "",
      notification_type: "escalation",
      message,
      _raw: alert as unknown as Record<string, unknown>,
    };

    appendLogLine(JSON.stringify(escalationEvent) + "\n");
  }
}

/**
 * Load recent events from the JSONL log file.
 *
 * Only the tail of the log is read (see {@link readRecentEvents}) so this stays
 * cheap regardless of how large the log has grown.
 */
export function loadEventsFromLog(): AgentEvent[] {
  return readRecentEvents();
}

/**
 * Run the escalation check for a session.
 * Called by the hook at terminal events after appending.
 *
 * Each rule fires at most once per session: any rule already represented by an
 * `_escalation` event in the recent log is skipped, so a session that stays
 * over a threshold no longer appends a fresh alert on every invocation.
 */
export function checkEscalation(sessionId: string): void {
  const config = loadEscalationConfig();
  if (config.rules.length === 0) return;

  const events = loadEventsFromLog();
  const state = computeSessionState(events, sessionId);
  const alerts = evaluateRules(config.rules, state);
  if (alerts.length === 0) return;

  const alreadyFired = new Set<string>();
  for (const event of events) {
    if (event.hook_event_type === "_escalation" && event.session_id === sessionId) {
      const ruleName = (event._raw as { rule_name?: string } | undefined)?.rule_name;
      if (ruleName) alreadyFired.add(ruleName);
    }
  }

  const freshAlerts = alerts.filter((alert) => !alreadyFired.has(alert.rule_name));
  if (freshAlerts.length > 0) {
    fireAlerts(freshAlerts, config.rules);
  }
}
