import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { loadCodexEvents } from "../src/codex.js";

const CLI_SCRIPT = join(import.meta.dirname, "..", "src", "cli.ts");
const HARNESS_DIR = join(import.meta.dirname, "..");

let testRootDir: string;
let testCodexDir: string;
let testLogDir: string;

function setupStateDb(codexDir: string): void {
  const db = new Database(join(codexDir, "state_5.sqlite"));
  db.exec(`
    create table threads (
      id text primary key,
      title text not null,
      source text not null,
      model_provider text not null,
      cwd text not null,
      created_at integer not null,
      updated_at integer not null,
      archived integer not null default 0,
      archived_at integer,
      model text,
      reasoning_effort text,
      agent_nickname text,
      agent_role text,
      agent_path text
    );

    create table thread_spawn_edges (
      parent_thread_id text not null,
      child_thread_id text primary key,
      status text not null
    );
  `);

  db.prepare(`
    insert into threads (
      id, title, source, model_provider, cwd, created_at, updated_at,
      archived, archived_at, model, reasoning_effort, agent_nickname, agent_role, agent_path
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "root-thread",
    "Add Codex support",
    "cli",
    "openai",
    "/repo",
    1710000000,
    1710000030,
    0,
    null,
    "gpt-5.4",
    "high",
    null,
    null,
    null,
  );

  db.prepare(`
    insert into threads (
      id, title, source, model_provider, cwd, created_at, updated_at,
      archived, archived_at, model, reasoning_effort, agent_nickname, agent_role, agent_path
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "child-thread",
    "Inspect code paths",
    JSON.stringify({
      subagent: {
        thread_spawn: {
          parent_thread_id: "root-thread",
          depth: 1,
          agent_nickname: "Scout",
          agent_role: "explore",
        },
      },
    }),
    "openai",
    "/repo",
    1710000010,
    1710000040,
    1,
    1710000040,
    "gpt-5.3-codex-spark",
    "low",
    "Scout",
    "explore",
    null,
  );

  db.prepare(`
    insert into thread_spawn_edges (parent_thread_id, child_thread_id, status)
    values (?, ?, ?)
  `).run("root-thread", "child-thread", "closed");

  db.close();
}

function setupLogsDb(codexDir: string): void {
  const db = new Database(join(codexDir, "logs_1.sqlite"));
  db.exec(`
    create table logs (
      id integer primary key autoincrement,
      ts integer not null,
      ts_nanos integer not null,
      level text not null,
      target text not null,
      feedback_log_body text,
      module_path text,
      file text,
      line integer,
      thread_id text,
      process_uuid text,
      estimated_bytes integer not null default 0
    );
  `);

  db.prepare(`
    insert into logs (ts, ts_nanos, level, target, feedback_log_body, thread_id)
    values (?, ?, ?, ?, ?, ?)
  `).run(
    1710000020,
    0,
    "INFO",
    "codex_core::stream_events_utils",
    'session_loop{thread_id=root-thread}:submission_dispatch{submission.id="submission-1" codex.op="user_input"}:turn{thread.id=root-thread turn.id=turn-1 model=gpt-5.4}: ToolCall: exec_command {"cmd":"pwd && rg codex harness/src","workdir":"/repo"} thread_id=root-thread',
    "root-thread",
  );

  db.prepare(`
    insert into logs (ts, ts_nanos, level, target, feedback_log_body, thread_id)
    values (?, ?, ?, ?, ?, ?)
  `).run(
    1710000030,
    0,
    "INFO",
    "codex_core::stream_events_utils",
    `session_loop{thread_id=child-thread}:submission_dispatch{submission.id="submission-2" codex.op="user_input"}:turn{thread.id=child-thread turn.id=turn-2 model=gpt-5.3-codex-spark}: ToolCall: apply_patch *** Begin Patch
*** Update File: /repo/harness/src/cli.ts
@@
-old
+new
*** End Patch
 thread_id=child-thread`,
    "child-thread",
  );

  db.prepare(`
    insert into logs (ts, ts_nanos, level, target, feedback_log_body, thread_id)
    values (?, ?, ?, ?, ?, ?)
  `).run(
    1710000035,
    0,
    "INFO",
    "codex_core::codex",
    'session_loop{thread_id=child-thread}:turn{thread.id=child-thread turn.id=turn-2 model=gpt-5.3-codex-spark}: Turn error: child failed',
    "child-thread",
  );

  db.close();
}

function setupHistory(codexDir: string): void {
  writeFileSync(
    join(codexDir, "history.jsonl"),
    `${JSON.stringify({
      session_id: "root-thread",
      ts: 1710000005,
      text: "Please add Codex support.",
    })}\n`,
  );
}

function runCli(args: string): string {
  return execSync(`npx tsx "${CLI_SCRIPT}" ${args}`, {
    env: {
      ...process.env,
      SSENRAH_LOG_DIR: testLogDir,
      SSENRAH_CODEX_DIR: testCodexDir,
      SSENRAH_INCLUDE_CODEX: "1",
    },
    cwd: HARNESS_DIR,
    encoding: "utf-8",
    timeout: 30000,
  });
}

describe("codex support", () => {
  beforeEach(() => {
    testRootDir = join(tmpdir(), `ssenrah-codex-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    testCodexDir = join(testRootDir, ".codex");
    testLogDir = join(testRootDir, ".ssenrah");
    mkdirSync(testCodexDir, { recursive: true });
    mkdirSync(testLogDir, { recursive: true });
    setupStateDb(testCodexDir);
    setupLogsDb(testCodexDir);
    setupHistory(testCodexDir);
  });

  afterEach(() => {
    if (existsSync(testRootDir)) rmSync(testRootDir, { recursive: true, force: true });
  });

  it("loads Codex threads, prompts, tool calls, and failures into AgentEvent records", () => {
    const events = loadCodexEvents(testCodexDir);

    expect(events.some((event) => event.hook_event_type === "SessionStart" && event.session_id === "root-thread")).toBe(true);
    expect(events.some((event) => event.hook_event_type === "UserPromptSubmit" && event.prompt === "Please add Codex support.")).toBe(true);

    const execCommand = events.find((event) => event.tool_name === "exec_command");
    expect(execCommand?.hook_event_type).toBe("PostToolUse");
    expect(execCommand?.tool_category).toBe("inspection");
    expect(execCommand?.effect_level).toBe("inspection_only");
    expect(execCommand?.prompt_segment_id).toBe("root-thread:prompt:1");

    const subagentStart = events.find((event) => event.hook_event_type === "SubagentStart");
    expect(subagentStart?.session_id).toBe("root-thread");
    expect(subagentStart?.agent_id).toBe("child-thread");
    expect(subagentStart?.agent_type).toBe("Explore");

    const applyPatch = events.find((event) => event.tool_name === "apply_patch");
    expect(applyPatch?.session_id).toBe("root-thread");
    expect(applyPatch?.agent_id).toBe("child-thread");
    expect(applyPatch?.tool_category).toBe("filesystem");
    expect(applyPatch?.effect_level).toBe("significant_side_effect");

    const failure = events.find((event) => event.hook_event_type === "StopFailure");
    expect(failure?.agent_id).toBe("child-thread");
    expect(failure?.error).toContain("child failed");
  });

  it("includes Codex sessions in CLI summary output", () => {
    const output = runCli("summary");
    expect(output).toContain("Total events:");
    expect(output).toContain("exec_command");
    expect(output).not.toContain("No events recorded");
  });
});
