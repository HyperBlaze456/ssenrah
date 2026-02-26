import { HarnessEvent } from "../harness/events";
import {
  buildRiskStatusLines,
  summarizeRiskStatus,
} from "../harness/risk-status";

function event(
  type: HarnessEvent["type"],
  data: Record<string, unknown>
): HarnessEvent {
  return {
    timestamp: "2026-02-26T00:00:00.000Z",
    type,
    agentId: "agent-1",
    data,
  };
}

describe("risk-status", () => {
  it("derives highest risk and approval-required state from policy await_user events", () => {
    const events: HarnessEvent[] = [
      event("intent", { toolName: "write_file", riskLevel: "write" }),
      event("policy", {
        tool: "write_file",
        riskLevel: "write",
        action: "await_user",
        reason: "strict_profile_requires_approval: write",
      }),
    ];

    const snapshot = summarizeRiskStatus(events);
    expect(snapshot.highestRisk).toBe("write");
    expect(snapshot.policyAction).toBe("await_user");
    expect(snapshot.approvalStatus).toBe("required");
    expect(buildRiskStatusLines(events)[0]).toContain("approval=required");
  });

  it("marks approvals as approved when policy allow comes from approval handler", () => {
    const events: HarnessEvent[] = [
      event("policy", {
        tool: "exec_command",
        riskLevel: "exec",
        action: "allow",
        reason: "approved_by_handler: exec_command (exec)",
      }),
    ];

    const snapshot = summarizeRiskStatus(events);
    expect(snapshot.highestRisk).toBe("exec");
    expect(snapshot.policyAction).toBe("allow");
    expect(snapshot.approvalStatus).toBe("approved");
    expect(buildRiskStatusLines(events)[1]).toContain("approved_by_handler");
  });

  it("stays compatible with unknown events and still surfaces policy denial terminal state", () => {
    const events: HarnessEvent[] = [
      event("audit_timeline", { step: "foo" }),
      event("intent", { toolName: "rm", riskLevel: "destructive" }),
      event("turn_result", { status: "failed", reason: "policy_denied" }),
    ];

    const snapshot = summarizeRiskStatus(events);
    expect(snapshot.highestRisk).toBe("destructive");
    expect(snapshot.policyAction).toBe("none");
    expect(snapshot.approvalStatus).toBe("denied");
  });
});
