import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { loadCodexEvents } from "../src/codex.js";

const CLI_SCRIPT = join(import.meta.dirname, "..", "src", "cli.ts");
const HARNESS_DIR = join(import.meta.dirname, "..");

let testRootDir: string;
let testCodexDir: string;
let testLogDir: string;

const rootRolloutRelativePath = join("sessions", "2026", "04", "05", "rollout-2026-04-05T00-00-00-root-thread.jsonl");
const childRolloutRelativePath = join("sessions", "2026", "04", "05", "rollout-2026-04-05T00-00-05-child-thread.jsonl");

function setupStateDb(codexDir: string): void {
  const db = new Database(join(codexDir, "state_5.sqlite"));
  db.exec(`
    create table threads (
      id text primary key,
      rollout_path text not null,
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
      id, rollout_path, title, source, model_provider, cwd, created_at, updated_at,
      archived, archived_at, model, reasoning_effort, agent_nickname, agent_role, agent_path
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "root-thread",
    join(codexDir, rootRolloutRelativePath),
    "Add Codex transcript support",
    "cli",
    "openai",
    "/repo",
    1743811200,
    1743811220,
    1,
    1743811220,
    "gpt-5.4",
    "high",
    null,
    null,
    null,
  );

  db.prepare(`
    insert into threads (
      id, rollout_path, title, source, model_provider, cwd, created_at, updated_at,
      archived, archived_at, model, reasoning_effort, agent_nickname, agent_role, agent_path
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "child-thread",
    join(codexDir, childRolloutRelativePath),
    "Inspect transcript parser",
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
    1743811205,
    1743811215,
    1,
    1743811215,
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

function writeRootRollout(codexDir: string): void {
  const rootRolloutPath = join(codexDir, rootRolloutRelativePath);
  mkdirSync(dirname(rootRolloutPath), { recursive: true });
  writeFileSync(
    rootRolloutPath,
    [
      JSON.stringify({
        timestamp: "2026-04-05T00:00:00.000Z",
        type: "session_meta",
        payload: {
          id: "root-thread",
          timestamp: "2026-04-05T00:00:00.000Z",
          cwd: "/repo",
          source: "cli",
          model_provider: "openai",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-05T00:00:01.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "Please add transcript-backed Codex support.",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-05T00:00:02.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-root",
          cwd: "/repo",
          model: "gpt-5.4",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-05T00:00:03.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call-exec",
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "rg transcript harness/src" }),
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-05T00:00:04.000Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          call_id: "call-exec",
          turn_id: "turn-root",
          exit_code: 0,
          aggregated_output: "harness/src/cost.ts",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-05T00:00:05.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call-spawn",
          name: "spawn_agent",
          arguments: JSON.stringify({ agent_type: "explore", message: "Inspect transcript parser" }),
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-05T00:00:05.500Z",
        type: "event_msg",
        payload: {
          type: "collab_agent_spawn_end",
          call_id: "call-spawn",
          sender_thread_id: "root-thread",
          new_thread_id: "child-thread",
          new_agent_nickname: "Scout",
          new_agent_role: "explore",
          prompt: "Inspect transcript parser",
          model: "gpt-5.3-codex-spark",
          reasoning_effort: "low",
          status: "pending_init",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-05T00:00:10.000Z",
        type: "event_msg",
        payload: {
          type: "collab_close_end",
          call_id: "call-close",
          sender_thread_id: "root-thread",
          receiver_thread_id: "child-thread",
          receiver_agent_nickname: "Scout",
          receiver_agent_role: "explore",
          status: { completed: "done" },
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-05T00:00:11.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Transcript-backed Codex support is ready." }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-05T00:00:12.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 1000,
              cached_input_tokens: 500,
              output_tokens: 400,
              reasoning_output_tokens: 150,
              total_tokens: 1400,
            },
          },
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-05T00:00:13.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-root",
          last_agent_message: "Transcript-backed Codex support is ready.",
        },
      }),
    ].join("\n") + "\n",
  );
}

function writeChildRollout(codexDir: string): void {
  const childRolloutPath = join(codexDir, childRolloutRelativePath);
  mkdirSync(dirname(childRolloutPath), { recursive: true });
  writeFileSync(
    childRolloutPath,
    [
      JSON.stringify({
        timestamp: "2026-04-05T00:00:05.600Z",
        type: "session_meta",
        payload: {
          id: "child-thread",
          timestamp: "2026-04-05T00:00:05.600Z",
          cwd: "/repo",
          source: "cli",
          model_provider: "openai",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-05T00:00:06.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-child",
          cwd: "/repo",
          model: "gpt-5.3-codex-spark",
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-05T00:00:06.500Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          call_id: "call-patch",
          status: "completed",
          name: "apply_patch",
          input: `*** Begin Patch
*** Update File: /repo/harness/src/cli.ts
@@
-old
+new
*** End Patch`,
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-05T00:00:07.000Z",
        type: "event_msg",
        payload: {
          type: "patch_apply_end",
          call_id: "call-patch",
          turn_id: "turn-child",
          success: true,
          stdout: "Success. Updated the following files:\nM /repo/harness/src/cli.ts\n",
          changes: {
            "/repo/harness/src/cli.ts": {
              type: "update",
            },
          },
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-05T00:00:08.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 1000,
              cached_input_tokens: 1000,
              output_tokens: 1000,
              reasoning_output_tokens: 200,
              total_tokens: 2000,
            },
          },
        },
      }),
      JSON.stringify({
        timestamp: "2026-04-05T00:00:09.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-child",
          last_agent_message: "Patched the file.",
        },
      }),
    ].join("\n") + "\n",
  );
}

function runCli(args: string, codexInput = testCodexDir): string {
  return execSync(`npx tsx "${CLI_SCRIPT}" ${args}`, {
    env: {
      ...process.env,
      SSENRAH_LOG_DIR: testLogDir,
      SSENRAH_CODEX_DIR: codexInput,
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
    writeRootRollout(testCodexDir);
    writeChildRollout(testCodexDir);
  });

  afterEach(() => {
    if (existsSync(testRootDir)) rmSync(testRootDir, { recursive: true, force: true });
  });

  it("loads Codex sessions from transcript rollouts and attaches transcript paths", () => {
    const events = loadCodexEvents(join(testCodexDir, "sessions"));

    expect(events.some((event) => event.hook_event_type === "SessionStart" && event.session_id === "root-thread")).toBe(true);
    expect(events.some((event) => event.hook_event_type === "UserPromptSubmit" && event.prompt === "Please add transcript-backed Codex support.")).toBe(true);

    const execCommand = events.find((event) => event.tool_name === "exec_command");
    expect(execCommand?.hook_event_type).toBe("PostToolUse");
    expect(execCommand?.tool_category).toBe("inspection");
    expect(execCommand?.effect_level).toBe("inspection_only");
    expect(execCommand?.transcript_path).toContain("root-thread.jsonl");
    expect(execCommand?.prompt_segment_id).toBe("root-thread:prompt:1");

    const subagentStart = events.find((event) => event.hook_event_type === "SubagentStart");
    expect(subagentStart?.session_id).toBe("root-thread");
    expect(subagentStart?.agent_id).toBe("child-thread");
    expect(subagentStart?.agent_type).toBe("Explore");
    expect(subagentStart?.agent_transcript_path).toContain("child-thread.jsonl");

    const applyPatch = events.find((event) => event.tool_name === "apply_patch");
    expect(applyPatch?.session_id).toBe("root-thread");
    expect(applyPatch?.agent_id).toBe("child-thread");
    expect(applyPatch?.tool_category).toBe("filesystem");
    expect(applyPatch?.effect_level).toBe("significant_side_effect");

    const sessionEnd = events.find((event) => event.hook_event_type === "SessionEnd");
    expect(sessionEnd?.cost_usd).toBeGreaterThan(0);
  });

  it("includes transcript-derived Codex sessions in CLI summary output", () => {
    const output = runCli("summary");
    expect(output).toContain("Total events:");
    expect(output).toContain("exec_command");
    expect(output).toContain("Est. cost:");
    expect(output).not.toContain("No events recorded");
  });
});
