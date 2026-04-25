import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";

const FIXTURES_DIR = join(import.meta.dirname, "fixtures");
const HOOK_SCRIPT = join(import.meta.dirname, "..", "src", "hook.ts");
const HARNESS_DIR = join(import.meta.dirname, "..");

let testLogDir: string;

function runHookWithFixture(fixtureName: string): void {
  const fixturePath = join(FIXTURES_DIR, fixtureName);
  execSync(`cat "${fixturePath}" | npx tsx "${HOOK_SCRIPT}"`, {
    env: { ...process.env, SSENRAH_LOG_DIR: testLogDir },
    cwd: HARNESS_DIR,
    timeout: 30000,
  });
}

function runHookWithStdin(input: string): void {
  execSync(`printf '%s' ${JSON.stringify(input)} | npx tsx "${HOOK_SCRIPT}"`, {
    env: { ...process.env, SSENRAH_LOG_DIR: testLogDir },
    cwd: HARNESS_DIR,
    timeout: 30000,
  });
}

function readEvents(): Record<string, unknown>[] {
  const logFile = join(testLogDir, "events.jsonl");
  if (!existsSync(logFile)) return [];
  return readFileSync(logFile, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe("hook handler", () => {
  beforeEach(() => {
    testLogDir = join(tmpdir(), `ssenrah-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testLogDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testLogDir)) rmSync(testLogDir, { recursive: true });
  });

  it("captures PostToolUse event with correct fields", () => {
    runHookWithFixture("post-tool-use.json");
    const events = readEvents();
    expect(events).toHaveLength(1);

    const event = events[0]!;
    expect(event.hook_event_type).toBe("PostToolUse");
    expect(event.session_id).toBe("abc-123-def");
    expect(event.tool_name).toBe("Bash");
    expect(event.id).toBeDefined();
    expect(event.timestamp).toBeDefined();
  }, 30000);

  it("captures SessionStart event with model info", () => {
    runHookWithFixture("session-start.json");
    const events = readEvents();
    expect(events).toHaveLength(1);

    const event = events[0]!;
    expect(event.hook_event_type).toBe("SessionStart");
    expect(event.model).toBe("claude-sonnet-4-6");
    expect(event.source).toBe("startup");
  }, 30000);

  it("captures TaskCompleted with task_id and task_subject", () => {
    runHookWithFixture("task-completed.json");
    const events = readEvents();
    expect(events).toHaveLength(1);

    const event = events[0]!;
    expect(event.hook_event_type).toBe("TaskCompleted");
    expect(event.task_id).toBe("task_42");
    expect(event.task_subject).toBe("Implement user authentication");
    expect(event.teammate_name).toBe("builder");
    expect(event.team_name).toBe("dev-team");
  }, 30000);

  it("captures SubagentStart with agent_id", () => {
    runHookWithFixture("subagent-start.json");
    const events = readEvents();
    expect(events).toHaveLength(1);

    const event = events[0]!;
    expect(event.hook_event_type).toBe("SubagentStart");
    expect(event.agent_id).toBe("agent_007");
    expect(event.agent_type).toBe("Explore");
  }, 30000);

  it("redacts secrets in tool_input", () => {
    runHookWithFixture("tool-with-secrets.json");
    const events = readEvents();
    expect(events).toHaveLength(1);

    const event = events[0]!;
    const toolInput = event.tool_input as Record<string, string>;
    expect(toolInput.command).toContain("[REDACTED]");
    expect(toolInput.command).not.toContain("VERY_SECRET_KEY_HERE");
  }, 30000);

  it("handles empty stdin gracefully", () => {
    runHookWithStdin("");
    const events = readEvents();
    expect(events).toHaveLength(0);
  }, 30000);

  it("handles malformed JSON by logging parse error event", () => {
    runHookWithStdin("not valid json {{{");
    const events = readEvents();
    expect(events).toHaveLength(1);
    expect(events[0]!.hook_event_type).toBe("_parse_error");
  }, 30000);

  it("appends multiple events to the same file", () => {
    runHookWithFixture("session-start.json");
    runHookWithFixture("post-tool-use.json");
    runHookWithFixture("task-completed.json");
    const events = readEvents();
    expect(events).toHaveLength(3);
    expect(events[0]!.hook_event_type).toBe("SessionStart");
    expect(events[1]!.hook_event_type).toBe("PostToolUse");
    expect(events[2]!.hook_event_type).toBe("TaskCompleted");
  }, 60000);

  it("preserves raw payload in _raw field", () => {
    runHookWithFixture("post-tool-use.json");
    const events = readEvents();
    const raw = events[0]!._raw as Record<string, unknown>;
    expect(raw.session_id).toBe("abc-123-def");
    expect(raw.transcript_path).toBeDefined();
  }, 30000);

  it("captures richer top-level hook telemetry fields", () => {
    runHookWithStdin(
      JSON.stringify({
        session_id: "session-telemetry",
        transcript_path: "/tmp/main-transcript.jsonl",
        cwd: "/repo",
        hook_event_name: "SubagentStop",
        agent_id: "agent_12345678",
        agent_type: "Research",
        agent_transcript_path: "/tmp/subagent-transcript.jsonl",
        reason: "completed",
        worktree_path: "/repo/.worktrees/research",
        custom_extra_field: "keep-me",
      }),
    );

    const events = readEvents();
    const event = events[0]!;
    expect(event.schema_version).toBe(3);
    expect(event.transcript_path).toBe("/tmp/main-transcript.jsonl");
    expect(event.agent_transcript_path).toBe("/tmp/subagent-transcript.jsonl");
    expect(event.worktree_path).toBe("/repo/.worktrees/research");
    expect(event.root_run_id).toBe("session-telemetry");
    expect(event.branch_kind).toBe("subagent");
    expect((event.extras as Record<string, unknown>).custom_extra_field).toBe("keep-me");
  }, 30000);

  it("captures elicitation and cwd-specific fields", () => {
    runHookWithStdin(
      JSON.stringify({
        session_id: "session-telemetry",
        transcript_path: "/tmp/main-transcript.jsonl",
        cwd: "/repo",
        hook_event_name: "ElicitationResult",
        action: "accept",
        content: { approved: true },
        elicitation_id: "elicitation_42",
        mode: "form",
        url: "https://example.com/review",
        old_cwd: "/repo",
        new_cwd: "/repo/subdir",
      }),
    );

    const events = readEvents();
    const event = events[0]!;
    expect(event.action).toBe("accept");
    expect(event.elicitation_id).toBe("elicitation_42");
    expect(event.mode).toBe("form");
    expect(event.url).toBe("https://example.com/review");
    expect(event.old_cwd).toBe("/repo");
    expect(event.new_cwd).toBe("/repo/subdir");
    expect(event.content).toEqual({ approved: true });
  }, 30000);

  it("derives tool significance metadata for inspection-heavy subagents", () => {
    runHookWithStdin(
      JSON.stringify({
        session_id: "session-telemetry",
        transcript_path: "/tmp/main-transcript.jsonl",
        cwd: "/repo",
        hook_event_name: "PostToolUse",
        tool_name: "Read",
        tool_input: { file_path: "/repo/README.md" },
        agent_id: "agent_helper",
        agent_type: "Explore",
      }),
    );

    const event = readEvents()[0]!;
    expect(event.tool_category).toBe("inspection");
    expect(event.effect_level).toBe("inspection_only");
    expect(event.collapsed_by_default).toBe(true);
  }, 30000);

  it("captures UserPromptExpansion (slash command expansion) fields", () => {
    runHookWithStdin(
      JSON.stringify({
        session_id: "session-expansion",
        transcript_path: "/tmp/expansion.jsonl",
        cwd: "/repo",
        hook_event_name: "UserPromptExpansion",
        expansion_type: "slash_command",
        command_name: "review",
        command_args: "--branch main",
        command_source: ".claude/commands/review.md",
        prompt: "expanded content",
      }),
    );

    const event = readEvents()[0]!;
    expect(event.hook_event_type).toBe("UserPromptExpansion");
    expect(event.expansion_type).toBe("slash_command");
    expect(event.command_name).toBe("review");
    expect(event.command_args).toBe("--branch main");
    expect(event.command_source).toBe(".claude/commands/review.md");
    expect(event.prompt).toBe("expanded content");
    expect(event.tool_category).toBe("coordination");
  }, 30000);

  it("captures PostToolBatch with the parallel tool_calls array", () => {
    runHookWithStdin(
      JSON.stringify({
        session_id: "session-batch",
        transcript_path: "/tmp/batch.jsonl",
        cwd: "/repo",
        hook_event_name: "PostToolBatch",
        tool_calls: [
          { tool_name: "Read", tool_use_id: "tu_a" },
          { tool_name: "Grep", tool_use_id: "tu_b" },
        ],
      }),
    );

    const event = readEvents()[0]!;
    expect(event.hook_event_type).toBe("PostToolBatch");
    expect(Array.isArray(event.tool_calls)).toBe(true);
    expect((event.tool_calls as Array<Record<string, unknown>>)).toHaveLength(2);
  }, 30000);

  it("captures PermissionDenied as a safety/policy event", () => {
    runHookWithStdin(
      JSON.stringify({
        session_id: "session-deny",
        transcript_path: "/tmp/deny.jsonl",
        cwd: "/repo",
        hook_event_name: "PermissionDenied",
        tool_name: "Bash",
        tool_input: { command: "rm -rf /" },
      }),
    );

    const event = readEvents()[0]!;
    expect(event.hook_event_type).toBe("PermissionDenied");
    expect(event.effect_level).toBe("safety_or_policy");
  }, 30000);

  it("captures Stop with stop_reason and StopFailure with error_type/error_message", () => {
    runHookWithStdin(
      JSON.stringify({
        session_id: "session-stop",
        transcript_path: "/tmp/stop.jsonl",
        cwd: "/repo",
        hook_event_name: "Stop",
        stop_reason: "end_turn",
      }),
    );

    runHookWithStdin(
      JSON.stringify({
        session_id: "session-stop",
        transcript_path: "/tmp/stop.jsonl",
        cwd: "/repo",
        hook_event_name: "StopFailure",
        error_type: "rate_limit",
        error_message: "rate limit exceeded",
      }),
    );

    const events = readEvents();
    const stop = events.find((event) => event.hook_event_type === "Stop")!;
    const stopFailure = events.find((event) => event.hook_event_type === "StopFailure")!;
    expect(stop.stop_reason).toBe("end_turn");
    expect(stop.outcome).toBe("completed");
    expect(stopFailure.error_type).toBe("rate_limit");
    expect(stopFailure.error_message).toBe("rate limit exceeded");
    expect(stopFailure.outcome).toBe("failed");
  }, 60000);

  it("captures SessionEnd exit_reason, FileChanged change_type, ConfigChange changed_keys", () => {
    runHookWithStdin(
      JSON.stringify({
        session_id: "session-env",
        transcript_path: "/tmp/env.jsonl",
        cwd: "/repo",
        hook_event_name: "SessionEnd",
        exit_reason: "logout",
      }),
    );

    runHookWithStdin(
      JSON.stringify({
        session_id: "session-env",
        transcript_path: "/tmp/env.jsonl",
        cwd: "/repo",
        hook_event_name: "FileChanged",
        file_path: "/repo/.envrc",
        change_type: "modified",
      }),
    );

    runHookWithStdin(
      JSON.stringify({
        session_id: "session-env",
        transcript_path: "/tmp/env.jsonl",
        cwd: "/repo",
        hook_event_name: "ConfigChange",
        config_source: "user_settings",
        changed_keys: ["hooks.PostToolUse", "hooks.Stop"],
      }),
    );

    const events = readEvents();
    const sessionEnd = events.find((event) => event.hook_event_type === "SessionEnd")!;
    const fileChanged = events.find((event) => event.hook_event_type === "FileChanged")!;
    const configChange = events.find((event) => event.hook_event_type === "ConfigChange")!;

    expect(sessionEnd.exit_reason).toBe("logout");
    expect(fileChanged.change_type).toBe("modified");
    expect(configChange.changed_keys).toEqual(["hooks.PostToolUse", "hooks.Stop"]);
  }, 60000);

  it("normalizes mcp_server / task_name aliases", () => {
    runHookWithStdin(
      JSON.stringify({
        session_id: "session-alias",
        transcript_path: "/tmp/alias.jsonl",
        cwd: "/repo",
        hook_event_name: "Elicitation",
        mcp_server: "filesystem",
        tool_name: "mcp__filesystem__write_file",
        elicitation_form: { fields: [{ name: "path", required: true }] },
      }),
    );

    runHookWithStdin(
      JSON.stringify({
        session_id: "session-alias",
        transcript_path: "/tmp/alias.jsonl",
        cwd: "/repo",
        hook_event_name: "TaskCompleted",
        task_id: "t_1",
        task_name: "Implement feature",
      }),
    );

    const events = readEvents();
    const elicitation = events.find((event) => event.hook_event_type === "Elicitation")!;
    const task = events.find((event) => event.hook_event_type === "TaskCompleted")!;

    // mcp_server is the new key — it should also populate the legacy mcp_server_name alias.
    expect(elicitation.mcp_server).toBe("filesystem");
    expect(elicitation.mcp_server_name).toBe("filesystem");
    expect((elicitation.elicitation_form as Record<string, unknown>).fields).toBeDefined();

    // task_name is the new key — it should also populate the legacy task_subject alias.
    expect(task.task_name).toBe("Implement feature");
    expect(task.task_subject).toBe("Implement feature");
  }, 60000);
});
