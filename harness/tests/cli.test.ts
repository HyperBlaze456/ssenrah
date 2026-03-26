import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import type { AgentEvent } from "../src/types.js";

const CLI_SCRIPT = join(import.meta.dirname, "..", "src", "cli.ts");
const HARNESS_DIR = join(import.meta.dirname, "..");

let testLogDir: string;

function runCli(args: string): string {
  return execSync(`npx tsx "${CLI_SCRIPT}" ${args}`, {
    env: { ...process.env, SSENRAH_LOG_DIR: testLogDir },
    cwd: HARNESS_DIR,
    encoding: "utf-8",
    timeout: 30000,
  });
}

function writeTestEvents(events: Partial<AgentEvent>[]): void {
  const logFile = join(testLogDir, "events.jsonl");
  const lines = events.map((e) => JSON.stringify({
    id: `test-${Math.random().toString(36).slice(2)}`,
    timestamp: new Date().toISOString(),
    session_id: "test-session",
    hook_event_type: "PostToolUse",
    cwd: "/test",
    ...e,
  })).join("\n") + "\n";
  writeFileSync(logFile, lines);
}

describe("CLI", () => {
  beforeEach(() => {
    testLogDir = join(tmpdir(), `ssenrah-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testLogDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testLogDir)) rmSync(testLogDir, { recursive: true });
  });

  describe("summary", () => {
    it("shows 'no events' when log is empty", () => {
      const output = runCli("summary");
      expect(output).toContain("No events recorded");
    }, 30000);

    it("shows activity summary with event counts", () => {
      writeTestEvents([
        { hook_event_type: "PostToolUse", tool_name: "Bash" },
        { hook_event_type: "PostToolUse", tool_name: "Bash" },
        { hook_event_type: "PostToolUse", tool_name: "Read" },
        { hook_event_type: "PostToolUseFailure", tool_name: "Bash" },
        { hook_event_type: "SubagentStart", agent_type: "Explore" },
      ]);
      const output = runCli("summary");
      expect(output).toContain("Total events:");
      expect(output).toContain("Bash");
    }, 30000);
  });

  describe("events", () => {
    it("lists recent events", () => {
      writeTestEvents([
        { hook_event_type: "SessionStart", source: "startup" },
        { hook_event_type: "PostToolUse", tool_name: "Bash" },
      ]);
      const output = runCli("events");
      expect(output).toContain("SessionStart");
      expect(output).toContain("PostToolUse");
    }, 30000);

    it("filters by --type", () => {
      writeTestEvents([
        { hook_event_type: "SessionStart" },
        { hook_event_type: "PostToolUse", tool_name: "Bash" },
        { hook_event_type: "PostToolUse", tool_name: "Read" },
      ]);
      const output = runCli("events --type PostToolUse");
      expect(output).toContain("PostToolUse");
      expect(output).not.toContain("SessionStart");
    }, 30000);

    it("filters by --session", () => {
      writeTestEvents([
        { session_id: "session-A", hook_event_type: "PostToolUse", tool_name: "Bash" },
        { session_id: "session-B", hook_event_type: "PostToolUse", tool_name: "Read" },
      ]);
      const output = runCli("events --session session-A");
      expect(output).toContain("1 of 1");
    }, 30000);

    it("shows 'no matching events' when filter has no results", () => {
      writeTestEvents([{ hook_event_type: "PostToolUse" }]);
      const output = runCli("events --type NonExistent");
      expect(output).toContain("No matching events");
    }, 30000);
  });

  describe("sessions", () => {
    it("lists sessions with event counts", () => {
      writeTestEvents([
        { session_id: "session-AAA", hook_event_type: "SessionStart" },
        { session_id: "session-AAA", hook_event_type: "PostToolUse" },
        { session_id: "session-BBB", hook_event_type: "SessionStart" },
      ]);
      const output = runCli("sessions");
      expect(output).toContain("2 sessions");
    }, 30000);
  });

  describe("help", () => {
    it("shows usage for unknown command", () => {
      const output = runCli("unknown-command");
      expect(output).toContain("Usage: ssenrah");
    }, 30000);
  });
});
