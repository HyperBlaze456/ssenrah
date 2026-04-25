import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import Database from "better-sqlite3";
import { parseCodexRollout } from "./codex-rollout.js";
import { calculateSessionCost } from "./cost.js";
import type { AgentEvent, EffectLevel, ToolCategory } from "./types.js";

interface CodexThreadRow {
  id: string;
  rollout_path: string | null;
  title: string;
  source: string;
  model_provider: string;
  cwd: string;
  created_at: number;
  updated_at: number;
  archived: number;
  archived_at: number | null;
  model: string | null;
  reasoning_effort: string | null;
  agent_nickname: string | null;
  agent_role: string | null;
  agent_path: string | null;
}

interface CodexSpawnEdgeRow {
  parent_thread_id: string;
  child_thread_id: string;
  status: string;
}

interface CodexHomeResolution {
  codex_dir: string;
  sessions_dir?: string;
  rollout_files: string[];
}

export interface CodexStatusReport {
  enabled: boolean;
  resolved: boolean;
  codex_dir?: string;
  sessions_dir?: string;
  state_db?: string;
  rollout_count: number;
  thread_count: number;
  latest_thread_updated_at?: string;
  recent_threads: Array<{
    id: string;
    title: string;
    model: string | null;
    updated_at: string;
    archived: boolean;
    rollout_path: string | null;
  }>;
  notes: string[];
}

const DEFAULT_CODEX_DIR = join(process.env.HOME ?? "~", ".codex");
const DISABLED_VALUES = new Set(["0", "false", "no", "off"]);
const INSPECTION_COMMAND_PREFIXES = [
  "pwd",
  "ls",
  "cat",
  "head",
  "tail",
  "find",
  "rg",
  "grep",
  "wc",
  "stat",
  "which",
  "command -v",
  "echo",
  "printf",
  "sed -n",
  "git status",
  "git diff",
  "git show",
  "git log",
  "git branch",
  "git rev-parse",
  "git remote",
];
const WRITE_COMMAND_PATTERN =
  /(^|[\s;&|()])(?:rm|mv|cp|mkdir|rmdir|touch|chmod|chown|tee|install)\b|>>?|(?:^|[\s;&|()])(?:npm|pnpm|yarn)\s+(?:install|add|remove)\b|(?:^|[\s;&|()])git\s+(?:commit|push|merge|rebase|checkout|switch|apply|reset|cherry-pick|stash|clean)\b|sed\s+-i\b|perl\s+-pi\b/i;

function includeCodexByDefault(): boolean {
  const raw = process.env.SSENRAH_INCLUDE_CODEX?.trim().toLowerCase();
  return !raw || !DISABLED_VALUES.has(raw);
}

function expandHome(value: string): string {
  if (value === "~") return process.env.HOME ?? value;
  if (value.startsWith("~/")) return join(process.env.HOME ?? "~", value.slice(2));
  return value;
}

function pickLatestSqliteFile(codexDir: string, prefix: string): string | null {
  const matches = readdirSync(codexDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && new RegExp(`^${prefix}_(\\d+)\\.sqlite$`).test(entry.name))
    .map((entry) => ({
      name: entry.name,
      version: parseInt(entry.name.match(/_(\d+)\.sqlite$/)?.[1] ?? "0", 10),
    }))
    .sort((left, right) => right.version - left.version);

  return matches[0] ? join(codexDir, matches[0].name) : null;
}

function listRolloutFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];

  const files: string[] = [];
  const stack = [dir];

  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
      } else if (entry.isFile() && /^rollout-.*\.jsonl$/.test(entry.name)) {
        files.push(path);
      }
    }
  }

  return files.sort();
}

function resolveCodexHome(input = process.env.SSENRAH_CODEX_DIR ?? DEFAULT_CODEX_DIR): CodexHomeResolution | null {
  const resolved = expandHome(input);
  if (!existsSync(resolved)) return null;

  if (resolved.endsWith(".jsonl")) {
    const codexDir = resolved.includes("/.codex/") ? resolved.slice(0, resolved.indexOf("/.codex/") + "/.codex".length) : dirname(dirname(dirname(dirname(resolved))));
    const sessionsDir = resolved.includes("/sessions/") ? resolved.slice(0, resolved.indexOf("/sessions/") + "/sessions".length) : undefined;
    return {
      codex_dir: codexDir,
      sessions_dir: sessionsDir,
      rollout_files: [resolved],
    };
  }

  const directCodexDir = basename(resolved) === ".codex" ? resolved : existsSync(join(resolved, ".codex")) ? join(resolved, ".codex") : resolved;
  const sessionsDir = basename(directCodexDir) === "sessions" ? directCodexDir : existsSync(join(directCodexDir, "sessions")) ? join(directCodexDir, "sessions") : undefined;
  const codexDir = basename(directCodexDir) === "sessions" ? dirname(directCodexDir) : directCodexDir;

  return {
    codex_dir: codexDir,
    sessions_dir: sessionsDir,
    rollout_files: sessionsDir ? listRolloutFiles(sessionsDir) : [],
  };
}

function toIsoFromSeconds(tsSeconds: number): string {
  return new Date(tsSeconds * 1000).toISOString();
}

function toUnixSeconds(isoTimestamp: string): number {
  return Math.floor(new Date(isoTimestamp).getTime() / 1000);
}

function titleCase(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function stringifyUnknown(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function summarizeAgentStatus(status: unknown): string | undefined {
  if (typeof status === "string") return status;
  if (!status || typeof status !== "object") return undefined;
  const record = status as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, "completed")) return "completed";
  if (Object.prototype.hasOwnProperty.call(record, "failed") || Object.prototype.hasOwnProperty.call(record, "errored")) {
    return "failed";
  }
  if (Object.prototype.hasOwnProperty.call(record, "cancelled")) return "cancelled";
  return undefined;
}

function parseSpawnSource(source: string | null | undefined): string | undefined {
  if (!source?.startsWith("{")) return undefined;
  const parsed = safeJsonParse(source) as
    | { subagent?: { thread_spawn?: { parent_thread_id?: string } } }
    | null;
  return parsed?.subagent?.thread_spawn?.parent_thread_id;
}

function getRootThreadId(
  threadId: string,
  parentByChild: Map<string, string>,
  memo = new Map<string, string>(),
): string {
  const cached = memo.get(threadId);
  if (cached) return cached;

  let current = threadId;
  const seen = new Set<string>();
  while (parentByChild.has(current) && !seen.has(current)) {
    seen.add(current);
    current = parentByChild.get(current)!;
  }

  memo.set(threadId, current);
  return current;
}

function isInspectionShellCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  if (!normalized) return false;
  if (WRITE_COMMAND_PATTERN.test(normalized)) return false;

  const segments = normalized
    .split(/&&|\|\||;|\n/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0) return false;

  return segments.every((segment) => {
    if (
      segment === "then" ||
      segment === "else" ||
      segment === "fi" ||
      segment === "do" ||
      segment === "done" ||
      segment.startsWith("if ") ||
      segment.startsWith("[ ") ||
      segment.startsWith("for ")
    ) {
      return true;
    }

    if (segment.startsWith("sqlite3 ")) {
      return (
        segment.includes(" select ") ||
        segment.includes(" \".schema") ||
        segment.includes(" \".tables") ||
        segment.includes(" '.schema") ||
        segment.includes(" '.tables")
      );
    }

    return INSPECTION_COMMAND_PREFIXES.some((prefix) => segment.startsWith(prefix));
  });
}

function classifyCodexToolCall(
  toolName: string,
  toolInput: Record<string, unknown> | undefined,
): { tool_category: ToolCategory; effect_level: EffectLevel } {
  if (toolName === "apply_patch") {
    return { tool_category: "filesystem", effect_level: "significant_side_effect" };
  }

  if (toolName === "exec_command") {
    const command = typeof toolInput?.cmd === "string" ? toolInput.cmd : "";
    if (command && isInspectionShellCommand(command)) {
      return { tool_category: "inspection", effect_level: "inspection_only" };
    }
    return { tool_category: "command", effect_level: "significant_side_effect" };
  }

  if (toolName === "write_stdin") {
    const chars = typeof toolInput?.chars === "string" ? toolInput.chars : "";
    if (!chars.trim()) {
      return { tool_category: "inspection", effect_level: "inspection_only" };
    }
    return { tool_category: "command", effect_level: "significant_side_effect" };
  }

  if (
    toolName === "update_plan" ||
    toolName === "spawn_agent" ||
    toolName === "wait_agent" ||
    toolName === "send_input" ||
    toolName === "close_agent" ||
    toolName === "resume_agent"
  ) {
    return { tool_category: "coordination", effect_level: "reasoning_or_coordination" };
  }

  if (toolName === "request_user_input") {
    return { tool_category: "approval", effect_level: "safety_or_policy" };
  }

  if (toolName.startsWith("mcp__")) {
    if (
      toolName.includes("__ast_grep_search") ||
      toolName.includes("__lsp_") ||
      toolName.includes("__read") ||
      toolName.includes("__list")
    ) {
      return { tool_category: "inspection", effect_level: "inspection_only" };
    }
    return { tool_category: "mcp", effect_level: "significant_side_effect" };
  }

  return { tool_category: "other", effect_level: "reasoning_or_coordination" };
}

function findRolloutPathForThread(
  thread: Pick<CodexThreadRow, "id" | "rollout_path">,
  resolution: CodexHomeResolution,
): string | undefined {
  if (thread.rollout_path && existsSync(thread.rollout_path)) return thread.rollout_path;
  return resolution.rollout_files.find((path) => path.includes(thread.id));
}

export function loadCodexEvents(
  codexInput = process.env.SSENRAH_CODEX_DIR ?? DEFAULT_CODEX_DIR,
): AgentEvent[] {
  if (!includeCodexByDefault()) return [];

  const resolution = resolveCodexHome(codexInput);
  if (!resolution) return [];

  const stateDbPath = pickLatestSqliteFile(resolution.codex_dir, "state");
  const threads: CodexThreadRow[] = [];
  const edges: CodexSpawnEdgeRow[] = [];

  if (stateDbPath) {
    const stateDb = new Database(stateDbPath, { readonly: true, fileMustExist: true });
    try {
      threads.push(
        ...((stateDb
          .prepare(`
            select
              id, rollout_path, title, source, model_provider, cwd, created_at, updated_at,
              archived, archived_at, model, reasoning_effort, agent_nickname, agent_role, agent_path
            from threads
            order by created_at asc
          `)
          .all() as unknown) as CodexThreadRow[]),
      );

      const hasSpawnEdgesTable = Boolean(
        stateDb
          .prepare(`select 1 as present from sqlite_master where type = 'table' and name = 'thread_spawn_edges' limit 1`)
          .get(),
      );

      if (hasSpawnEdgesTable) {
        edges.push(
          ...((stateDb
            .prepare(`select parent_thread_id, child_thread_id, status from thread_spawn_edges`)
            .all() as unknown) as CodexSpawnEdgeRow[]),
        );
      }
    } finally {
      stateDb.close();
    }
  }

  if (threads.length === 0 && resolution.rollout_files.length === 0) return [];

  if (threads.length === 0) {
    for (const rolloutPath of resolution.rollout_files) {
      const rollout = parseCodexRollout(rolloutPath);
      if (!rollout) continue;
      const lastModel = [...rollout.turns].reverse().find((turn) => turn.model && turn.model !== "unknown")?.model ?? null;
      threads.push({
        id: rollout.session_id,
        rollout_path: rolloutPath,
        title: rollout.prompts[0]?.content ?? basename(rolloutPath),
        source: rollout.source ?? "cli",
        model_provider: rollout.model_provider ?? "unknown",
        cwd: rollout.cwd,
        created_at: toUnixSeconds(rollout.started_at),
        updated_at: toUnixSeconds(rollout.ended_at),
        archived: 1,
        archived_at: toUnixSeconds(rollout.ended_at),
        model: lastModel,
        reasoning_effort: null,
        agent_nickname: null,
        agent_role: null,
        agent_path: null,
      });
    }
  }

  const parentByChild = new Map(edges.map((edge) => [edge.child_thread_id, edge.parent_thread_id]));
  for (const thread of threads) {
    if (parentByChild.has(thread.id)) continue;
    const sourceParent = parseSpawnSource(thread.source);
    if (sourceParent) parentByChild.set(thread.id, sourceParent);
  }

  const rootMemo = new Map<string, string>();
  const transcriptByThreadId = new Map<string, ReturnType<typeof parseCodexRollout>>();
  const transcriptPathByThreadId = new Map<string, string>();
  const threadById = new Map<string, CodexThreadRow>(threads.map((thread) => [thread.id, thread]));

  for (const thread of threads) {
    const rolloutPath = findRolloutPathForThread(thread, resolution);
    if (!rolloutPath) continue;
    transcriptPathByThreadId.set(thread.id, rolloutPath);
    transcriptByThreadId.set(thread.id, parseCodexRollout(rolloutPath));
  }

  const spawnEventByChildId = new Map<string, { timestamp: string; payload: Record<string, unknown> }>();
  const closeEventByChildId = new Map<string, { timestamp: string; payload: Record<string, unknown> }>();

  for (const thread of threads) {
    const rootThreadId = getRootThreadId(thread.id, parentByChild, rootMemo);
    if (rootThreadId !== thread.id) continue;

    const rollout = transcriptByThreadId.get(thread.id);
    if (!rollout) continue;

    for (const event of rollout.spawn_events) {
      if (typeof event.payload.new_thread_id === "string") {
        spawnEventByChildId.set(event.payload.new_thread_id, {
          timestamp: event.timestamp,
          payload: event.payload,
        });
      }
    }

    for (const event of rollout.close_events) {
      if (typeof event.payload.receiver_thread_id === "string") {
        closeEventByChildId.set(event.payload.receiver_thread_id, {
          timestamp: event.timestamp,
          payload: event.payload,
        });
      }
    }
  }

  const events: AgentEvent[] = [];

  for (const thread of threads) {
    const rootThreadId = getRootThreadId(thread.id, parentByChild, rootMemo);
    const isRootThread = rootThreadId === thread.id;
    const rollout = transcriptByThreadId.get(thread.id);
    const rootTranscriptPath = transcriptPathByThreadId.get(rootThreadId) ?? transcriptPathByThreadId.get(thread.id);
    const agentTranscriptPath = isRootThread ? undefined : transcriptPathByThreadId.get(thread.id);
    const edgeStatus = edges.find((edge) => edge.child_thread_id === thread.id)?.status;
    const agentType = titleCase(thread.agent_role) ?? thread.agent_nickname ?? "Subagent";
    const startTimestamp = isRootThread
      ? rollout?.started_at ?? toIsoFromSeconds(thread.created_at)
      : spawnEventByChildId.get(thread.id)?.timestamp ?? rollout?.started_at ?? toIsoFromSeconds(thread.created_at);
    const cost = isRootThread && rootTranscriptPath ? calculateSessionCost(rootTranscriptPath) : null;

    if (isRootThread) {
      events.push({
        id: `codex:session-start:${thread.id}`,
        schema_version: 3,
        timestamp: startTimestamp,
        session_id: thread.id,
        transcript_path: rootTranscriptPath,
        hook_event_type: "SessionStart",
        cwd: thread.cwd,
        source: `codex:${thread.source}`,
        model: thread.model ?? rollout?.turns[0]?.model ?? undefined,
        outcome: "active",
        branch_kind: "main",
        root_run_id: thread.id,
        extras: {
          provider: "codex",
          model_provider: thread.model_provider,
          reasoning_effort: thread.reasoning_effort,
        },
        _raw: {
          provider: "codex",
          thread,
          rollout,
        },
      });
    } else {
      events.push({
        id: `codex:subagent-start:${thread.id}`,
        schema_version: 3,
        timestamp: spawnEventByChildId.get(thread.id)?.timestamp ?? startTimestamp,
        session_id: rootThreadId,
        transcript_path: rootTranscriptPath,
        agent_transcript_path: agentTranscriptPath,
        hook_event_type: "SubagentStart",
        cwd: thread.cwd,
        agent_id: thread.id,
        agent_type: agentType,
        model: thread.model ?? rollout?.turns[0]?.model ?? undefined,
        outcome: "active",
        branch_kind: "subagent",
        root_run_id: rootThreadId,
        parent_run_id: parentByChild.get(thread.id),
        reason: thread.title,
        collapsed_by_default: true,
        extras: {
          provider: "codex",
          model_provider: thread.model_provider,
          agent_nickname: thread.agent_nickname,
          agent_path: thread.agent_path,
        },
        _raw: {
          provider: "codex",
          thread,
          rollout,
        },
      });
    }

    if (isRootThread && rollout) {
      rollout.prompts.forEach((prompt, index) => {
        events.push({
          id: `codex:prompt:${thread.id}:${index + 1}`,
          schema_version: 3,
          timestamp: prompt.timestamp,
          session_id: thread.id,
          transcript_path: rootTranscriptPath,
          hook_event_type: "UserPromptSubmit",
          cwd: thread.cwd,
          prompt: prompt.content,
          message: prompt.content,
          prompt_segment_id: `${thread.id}:prompt:${index + 1}`,
          model: thread.model ?? undefined,
          branch_kind: "main",
          root_run_id: thread.id,
          effect_level: "reasoning_or_coordination",
          tool_category: "coordination",
          extras: {
            provider: "codex",
            model_provider: thread.model_provider,
          },
          _raw: {
            provider: "codex",
            prompt,
          },
        });
      });
    }

    if (rollout) {
      const resultByCallId = new Map(rollout.tool_results.map((result) => [result.call_id, result]));
      const modelByTurnId = new Map(rollout.turns.map((turn) => [turn.turn_id, turn.model]));

      for (const call of rollout.tool_calls) {
        const result = resultByCallId.get(call.call_id);
        const classification = classifyCodexToolCall(call.tool_name, call.tool_input);
        const success = result?.success !== false;

        events.push({
          id: `codex:tool:${thread.id}:${call.call_id}`,
          schema_version: 3,
          timestamp: result?.timestamp ?? call.timestamp,
          session_id: rootThreadId,
          transcript_path: rootTranscriptPath,
          agent_transcript_path: agentTranscriptPath,
          hook_event_type: success ? "PostToolUse" : "PostToolUseFailure",
          cwd: thread.cwd,
          tool_name: call.tool_name,
          tool_input: call.tool_input,
          tool_use_id: call.call_id,
          tool_response: result?.output,
          error: success ? undefined : result?.error ?? "Tool failed",
          model: call.turn_id ? modelByTurnId.get(call.turn_id) ?? thread.model ?? undefined : thread.model ?? undefined,
          agent_id: isRootThread ? undefined : thread.id,
          agent_type: isRootThread ? undefined : agentType,
          root_run_id: rootThreadId,
          parent_run_id: isRootThread ? undefined : parentByChild.get(thread.id),
          branch_kind: isRootThread ? "main" : "subagent",
          tool_category: classification.tool_category,
          effect_level: success ? classification.effect_level : "failure_or_anomaly",
          collapsed_by_default:
            classification.effect_level === "inspection_only" ||
            (!isRootThread && classification.effect_level === "reasoning_or_coordination"),
          extras: {
            provider: "codex",
            result_payload: result?.raw_payload,
          },
          _raw: {
            provider: "codex",
            call,
            result,
          },
        });
      }
    }

    const endTimestamp = isRootThread
      ? thread.archived || rollout?.has_task_complete
        ? rollout?.ended_at ?? (thread.archived_at ? toIsoFromSeconds(thread.archived_at) : undefined)
        : undefined
      : closeEventByChildId.get(thread.id)?.timestamp ??
        (thread.archived || edgeStatus && edgeStatus !== "open" || rollout?.has_task_complete ? rollout?.ended_at : undefined) ??
        (thread.archived_at ? toIsoFromSeconds(thread.archived_at) : edgeStatus && edgeStatus !== "open" ? toIsoFromSeconds(thread.updated_at) : undefined);

    if (endTimestamp) {
      if (isRootThread) {
        events.push({
          id: `codex:session-end:${thread.id}`,
          schema_version: 3,
          timestamp: endTimestamp,
          session_id: thread.id,
          transcript_path: rootTranscriptPath,
          hook_event_type: "SessionEnd",
          cwd: thread.cwd,
          source: `codex:${thread.source}`,
          reason: thread.archived ? "archived" : "completed",
          model: thread.model ?? undefined,
          outcome: "completed",
          branch_kind: "main",
          root_run_id: thread.id,
          cost_usd: cost?.cost_usd,
          extras: {
            provider: "codex",
            model_provider: thread.model_provider,
          },
          _raw: {
            provider: "codex",
            thread,
            rollout,
          },
        });
      } else {
        const closePayload = closeEventByChildId.get(thread.id)?.payload;
        events.push({
          id: `codex:subagent-stop:${thread.id}`,
          schema_version: 3,
          timestamp: endTimestamp,
          session_id: rootThreadId,
          transcript_path: rootTranscriptPath,
          agent_transcript_path: agentTranscriptPath,
          hook_event_type: "SubagentStop",
          cwd: thread.cwd,
          agent_id: thread.id,
          agent_type: agentType,
          model: thread.model ?? undefined,
          outcome: edgeStatus === "failed" ? "failed" : "completed",
          branch_kind: "subagent",
          root_run_id: rootThreadId,
          parent_run_id: parentByChild.get(thread.id),
          reason:
            summarizeAgentStatus(closePayload?.status) ??
            edgeStatus ??
            (thread.archived ? "archived" : "completed"),
          collapsed_by_default: true,
          extras: {
            provider: "codex",
            model_provider: thread.model_provider,
          },
          _raw: {
            provider: "codex",
            thread,
            close_payload: closePayload,
          },
        });
      }
    }
  }

  events.sort((left, right) => {
    const timestampCompare = left.timestamp.localeCompare(right.timestamp);
    return timestampCompare !== 0 ? timestampCompare : left.id.localeCompare(right.id);
  });

  const activePromptBySession = new Map<string, string>();
  for (const event of events) {
    if (event.hook_event_type === "UserPromptSubmit" && event.prompt_segment_id) {
      activePromptBySession.set(event.session_id, event.prompt_segment_id);
      continue;
    }

    const promptSegmentId = activePromptBySession.get(event.session_id);
    if (promptSegmentId && !event.prompt_segment_id) {
      event.prompt_segment_id = promptSegmentId;
    }
  }

  return events;
}

/**
 * Diagnostic snapshot of where Codex data is being read from and what it looks like.
 *
 * Used by the `ssenrah codex status` CLI command to surface install state, schema version
 * (via the highest `state_N.sqlite` we found), and a peek at the most recent threads —
 * without paying the full event-construction cost.
 */
export function getCodexStatus(
  codexInput: string = process.env.SSENRAH_CODEX_DIR ?? DEFAULT_CODEX_DIR,
): CodexStatusReport {
  const enabled = includeCodexByDefault();
  const notes: string[] = [];

  if (!enabled) {
    notes.push("SSENRAH_INCLUDE_CODEX is set to a falsey value — Codex ingestion is disabled.");
  }

  const resolution = resolveCodexHome(codexInput);
  if (!resolution) {
    return {
      enabled,
      resolved: false,
      rollout_count: 0,
      thread_count: 0,
      recent_threads: [],
      notes: [
        ...notes,
        `Could not resolve a Codex home from "${codexInput}". Install Codex or set SSENRAH_CODEX_DIR to point at a .codex directory, sessions directory, or rollout JSONL file.`,
      ],
    };
  }

  const stateDbPath = pickLatestSqliteFile(resolution.codex_dir, "state");
  if (!stateDbPath) {
    notes.push("No state_*.sqlite file found — relying on rollout transcripts only.");
  }

  let threadCount = 0;
  const recentThreads: CodexStatusReport["recent_threads"] = [];
  let latestThreadUpdatedAt: string | undefined;

  if (stateDbPath) {
    const stateDb = new Database(stateDbPath, { readonly: true, fileMustExist: true });
    try {
      const rows = stateDb
        .prepare(`
          select id, rollout_path, title, model, updated_at, archived
          from threads
          order by updated_at desc
        `)
        .all() as Array<{
          id: string;
          rollout_path: string | null;
          title: string | null;
          model: string | null;
          updated_at: number;
          archived: number;
        }>;

      threadCount = rows.length;
      if (rows.length > 0) latestThreadUpdatedAt = toIsoFromSeconds(rows[0]!.updated_at);
      for (const row of rows.slice(0, 5)) {
        recentThreads.push({
          id: row.id,
          title: row.title ?? "",
          model: row.model,
          updated_at: toIsoFromSeconds(row.updated_at),
          archived: Boolean(row.archived),
          rollout_path: row.rollout_path,
        });
      }
    } finally {
      stateDb.close();
    }
  }

  return {
    enabled,
    resolved: true,
    codex_dir: resolution.codex_dir,
    sessions_dir: resolution.sessions_dir,
    state_db: stateDbPath ?? undefined,
    rollout_count: resolution.rollout_files.length,
    thread_count: threadCount,
    latest_thread_updated_at: latestThreadUpdatedAt,
    recent_threads: recentThreads,
    notes,
  };
}

export interface CodexSyncOptions {
  /** Override the Codex home (path to ~/.codex, sessions dir, or a single rollout). */
  codexInput?: string;
  /** Override the JSONL log file ssenrah writes into. Defaults to `~/.ssenrah/events/events.jsonl` (or `$SSENRAH_LOG_DIR/events.jsonl`). */
  logFile?: string;
  /** ISO timestamp — only events at or after this time are written. */
  since?: string;
}

export interface CodexSyncResult {
  appended: number;
  skipped_existing: number;
  skipped_filtered: number;
  total_codex_events: number;
  log_file: string;
}

/**
 * Persist Codex events into the harness JSONL log.
 *
 * Idempotent: events are keyed by their stable `id` (e.g. `codex:tool:<thread>:<call>`),
 * so re-running `sync` only appends events that aren't already in the log.
 */
export function syncCodexEvents(options: CodexSyncOptions = {}): CodexSyncResult {
  const logFile =
    options.logFile ??
    join(
      process.env.SSENRAH_LOG_DIR ?? join(process.env.HOME ?? "~", ".ssenrah", "events"),
      "events.jsonl",
    );

  const events = loadCodexEvents(options.codexInput);

  const seen = new Set<string>();
  if (existsSync(logFile)) {
    for (const line of readFileSync(logFile, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as { id?: string };
        if (typeof parsed.id === "string") seen.add(parsed.id);
      } catch {
        // Ignore malformed lines — they aren't ours to repair from this command.
      }
    }
  }

  const sinceMs = options.since ? new Date(options.since).getTime() : null;
  if (sinceMs !== null && Number.isNaN(sinceMs)) {
    throw new Error(`Invalid --since timestamp: ${options.since}`);
  }

  let appended = 0;
  let skippedExisting = 0;
  let skippedFiltered = 0;

  if (!existsSync(dirname(logFile))) {
    mkdirSync(dirname(logFile), { recursive: true });
  }

  for (const event of events) {
    if (sinceMs !== null && new Date(event.timestamp).getTime() < sinceMs) {
      skippedFiltered += 1;
      continue;
    }
    if (seen.has(event.id)) {
      skippedExisting += 1;
      continue;
    }

    appendFileSync(logFile, JSON.stringify(event) + "\n", "utf-8");
    seen.add(event.id);
    appended += 1;
  }

  return {
    appended,
    skipped_existing: skippedExisting,
    skipped_filtered: skippedFiltered,
    total_codex_events: events.length,
    log_file: logFile,
  };
}
