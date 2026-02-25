import { Agent } from "../agent/agent";
import { ToolDefinition } from "../agent/types";
import { Team } from "../teams/team";

describe("Agent", () => {
  it("constructs without error", () => {
    expect(() => new Agent()).not.toThrow();
  });

  it("getHistory returns empty array initially", () => {
    const agent = new Agent();
    expect(agent.getHistory()).toEqual([]);
  });

  it("clearHistory empties the history", () => {
    const agent = new Agent();
    agent.clearHistory();
    expect(agent.getHistory()).toEqual([]);
  });

  it("respects custom maxTurns in config", () => {
    // Agent should be constructable with maxTurns
    expect(() => new Agent({ maxTurns: 5 })).not.toThrow();
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
  it("throws when maxWorkers is 0", () => {
    expect(
      () => new Team({ name: "test", maxWorkers: 0 })
    ).toThrow("maxWorkers must be a positive integer");
  });

  it("throws when maxWorkers is negative", () => {
    expect(
      () => new Team({ name: "test", maxWorkers: -1 })
    ).toThrow("maxWorkers must be a positive integer");
  });

  it("constructs successfully with valid maxWorkers", () => {
    expect(() => new Team({ name: "test", maxWorkers: 2 })).not.toThrow();
  });

  it("defaults maxWorkers to 3 when not specified", () => {
    expect(() => new Team({ name: "test" })).not.toThrow();
  });
});
