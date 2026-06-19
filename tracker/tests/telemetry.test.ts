import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/types.js";
import {
  deriveTelemetryTimeline,
  deriveRunTrace,
  getAuthoritativeSessionCost,
  getAuthoritativeTotalCost,
  summarizeSessions,
  summarizeAgents,
  summarizeTasks,
  formatTelemetryTimeline,
} from "../src/telemetry.js";

function makeEvent(overrides: Partial<AgentEvent>): AgentEvent {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    schema_version: 3,
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    session_id: overrides.session_id ?? "session-1",
    hook_event_type: overrides.hook_event_type ?? "PostToolUse",
    cwd: overrides.cwd ?? "/repo",
    ...overrides,
  };
}

describe("telemetry", () => {
  it("derives a normalized timeline", () => {
    const records = deriveTelemetryTimeline([
      makeEvent({
        timestamp: "2026-04-01T00:00:00.000Z",
        hook_event_type: "SessionStart",
        model: "claude-sonnet-4-6",
        source: "startup",
      }),
      makeEvent({
        timestamp: "2026-04-01T00:00:01.000Z",
        hook_event_type: "TaskCreated",
        task_id: "task-1",
        task_subject: "Investigate flaky test",
      }),
      makeEvent({
        timestamp: "2026-04-01T00:00:02.000Z",
        hook_event_type: "PostToolUseFailure",
        tool_name: "Bash",
        error: "npm test failed",
      }),
    ]);

    expect(records).toHaveLength(3);
    expect(records[0]!.operation).toBe("session.start");
    expect(records[1]!.operation).toBe("task.create");
    expect(records[2]!.severity).toBe("error");

    const formatted = formatTelemetryTimeline(records);
    expect(formatted).toContain("session.start");
    expect(formatted).toContain("task.create");
    expect(formatted).toContain("tool.failure");
  });

  it("summarizes agent activity across main and subagents", () => {
    const summaries = summarizeAgents([
      makeEvent({
        timestamp: "2026-04-01T00:00:00.000Z",
        hook_event_type: "SessionStart",
      }),
      makeEvent({
        timestamp: "2026-04-01T00:00:01.000Z",
        hook_event_type: "SubagentStart",
        agent_id: "agent_12345678",
        agent_type: "Explore",
      }),
      makeEvent({
        timestamp: "2026-04-01T00:00:02.000Z",
        hook_event_type: "PostToolUse",
        agent_id: "agent_12345678",
        agent_type: "Explore",
        tool_name: "Read",
      }),
      makeEvent({
        timestamp: "2026-04-01T00:00:03.000Z",
        hook_event_type: "PostToolUseFailure",
        agent_id: "agent_12345678",
        agent_type: "Explore",
        tool_name: "Bash",
        error: "boom",
      }),
    ]);

    expect(summaries).toHaveLength(2);
    const subagent = summaries.find((summary) => summary.actor_kind === "subagent");
    expect(subagent?.tool_calls).toBe(2);
    expect(subagent?.failures).toBe(1);
  });

  it("summarizes task lifecycle and duration", () => {
    const tasks = summarizeTasks([
      makeEvent({
        timestamp: "2026-04-01T00:00:01.000Z",
        hook_event_type: "TaskCreated",
        task_id: "task-1",
        task_subject: "Write regression test",
        teammate_name: "builder",
      }),
      makeEvent({
        timestamp: "2026-04-01T00:00:11.000Z",
        hook_event_type: "TaskCompleted",
        task_id: "task-1",
        task_subject: "Write regression test",
        teammate_name: "builder",
      }),
    ]);

    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.status).toBe("completed");
    expect(tasks[0]!.duration_seconds).toBe(10);
    expect(tasks[0]!.owner).toBe("builder");
  });

  it("uses the latest session cost snapshot instead of summing duplicates", () => {
    const events = [
      makeEvent({
        session_id: "session-cost",
        timestamp: "2026-04-01T00:00:00.000Z",
        hook_event_type: "Stop",
        cost_usd: 1.25,
      }),
      makeEvent({
        session_id: "session-cost",
        timestamp: "2026-04-01T00:00:10.000Z",
        hook_event_type: "SessionEnd",
        cost_usd: 1.25,
      }),
    ];

    expect(getAuthoritativeSessionCost(events, "session-cost")).toBe(1.25);
    expect(summarizeSessions(events)[0]!.cost_usd).toBe(1.25);
    expect(getAuthoritativeTotalCost(events)).toBe(1.25);
  });

  it("collapses short inspection-only helper agents in run traces", () => {
    const trace = deriveRunTrace(
      [
        makeEvent({
          id: "main-start",
          timestamp: "2026-04-01T00:00:00.000Z",
          hook_event_type: "SessionStart",
        }),
        makeEvent({
          id: "prompt-1",
          timestamp: "2026-04-01T00:00:01.000Z",
          hook_event_type: "UserPromptSubmit",
          prompt: "Investigate the failing spec",
          prompt_segment_id: "prompt-1",
        }),
        makeEvent({
          id: "sub-read",
          timestamp: "2026-04-01T00:00:02.000Z",
          hook_event_type: "PostToolUse",
          agent_id: "agent-helper",
          agent_type: "Explore",
          tool_name: "Read",
          tool_category: "inspection",
          effect_level: "inspection_only",
        }),
      ],
      "session-1",
    );

    expect(trace).not.toBeNull();
    expect(trace?.lanes.find((lane) => lane.actor_id === "agent-helper")?.expanded).toBe(false);
    expect(
      trace?.nodes.some(
        (node) => node.actor_id === "agent-helper" && node.collapsed_by_default,
      ),
    ).toBe(true);
  });

  it("expands significant branches and supports prompt slicing", () => {
    const expandedTrace = deriveRunTrace(
      [
        makeEvent({
          id: "main-start",
          timestamp: "2026-04-01T00:00:00.000Z",
          hook_event_type: "SessionStart",
        }),
        makeEvent({
          id: "prompt-1",
          timestamp: "2026-04-01T00:00:01.000Z",
          hook_event_type: "UserPromptSubmit",
          prompt: "Handle request one",
          prompt_segment_id: "prompt-1",
        }),
        makeEvent({
          id: "sub-start",
          timestamp: "2026-04-01T00:00:02.000Z",
          hook_event_type: "SubagentStart",
          agent_id: "agent-builder",
          agent_type: "Builder",
        }),
        makeEvent({
          id: "sub-edit",
          timestamp: "2026-04-01T00:00:03.000Z",
          hook_event_type: "PostToolUse",
          agent_id: "agent-builder",
          agent_type: "Builder",
          tool_name: "Edit",
          tool_category: "filesystem",
          effect_level: "significant_side_effect",
        }),
      ],
      "session-1",
    );

    const trace = deriveRunTrace(
      [
        makeEvent({
          id: "main-start",
          timestamp: "2026-04-01T00:00:00.000Z",
          hook_event_type: "SessionStart",
        }),
        makeEvent({
          id: "prompt-1",
          timestamp: "2026-04-01T00:00:01.000Z",
          hook_event_type: "UserPromptSubmit",
          prompt: "Handle request one",
          prompt_segment_id: "prompt-1",
        }),
        makeEvent({
          id: "sub-start",
          timestamp: "2026-04-01T00:00:02.000Z",
          hook_event_type: "SubagentStart",
          agent_id: "agent-builder",
          agent_type: "Builder",
        }),
        makeEvent({
          id: "sub-edit",
          timestamp: "2026-04-01T00:00:03.000Z",
          hook_event_type: "PostToolUse",
          agent_id: "agent-builder",
          agent_type: "Builder",
          tool_name: "Edit",
          tool_category: "filesystem",
          effect_level: "significant_side_effect",
        }),
        makeEvent({
          id: "prompt-2",
          timestamp: "2026-04-01T00:00:04.000Z",
          hook_event_type: "UserPromptSubmit",
          prompt: "Handle request two",
          prompt_segment_id: "prompt-2",
        }),
        makeEvent({
          id: "team-task",
          timestamp: "2026-04-01T00:00:05.000Z",
          hook_event_type: "TaskCreated",
          teammate_name: "verifier",
          team_name: "qa-team",
          task_id: "task-1",
          task_subject: "Verify request two",
        }),
      ],
      "session-1",
      { promptSliceId: "prompt-2" },
    );

    expect(expandedTrace?.lanes.find((lane) => lane.actor_id === "agent-builder")?.expanded).toBe(true);
    expect(trace?.prompt_slices).toHaveLength(2);
    expect(trace?.lanes.some((lane) => lane.actor_id === "agent-builder")).toBe(false);
    expect(trace?.lanes.some((lane) => lane.branch_kind === "team")).toBe(true);
    expect(trace?.first_event).toBe("2026-04-01T00:00:04.000Z");
  });

  it("marks a TaskSummary as failed from completion_status", () => {
    const tasks = summarizeTasks([
      makeEvent({
        timestamp: "2026-04-01T00:00:00.000Z",
        hook_event_type: "TaskCreated",
        task_id: "task-x",
        task_subject: "Risky task",
      }),
      makeEvent({
        timestamp: "2026-04-01T00:00:05.000Z",
        hook_event_type: "TaskCompleted",
        task_id: "task-x",
        completion_status: "failed",
        outcome: "failed",
      }),
    ]);
    const task = tasks.find((candidate) => candidate.task_id === "task-x")!;
    expect(task.status).toBe("failed");
  });

  it("surfaces session tokens, cost_kind and lane cost from terminal token_usage", () => {
    const events = [
      makeEvent({
        timestamp: "2026-04-01T00:00:00.000Z",
        hook_event_type: "SessionStart",
        model: "claude-sonnet-4-6",
      }),
      makeEvent({
        timestamp: "2026-04-01T00:00:10.000Z",
        hook_event_type: "Stop",
        cost_usd: 0.42,
        reported_cost_usd: 0.39,
        cost_kind: "recomputed",
        ttft_ms: 900,
        token_usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cache_read_input_tokens: 200,
          cache_creation_input_tokens: 100,
          total_tokens: 1800,
          main_total_tokens: 1800,
          sidechain_total_tokens: 0,
        },
      }),
    ];

    const session = summarizeSessions(events)[0]!;
    expect(session.cost_usd).toBeCloseTo(0.42, 4);
    expect(session.reported_cost_usd).toBeCloseTo(0.39, 4);
    expect(session.cost_kind).toBe("recomputed");
    expect(session.total_tokens).toBe(1800);
    expect(session.input_tokens).toBe(1000);
    expect(session.ttft_ms).toBe(900);

    const trace = deriveRunTrace(events, "session-1");
    const mainLane = trace?.lanes.find((lane) => lane.id === "lane:main");
    expect(mainLane?.cost_usd).toBeCloseTo(0.42, 4);
    expect(mainLane?.total_tokens).toBe(1800);
  });
});
