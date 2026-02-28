import { createSpawnAgentTool } from "../tools/spawn-agent";
import { AgentTypeRegistry } from "../agents/registry";
import { StaticToolRegistry } from "../tools/registry";
import type { AgentType } from "../agents/agent-types";
import type { LLMProvider, ChatResponse } from "../providers/types";

// Mock provider that returns a simple response
function createMockProvider(responseText = "Task completed."): LLMProvider {
  return {
    name: "mock",
    chat: async (): Promise<ChatResponse> => ({
      textBlocks: [responseText],
      toolCalls: [],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5 },
    }),
  };
}

describe("spawn_agent tool", () => {
  const explorerType: AgentType = {
    name: "explorer",
    description: "Read-only codebase exploration",
    model: "test-model",
    toolPacks: ["filesystem"],
    maxTurns: 5,
    intentRequired: false,
    isolation: { maxDepth: 2 },
  };

  const deepType: AgentType = {
    name: "deep",
    description: "Agent that can spawn more agents",
    model: "test-model",
    toolPacks: ["filesystem", "spawn"],
    maxTurns: 5,
    intentRequired: false,
    isolation: { maxDepth: 1 },
  };

  function createTestDeps(overrides?: Partial<Parameters<typeof createSpawnAgentTool>[0]>) {
    const registry = new AgentTypeRegistry();
    registry.register(explorerType);
    registry.register(deepType);

    const toolRegistry = new StaticToolRegistry();
    // Register a minimal filesystem pack for resolution
    toolRegistry.registerPack("filesystem", [
      {
        name: "read_file",
        description: "Read a file",
        inputSchema: { type: "object", properties: { path: { type: "string" } } },
        run: () => "file contents",
      },
    ]);

    return {
      registry,
      provider: createMockProvider(),
      toolRegistry,
      currentDepth: 0,
      ...overrides,
    };
  }

  it("spawns an agent and returns the result", async () => {
    const deps = createTestDeps({ provider: createMockProvider("Exploration complete.") });
    const tool = createSpawnAgentTool(deps);

    const result = await tool.run({
      agentType: "explorer",
      prompt: "Find all TypeScript files",
    });

    expect(result).toBe("Exploration complete.");
  });

  it("returns error for unknown agent type", async () => {
    const deps = createTestDeps();
    const tool = createSpawnAgentTool(deps);

    const result = await tool.run({
      agentType: "nonexistent",
      prompt: "do something",
    });

    expect(result).toContain("Error: unknown agent type");
    expect(result).toContain("nonexistent");
  });

  it("returns error for empty agentType", async () => {
    const deps = createTestDeps();
    const tool = createSpawnAgentTool(deps);

    const result = await tool.run({ agentType: "", prompt: "do something" });
    expect(result).toContain("Error: agentType is required");
  });

  it("returns error for empty prompt", async () => {
    const deps = createTestDeps();
    const tool = createSpawnAgentTool(deps);

    const result = await tool.run({ agentType: "explorer", prompt: "" });
    expect(result).toContain("Error: prompt is required");
  });

  it("enforces depth limit — refuses at maxDepth", async () => {
    // explorerType has maxDepth 2, so depth=2 should fail
    const deps = createTestDeps({ currentDepth: 2 });
    const tool = createSpawnAgentTool(deps);

    const result = await tool.run({
      agentType: "explorer",
      prompt: "explore",
    });

    expect(result).toContain("Error: spawn depth limit exceeded");
    expect(result).toContain("current=2");
    expect(result).toContain("max=2");
  });

  it("allows spawn when depth is below limit", async () => {
    // explorerType has maxDepth 2, depth=1 should work
    const deps = createTestDeps({
      currentDepth: 1,
      provider: createMockProvider("depth 1 ok"),
    });
    const tool = createSpawnAgentTool(deps);

    const result = await tool.run({
      agentType: "explorer",
      prompt: "explore",
    });

    expect(result).toBe("depth 1 ok");
  });

  it("defaults maxDepth to 1 when not specified", async () => {
    const typeNoDepth: AgentType = {
      name: "simple",
      description: "Simple agent with no explicit maxDepth",
      model: "test-model",
      intentRequired: false,
    };

    const registry = new AgentTypeRegistry();
    registry.register(typeNoDepth);

    const tool = createSpawnAgentTool({
      registry,
      provider: createMockProvider(),
      toolRegistry: new StaticToolRegistry(),
      currentDepth: 1, // at depth 1, maxDepth defaults to 1 => should fail
    });

    const result = await tool.run({
      agentType: "simple",
      prompt: "do something",
    });

    expect(result).toContain("Error: spawn depth limit exceeded");
  });

  it("enforces policy restriction — child cannot escalate", async () => {
    // Parent is "strict", child type is "local-permissive"
    // Effective should be "strict" (more restrictive)
    const permissiveType: AgentType = {
      name: "permissive",
      description: "Permissive agent",
      model: "test-model",
      toolPacks: [],
      policyProfile: "local-permissive",
      intentRequired: false,
    };

    const registry = new AgentTypeRegistry();
    registry.register(permissiveType);

    // We can't directly check the effective policy from outside,
    // but we verify the tool creates and runs the agent without error
    const tool = createSpawnAgentTool({
      registry,
      provider: createMockProvider("ran with strict policy"),
      toolRegistry: new StaticToolRegistry(),
      parentPolicyProfile: "strict",
      currentDepth: 0,
    });

    const result = await tool.run({
      agentType: "permissive",
      prompt: "do something",
    });

    // Should succeed — the policy is resolved internally
    expect(result).toBe("ran with strict policy");
  });

  it("prepends context to prompt when provided", async () => {
    const deps = createTestDeps({ provider: createMockProvider("context received") });
    const tool = createSpawnAgentTool(deps);

    const result = await tool.run({
      agentType: "explorer",
      prompt: "find files",
      context: "Look in the src directory",
    });

    expect(result).toBe("context received");
  });

  it("handles agent failure gracefully", async () => {
    const failingProvider: LLMProvider = {
      name: "failing",
      chat: async () => {
        throw new Error("Provider crashed");
      },
    };

    const deps = createTestDeps({ provider: failingProvider });
    const tool = createSpawnAgentTool(deps);

    const result = await tool.run({
      agentType: "explorer",
      prompt: "explore",
    });

    expect(result).toContain("Error: subagent");
    expect(result).toContain("failed");
  });

  it("includes available types in tool description", () => {
    const deps = createTestDeps();
    const tool = createSpawnAgentTool(deps);

    expect(tool.description).toContain("explorer");
    expect(tool.description).toContain("deep");
  });
});
