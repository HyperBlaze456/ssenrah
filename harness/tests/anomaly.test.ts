import { describe, it, expect } from "vitest";
import { detectAnomalies, DEFAULT_ANOMALY_CONFIG } from "../src/anomaly.js";
import type { AgentEvent } from "../src/types.js";
import { randomUUID } from "node:crypto";

function makeEvent(
  overrides: Partial<AgentEvent> & { hook_event_type: string }
): AgentEvent {
  return {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    session_id: "session-1",
    hook_event_type: overrides.hook_event_type,
    cwd: "/test",
    ...overrides,
  };
}

function makeToolEvent(
  toolName: string,
  toolInput: Record<string, unknown> = {},
  opts: { session_id?: string; timestamp?: string } = {}
): AgentEvent {
  return makeEvent({
    hook_event_type: "PostToolUse",
    tool_name: toolName,
    tool_input: toolInput,
    ...opts,
  });
}

function makeErrorEvent(
  toolName: string,
  opts: { session_id?: string; timestamp?: string } = {}
): AgentEvent {
  return makeEvent({
    hook_event_type: "PostToolUseFailure",
    tool_name: toolName,
    error: "something failed",
    ...opts,
  });
}

describe("anomaly detection", () => {
  describe("infinite loop detection", () => {
    it("detects repeated identical tool calls", () => {
      const events = Array.from({ length: 6 }, () =>
        makeToolEvent("Read", { file_path: "/same/file.ts" })
      );

      const anomalies = detectAnomalies(events, {
        ...DEFAULT_ANOMALY_CONFIG,
        loop_repeat_threshold: 5,
      });

      expect(anomalies.some((a) => a.type === "infinite_loop")).toBe(true);
      const loop = anomalies.find((a) => a.type === "infinite_loop")!;
      expect(loop.message).toContain("Read");
      expect(loop.message).toContain("6 times");
    });

    it("does not trigger below threshold", () => {
      const events = Array.from({ length: 3 }, () =>
        makeToolEvent("Read", { file_path: "/same/file.ts" })
      );

      const anomalies = detectAnomalies(events, {
        ...DEFAULT_ANOMALY_CONFIG,
        loop_repeat_threshold: 5,
      });

      expect(anomalies.filter((a) => a.type === "infinite_loop")).toHaveLength(0);
    });

    it("does not trigger for different inputs", () => {
      const events = Array.from({ length: 6 }, (_, i) =>
        makeToolEvent("Read", { file_path: `/file-${i}.ts` })
      );

      const anomalies = detectAnomalies(events, {
        ...DEFAULT_ANOMALY_CONFIG,
        loop_repeat_threshold: 5,
      });

      expect(anomalies.filter((a) => a.type === "infinite_loop")).toHaveLength(0);
    });

    it("marks critical when count is 2x threshold", () => {
      const events = Array.from({ length: 12 }, () =>
        makeToolEvent("Bash", { command: "npm test" })
      );

      const anomalies = detectAnomalies(events, {
        ...DEFAULT_ANOMALY_CONFIG,
        loop_repeat_threshold: 5,
      });

      const loop = anomalies.find((a) => a.type === "infinite_loop")!;
      expect(loop.severity).toBe("critical");
    });
  });

  describe("tool thrashing detection", () => {
    it("detects rapid tool switching with high failure rate", () => {
      const baseTime = new Date("2026-03-28T10:00:00.000Z").getTime();
      const events: AgentEvent[] = [];

      // 10 distinct tools in 30s, 50% failures
      for (let i = 0; i < 10; i++) {
        const ts = new Date(baseTime + i * 2000).toISOString();
        if (i % 2 === 0) {
          events.push(makeToolEvent(`Tool${i}`, {}, { timestamp: ts }));
        } else {
          events.push(makeErrorEvent(`Tool${i}`, { timestamp: ts }));
        }
      }

      const anomalies = detectAnomalies(events, {
        ...DEFAULT_ANOMALY_CONFIG,
        thrash_tool_count: 8,
        thrash_window_seconds: 30,
      });

      expect(anomalies.some((a) => a.type === "tool_thrashing")).toBe(true);
    });

    it("does not trigger with low failure rate", () => {
      const baseTime = new Date("2026-03-28T10:00:00.000Z").getTime();
      const events: AgentEvent[] = [];

      // 10 distinct tools, all succeed
      for (let i = 0; i < 10; i++) {
        const ts = new Date(baseTime + i * 2000).toISOString();
        events.push(makeToolEvent(`Tool${i}`, {}, { timestamp: ts }));
      }

      const anomalies = detectAnomalies(events, {
        ...DEFAULT_ANOMALY_CONFIG,
        thrash_tool_count: 8,
        thrash_window_seconds: 30,
      });

      expect(anomalies.filter((a) => a.type === "tool_thrashing")).toHaveLength(0);
    });
  });

  describe("error cascade detection", () => {
    it("detects rapid successive errors", () => {
      const baseTime = new Date("2026-03-28T10:00:00.000Z").getTime();
      const events = Array.from({ length: 6 }, (_, i) =>
        makeErrorEvent("Bash", {
          timestamp: new Date(baseTime + i * 5000).toISOString(),
        })
      );

      const anomalies = detectAnomalies(events, {
        ...DEFAULT_ANOMALY_CONFIG,
        error_cascade_count: 5,
        error_cascade_window_seconds: 60,
      });

      expect(anomalies.some((a) => a.type === "error_cascade")).toBe(true);
      const cascade = anomalies.find((a) => a.type === "error_cascade")!;
      expect(cascade.message).toContain("6 errors");
    });

    it("does not trigger when errors are spread out", () => {
      const baseTime = new Date("2026-03-28T10:00:00.000Z").getTime();
      const events = Array.from({ length: 6 }, (_, i) =>
        makeErrorEvent("Bash", {
          // 2 minutes apart — outside 60s window
          timestamp: new Date(baseTime + i * 120000).toISOString(),
        })
      );

      const anomalies = detectAnomalies(events, {
        ...DEFAULT_ANOMALY_CONFIG,
        error_cascade_count: 5,
        error_cascade_window_seconds: 60,
      });

      expect(anomalies.filter((a) => a.type === "error_cascade")).toHaveLength(0);
    });

    it("does not trigger below threshold", () => {
      const baseTime = new Date("2026-03-28T10:00:00.000Z").getTime();
      const events = Array.from({ length: 3 }, (_, i) =>
        makeErrorEvent("Bash", {
          timestamp: new Date(baseTime + i * 5000).toISOString(),
        })
      );

      const anomalies = detectAnomalies(events, {
        ...DEFAULT_ANOMALY_CONFIG,
        error_cascade_count: 5,
        error_cascade_window_seconds: 60,
      });

      expect(anomalies.filter((a) => a.type === "error_cascade")).toHaveLength(0);
    });
  });

  describe("cost spike detection", () => {
    it("detects high session cost", () => {
      const events = [
        makeEvent({
          hook_event_type: "Stop",
          cost_usd: 3.50,
        }),
      ];

      const anomalies = detectAnomalies(events, {
        ...DEFAULT_ANOMALY_CONFIG,
        cost_spike_threshold_usd: 2.0,
      });

      expect(anomalies.some((a) => a.type === "cost_spike")).toBe(true);
      const spike = anomalies.find((a) => a.type === "cost_spike")!;
      expect(spike.message).toContain("$3.50");
    });

    it("does not trigger below threshold", () => {
      const events = [
        makeEvent({
          hook_event_type: "Stop",
          cost_usd: 1.50,
        }),
      ];

      const anomalies = detectAnomalies(events, {
        ...DEFAULT_ANOMALY_CONFIG,
        cost_spike_threshold_usd: 2.0,
      });

      expect(anomalies.filter((a) => a.type === "cost_spike")).toHaveLength(0);
    });

    it("marks critical at 3x threshold", () => {
      const events = [
        makeEvent({
          hook_event_type: "Stop",
          cost_usd: 7.00,
        }),
      ];

      const anomalies = detectAnomalies(events, {
        ...DEFAULT_ANOMALY_CONFIG,
        cost_spike_threshold_usd: 2.0,
      });

      const spike = anomalies.find((a) => a.type === "cost_spike")!;
      expect(spike.severity).toBe("critical");
    });
  });

  describe("cross-session isolation", () => {
    it("detects anomalies independently per session", () => {
      const events = [
        ...Array.from({ length: 3 }, () =>
          makeToolEvent("Read", { file_path: "/a.ts" }, { session_id: "s1" })
        ),
        ...Array.from({ length: 6 }, () =>
          makeToolEvent("Read", { file_path: "/a.ts" }, { session_id: "s2" })
        ),
      ];

      const anomalies = detectAnomalies(events, {
        ...DEFAULT_ANOMALY_CONFIG,
        loop_repeat_threshold: 5,
      });

      const loops = anomalies.filter((a) => a.type === "infinite_loop");
      expect(loops).toHaveLength(1);
      expect(loops[0]!.session_id).toBe("s2");
    });
  });

  describe("empty input", () => {
    it("returns empty array for no events", () => {
      expect(detectAnomalies([])).toEqual([]);
    });

    it("returns empty array for normal activity", () => {
      const events = [
        makeToolEvent("Read", { file_path: "/a.ts" }),
        makeToolEvent("Edit", { file_path: "/b.ts" }),
        makeToolEvent("Bash", { command: "npm test" }),
      ];

      expect(detectAnomalies(events)).toEqual([]);
    });
  });
});
