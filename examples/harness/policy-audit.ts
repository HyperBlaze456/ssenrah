import { HarnessEvent } from "./events";
import { PolicyAction } from "./policy-engine";

export interface PolicyBypassIncident {
  index: number;
  toolName: string;
  blockedAction: "await_user" | "deny";
  reason?: string;
}

export interface PolicyAuditReport {
  incidents: PolicyBypassIncident[];
  blockedDecisions: number;
}

function toSafeString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function isBlockedAction(action: PolicyAction | string): action is "await_user" | "deny" {
  return action === "await_user" || action === "deny";
}

/**
 * Detects approval/policy bypass incidents in a turn-level event stream.
 *
 * A bypass incident is counted when:
 *  - A policy decision blocks a tool (`await_user` or `deny`), and
 *  - A `tool_call` for the same tool appears later before the next `turn_result`.
 */
export function detectPolicyBypassIncidents(
  events: ReadonlyArray<HarnessEvent>
): PolicyAuditReport {
  const blockedTools = new Map<
    string,
    { action: "await_user" | "deny"; reason?: string; index: number }
  >();
  const incidents: PolicyBypassIncident[] = [];
  let blockedDecisions = 0;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    if (event.type === "turn_result") {
      blockedTools.clear();
      continue;
    }

    if (event.type === "policy") {
      const toolName = toSafeString(event.data["tool"]).trim();
      const action = toSafeString(event.data["action"]);
      const reason = toSafeString(event.data["reason"]) || undefined;
      if (toolName && isBlockedAction(action)) {
        blockedDecisions += 1;
        blockedTools.set(toolName, { action, reason, index: i });
      }
      continue;
    }

    if (event.type === "tool_call") {
      const toolName = toSafeString(event.data["tool"]).trim();
      if (!toolName) continue;
      const blocked = blockedTools.get(toolName);
      if (!blocked) continue;
      incidents.push({
        index: i,
        toolName,
        blockedAction: blocked.action,
        reason: blocked.reason,
      });
      blockedTools.delete(toolName);
    }
  }

  return {
    incidents,
    blockedDecisions,
  };
}

export function hasPolicyBypassIncidents(
  events: ReadonlyArray<HarnessEvent>
): boolean {
  return detectPolicyBypassIncidents(events).incidents.length > 0;
}
