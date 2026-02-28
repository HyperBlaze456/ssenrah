import { parseIntents, validateIntents, getIntentSystemPrompt, IntentDeclaration } from "../harness/intent";
import { Beholder } from "../harness/beholder";
import { FallbackAgent } from "../harness/fallback";
import { EventLogger } from "../harness/events";
import { LLMProvider, ChatRequest, ChatResponse, ToolCall } from "../providers/types";
import fs from "fs";
import os from "os";
import path from "path";

// ---------------------------------------------------------------------------
// Mock LLMProvider
// ---------------------------------------------------------------------------

function makeMockProvider(responseText: string): LLMProvider {
  return {
    name: "mock",
    async chat(_params: ChatRequest): Promise<ChatResponse> {
      return {
        textBlocks: [responseText],
        toolCalls: [],
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 20 },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// parseIntents
// ---------------------------------------------------------------------------

describe("parseIntents", () => {
  it("extracts intent from text with <intent> tags", () => {
    const text = `Let me read the file.
<intent>{"toolName":"read_file","purpose":"Read config","expectedOutcome":"File contents returned","riskLevel":"read"}</intent>
Some trailing text.`;
    const intents = parseIntents(text);
    expect(intents).toHaveLength(1);
    expect(intents[0].toolName).toBe("read_file");
    expect(intents[0].purpose).toBe("Read config");
    expect(intents[0].expectedOutcome).toBe("File contents returned");
    expect(intents[0].riskLevel).toBe("read");
    expect(typeof intents[0].timestamp).toBe("string");
  });

  it("returns empty array when no intents found", () => {
    const intents = parseIntents("No intent tags here at all.");
    expect(intents).toEqual([]);
  });

  it("handles malformed JSON gracefully", () => {
    const text = `<intent>{bad json here}</intent>
<intent>{"toolName":"edit_file","purpose":"Write output","expectedOutcome":"File written","riskLevel":"write"}</intent>`;
    const intents = parseIntents(text);
    // Only the valid one should be parsed
    expect(intents).toHaveLength(1);
    expect(intents[0].toolName).toBe("edit_file");
  });

  it("extracts multiple intents from text", () => {
    const text = `
<intent>{"toolName":"read_file","purpose":"Read config","expectedOutcome":"Contents","riskLevel":"read"}</intent>
<intent>{"toolName":"edit_file","purpose":"Update config","expectedOutcome":"Updated","riskLevel":"write"}</intent>`;
    const intents = parseIntents(text);
    expect(intents).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// validateIntents
// ---------------------------------------------------------------------------

describe("validateIntents", () => {
  const baseIntent: IntentDeclaration = {
    toolName: "read_file",
    purpose: "Read config",
    expectedOutcome: "Contents",
    riskLevel: "read",
    timestamp: new Date().toISOString(),
  };

  it("returns valid when all tool calls have matching intents", () => {
    const intents = [baseIntent];
    const toolCalls: ToolCall[] = [{ id: "tc1", name: "read_file", input: { path: "/etc/config" } }];
    const result = validateIntents(intents, toolCalls);
    expect(result.valid).toBe(true);
    expect(result.unmatched).toHaveLength(0);
  });

  it("returns unmatched tool calls when intents are missing", () => {
    const intents: IntentDeclaration[] = [];
    const toolCalls: ToolCall[] = [
      { id: "tc1", name: "read_file", input: { path: "/etc/config" } },
      { id: "tc2", name: "edit_file", input: { path: "/etc/config", content: "x" } },
    ];
    const result = validateIntents(intents, toolCalls);
    expect(result.valid).toBe(false);
    expect(result.unmatched).toHaveLength(2);
    expect(result.unmatched.map((u) => u.name)).toContain("read_file");
    expect(result.unmatched.map((u) => u.name)).toContain("edit_file");
  });

  it("returns only the unmatched tool calls", () => {
    const intents = [baseIntent]; // covers read_file only
    const toolCalls: ToolCall[] = [
      { id: "tc1", name: "read_file", input: {} },
      { id: "tc2", name: "edit_file", input: {} },
    ];
    const result = validateIntents(intents, toolCalls);
    expect(result.valid).toBe(false);
    expect(result.unmatched).toHaveLength(1);
    expect(result.unmatched[0].name).toBe("edit_file");
  });

  it("requires one intent per tool call occurrence", () => {
    const intents = [baseIntent]; // only one intent for read_file
    const toolCalls: ToolCall[] = [
      { id: "tc1", name: "read_file", input: { path: "a" } },
      { id: "tc2", name: "read_file", input: { path: "b" } },
    ];
    const result = validateIntents(intents, toolCalls);
    expect(result.valid).toBe(false);
    expect(result.unmatched).toHaveLength(1);
    expect(result.unmatched[0].id).toBe("tc2");
  });
});

// ---------------------------------------------------------------------------
// getIntentSystemPrompt
// ---------------------------------------------------------------------------

describe("getIntentSystemPrompt", () => {
  it("returns a non-empty string", () => {
    const prompt = getIntentSystemPrompt();
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  it("mentions the <intent> tag format", () => {
    const prompt = getIntentSystemPrompt();
    expect(prompt).toContain("<intent>");
  });
});

// ---------------------------------------------------------------------------
// Beholder
// ---------------------------------------------------------------------------

describe("Beholder", () => {
  function makeIntent(toolName: string = "read_file"): IntentDeclaration {
    return {
      toolName,
      purpose: "Test purpose",
      expectedOutcome: "Test outcome",
      riskLevel: "read",
      timestamp: new Date().toISOString(),
    };
  }

  function makeToolCall(name: string = "read_file", input: Record<string, unknown> = { path: "/tmp/file" }): ToolCall {
    return { id: Math.random().toString(36).slice(2), name, input };
  }

  it("returns ok for normal operation", async () => {
    const beholder = new Beholder();
    const verdict = await beholder.evaluate(makeIntent(), makeToolCall(), { inputTokens: 100, outputTokens: 50 });
    expect(verdict.action).toBe("ok");
  });

  it("detects loop (3+ identical consecutive tool calls)", async () => {
    const beholder = new Beholder();
    const intent = makeIntent();
    const call = makeToolCall("read_file", { path: "/tmp/same" });

    await beholder.evaluate(intent, call);
    await beholder.evaluate(intent, call);
    const verdict = await beholder.evaluate(intent, call);

    expect(verdict.action).toBe("kill");
    expect(verdict.reason).toContain("Loop detected");
  });

  it("detects rate limit violation", async () => {
    const beholder = new Beholder({ maxToolCallsPerMinute: 3 });
    const intent = makeIntent();

    // 3 unique calls to fill the window
    await beholder.evaluate(intent, makeToolCall("read_file", { path: "/a" }));
    await beholder.evaluate(intent, makeToolCall("read_file", { path: "/b" }));
    await beholder.evaluate(intent, makeToolCall("read_file", { path: "/c" }));
    // 4th call should trigger rate limit
    const verdict = await beholder.evaluate(intent, makeToolCall("read_file", { path: "/d" }));

    expect(verdict.action).toBe("pause");
    expect(verdict.reason).toContain("Rate limit");
  });

  it("detects budget overrun", async () => {
    const beholder = new Beholder({ maxTokenBudget: 100 });
    const verdict = await beholder.evaluate(
      makeIntent(),
      makeToolCall(),
      { inputTokens: 90, outputTokens: 20 } // 110 total > 100
    );
    expect(verdict.action).toBe("kill");
    expect(verdict.reason).toContain("Token budget exceeded");
  });

  it("reset clears state", async () => {
    const beholder = new Beholder({ maxTokenBudget: 50 });
    await beholder.evaluate(makeIntent(), makeToolCall(), { inputTokens: 40, outputTokens: 20 });
    beholder.reset();
    const stats = beholder.getStats();
    expect(stats.totalToolCalls).toBe(0);
    expect(stats.totalTokens).toBe(0);
    expect(stats.driftCount).toBe(0);
    // After reset, normal call should be ok
    const verdict = await beholder.evaluate(makeIntent(), makeToolCall(), { inputTokens: 10, outputTokens: 5 });
    expect(verdict.action).toBe("ok");
  });

  it("getStats returns correct cumulative values", async () => {
    const beholder = new Beholder();
    await beholder.evaluate(makeIntent(), makeToolCall(), { inputTokens: 100, outputTokens: 50 });
    await beholder.evaluate(makeIntent(), makeToolCall("edit_file", { path: "/x" }), { inputTokens: 200, outputTokens: 80 });
    const stats = beholder.getStats();
    expect(stats.totalToolCalls).toBe(2);
    expect(stats.totalTokens).toBe(430);
  });
});

// ---------------------------------------------------------------------------
// FallbackAgent
// ---------------------------------------------------------------------------

describe("FallbackAgent", () => {
  function makeIntent(): IntentDeclaration {
    return {
      toolName: "read_file",
      purpose: "Read a config file",
      expectedOutcome: "File contents returned",
      riskLevel: "read",
      timestamp: new Date().toISOString(),
    };
  }

  function makeToolCall(name: string = "read_file"): ToolCall {
    return { id: "tc1", name, input: { path: "/nonexistent" } };
  }

  it("returns resolved=true when retry succeeds", async () => {
    // Provider suggests switching to list_files, which succeeds
    const mockProvider = makeMockProvider(
      JSON.stringify({ toolName: "list_files", input: { path: "/tmp" } })
    );

    const fallback = new FallbackAgent({
      provider: mockProvider,
      model: "gemini-2.0-flash",
      maxRetries: 3,
    });
    const tools = [
      {
        name: "list_files",
        description: "List files in a directory",
        run: async (_input: Record<string, unknown>) => "file1.txt\nfile2.txt",
      },
      {
        name: "read_file",
        description: "Read a file",
        run: async (_input: Record<string, unknown>) => {
          throw new Error("File not found");
        },
      },
    ];

    const result = await fallback.handleFailure(makeToolCall(), "File not found", makeIntent(), tools);

    expect(result.resolved).toBe(true);
    expect(result.result).toBe("file1.txt\nfile2.txt");
    expect(result.attempts).toBe(1);
    expect(result.summary).toContain("SUCCESS");
  });

  it("returns resolved=false after max retries", async () => {
    // Provider always suggests a tool that doesn't exist
    const mockProvider = makeMockProvider(
      JSON.stringify({ toolName: "nonexistent_tool", input: {} })
    );

    const fallback = new FallbackAgent({
      provider: mockProvider,
      model: "gemini-2.0-flash",
      maxRetries: 3,
    });
    const tools = [
      {
        name: "read_file",
        description: "Read a file",
        run: async (_input: Record<string, unknown>) => {
          throw new Error("File not found");
        },
      },
    ];

    const result = await fallback.handleFailure(makeToolCall(), "File not found", makeIntent(), tools);

    expect(result.resolved).toBe(false);
    expect(result.summary).toContain("FAILED");
  });
});

// ---------------------------------------------------------------------------
// EventLogger
// ---------------------------------------------------------------------------

describe("EventLogger", () => {
  it("logs events to memory buffer", () => {
    const logger = new EventLogger();
    logger.log({
      timestamp: new Date().toISOString(),
      type: "tool_call",
      agentId: "agent-1",
      data: { toolName: "read_file" },
    });
    expect(logger.getEvents()).toHaveLength(1);
  });

  it("getEvents returns logged events in order", () => {
    const logger = new EventLogger();
    const timestamps = ["2024-01-01T00:00:00Z", "2024-01-01T00:01:00Z", "2024-01-01T00:02:00Z"];
    for (const ts of timestamps) {
      logger.log({ timestamp: ts, type: "intent", agentId: "agent-1", data: {} });
    }
    const events = logger.getEvents();
    expect(events).toHaveLength(3);
    expect(events[0].timestamp).toBe(timestamps[0]);
    expect(events[1].timestamp).toBe(timestamps[1]);
    expect(events[2].timestamp).toBe(timestamps[2]);
  });

  it("getEvents returns a copy (mutations do not affect the buffer)", () => {
    const logger = new EventLogger();
    logger.log({ timestamp: "t1", type: "error", agentId: "a1", data: {} });
    const events = logger.getEvents();
    events.push({ timestamp: "t2", type: "error", agentId: "a1", data: {} });
    expect(logger.getEvents()).toHaveLength(1);
  });

  it("writes JSONL events to disk when filePath is configured", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ssenrah-events-"));
    const logPath = path.join(tmpDir, "events.jsonl");
    try {
      const logger = new EventLogger({ filePath: logPath });
      logger.log({
        timestamp: "2024-01-01T00:00:00Z",
        type: "intent",
        agentId: "agent-1",
        data: { toolName: "read_file" },
      });
      const content = fs.readFileSync(logPath, "utf8");
      expect(content).toContain('"type":"intent"');
      expect(content).toContain('"agentId":"agent-1"');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("accepts policy/error governance events for fail-closed auditing", () => {
    const logger = new EventLogger();
    logger.log({
      timestamp: "2024-01-01T00:00:00Z",
      type: "policy",
      agentId: "agent-1",
      data: { tool: "exec_command", action: "deny", reason: "managed_profile_denies_exec" },
    });
    logger.log({
      timestamp: "2024-01-01T00:00:01Z",
      type: "error",
      agentId: "agent-1",
      data: { reason: "policy_denied", tool: "exec_command" },
    });

    const events = logger.getEvents();
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: "policy",
      data: { action: "deny" },
    });
    expect(events[1]).toMatchObject({
      type: "error",
      data: { reason: "policy_denied" },
    });
  });
});
