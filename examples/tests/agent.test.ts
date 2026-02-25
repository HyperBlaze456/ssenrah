import { Agent } from "../agent/agent";
import { ToolDefinition } from "../agent/types";
import { Team } from "../teams/team";
import { LLMProvider, ChatRequest, ChatResponse } from "../providers/types";
import { Beholder } from "../harness/beholder";

/** Helper: create a mock provider that returns a fixed text response */
function createMockProvider(text = "Hello"): LLMProvider {
  return {
    name: "mock",
    chat: jest.fn().mockResolvedValue({
      textBlocks: [text],
      toolCalls: [],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5 },
    } satisfies ChatResponse),
  };
}

describe("Agent", () => {
  it("constructs without error", () => {
    expect(
      () => new Agent({ provider: createMockProvider(), model: "test" })
    ).not.toThrow();
  });

  it("getHistory returns empty array initially", () => {
    const agent = new Agent({ provider: createMockProvider(), model: "test" });
    expect(agent.getHistory()).toEqual([]);
  });

  it("clearHistory empties the history", () => {
    const agent = new Agent({ provider: createMockProvider(), model: "test" });
    agent.clearHistory();
    expect(agent.getHistory()).toEqual([]);
  });

  it("respects custom maxTurns in config", () => {
    expect(
      () =>
        new Agent({
          provider: createMockProvider(),
          model: "test",
          maxTurns: 5,
        })
    ).not.toThrow();
  });

  it("runs a simple turn with mock provider", async () => {
    const provider = createMockProvider("I am a helpful agent");
    const agent = new Agent({ provider, model: "test-model" });

    const result = await agent.run("Hello");

    expect(result.response).toBe("I am a helpful agent");
    expect(result.done).toBe(true);
    expect(result.toolsUsed).toEqual([]);
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(provider.chat).toHaveBeenCalledTimes(1);

    // Verify the request sent to provider
    const call = (provider.chat as jest.Mock).mock.calls[0][0] as ChatRequest;
    expect(call.model).toBe("test-model");
    expect(call.messages).toHaveLength(1);
    expect(call.messages[0].role).toBe("user");
    expect(call.messages[0].content).toBe("Hello");
  });

  it("streams text deltas when provider supports chatStream", async () => {
    const onTextDelta = jest.fn();
    const provider: LLMProvider = {
      name: "mock-stream",
      chat: jest.fn().mockResolvedValue({
        textBlocks: ["fallback"],
        toolCalls: [],
        stopReason: "end_turn",
      } satisfies ChatResponse),
      chatStream: jest.fn().mockImplementation(async (_params, callbacks) => {
        callbacks?.onTextDelta?.("stream");
        callbacks?.onTextDelta?.("ed");
        return {
          textBlocks: ["streamed"],
          toolCalls: [],
          stopReason: "end_turn",
          usage: { inputTokens: 3, outputTokens: 2 },
        } satisfies ChatResponse;
      }),
    };

    const agent = new Agent({ provider, model: "test-model" });
    const result = await agent.run("hello", {
      stream: true,
      onTextDelta,
    });

    expect(result.response).toBe("streamed");
    expect(result.done).toBe(true);
    expect(provider.chatStream).toHaveBeenCalledTimes(1);
    expect(onTextDelta).toHaveBeenCalledTimes(2);
    expect(onTextDelta.mock.calls.flat()).toEqual(["stream", "ed"]);
  });

  it("executes tool calls and loops", async () => {
    const provider: LLMProvider = {
      name: "mock",
      chat: jest
        .fn()
        // First call: returns a tool call
        .mockResolvedValueOnce({
          textBlocks: [
            `Let me read that file.
<intent>{"toolName":"echo","purpose":"echo back the input","expectedOutcome":"the message is echoed","riskLevel":"read"}</intent>`,
          ],
          toolCalls: [
            { id: "tc1", name: "echo", input: { message: "hi" } },
          ],
          stopReason: "tool_use",
        } satisfies ChatResponse)
        // Second call: returns final text
        .mockResolvedValueOnce({
          textBlocks: ["Done! The echo said hi."],
          toolCalls: [],
          stopReason: "end_turn",
        } satisfies ChatResponse),
    };

    const echoTool: ToolDefinition = {
      name: "echo",
      description: "Echo input",
      inputSchema: {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
      },
      run: (input) => `echo: ${input["message"]}`,
    };

    const agent = new Agent({
      provider,
      model: "test",
      tools: [echoTool],
    });

    const result = await agent.run("Say hi");

    expect(result.done).toBe(true);
    expect(result.toolsUsed).toEqual(["echo"]);
    expect(result.response).toBe("Done! The echo said hi.");
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(provider.chat).toHaveBeenCalledTimes(2);
  });

  it("blocks undeclared tool calls when intentRequired is enabled", async () => {
    const provider: LLMProvider = {
      name: "mock",
      chat: jest.fn().mockResolvedValue({
        textBlocks: ["Calling a tool without intent"],
        toolCalls: [{ id: "tc1", name: "echo", input: { message: "hi" } }],
        stopReason: "tool_use",
      } satisfies ChatResponse),
    };

    const agent = new Agent({
      provider,
      model: "test",
      maxTurns: 1,
      tools: [
        {
          name: "echo",
          description: "echo",
          inputSchema: { type: "object", properties: {}, required: [] },
          run: () => "ok",
        },
      ],
    });

    const result = await agent.run("hi");
    expect(result.done).toBe(false);
    expect(result.toolsUsed).toEqual([]);
  });
});

describe("ToolDefinition", () => {
  it("custom sync tool runs correctly", async () => {
    const echoTool: ToolDefinition = {
      name: "echo",
      description: "Echo input back",
      inputSchema: {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
      },
      run: (input) => `echo: ${input["message"]}`,
    };

    const result = await echoTool.run({ message: "hello" });
    expect(result).toBe("echo: hello");
  });

  it("custom async tool runs correctly", async () => {
    const asyncTool: ToolDefinition = {
      name: "async_echo",
      description: "Async echo",
      inputSchema: { type: "object", properties: {}, required: [] },
      run: async (_input) => Promise.resolve("async result"),
    };

    const result = await asyncTool.run({});
    expect(result).toBe("async result");
  });
});

describe("Team configuration", () => {
  const mockProvider = createMockProvider();

  it("throws when maxWorkers is 0", () => {
    expect(
      () => new Team({ name: "test", maxWorkers: 0, orchestratorProvider: mockProvider, workerProvider: mockProvider })
    ).toThrow("maxWorkers must be a positive integer");
  });

  it("throws when maxWorkers is negative", () => {
    expect(
      () => new Team({ name: "test", maxWorkers: -1, orchestratorProvider: mockProvider, workerProvider: mockProvider })
    ).toThrow("maxWorkers must be a positive integer");
  });

  it("constructs successfully with valid maxWorkers", () => {
    expect(() => new Team({ name: "test", maxWorkers: 2, orchestratorProvider: mockProvider, workerProvider: mockProvider })).not.toThrow();
  });

  it("defaults maxWorkers to 3 when not specified", () => {
    expect(() => new Team({ name: "test", orchestratorProvider: mockProvider, workerProvider: mockProvider })).not.toThrow();
  });

  it("throws when workerRestartLimit is negative", () => {
    expect(
      () =>
        new Team({
          name: "test",
          orchestratorProvider: mockProvider,
          workerProvider: mockProvider,
          workerRestartLimit: -1,
        })
    ).toThrow("workerRestartLimit must be a non-negative integer");
  });

  it("accepts optional shared beholder + restart configuration", () => {
    const beholder = new Beholder();
    expect(
      () =>
        new Team({
          name: "test",
          orchestratorProvider: mockProvider,
          workerProvider: mockProvider,
          beholder,
          workerRestartLimit: 2,
        })
    ).not.toThrow();
  });
});
