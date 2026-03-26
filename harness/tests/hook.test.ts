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
});
