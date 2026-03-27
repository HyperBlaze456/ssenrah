import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractDecisionChain, formatDecisionChain } from "../src/reasoning.js";

function makeTranscriptLine(entry: Record<string, unknown>): string {
  return JSON.stringify(entry);
}

function assistantEntry(
  msgId: string,
  contentBlocks: Array<Record<string, unknown>>,
  opts: { model?: string; timestamp?: string; sessionId?: string } = {}
): string {
  return makeTranscriptLine({
    type: "assistant",
    sessionId: opts.sessionId ?? "test-session",
    timestamp: opts.timestamp ?? "2026-03-28T10:00:00.000Z",
    message: {
      id: msgId,
      model: opts.model ?? "claude-opus-4-6",
      role: "assistant",
      content: contentBlocks,
      usage: { input_tokens: 100, output_tokens: 50 },
    },
  });
}

function userEntry(
  content: string,
  opts: { timestamp?: string; sessionId?: string } = {}
): string {
  return makeTranscriptLine({
    type: "user",
    sessionId: opts.sessionId ?? "test-session",
    timestamp: opts.timestamp ?? "2026-03-28T09:59:00.000Z",
    message: { role: "user", content },
  });
}

describe("reasoning extractor", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ssenrah-reasoning-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("extracts thinking blocks from transcript", () => {
    const path = join(tmpDir, "transcript.jsonl");
    writeFileSync(
      path,
      [
        assistantEntry("msg-1", [
          { type: "thinking", thinking: "I need to read the config file first." },
        ]),
        assistantEntry("msg-1", [
          { type: "text", text: "Let me check the config." },
        ]),
        assistantEntry("msg-1", [
          {
            type: "tool_use",
            name: "Read",
            id: "tu-1",
            input: { file_path: "/config.json" },
          },
        ]),
      ].join("\n")
    );

    const chain = extractDecisionChain(path);
    expect(chain).not.toBeNull();
    expect(chain!.steps).toHaveLength(1);

    const step = chain!.steps[0]!;
    expect(step.thinking).toBe("I need to read the config file first.");
    expect(step.reasoning).toBe("Let me check the config.");
    expect(step.decisions).toHaveLength(1);
    expect(step.decisions[0]!.tool_name).toBe("Read");
    expect(step.decisions[0]!.tool_input).toEqual({ file_path: "/config.json" });
  });

  it("extracts user prompts", () => {
    const path = join(tmpDir, "transcript.jsonl");
    writeFileSync(
      path,
      [
        userEntry("Fix the login bug"),
        assistantEntry("msg-1", [
          { type: "text", text: "I'll investigate the login issue." },
        ]),
      ].join("\n")
    );

    const chain = extractDecisionChain(path);
    expect(chain).not.toBeNull();
    expect(chain!.prompts).toHaveLength(1);
    expect(chain!.prompts[0]!.content).toBe("Fix the login bug");
  });

  it("groups multiple entries by message.id into one turn", () => {
    const path = join(tmpDir, "transcript.jsonl");
    writeFileSync(
      path,
      [
        assistantEntry("msg-A", [
          { type: "thinking", thinking: "Step 1 reasoning" },
        ]),
        assistantEntry("msg-A", [
          { type: "tool_use", name: "Bash", id: "tu-1", input: { command: "ls" } },
        ]),
        assistantEntry("msg-A", [
          { type: "tool_use", name: "Read", id: "tu-2", input: { file_path: "a.ts" } },
        ]),
      ].join("\n")
    );

    const chain = extractDecisionChain(path);
    expect(chain!.steps).toHaveLength(1);
    expect(chain!.steps[0]!.decisions).toHaveLength(2);
    expect(chain!.steps[0]!.decisions[0]!.tool_name).toBe("Bash");
    expect(chain!.steps[0]!.decisions[1]!.tool_name).toBe("Read");
  });

  it("separates different message.ids into separate turns", () => {
    const path = join(tmpDir, "transcript.jsonl");
    writeFileSync(
      path,
      [
        assistantEntry("msg-1", [
          { type: "text", text: "First turn" },
        ], { timestamp: "2026-03-28T10:00:00.000Z" }),
        assistantEntry("msg-1", [
          { type: "tool_use", name: "Read", id: "tu-1", input: {} },
        ], { timestamp: "2026-03-28T10:00:01.000Z" }),
        assistantEntry("msg-2", [
          { type: "thinking", thinking: "Second turn thinking" },
        ], { timestamp: "2026-03-28T10:01:00.000Z" }),
        assistantEntry("msg-2", [
          { type: "tool_use", name: "Edit", id: "tu-2", input: {} },
        ], { timestamp: "2026-03-28T10:01:01.000Z" }),
      ].join("\n")
    );

    const chain = extractDecisionChain(path);
    expect(chain!.steps).toHaveLength(2);
    expect(chain!.steps[0]!.reasoning).toBe("First turn");
    expect(chain!.steps[1]!.thinking).toBe("Second turn thinking");
  });

  it("computes summary correctly", () => {
    const path = join(tmpDir, "transcript.jsonl");
    writeFileSync(
      path,
      [
        userEntry("Do something"),
        userEntry("And another thing"),
        assistantEntry("msg-1", [
          { type: "thinking", thinking: "think" },
        ]),
        assistantEntry("msg-1", [
          { type: "text", text: "reason" },
        ]),
        assistantEntry("msg-1", [
          { type: "tool_use", name: "Read", id: "t1", input: {} },
        ]),
        assistantEntry("msg-2", [
          { type: "tool_use", name: "Edit", id: "t2", input: {} },
        ]),
        assistantEntry("msg-2", [
          { type: "tool_use", name: "Write", id: "t3", input: {} },
        ]),
      ].join("\n")
    );

    const chain = extractDecisionChain(path);
    expect(chain!.summary.total_turns).toBe(2);
    expect(chain!.summary.total_thinking_blocks).toBe(1);
    expect(chain!.summary.total_reasoning_blocks).toBe(1);
    expect(chain!.summary.total_decisions).toBe(3);
    expect(chain!.summary.total_user_prompts).toBe(2);
    expect(chain!.summary.models_used).toEqual(["claude-opus-4-6"]);
  });

  it("tracks multiple models", () => {
    const path = join(tmpDir, "transcript.jsonl");
    writeFileSync(
      path,
      [
        assistantEntry("msg-1", [
          { type: "text", text: "opus turn" },
        ], { model: "claude-opus-4-6" }),
        assistantEntry("msg-2", [
          { type: "text", text: "sonnet turn" },
        ], { model: "claude-sonnet-4-6" }),
      ].join("\n")
    );

    const chain = extractDecisionChain(path);
    expect(chain!.summary.models_used).toContain("claude-opus-4-6");
    expect(chain!.summary.models_used).toContain("claude-sonnet-4-6");
  });

  it("returns null for nonexistent file", () => {
    expect(extractDecisionChain("/nonexistent/path.jsonl")).toBeNull();
  });

  it("returns null for empty file", () => {
    const path = join(tmpDir, "empty.jsonl");
    writeFileSync(path, "");
    expect(extractDecisionChain(path)).toBeNull();
  });

  it("skips non-assistant/non-user entries", () => {
    const path = join(tmpDir, "transcript.jsonl");
    writeFileSync(
      path,
      [
        makeTranscriptLine({ type: "progress", data: {} }),
        makeTranscriptLine({ type: "file-history-snapshot", snapshot: {} }),
        assistantEntry("msg-1", [
          { type: "text", text: "only turn" },
        ]),
      ].join("\n")
    );

    const chain = extractDecisionChain(path);
    expect(chain!.steps).toHaveLength(1);
    expect(chain!.prompts).toHaveLength(0);
  });

  it("handles malformed JSON lines gracefully", () => {
    const path = join(tmpDir, "transcript.jsonl");
    writeFileSync(
      path,
      [
        "not-valid-json",
        assistantEntry("msg-1", [
          { type: "text", text: "valid turn" },
        ]),
        "{broken",
      ].join("\n")
    );

    const chain = extractDecisionChain(path);
    expect(chain).not.toBeNull();
    expect(chain!.steps).toHaveLength(1);
  });

  it("handles user content as array of blocks", () => {
    const path = join(tmpDir, "transcript.jsonl");
    writeFileSync(
      path,
      [
        makeTranscriptLine({
          type: "user",
          sessionId: "test-session",
          timestamp: "2026-03-28T10:00:00.000Z",
          message: {
            role: "user",
            content: [
              { type: "text", text: "Part one." },
              { type: "text", text: "Part two." },
            ],
          },
        }),
      ].join("\n")
    );

    const chain = extractDecisionChain(path);
    expect(chain!.prompts).toHaveLength(1);
    expect(chain!.prompts[0]!.content).toBe("Part one.\nPart two.");
  });

  it("concatenates multiple thinking blocks in same turn", () => {
    const path = join(tmpDir, "transcript.jsonl");
    writeFileSync(
      path,
      [
        assistantEntry("msg-1", [
          { type: "thinking", thinking: "First thought." },
        ]),
        assistantEntry("msg-1", [
          { type: "thinking", thinking: "Second thought." },
        ]),
      ].join("\n")
    );

    const chain = extractDecisionChain(path);
    expect(chain!.steps[0]!.thinking).toBe("First thought.\nSecond thought.");
  });

  it("formats decision chain without crashing", () => {
    const path = join(tmpDir, "transcript.jsonl");
    writeFileSync(
      path,
      [
        userEntry("Hello"),
        assistantEntry("msg-1", [
          { type: "thinking", thinking: "Analyzing request" },
        ]),
        assistantEntry("msg-1", [
          { type: "text", text: "Let me help." },
        ]),
        assistantEntry("msg-1", [
          { type: "tool_use", name: "Read", id: "t1", input: { file_path: "x.ts" } },
        ]),
      ].join("\n")
    );

    const chain = extractDecisionChain(path)!;
    const output = formatDecisionChain(chain);
    expect(output).toContain("Decision Chain");
    expect(output).toContain("Thinking:");
    expect(output).toContain("Reasoning:");
    expect(output).toContain("Read");
    expect(output).toContain("User: Hello");
  });
});
