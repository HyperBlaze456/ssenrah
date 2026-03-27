import { describe, it, expect } from "vitest";
import { verifySession, formatVerification } from "../src/verify.js";
import type { AgentEvent } from "../src/types.js";
import { randomUUID } from "node:crypto";

function makeEvent(
  overrides: Partial<AgentEvent> & { hook_event_type: string }
): AgentEvent {
  return {
    id: randomUUID(),
    timestamp: "2026-03-28T10:00:00.000Z",
    session_id: "session-1",
    hook_event_type: overrides.hook_event_type,
    cwd: "/test",
    ...overrides,
  };
}

describe("session verification", () => {
  it("extracts file edits", () => {
    const events = [
      makeEvent({
        hook_event_type: "PostToolUse",
        tool_name: "Edit",
        tool_input: { file_path: "/src/main.ts" },
      }),
      makeEvent({
        hook_event_type: "PostToolUse",
        tool_name: "Edit",
        tool_input: { file_path: "/src/utils.ts" },
      }),
    ];

    const report = verifySession(events, "session-1");
    expect(report.summary.files_edited).toBe(2);
    expect(report.files_modified).toContain("/src/main.ts");
    expect(report.files_modified).toContain("/src/utils.ts");
  });

  it("extracts file writes", () => {
    const events = [
      makeEvent({
        hook_event_type: "PostToolUse",
        tool_name: "Write",
        tool_input: { file_path: "/src/new-file.ts" },
      }),
    ];

    const report = verifySession(events, "session-1");
    expect(report.summary.files_written).toBe(1);
    expect(report.files_modified).toContain("/src/new-file.ts");
  });

  it("tracks file reads separately", () => {
    const events = [
      makeEvent({
        hook_event_type: "PostToolUse",
        tool_name: "Read",
        tool_input: { file_path: "/src/config.ts" },
      }),
    ];

    const report = verifySession(events, "session-1");
    expect(report.summary.files_read).toBe(1);
    // Reads don't appear in files_modified
    expect(report.files_modified).not.toContain("/src/config.ts");
  });

  it("extracts bash commands", () => {
    const events = [
      makeEvent({
        hook_event_type: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "ls -la" },
      }),
      makeEvent({
        hook_event_type: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "git status" },
      }),
    ];

    const report = verifySession(events, "session-1");
    expect(report.summary.commands_run).toBe(2);
    expect(report.commands[0]!.command).toBe("ls -la");
  });

  it("identifies test commands", () => {
    const events = [
      makeEvent({
        hook_event_type: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "npm test" },
      }),
      makeEvent({
        hook_event_type: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "npx vitest run" },
      }),
      makeEvent({
        hook_event_type: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "ls -la" },
      }),
    ];

    const report = verifySession(events, "session-1");
    expect(report.summary.tests_run).toBe(2);
    expect(report.test_runs).toHaveLength(2);
    expect(report.test_runs[0]!.is_test).toBe(true);
    expect(report.commands[2]!.is_test).toBe(false);
  });

  it("detects failed test commands", () => {
    const events = [
      makeEvent({
        hook_event_type: "PostToolUseFailure",
        tool_name: "Bash",
        tool_input: { command: "npm test" },
        error: "exit code 1",
      }),
    ];

    const report = verifySession(events, "session-1");
    expect(report.summary.tests_run).toBe(1);
    expect(report.summary.tests_failed).toBe(1);
    expect(report.test_runs[0]!.failed).toBe(true);
  });

  it("collects errors", () => {
    const events = [
      makeEvent({
        hook_event_type: "PostToolUseFailure",
        tool_name: "Edit",
        error: "old_string not found",
      }),
      makeEvent({
        hook_event_type: "StopFailure",
        error: "session crash",
      }),
    ];

    const report = verifySession(events, "session-1");
    expect(report.summary.errors).toBe(2);
    expect(report.errors[0]!.error).toBe("old_string not found");
    expect(report.errors[1]!.error).toBe("session crash");
  });

  it("deduplicates modified files", () => {
    const events = [
      makeEvent({
        hook_event_type: "PostToolUse",
        tool_name: "Edit",
        tool_input: { file_path: "/src/main.ts" },
        timestamp: "2026-03-28T10:00:00.000Z",
      }),
      makeEvent({
        hook_event_type: "PostToolUse",
        tool_name: "Edit",
        tool_input: { file_path: "/src/main.ts" },
        timestamp: "2026-03-28T10:01:00.000Z",
      }),
    ];

    const report = verifySession(events, "session-1");
    expect(report.summary.files_edited).toBe(2); // 2 edit events
    expect(report.files_modified).toHaveLength(1); // but 1 unique file
  });

  it("calculates duration", () => {
    const events = [
      makeEvent({
        hook_event_type: "SessionStart",
        timestamp: "2026-03-28T10:00:00.000Z",
      }),
      makeEvent({
        hook_event_type: "PostToolUse",
        tool_name: "Read",
        tool_input: { file_path: "/a.ts" },
        timestamp: "2026-03-28T10:05:00.000Z",
      }),
    ];

    const report = verifySession(events, "session-1");
    expect(report.summary.duration_seconds).toBe(300); // 5 minutes
  });

  it("filters to requested session only", () => {
    const events = [
      makeEvent({
        hook_event_type: "PostToolUse",
        tool_name: "Edit",
        tool_input: { file_path: "/a.ts" },
        session_id: "session-1",
      }),
      makeEvent({
        hook_event_type: "PostToolUse",
        tool_name: "Edit",
        tool_input: { file_path: "/b.ts" },
        session_id: "session-2",
      }),
    ];

    const report = verifySession(events, "session-1");
    expect(report.summary.files_edited).toBe(1);
    expect(report.files_modified).toEqual(["/a.ts"]);
  });

  it("returns empty report for unknown session", () => {
    const report = verifySession([], "nonexistent");
    expect(report.summary.total_events).toBe(0);
    expect(report.files_modified).toEqual([]);
    expect(report.commands).toEqual([]);
    expect(report.errors).toEqual([]);
  });

  it("recognizes various test command patterns", () => {
    const testCommands = [
      "npm test",
      "npx vitest run",
      "npx jest",
      "pytest tests/",
      "cargo test",
      "go test ./...",
      "make test",
    ];

    for (const cmd of testCommands) {
      const events = [
        makeEvent({
          hook_event_type: "PostToolUse",
          tool_name: "Bash",
          tool_input: { command: cmd },
        }),
      ];

      const report = verifySession(events, "session-1");
      expect(report.test_runs).toHaveLength(1);
    }
  });

  it("formats report without crashing", () => {
    const events = [
      makeEvent({
        hook_event_type: "PostToolUse",
        tool_name: "Edit",
        tool_input: { file_path: "/src/main.ts" },
        timestamp: "2026-03-28T10:00:00.000Z",
      }),
      makeEvent({
        hook_event_type: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "npm test" },
        timestamp: "2026-03-28T10:01:00.000Z",
      }),
      makeEvent({
        hook_event_type: "PostToolUseFailure",
        tool_name: "Bash",
        tool_input: { command: "npm run build" },
        error: "Type error",
        timestamp: "2026-03-28T10:02:00.000Z",
      }),
    ];

    const report = verifySession(events, "session-1");
    const output = formatVerification(report);
    expect(output).toContain("Session Verification");
    expect(output).toContain("/src/main.ts");
    expect(output).toContain("npm test");
    expect(output).toContain("Type error");
    expect(output).toContain("Verification checklist");
  });
});
