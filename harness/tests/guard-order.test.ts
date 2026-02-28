import { Agent } from "../agent/agent";
import { Beholder } from "../harness/beholder";
import { LLMProvider, ChatResponse } from "../providers/types";

describe("guard order", () => {
  it("enforces intent -> policy -> beholder -> tool -> fallback ordering", async () => {
    const provider: LLMProvider = {
      name: "mock-main",
      chat: jest
        .fn()
        .mockResolvedValueOnce({
          textBlocks: [
            `<intent>{"toolName":"unstable_tool","purpose":"read data","expectedOutcome":"data","riskLevel":"read"}</intent>`,
          ],
          toolCalls: [{ id: "tc1", name: "unstable_tool", input: { path: "/tmp/a" } }],
          stopReason: "tool_use",
        } satisfies ChatResponse)
        .mockResolvedValueOnce({
          textBlocks: ["done"],
          toolCalls: [],
          stopReason: "end_turn",
        } satisfies ChatResponse),
    };

    const fallbackProvider: LLMProvider = {
      name: "mock-fallback",
      chat: jest.fn().mockResolvedValue({
        textBlocks: ['{"toolName": null, "input": {}}'],
        toolCalls: [],
        stopReason: "end_turn",
      } satisfies ChatResponse),
    };

    const agent = new Agent({
      provider,
      model: "test",
      fallbackProvider,
      fallbackModel: "fallback-test",
      tools: [
        {
          name: "unstable_tool",
          description: "fails and triggers fallback",
          inputSchema: { type: "object", properties: {}, required: [] },
          run: jest.fn().mockResolvedValue("Error: transient failure"),
        },
      ],
    });
    agent.setBeholder(new Beholder());

    const result = await agent.run("run unstable tool");

    expect(result.status).toBe("completed");
    const eventTypes = agent
      .getEventLogger()
      .getEvents()
      .map((event) => event.type);

    const policyIndex = eventTypes.indexOf("policy");
    const beholderIndex = eventTypes.indexOf("beholder_action");
    const toolCallIndex = eventTypes.indexOf("tool_call");
    const fallbackIndex = eventTypes.indexOf("fallback");
    const toolResultIndex = eventTypes.indexOf("tool_result");

    expect(policyIndex).toBeGreaterThan(-1);
    expect(beholderIndex).toBeGreaterThan(-1);
    expect(toolCallIndex).toBeGreaterThan(-1);
    expect(fallbackIndex).toBeGreaterThan(-1);
    expect(toolResultIndex).toBeGreaterThan(-1);
    expect(policyIndex).toBeLessThan(beholderIndex);
    expect(beholderIndex).toBeLessThan(toolCallIndex);
    expect(toolCallIndex).toBeLessThan(fallbackIndex);
    expect(fallbackIndex).toBeLessThan(toolResultIndex);
  });

  it("short-circuits await_user before beholder/tool execution", async () => {
    const provider: LLMProvider = {
      name: "mock-main",
      chat: jest.fn().mockResolvedValue({
        textBlocks: [
          `<intent>{"toolName":"edit_file","purpose":"update file","expectedOutcome":"updated","riskLevel":"write"}</intent>`,
        ],
        toolCalls: [{ id: "tc1", name: "edit_file", input: { path: "/tmp/a" } }],
        stopReason: "tool_use",
      } satisfies ChatResponse),
    };

    const runTool = jest.fn().mockResolvedValue("updated");
    const beholder = new Beholder();
    const agent = new Agent({
      provider,
      model: "test",
      policyProfile: "strict",
      tools: [
        {
          name: "edit_file",
          description: "edit",
          inputSchema: { type: "object", properties: {}, required: [] },
          run: runTool,
        },
      ],
    });
    agent.setBeholder(beholder);

    const result = await agent.run("edit the file");

    expect(result.status).toBe("await_user");
    expect(result.reason).toBe("policy_await_user");
    expect(runTool).not.toHaveBeenCalled();

    const eventTypes = agent
      .getEventLogger()
      .getEvents()
      .map((event) => event.type);

    expect(eventTypes).toContain("policy");
    expect(eventTypes).not.toContain("beholder_action");
    expect(eventTypes).not.toContain("tool_call");
    expect(eventTypes).not.toContain("tool_result");
    expect(eventTypes).not.toContain("fallback");
  });
});
