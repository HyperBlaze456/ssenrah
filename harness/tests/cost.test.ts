import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { calculateSessionCost, formatCost, formatTokens } from "../src/cost.js";

let testDir: string;

describe("calculateSessionCost", () => {
  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `ssenrah-cost-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true });
  });

  it("calculates cost from a transcript with Sonnet messages", () => {
    const transcriptPath = join(testDir, "transcript.jsonl");
    const lines = [
      JSON.stringify({
        type: "assistant",
        message: {
          model: "claude-sonnet-4-6",
          usage: {
            input_tokens: 1000,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            output_tokens: 500,
          },
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          model: "claude-sonnet-4-6",
          usage: {
            input_tokens: 2000,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            output_tokens: 1000,
          },
        },
      }),
    ];
    writeFileSync(transcriptPath, lines.join("\n") + "\n");

    const cost = calculateSessionCost(transcriptPath);
    expect(cost).not.toBeNull();
    expect(cost!.model).toBe("claude-sonnet-4-6");
    expect(cost!.input_tokens).toBe(3000);
    expect(cost!.output_tokens).toBe(1500);
    // Sonnet: $3/1M input + $15/1M output
    // (3000/1M)*3 + (1500/1M)*15 = 0.009 + 0.0225 = 0.0315
    expect(cost!.cost_usd).toBeCloseTo(0.0315, 4);
  });

  it("calculates cost with cache tokens", () => {
    const transcriptPath = join(testDir, "transcript.jsonl");
    writeFileSync(
      transcriptPath,
      JSON.stringify({
        type: "assistant",
        message: {
          model: "claude-sonnet-4-6",
          usage: {
            input_tokens: 100,
            cache_creation_input_tokens: 500,
            cache_read_input_tokens: 10000,
            output_tokens: 200,
          },
        },
      }) + "\n"
    );

    const cost = calculateSessionCost(transcriptPath);
    expect(cost).not.toBeNull();
    expect(cost!.cache_read_input_tokens).toBe(10000);
    expect(cost!.cache_creation_input_tokens).toBe(500);
    // Sonnet cache: $0.30/1M read, $3.75/1M creation
    // input: (100/1M)*3 = 0.0003
    // output: (200/1M)*15 = 0.003
    // cache_read: (10000/1M)*0.30 = 0.003
    // cache_creation: (500/1M)*3.75 = 0.001875
    // total = 0.008175
    expect(cost!.cost_usd).toBeCloseTo(0.0082, 3);
  });

  it("handles Opus pricing correctly", () => {
    const transcriptPath = join(testDir, "transcript.jsonl");
    writeFileSync(
      transcriptPath,
      JSON.stringify({
        type: "assistant",
        message: {
          model: "claude-opus-4-6",
          usage: {
            input_tokens: 1000,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            output_tokens: 1000,
          },
        },
      }) + "\n"
    );

    const cost = calculateSessionCost(transcriptPath);
    expect(cost).not.toBeNull();
    // Opus: $15/1M input + $75/1M output
    // (1000/1M)*15 + (1000/1M)*75 = 0.015 + 0.075 = 0.09
    expect(cost!.cost_usd).toBeCloseTo(0.09, 4);
  });

  it("handles model ID with suffix (e.g. claude-opus-4-6[1m])", () => {
    const transcriptPath = join(testDir, "transcript.jsonl");
    writeFileSync(
      transcriptPath,
      JSON.stringify({
        type: "assistant",
        message: {
          model: "claude-opus-4-6[1m]",
          usage: {
            input_tokens: 1000,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            output_tokens: 1000,
          },
        },
      }) + "\n"
    );

    const cost = calculateSessionCost(transcriptPath);
    expect(cost).not.toBeNull();
    // Should match Opus pricing via prefix match
    expect(cost!.cost_usd).toBeCloseTo(0.09, 4);
  });

  it("uses fallback pricing for unknown models", () => {
    const transcriptPath = join(testDir, "transcript.jsonl");
    writeFileSync(
      transcriptPath,
      JSON.stringify({
        type: "assistant",
        message: {
          model: "claude-future-model-99",
          usage: {
            input_tokens: 1000,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            output_tokens: 1000,
          },
        },
      }) + "\n"
    );

    const cost = calculateSessionCost(transcriptPath);
    expect(cost).not.toBeNull();
    // Falls back to Sonnet pricing
    expect(cost!.cost_usd).toBeCloseTo(0.018, 3);
  });

  it("returns null for non-existent transcript", () => {
    const cost = calculateSessionCost("/tmp/does-not-exist.jsonl");
    expect(cost).toBeNull();
  });

  it("returns null for transcript with no usage data", () => {
    const transcriptPath = join(testDir, "transcript.jsonl");
    writeFileSync(
      transcriptPath,
      JSON.stringify({ type: "user", message: "hello" }) + "\n"
    );
    const cost = calculateSessionCost(transcriptPath);
    expect(cost).toBeNull();
  });

  it("computes total_tokens as sum of all token types", () => {
    const transcriptPath = join(testDir, "transcript.jsonl");
    writeFileSync(
      transcriptPath,
      JSON.stringify({
        type: "assistant",
        message: {
          model: "claude-sonnet-4-6",
          usage: {
            input_tokens: 100,
            cache_creation_input_tokens: 200,
            cache_read_input_tokens: 300,
            output_tokens: 400,
          },
        },
      }) + "\n"
    );

    const cost = calculateSessionCost(transcriptPath);
    expect(cost!.total_tokens).toBe(1000);
  });

  it("parses the real fixture transcript", () => {
    const fixturePath = join(
      import.meta.dirname,
      "fixtures",
      "transcript-sample.jsonl"
    );
    const cost = calculateSessionCost(fixturePath);
    expect(cost).not.toBeNull();
    expect(cost!.model).toBe("claude-sonnet-4-6");
    // 3 assistant messages: 100+200+150=450 input, 500+0+100=600 cache_create,
    // 2000+3000+4000=9000 cache_read, 50+100+30=180 output
    expect(cost!.input_tokens).toBe(450);
    expect(cost!.cache_creation_input_tokens).toBe(600);
    expect(cost!.cache_read_input_tokens).toBe(9000);
    expect(cost!.output_tokens).toBe(180);
  });
});

describe("formatCost", () => {
  it("formats small costs with 4 decimals", () => {
    expect(formatCost(0.0042)).toBe("$0.0042");
  });

  it("formats sub-dollar costs with 3 decimals", () => {
    expect(formatCost(0.123)).toBe("$0.123");
  });

  it("formats dollar+ costs with 2 decimals", () => {
    expect(formatCost(5.678)).toBe("$5.68");
  });
});

describe("formatTokens", () => {
  it("formats small counts as-is", () => {
    expect(formatTokens(500)).toBe("500");
  });

  it("formats thousands as K", () => {
    expect(formatTokens(114511)).toBe("114.5K");
  });

  it("formats millions as M", () => {
    expect(formatTokens(2500000)).toBe("2.50M");
  });
});
