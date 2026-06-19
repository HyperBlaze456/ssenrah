import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { calculateSessionCost, formatCost, formatTokens } from "../src/cost.js";

let testDir: string;

function writeCodexRollout(path: string, overrides: {
  sessionId?: string;
  model?: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
} = {}): void {
  const sessionId = overrides.sessionId ?? "codex-session";
  const model = overrides.model ?? "gpt-5.4";
  const lines = [
    JSON.stringify({
      timestamp: "2026-04-05T00:00:00.000Z",
      type: "session_meta",
      payload: {
        id: sessionId,
        timestamp: "2026-04-05T00:00:00.000Z",
        cwd: "/repo",
        source: "cli",
        model_provider: "openai",
      },
    }),
    JSON.stringify({
      timestamp: "2026-04-05T00:00:01.000Z",
      type: "turn_context",
      payload: {
        turn_id: "turn-1",
        cwd: "/repo",
        model,
      },
    }),
    JSON.stringify({
      timestamp: "2026-04-05T00:00:02.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: overrides.inputTokens ?? 1000,
            cached_input_tokens: overrides.cachedInputTokens ?? 500,
            output_tokens: overrides.outputTokens ?? 400,
            reasoning_output_tokens: overrides.reasoningOutputTokens ?? 150,
            total_tokens: (overrides.inputTokens ?? 1000) + (overrides.outputTokens ?? 400),
          },
        },
      },
    }),
  ];

  writeFileSync(path, lines.join("\n") + "\n");
}

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

  it("calculates cost from a Codex rollout transcript", () => {
    const transcriptPath = join(testDir, "codex-rollout.jsonl");
    writeCodexRollout(transcriptPath, {
      model: "gpt-5.4",
      inputTokens: 1000,
      cachedInputTokens: 500,
      outputTokens: 400,
      reasoningOutputTokens: 150,
    });

    const cost = calculateSessionCost(transcriptPath);
    expect(cost).not.toBeNull();
    expect(cost!.model).toBe("gpt-5.4");
    expect(cost!.input_tokens).toBe(1000);
    expect(cost!.cache_read_input_tokens).toBe(500);
    expect(cost!.output_tokens).toBe(400);
    expect(cost!.cost_usd).toBeCloseTo(0.0086, 4);
  });

  it("uses GPT-5.3-Codex pricing as the prefix match for Codex Spark rollouts", () => {
    const transcriptPath = join(testDir, "codex-spark-rollout.jsonl");
    writeCodexRollout(transcriptPath, {
      model: "gpt-5.3-codex-spark",
      inputTokens: 1000,
      cachedInputTokens: 1000,
      outputTokens: 1000,
    });

    const cost = calculateSessionCost(transcriptPath);
    expect(cost).not.toBeNull();
    expect(cost!.model).toBe("gpt-5.3-codex-spark");
    expect(cost!.cost_usd).toBeCloseTo(0.0159, 4);
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
    // Flat cache_creation is treated as the 5m tier (no regression).
    expect(cost!.cost_kind).toBe("recomputed");
  });

  it("splits cache_creation into 5m / 1h tiers and prices the 1h tier higher", () => {
    const transcriptPath = join(testDir, "transcript.jsonl");
    writeFileSync(
      transcriptPath,
      JSON.stringify({
        type: "assistant",
        message: {
          model: "claude-sonnet-4-6",
          usage: {
            input_tokens: 100,
            output_tokens: 200,
            cache_read_input_tokens: 0,
            cache_creation: {
              ephemeral_5m_input_tokens: 1000,
              ephemeral_1h_input_tokens: 2000,
            },
          },
        },
      }) + "\n"
    );

    const cost = calculateSessionCost(transcriptPath);
    expect(cost).not.toBeNull();
    expect(cost!.cache_creation_5m_input_tokens).toBe(1000);
    expect(cost!.cache_creation_1h_input_tokens).toBe(2000);
    expect(cost!.cache_creation_input_tokens).toBe(3000);
    // input 0.0003 + output 0.003 + 5m (1000/1M*3.75=0.00375) + 1h (2000/1M*6=0.012)
    expect(cost!.cost_usd).toBeCloseTo(0.0191, 4);
  });

  it("captures reported cost, ttft, duration, service tier, web search, and main/sidechain split", () => {
    const transcriptPath = join(testDir, "transcript.jsonl");
    const lines = [
      JSON.stringify({
        type: "assistant",
        isSidechain: false,
        costUSD: 0.05,
        durationMs: 1200,
        ttftMs: 800,
        requestId: "req_main",
        message: {
          model: "claude-sonnet-4-6",
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
            service_tier: "standard",
            server_tool_use: { web_search_requests: 2 },
          },
        },
      }),
      JSON.stringify({
        type: "assistant",
        isSidechain: true,
        costUSD: 0.02,
        durationMs: 600,
        ttftMs: 300,
        message: {
          model: "claude-sonnet-4-6",
          usage: { input_tokens: 200, output_tokens: 100 },
        },
      }),
    ];
    writeFileSync(transcriptPath, lines.join("\n") + "\n");

    const cost = calculateSessionCost(transcriptPath);
    expect(cost).not.toBeNull();
    expect(cost!.reported_cost_usd).toBeCloseTo(0.07, 4);
    expect(cost!.ttft_ms).toBe(800); // first main-lane turn
    expect(cost!.duration_ms).toBe(1800);
    expect(cost!.service_tier).toBe("standard");
    expect(cost!.web_search_requests).toBe(2);
    expect(cost!.main_total_tokens).toBe(150);
    expect(cost!.sidechain_total_tokens).toBe(300);
    expect(cost!.cost_kind).toBe("recomputed");
  });

  it("surfaces Codex reasoning_output_tokens", () => {
    const transcriptPath = join(testDir, "codex-rollout.jsonl");
    writeCodexRollout(transcriptPath, { reasoningOutputTokens: 150 });
    const cost = calculateSessionCost(transcriptPath);
    expect(cost).not.toBeNull();
    expect(cost!.reasoning_output_tokens).toBe(150);
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
