import { Agent } from "../agent/agent";
import { detectPolicyBypassIncidents } from "../harness/policy-audit";
import { HarnessEvent } from "../harness/events";
import { ChatResponse, LLMProvider } from "../providers/types";

function mockEvent(
  type: HarnessEvent["type"],
  data: Record<string, unknown>
): HarnessEvent {
  return {
    timestamp: "2026-02-26T00:00:00.000Z",
    type,
    agentId: "agent",
    data,
  };
}

describe("policy audit", () => {
  it("reports zero incidents when blocked decisions have no subsequent tool call", () => {
    const report = detectPolicyBypassIncidents([
      mockEvent("policy", {
        tool: "edit_file",
        action: "await_user",
        reason: "strict_profile_requires_approval",
      }),
      mockEvent("turn_result", {
        status: "await_user",
        reason: "policy_await_user",
      }),
    ]);

    expect(report.blockedDecisions).toBe(1);
    expect(report.incidents).toHaveLength(0);
  });

  it("detects bypass when blocked tool still executes in same turn", () => {
    const report = detectPolicyBypassIncidents([
      mockEvent("policy", {
        tool: "exec_command",
        action: "deny",
        reason: "managed_profile_denies_exec",
      }),
      mockEvent("tool_call", { tool: "exec_command", input: { cmd: "pwd" } }),
      mockEvent("turn_result", {
        status: "failed",
        reason: "policy_denied",
      }),
    ]);

    expect(report.blockedDecisions).toBe(1);
    expect(report.incidents).toHaveLength(1);
    expect(report.incidents[0]).toMatchObject({
      toolName: "exec_command",
      blockedAction: "deny",
    });
  });

  it("staged strict run has zero approval bypass incidents", async () => {
    const provider: LLMProvider = {
      name: "mock",
      chat: jest.fn().mockResolvedValue({
        textBlocks: [
          `<intent>{"toolName":"edit_file","purpose":"update config","expectedOutcome":"updated","riskLevel":"write"}</intent>`,
        ],
        toolCalls: [{ id: "tc1", name: "edit_file", input: { path: "/tmp/x" } }],
        stopReason: "tool_use",
      } satisfies ChatResponse),
    };

    const agent = new Agent({
      provider,
      model: "test",
      policyProfile: "strict",
      tools: [
        {
          name: "edit_file",
          description: "edit",
          inputSchema: { type: "object", properties: {}, required: [] },
          run: jest.fn().mockResolvedValue("updated"),
        },
      ],
    });

    const result = await agent.run("update file");
    expect(result.status).toBe("await_user");
    const report = detectPolicyBypassIncidents(agent.getEventLogger().getEvents());
    expect(report.blockedDecisions).toBeGreaterThan(0);
    expect(report.incidents).toHaveLength(0);
  });
});
