import { RuntimePhaseMachine } from "../harness/runtime-phase";
import { PolicyEngine } from "../harness/policy-engine";
import { BASELINE_TASK_SET } from "../evals/baseline-task-set";
import { scoreBaselineResponses } from "../evals/scoring";
import { evaluateMvpRegressionGates } from "../teams/regression-gates";
import { detectPolicyBypassIncidents } from "../harness/policy-audit";
import { HarnessEvent } from "../harness/events";

describe("release gates", () => {
  it("Gate A: runtime phase machine enforces deterministic path", () => {
    const machine = new RuntimePhaseMachine("planning");
    expect(machine.transitionTo("executing")).toBe("executing");
    expect(machine.transitionTo("reconciling")).toBe("reconciling");
    expect(machine.transitionTo("completed")).toBe("completed");
    expect(machine.isTerminal()).toBe(true);
  });

  it("Gate B: strict policy requires approval for write/exec/destructive", async () => {
    const policy = new PolicyEngine({ profile: "strict" });

    await expect(
      policy.evaluateToolCall({
        toolName: "read_file",
        riskLevel: "read",
        toolCallCount: 1,
      })
    ).resolves.toMatchObject({ action: "allow" });

    await expect(
      policy.evaluateToolCall({
        toolName: "exec_command",
        riskLevel: "exec",
        toolCallCount: 2,
      })
    ).resolves.toMatchObject({ action: "await_user" });
  });

  it("Gate C: baseline eval task set and scorer are operational", () => {
    expect(BASELINE_TASK_SET.length).toBeGreaterThanOrEqual(5);
    const responses: Record<string, string> = {};
    for (const task of BASELINE_TASK_SET) {
      responses[task.id] = task.requiredKeywords.join(" ");
    }
    const report = scoreBaselineResponses(BASELINE_TASK_SET, responses);
    expect(report.normalizedScore).toBe(1);
  });

  it("Gate D: MVP regression gate aggregator enforces all safety toggles", () => {
    const report = evaluateMvpRegressionGates({
      replayEquivalent: true,
      capEnforcementActive: true,
      heartbeatPolicyActive: true,
      trustGatingActive: true,
      mutableGraphEnabled: true,
      reconcileEnabled: true,
    });
    expect(report.passed).toBe(true);
  });

  it("Gate B+: staged policy events show zero approval bypass incidents", () => {
    const stagedEvents: HarnessEvent[] = [
      {
        timestamp: "2026-02-26T00:00:00.000Z",
        type: "policy",
        agentId: "agent",
        data: {
          tool: "edit_file",
          action: "await_user",
          reason: "strict_profile_requires_approval",
        },
      },
      {
        timestamp: "2026-02-26T00:00:01.000Z",
        type: "turn_result",
        agentId: "agent",
        data: { status: "await_user", reason: "policy_await_user" },
      },
    ];

    const report = detectPolicyBypassIncidents(stagedEvents);
    expect(report.blockedDecisions).toBe(1);
    expect(report.incidents).toHaveLength(0);
  });
});
