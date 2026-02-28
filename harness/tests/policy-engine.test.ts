import { PolicyEngine } from "../harness/policy-engine";

describe("PolicyEngine", () => {
  it("local-permissive allows read/write/exec and gates destructive", async () => {
    const engine = new PolicyEngine({ profile: "local-permissive" });

    await expect(
      engine.evaluateToolCall({
        toolName: "read_file",
        riskLevel: "read",
        toolCallCount: 1,
      })
    ).resolves.toMatchObject({ action: "allow" });

    await expect(
      engine.evaluateToolCall({
        toolName: "edit_file",
        riskLevel: "write",
        toolCallCount: 2,
      })
    ).resolves.toMatchObject({ action: "allow" });

    await expect(
      engine.evaluateToolCall({
        toolName: "exec_command",
        riskLevel: "exec",
        toolCallCount: 3,
      })
    ).resolves.toMatchObject({ action: "allow" });

    await expect(
      engine.evaluateToolCall({
        toolName: "rm_rf",
        riskLevel: "destructive",
        toolCallCount: 4,
      })
    ).resolves.toMatchObject({ action: "await_user" });
  });

  it("strict profile gates non-read risks", async () => {
    const engine = new PolicyEngine({ profile: "strict" });

    await expect(
      engine.evaluateToolCall({
        toolName: "read_file",
        riskLevel: "read",
        toolCallCount: 1,
      })
    ).resolves.toMatchObject({ action: "allow" });

    await expect(
      engine.evaluateToolCall({
        toolName: "exec_command",
        riskLevel: "exec",
        toolCallCount: 2,
      })
    ).resolves.toMatchObject({ action: "await_user" });
  });

  it("managed profile denies exec/destructive", async () => {
    const engine = new PolicyEngine({ profile: "managed" });

    await expect(
      engine.evaluateToolCall({
        toolName: "exec_command",
        riskLevel: "exec",
        toolCallCount: 1,
      })
    ).resolves.toMatchObject({ action: "deny" });
  });

  it("enforces max tool-call cap", async () => {
    const engine = new PolicyEngine({
      profile: "local-permissive",
      maxToolCalls: 1,
    });

    await expect(
      engine.evaluateToolCall({
        toolName: "read_file",
        riskLevel: "read",
        toolCallCount: 2,
      })
    ).resolves.toMatchObject({ action: "await_user" });
  });

  it("approval handler can elevate await_user to allow", async () => {
    const engine = new PolicyEngine({ profile: "strict" });
    const decision = await engine.evaluateToolCall(
      {
        toolName: "edit_file",
        riskLevel: "write",
        toolCallCount: 1,
      },
      async (): Promise<"approve"> => "approve"
    );

    expect(decision.action).toBe("allow");
    expect(decision.reason).toMatch(/approved_by_handler/i);
  });
});
