import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/types.js";
import {
  deriveTelemetryTimeline,
  summarizeAgents,
  summarizeTasks,
  formatTelemetryTimeline,
} from "../src/telemetry.js";

function makeEvent(overrides: Partial<AgentEvent>): AgentEvent {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    schema_version: 2,
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
});
