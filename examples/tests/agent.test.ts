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
  function expectDoneCompatibility(
    result: { status: string; done: boolean },
    expectedStatus: string
  ) {
    expect(result.status).toBe(expectedStatus);
    expect(result.done).toBe(expectedStatus === "completed");
  }

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
    expectDoneCompatibility(result, "completed");
    expect(result.phase).toBe("completed");
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
    expectDoneCompatibility(result, "completed");
    expect(result.phase).toBe("completed");
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

    expectDoneCompatibility(result, "completed");
    expect(result.phase).toBe("completed");
    expect(result.toolsUsed).toEqual(["echo"]);
    expect(result.response).toBe("Done! The echo said hi.");
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(provider.chat).toHaveBeenCalledTimes(2);
  });

  it("returns completed when end_turn arrives on the final allowed turn", async () => {
    const provider = createMockProvider("Done on turn 1");
    const agent = new Agent({
      provider,
      model: "test",
      maxTurns: 1,
      intentRequired: false,
    });

    const result = await agent.run("hello");

    expectDoneCompatibility(result, "completed");
    expect(result.phase).toBe("completed");
    expect(result.response).toBe("Done on turn 1");
  });

  it("returns completed for tool flow that finishes exactly at maxTurns boundary", async () => {
    const provider: LLMProvider = {
      name: "mock",
      chat: jest
        .fn()
        .mockResolvedValueOnce({
          textBlocks: [
            '<intent>{"toolName":"echo","purpose":"echo","expectedOutcome":"echoed","riskLevel":"read"}</intent>',
          ],
          toolCalls: [{ id: "tc1", name: "echo", input: { message: "hi" } }],
          stopReason: "tool_use",
        } satisfies ChatResponse)
        .mockResolvedValueOnce({
          textBlocks: ["Done on turn 2"],
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
      maxTurns: 2,
      tools: [echoTool],
    });

    const result = await agent.run("say hi");

    expectDoneCompatibility(result, "completed");
    expect(result.phase).toBe("completed");
    expect(result.toolsUsed).toEqual(["echo"]);
    expect(result.response).toBe("Done on turn 2");
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
    expectDoneCompatibility(result, "max_turns");
    expect(result.phase).toBe("failed");
    expect(result.toolsUsed).toEqual([]);
  });

  it("returns max_tokens status while keeping done=false compatibility", async () => {
    const provider: LLMProvider = {
      name: "mock",
      chat: jest.fn().mockResolvedValue({
        textBlocks: ["partial response"],
        toolCalls: [],
        stopReason: "max_tokens",
      } satisfies ChatResponse),
    };
    const agent = new Agent({ provider, model: "test", intentRequired: false });

    const result = await agent.run("hello");

    expectDoneCompatibility(result, "max_tokens");
    expect(result.phase).toBe("failed");
    expect(result.response).toBe("partial response");
    expect(result.reason).toBe("provider_max_tokens");
  });

  it("returns await_user when policy profile requires approval", async () => {
    const provider: LLMProvider = {
      name: "mock",
      chat: jest.fn().mockResolvedValue({
        textBlocks: [
          `<intent>{"toolName":"edit_file","purpose":"update config","expectedOutcome":"config updated","riskLevel":"write"}</intent>`,
        ],
        toolCalls: [{ id: "tc1", name: "edit_file", input: { path: "/tmp/a" } }],
        stopReason: "tool_use",
      } satisfies ChatResponse),
    };

    const runTool = jest.fn().mockResolvedValue("ok");
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

    const result = await agent.run("update file");

    expectDoneCompatibility(result, "await_user");
    expect(result.phase).toBe("await_user");
    expect(result.reason).toBe("policy_await_user");
    expect(runTool).not.toHaveBeenCalled();

    const policyEvents = agent
      .getEventLogger()
      .getEvents()
      .filter((event) => event.type === "policy");
    const lastPolicyEvent = policyEvents[policyEvents.length - 1];
    expect(lastPolicyEvent?.data).toMatchObject({
      action: "await_user",
      tool: "edit_file",
      riskLevel: "write",
    });
  });

  it("executes tool when approval handler approves strict-policy request", async () => {
    const provider: LLMProvider = {
      name: "mock",
      chat: jest
        .fn()
        .mockResolvedValueOnce({
          textBlocks: [
            `<intent>{"toolName":"edit_file","purpose":"update config","expectedOutcome":"config updated","riskLevel":"write"}</intent>`,
          ],
          toolCalls: [{ id: "tc1", name: "edit_file", input: { path: "/tmp/a" } }],
          stopReason: "tool_use",
        } satisfies ChatResponse)
        .mockResolvedValueOnce({
          textBlocks: ["done"],
          toolCalls: [],
          stopReason: "end_turn",
        } satisfies ChatResponse),
    };

    const runTool = jest.fn().mockResolvedValue("updated");
    const agent = new Agent({
      provider,
      model: "test",
      policyProfile: "strict",
      approvalHandler: async (): Promise<"approve"> => "approve",
      tools: [
        {
          name: "edit_file",
          description: "edit",
          inputSchema: { type: "object", properties: {}, required: [] },
          run: runTool,
        },
      ],
    });

    const result = await agent.run("update file");

    expectDoneCompatibility(result, "completed");
    expect(result.phase).toBe("completed");
    expect(result.toolsUsed).toContain("edit_file");
    expect(runTool).toHaveBeenCalledTimes(1);
  });

  it("fails closed when policy denies a tool call", async () => {
    const provider: LLMProvider = {
      name: "mock",
      chat: jest.fn().mockResolvedValue({
        textBlocks: [
          `<intent>{"toolName":"exec_command","purpose":"run shell command","expectedOutcome":"command output","riskLevel":"exec"}</intent>`,
        ],
        toolCalls: [{ id: "tc1", name: "exec_command", input: { cmd: "rm -rf /tmp/x" } }],
        stopReason: "tool_use",
      } satisfies ChatResponse),
    };

    const runTool = jest.fn().mockResolvedValue("should not run");
    const beholder = new Beholder();
    const agent = new Agent({
      provider,
      model: "test",
      policyProfile: "managed",
      tools: [
        {
          name: "exec_command",
          description: "exec",
          inputSchema: { type: "object", properties: {}, required: [] },
          run: runTool,
        },
      ],
    });
    agent.setBeholder(beholder);

    const result = await agent.run("run command");

    expectDoneCompatibility(result, "failed");
    expect(result.phase).toBe("failed");
    expect(result.reason).toBe("policy_denied");
    expect(runTool).not.toHaveBeenCalled();

    const events = agent.getEventLogger().getEvents();
    const eventTypes = events.map((event) => event.type);
    expect(eventTypes).toContain("policy");
    expect(eventTypes).toContain("error");
    expect(eventTypes).not.toContain("beholder_action");
    expect(eventTypes).not.toContain("tool_call");
  });

  it("returns cancelled status when signal is aborted", async () => {
    const provider = createMockProvider("unused");
    const controller = new AbortController();
    controller.abort();
    const agent = new Agent({
      provider,
      model: "test",
      signal: controller.signal,
      intentRequired: false,
    });

    const result = await agent.run("hello");

    expectDoneCompatibility(result, "cancelled");
    expect(result.phase).toBe("failed");
    expect(result.reason).toBe("signal_aborted");
    expect(provider.chat).not.toHaveBeenCalled();
  });

  it("returns failed status when beholder kills execution", async () => {
    const provider: LLMProvider = {
      name: "mock",
      chat: jest.fn().mockResolvedValue({
        textBlocks: [
          '<intent>{"toolName":"echo","purpose":"echo","expectedOutcome":"echoed","riskLevel":"read"}</intent>',
        ],
        toolCalls: [{ id: "tc1", name: "echo", input: { message: "hi" } }],
        stopReason: "tool_use",
        usage: { inputTokens: 1, outputTokens: 1 },
      } satisfies ChatResponse),
    };

    const echoToolRun = jest.fn().mockResolvedValue("echo: hi");
    const agent = new Agent({
      provider,
      model: "test",
      tools: [
        {
          name: "echo",
          description: "Echo input",
          inputSchema: {
            type: "object",
            properties: { message: { type: "string" } },
            required: ["message"],
          },
          run: echoToolRun,
        },
      ],
    });
    agent.setBeholder(new Beholder({ maxTokenBudget: -1 }));

    const result = await agent.run("say hi");

    expectDoneCompatibility(result, "failed");
    expect(result.phase).toBe("failed");
    expect(result.reason).toBe("beholder_kill");
    expect(result.response).toContain("agent killed by Beholder");
    expect(result.toolsUsed).toEqual([]);
    expect(echoToolRun).not.toHaveBeenCalled();
  });

  it("emits turn_result event with status + phase", async () => {
    const provider = createMockProvider("done");
    const agent = new Agent({ provider, model: "test", intentRequired: false });

    await agent.run("hello");
    const events = agent.getEventLogger().getEvents();
    const lastEvent = events[events.length - 1];

    expect(lastEvent.type).toBe("turn_result");
    expect(lastEvent.data).toMatchObject({
      status: "completed",
      phase: "completed",
      done: true,
    });
  });

  it("resolves tools from registry packs (instead of injecting all defaults)", async () => {
    const provider = createMockProvider("ok");
    const customTool: ToolDefinition = {
      name: "custom_tool",
      description: "custom",
      inputSchema: { type: "object", properties: {}, required: [] },
      run: () => "ok",
    };
    const registry = {
      resolvePacks: jest.fn().mockReturnValue([customTool]),
    };

    const agent = new Agent({
      provider,
      model: "test-model",
      toolRegistry: registry,
      toolPacks: ["custom-pack"],
      intentRequired: false,
    });

    await agent.run("hello");
    const call = (provider.chat as jest.Mock).mock.calls[0][0] as ChatRequest;
    const toolNames = (call.tools ?? []).map((tool) => tool.name);
    expect(toolNames).toEqual(["custom_tool"]);
    expect(registry.resolvePacks).toHaveBeenCalledWith(["custom-pack"]);
  });

  it("applies pre-run hooks that override model", async () => {
    const provider = createMockProvider("ok");
    const agent = new Agent({
      provider,
      model: "base-model",
      intentRequired: false,
      hooks: [
        (context) => {
          context.settings.model = "hook-model";
        },
      ],
    });

    await agent.run("hello");
    const call = (provider.chat as jest.Mock).mock.calls[0][0] as ChatRequest;
    expect(call.model).toBe("hook-model");
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
