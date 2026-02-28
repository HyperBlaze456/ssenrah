import { HarnessEvent } from "./events";
import { PolicyAction, RiskLevel } from "./policy-engine";

export interface RiskStatusSnapshot {
  highestRisk: RiskLevel | "unknown";
  policyAction: PolicyAction | "none" | "unknown";
  approvalStatus: "none" | "required" | "approved" | "denied";
  policyReason?: string;
}

const RISK_LEVEL_ORDER: Readonly<Record<RiskLevel, number>> = {
  read: 0,
  write: 1,
  exec: 2,
  destructive: 3,
};

function toSafeString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function isRiskLevel(value: string): value is RiskLevel {
  return (
    value === "read" ||
    value === "write" ||
    value === "exec" ||
    value === "destructive"
  );
}

function maxRisk(
  current: RiskLevel | "unknown",
  next: RiskLevel
): RiskLevel {
  if (current === "unknown") return next;
  return RISK_LEVEL_ORDER[next] >= RISK_LEVEL_ORDER[current] ? next : current;
}

function isPolicyAction(value: string): value is PolicyAction {
  return value === "allow" || value === "await_user" || value === "deny";
}

export function summarizeRiskStatus(
  events: ReadonlyArray<HarnessEvent>
): RiskStatusSnapshot {
  let highestRisk: RiskLevel | "unknown" = "unknown";
  let policyAction: RiskStatusSnapshot["policyAction"] = "none";
  let approvalStatus: RiskStatusSnapshot["approvalStatus"] = "none";
  let policyReason: string | undefined;

  for (const event of events) {
    if (event.type === "intent") {
      const riskLevel = toSafeString(event.data["riskLevel"]);
      if (isRiskLevel(riskLevel)) {
        highestRisk = maxRisk(highestRisk, riskLevel);
      }
      continue;
    }

    if (event.type === "policy") {
      const action = toSafeString(event.data["action"]);
      const reason = toSafeString(event.data["reason"]);
      const riskLevel = toSafeString(event.data["riskLevel"]);

      if (isRiskLevel(riskLevel)) {
        highestRisk = maxRisk(highestRisk, riskLevel);
      }

      if (reason) {
        policyReason = reason;
      }

      if (isPolicyAction(action)) {
        policyAction = action;
        if (action === "await_user") {
          approvalStatus = "required";
        } else if (action === "deny") {
          approvalStatus = "denied";
        } else if (
          action === "allow" &&
          reason.toLowerCase().includes("approved_by_handler")
        ) {
          approvalStatus = "approved";
        }
      } else if (action) {
        policyAction = "unknown";
      }
      continue;
    }

    if (event.type === "turn_result") {
      const status = toSafeString(event.data["status"]);
      const reason = toSafeString(event.data["reason"]);
      if (status === "await_user" || reason === "policy_await_user") {
        approvalStatus = "required";
      }
      if (status === "failed" && reason === "policy_denied") {
        approvalStatus = "denied";
      }
    }
  }

  return {
    highestRisk,
    policyAction,
    approvalStatus,
    policyReason,
  };
}

export function formatRiskStatusLines(snapshot: RiskStatusSnapshot): string[] {
  const risk =
    snapshot.highestRisk === "unknown"
      ? "unknown"
      : snapshot.highestRisk.toUpperCase();
  const lines = [
    `risk=${risk}  approval=${snapshot.approvalStatus}  policy=${snapshot.policyAction}`,
  ];

  if (snapshot.policyReason) {
    lines.push(`policy reason=${snapshot.policyReason}`);
  }

  return lines;
}

export function buildRiskStatusLines(
  events: ReadonlyArray<HarnessEvent>
): string[] {
  return formatRiskStatusLines(summarizeRiskStatus(events));
}
