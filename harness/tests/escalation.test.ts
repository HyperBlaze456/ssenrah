import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadEscalationConfig,
  createDefaultConfig,
  computeSessionState,
  evaluateRules,
} from "../src/escalation.js";
import type { AgentEvent, EscalationRule } from "../src/types.js";

let testDir: string;
let origHome: string | undefined;

function makeEvent(overrides: Partial<AgentEvent>): AgentEvent {
  return {
    id: `test-${Math.random().toString(36).slice(2)}`,
    timestamp: new Date().toISOString(),
    session_id: "test-session",
    hook_event_type: "PostToolUse",
    cwd: "/test",
    ...overrides,
  };
}

describe("escalation config", () => {
  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `ssenrah-esc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testDir, { recursive: true });
    origHome = process.env.HOME;
    process.env.HOME = testDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    if (existsSync(testDir)) rmSync(testDir, { recursive: true });
  });

  it("creates default config when none exists", () => {
    createDefaultConfig();
    const configPath = join(testDir, ".ssenrah", "escalation.json");
    expect(existsSync(configPath)).toBe(true);

    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(config.rules).toHaveLength(3);
    expect(config.rules[0].condition).toBe("session_cost_exceeds");
    expect(config.rules[1].condition).toBe("error_count_exceeds");
    expect(config.rules[2].condition).toBe("session_duration_exceeds");
  });

  it("loads existing config from disk", () => {
    const configDir = join(testDir, ".ssenrah");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "escalation.json"),
      JSON.stringify({
        rules: [
          {
            name: "Custom rule",
            condition: "session_cost_exceeds",
            threshold: 10,
            action: "console",
          },
        ],
      })
    );

    const config = loadEscalationConfig();
    expect(config.rules).toHaveLength(1);
    expect(config.rules[0]!.name).toBe("Custom rule");
    expect(config.rules[0]!.threshold).toBe(10);
  });

  it("falls back to defaults on corrupted config", () => {
    const configDir = join(testDir, ".ssenrah");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "escalation.json"), "not valid json {{{");

    const config = loadEscalationConfig();
    expect(config.rules).toHaveLength(3);
  });
});

describe("computeSessionState", () => {
  it("computes state from events", () => {
    const now = Date.now();
    const events: AgentEvent[] = [
      makeEvent({
        session_id: "sess-A",
        timestamp: new Date(now).toISOString(),
        hook_event_type: "SessionStart",
      }),
      makeEvent({
        session_id: "sess-A",
        timestamp: new Date(now + 60000).toISOString(),
        hook_event_type: "PostToolUse",
      }),
      makeEvent({
        session_id: "sess-A",
        timestamp: new Date(now + 120000).toISOString(),
        hook_event_type: "PostToolUseFailure",
      }),
      makeEvent({
        session_id: "sess-A",
        timestamp: new Date(now + 180000).toISOString(),
        hook_event_type: "Stop",
        cost_usd: 1.5,
      }),
    ];

    const state = computeSessionState(events, "sess-A");
    expect(state.session_id).toBe("sess-A");
    expect(state.event_count).toBe(4);
    expect(state.error_count).toBe(1);
    expect(state.duration_seconds).toBe(180);
    expect(state.cost_usd).toBe(1.5);
  });

  it("returns zero state for unknown session", () => {
    const state = computeSessionState([], "nonexistent");
    expect(state.event_count).toBe(0);
    expect(state.cost_usd).toBe(0);
    expect(state.error_count).toBe(0);
  });

  it("filters to the correct session", () => {
    const events: AgentEvent[] = [
      makeEvent({ session_id: "sess-A", hook_event_type: "PostToolUseFailure" }),
      makeEvent({ session_id: "sess-B", hook_event_type: "PostToolUseFailure" }),
      makeEvent({ session_id: "sess-B", hook_event_type: "PostToolUseFailure" }),
    ];

    const stateA = computeSessionState(events, "sess-A");
    const stateB = computeSessionState(events, "sess-B");
    expect(stateA.error_count).toBe(1);
    expect(stateB.error_count).toBe(2);
  });
});

describe("evaluateRules", () => {
  const rules: EscalationRule[] = [
    {
      name: "Cost alert",
      condition: "session_cost_exceeds",
      threshold: 5.0,
      action: "log",
    },
    {
      name: "Error alert",
      condition: "error_count_exceeds",
      threshold: 3,
      action: "log",
    },
    {
      name: "Duration alert",
      condition: "session_duration_exceeds",
      threshold: 3600,
      action: "console",
    },
  ];

  it("returns no alerts when all below threshold", () => {
    const state = {
      session_id: "s1",
      cost_usd: 1.0,
      duration_seconds: 600,
      error_count: 1,
      event_count: 10,
    };
    const alerts = evaluateRules(rules, state);
    expect(alerts).toHaveLength(0);
  });

  it("fires cost alert when exceeded", () => {
    const state = {
      session_id: "s1",
      cost_usd: 7.5,
      duration_seconds: 600,
      error_count: 1,
      event_count: 10,
    };
    const alerts = evaluateRules(rules, state);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.rule_name).toBe("Cost alert");
    expect(alerts[0]!.actual_value).toBe(7.5);
    expect(alerts[0]!.threshold).toBe(5.0);
  });

  it("fires multiple alerts when multiple thresholds exceeded", () => {
    const state = {
      session_id: "s1",
      cost_usd: 10,
      duration_seconds: 7200,
      error_count: 5,
      event_count: 100,
    };
    const alerts = evaluateRules(rules, state);
    expect(alerts).toHaveLength(3);
  });

  it("does not fire at exactly the threshold (strict greater-than)", () => {
    const state = {
      session_id: "s1",
      cost_usd: 5.0,
      duration_seconds: 3600,
      error_count: 3,
      event_count: 10,
    };
    const alerts = evaluateRules(rules, state);
    expect(alerts).toHaveLength(0);
  });

  it("skips unknown conditions", () => {
    const customRules: EscalationRule[] = [
      {
        name: "Unknown",
        condition: "unknown_condition" as EscalationRule["condition"],
        threshold: 1,
        action: "log",
      },
    ];
    const state = {
      session_id: "s1",
      cost_usd: 100,
      duration_seconds: 99999,
      error_count: 999,
      event_count: 10,
    };
    const alerts = evaluateRules(customRules, state);
    expect(alerts).toHaveLength(0);
  });
});
