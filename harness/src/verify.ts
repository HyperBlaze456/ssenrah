/**
 * Session verification — extract and summarize what an agent session changed.
 *
 * V-5: "Provide environment for humans to quickly test/verify agent work."
 *
 * Parses the event log to extract:
 * - Files written or edited (from Edit/Write tool events)
 * - Commands executed (from Bash tool events)
 * - Test results (from Bash outputs containing test patterns)
 * - Errors encountered
 *
 * Gives humans a quick overview of what happened and what to check.
 */
import type { AgentEvent } from "./types.js";

export interface FileChange {
  file_path: string;
  action: "edit" | "write" | "read";
  timestamp: string;
  tool_use_id?: string;
}

export interface CommandExecution {
  command: string;
  timestamp: string;
  /** Whether this was a test command (npm test, vitest, jest, etc.) */
  is_test: boolean;
  /** Whether the command failed */
  failed: boolean;
  tool_use_id?: string;
}

export interface SessionVerification {
  session_id: string;
  /** Files modified during the session */
  files_changed: FileChange[];
  /** Unique file paths that were modified (edit/write only) */
  files_modified: string[];
  /** Commands executed */
  commands: CommandExecution[];
  /** Test commands and their outcomes */
  test_runs: CommandExecution[];
  /** Errors encountered */
  errors: Array<{ timestamp: string; tool_name?: string; error: string }>;
  /** Summary statistics */
  summary: {
    total_events: number;
    files_edited: number;
    files_written: number;
    files_read: number;
    commands_run: number;
    tests_run: number;
    tests_failed: number;
    errors: number;
    duration_seconds: number;
  };
}

const TEST_PATTERNS = [
  /\bnpm\s+test\b/,
  /\bnpx\s+(vitest|jest|mocha|ava)\b/,
  /\bvitest\s+run\b/,
  /\bjest\b/,
  /\bpytest\b/,
  /\bcargo\s+test\b/,
  /\bgo\s+test\b/,
  /\bmake\s+test\b/,
];

function isTestCommand(command: string): boolean {
  return TEST_PATTERNS.some((p) => p.test(command));
}

/**
 * Extract file changes from tool events.
 */
function extractFileChanges(events: AgentEvent[]): FileChange[] {
  const changes: FileChange[] = [];

  for (const e of events) {
    if (e.hook_event_type !== "PostToolUse" || !e.tool_name) continue;

    const input = e.tool_input ?? {};
    const filePath =
      (input.file_path as string) ??
      (input.path as string) ??
      undefined;

    if (!filePath) continue;

    let action: FileChange["action"] | undefined;
    switch (e.tool_name) {
      case "Edit":
        action = "edit";
        break;
      case "Write":
        action = "write";
        break;
      case "Read":
        action = "read";
        break;
      default:
        continue;
    }

    changes.push({
      file_path: filePath,
      action,
      timestamp: e.timestamp,
      tool_use_id: e.tool_use_id,
    });
  }

  return changes;
}

/**
 * Extract command executions from Bash tool events.
 */
function extractCommands(events: AgentEvent[]): CommandExecution[] {
  const commands: CommandExecution[] = [];

  // Collect both success and failure bash events
  const bashEvents = events.filter(
    (e) =>
      (e.hook_event_type === "PostToolUse" ||
        e.hook_event_type === "PostToolUseFailure") &&
      e.tool_name === "Bash"
  );

  for (const e of bashEvents) {
    const input = e.tool_input ?? {};
    const command = (input.command as string) ?? "";
    if (!command) continue;

    commands.push({
      command,
      timestamp: e.timestamp,
      is_test: isTestCommand(command),
      failed: e.hook_event_type === "PostToolUseFailure",
      tool_use_id: e.tool_use_id,
    });
  }

  return commands;
}

/**
 * Extract errors from the event log.
 */
function extractErrors(
  events: AgentEvent[]
): Array<{ timestamp: string; tool_name?: string; error: string }> {
  const errors: Array<{ timestamp: string; tool_name?: string; error: string }> = [];

  for (const e of events) {
    if (
      e.hook_event_type === "PostToolUseFailure" ||
      e.hook_event_type === "StopFailure"
    ) {
      errors.push({
        timestamp: e.timestamp,
        tool_name: e.tool_name,
        error: e.error ?? "Unknown error",
      });
    }
  }

  return errors;
}

/**
 * Build a session verification report from events.
 */
export function verifySession(
  events: AgentEvent[],
  sessionId: string
): SessionVerification {
  const sessionEvents = events.filter((e) => e.session_id === sessionId);

  const fileChanges = extractFileChanges(sessionEvents);
  const commands = extractCommands(sessionEvents);
  const errors = extractErrors(sessionEvents);

  const modifications = fileChanges.filter(
    (f) => f.action === "edit" || f.action === "write"
  );
  const filesModified = [...new Set(modifications.map((f) => f.file_path))];

  const testRuns = commands.filter((c) => c.is_test);
  const testsFailed = testRuns.filter((c) => c.failed).length;

  // Duration
  let duration = 0;
  if (sessionEvents.length >= 2) {
    const first = new Date(sessionEvents[0]!.timestamp).getTime();
    const last = new Date(
      sessionEvents[sessionEvents.length - 1]!.timestamp
    ).getTime();
    duration = Math.round((last - first) / 1000);
  }

  return {
    session_id: sessionId,
    files_changed: fileChanges,
    files_modified: filesModified,
    commands,
    test_runs: testRuns,
    errors,
    summary: {
      total_events: sessionEvents.length,
      files_edited: fileChanges.filter((f) => f.action === "edit").length,
      files_written: fileChanges.filter((f) => f.action === "write").length,
      files_read: fileChanges.filter((f) => f.action === "read").length,
      commands_run: commands.length,
      tests_run: testRuns.length,
      tests_failed: testsFailed,
      errors: errors.length,
      duration_seconds: duration,
    },
  };
}

/**
 * Format a verification report for CLI display.
 */
export function formatVerification(v: SessionVerification): string {
  const lines: string[] = [];

  lines.push("╔══════════════════════════════════════════════════════╗");
  lines.push("║        ssenrah — Session Verification (V-5)         ║");
  lines.push("╠══════════════════════════════════════════════════════╣");
  lines.push(`║  Session:      ${v.session_id.slice(0, 8).padEnd(37)} ║`);

  const mins = Math.floor(v.summary.duration_seconds / 60);
  const secs = v.summary.duration_seconds % 60;
  const durStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  lines.push(`║  Duration:     ${durStr.padEnd(37)} ║`);
  lines.push(`║  Total events: ${String(v.summary.total_events).padEnd(37)} ║`);
  lines.push("╠══════════════════════════════════════════════════════╣");
  lines.push(`║  Files edited:  ${String(v.summary.files_edited).padEnd(36)} ║`);
  lines.push(`║  Files written: ${String(v.summary.files_written).padEnd(36)} ║`);
  lines.push(`║  Files read:    ${String(v.summary.files_read).padEnd(36)} ║`);
  lines.push(`║  Commands run:  ${String(v.summary.commands_run).padEnd(36)} ║`);
  lines.push(`║  Tests run:     ${String(v.summary.tests_run).padEnd(36)} ║`);

  if (v.summary.tests_failed > 0) {
    lines.push(`║  Tests FAILED:  ${String(v.summary.tests_failed).padEnd(36)} ║`);
  }

  lines.push(`║  Errors:        ${String(v.summary.errors).padEnd(36)} ║`);
  lines.push("╚══════════════════════════════════════════════════════╝");

  // Modified files
  if (v.files_modified.length > 0) {
    lines.push("");
    lines.push("  Modified files:");
    for (const f of v.files_modified) {
      lines.push(`    ✎ ${f}`);
    }
  }

  // Test results
  if (v.test_runs.length > 0) {
    lines.push("");
    lines.push("  Test runs:");
    for (const t of v.test_runs) {
      const icon = t.failed ? "✗" : "✓";
      const time = new Date(t.timestamp).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
      const cmd =
        t.command.length > 50 ? t.command.slice(0, 50) + "…" : t.command;
      lines.push(`    ${icon} ${time}  ${cmd}`);
    }
  }

  // Errors
  if (v.errors.length > 0) {
    lines.push("");
    lines.push("  Errors:");
    for (const err of v.errors.slice(-10)) {
      const time = new Date(err.timestamp).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
      const tool = err.tool_name ? `[${err.tool_name}] ` : "";
      const msg =
        err.error.length > 60 ? err.error.slice(0, 60) + "…" : err.error;
      lines.push(`    ✗ ${time}  ${tool}${msg}`);
    }
  }

  // Quick verification checklist
  lines.push("");
  lines.push("  Verification checklist:");
  if (v.files_modified.length > 0) {
    lines.push(`    [ ] Review ${v.files_modified.length} modified file(s)`);
  }
  if (v.test_runs.length > 0) {
    if (v.summary.tests_failed > 0) {
      lines.push(`    [!] ${v.summary.tests_failed} test run(s) failed — investigate`);
    } else {
      lines.push(`    [✓] All ${v.test_runs.length} test run(s) passed`);
    }
  } else {
    lines.push("    [ ] No tests were run — consider running tests");
  }
  if (v.errors.length > 0) {
    lines.push(`    [!] ${v.errors.length} error(s) occurred — review above`);
  }

  return lines.join("\n");
}
