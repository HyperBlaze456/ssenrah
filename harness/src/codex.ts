import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { AgentEvent, EffectLevel, ToolCategory } from "./types.js";

interface CodexThreadRow {
  id: string;
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

interface CodexLogRow {
  id: number;
  ts: number;
  ts_nanos: number;
  level: string;
  target: string;
  feedback_log_body: string | null;
  thread_id: string | null;
}

interface CodexHistoryEntry {
  session_id: string;
  ts: number;
  text: string;
}

interface CodexParsedToolCall {
  tool_name: string;
  tool_input?: Record<string, unknown>;
  model?: string;
  turn_id?: string;
  submission_id?: string;
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

function toIsoFromSeconds(tsSeconds: number, tsNanos = 0): string {
  return new Date(tsSeconds * 1000 + Math.floor(tsNanos / 1_000_000)).toISOString();
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

  if (toolName === "update_plan" || toolName === "spawn_agent" || toolName === "wait_agent" || toolName === "send_input" || toolName === "close_agent" || toolName === "resume_agent") {
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

function parseToolCallBody(feedbackLogBody: string): CodexParsedToolCall | null {
  const marker = "ToolCall: ";
  const markerIndex = feedbackLogBody.indexOf(marker);
  if (markerIndex < 0) return null;

  const threadMarkerIndex = feedbackLogBody.lastIndexOf(" thread_id=");
  const toolCallBody = feedbackLogBody
    .slice(markerIndex + marker.length, threadMarkerIndex >= 0 ? threadMarkerIndex : undefined)
    .trim();
  if (!toolCallBody) return null;

  const firstWhitespace = toolCallBody.search(/\s/);
  const tool_name = firstWhitespace >= 0 ? toolCallBody.slice(0, firstWhitespace).trim() : toolCallBody;
  const rawInput = firstWhitespace >= 0 ? toolCallBody.slice(firstWhitespace).trim() : "";

  let tool_input: Record<string, unknown> | undefined;
  if (rawInput.startsWith("{")) {
    const parsed = safeJsonParse(rawInput);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      tool_input = parsed as Record<string, unknown>;
    } else if (parsed !== null) {
      tool_input = { value: parsed };
    } else {
      tool_input = { raw: rawInput };
    }
  } else if (rawInput.length > 0) {
    tool_input = tool_name === "apply_patch" ? { patch: rawInput } : { raw: rawInput };
  }

  return {
    tool_name,
    tool_input,
    model: feedbackLogBody.match(/ model=([^\s}:]+)/)?.[1],
    turn_id: feedbackLogBody.match(/ turn\.id=([^\s}]+)/)?.[1],
    submission_id: feedbackLogBody.match(/ submission\.id="([^"]+)"/)?.[1],
  };
}

function parseTurnError(feedbackLogBody: string): string | undefined {
  const marker = "Turn error: ";
  const index = feedbackLogBody.indexOf(marker);
  if (index < 0) return undefined;
  return feedbackLogBody.slice(index + marker.length).trim();
}

function readCodexHistory(historyPath: string): CodexHistoryEntry[] {
  if (!existsSync(historyPath)) return [];
  const lines = readFileSync(historyPath, "utf-8").split("\n").filter(Boolean);
  const entries: CodexHistoryEntry[] = [];

  for (const line of lines) {
    const parsed = safeJsonParse(line) as Partial<CodexHistoryEntry> | null;
    if (
      parsed &&
      typeof parsed.session_id === "string" &&
      typeof parsed.ts === "number" &&
      typeof parsed.text === "string"
    ) {
      entries.push({
        session_id: parsed.session_id,
        ts: parsed.ts,
        text: parsed.text,
      });
    }
  }

  return entries.sort((left, right) => left.ts - right.ts);
}

export function loadCodexEvents(
  codexDir = process.env.SSENRAH_CODEX_DIR ?? DEFAULT_CODEX_DIR,
): AgentEvent[] {
  if (!includeCodexByDefault() || !existsSync(codexDir)) return [];

  const stateDbPath = pickLatestSqliteFile(codexDir, "state");
  const logsDbPath = pickLatestSqliteFile(codexDir, "logs");
  if (!stateDbPath || !logsDbPath) return [];

  const historyPath = join(codexDir, "history.jsonl");
  const stateDb = new Database(stateDbPath, { readonly: true, fileMustExist: true });
  const logsDb = new Database(logsDbPath, { readonly: true, fileMustExist: true });

  try {
    const threads = stateDb
      .prepare(`
        select
          id, title, source, model_provider, cwd, created_at, updated_at,
          archived, archived_at, model, reasoning_effort, agent_nickname, agent_role, agent_path
        from threads
        order by created_at asc
      `)
      .all() as CodexThreadRow[];

    if (threads.length === 0) return [];

    const hasSpawnEdgesTable = Boolean(
      stateDb
        .prepare(`select 1 as present from sqlite_master where type = 'table' and name = 'thread_spawn_edges' limit 1`)
        .get(),
    );

    const edges = hasSpawnEdgesTable
      ? (stateDb
          .prepare(`select parent_thread_id, child_thread_id, status from thread_spawn_edges`)
          .all() as CodexSpawnEdgeRow[])
      : [];

    const threadById = new Map(threads.map((thread) => [thread.id, thread]));
    const parentByChild = new Map(edges.map((edge) => [edge.child_thread_id, edge.parent_thread_id]));

    for (const thread of threads) {
      if (parentByChild.has(thread.id)) continue;
      const sourceParent = parseSpawnSource(thread.source);
      if (sourceParent) parentByChild.set(thread.id, sourceParent);
    }

    const rootMemo = new Map<string, string>();
    const histories = readCodexHistory(historyPath).filter((entry) => threadById.has(entry.session_id));
    const relevantLogs = logsDb
      .prepare(`
        select id, ts, ts_nanos, level, target, feedback_log_body, thread_id
        from logs
        where
          thread_id is not null and
          feedback_log_body is not null and
          (
            feedback_log_body like '%ToolCall:%' or
            feedback_log_body like '%Turn error:%'
          )
        order by ts asc, ts_nanos asc, id asc
      `)
      .all() as CodexLogRow[];

    const promptCounters = new Map<string, number>();
    const events: AgentEvent[] = [];

    for (const thread of threads) {
      const rootThreadId = getRootThreadId(thread.id, parentByChild, rootMemo);
      const isRootThread = rootThreadId === thread.id;
      const agentType = titleCase(thread.agent_role) ?? thread.agent_nickname ?? "Subagent";

      if (isRootThread) {
        events.push({
          id: `codex:session-start:${thread.id}`,
          schema_version: 3,
          timestamp: toIsoFromSeconds(thread.created_at),
          session_id: thread.id,
          hook_event_type: "SessionStart",
          cwd: thread.cwd,
          source: `codex:${thread.source}`,
          model: thread.model ?? undefined,
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
          },
        });
      } else {
        events.push({
          id: `codex:subagent-start:${thread.id}`,
          schema_version: 3,
          timestamp: toIsoFromSeconds(thread.created_at),
          session_id: rootThreadId,
          hook_event_type: "SubagentStart",
          cwd: thread.cwd,
          agent_id: thread.id,
          agent_type: agentType,
          model: thread.model ?? undefined,
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
          },
        });
      }

      const edgeStatus = edges.find((edge) => edge.child_thread_id === thread.id)?.status;
      const endedAt = thread.archived_at ?? (edgeStatus && edgeStatus !== "open" ? thread.updated_at : null);
      if (!isRootThread && endedAt) {
        events.push({
          id: `codex:subagent-stop:${thread.id}`,
          schema_version: 3,
          timestamp: toIsoFromSeconds(endedAt),
          session_id: rootThreadId,
          hook_event_type: "SubagentStop",
          cwd: thread.cwd,
          agent_id: thread.id,
          agent_type: agentType,
          model: thread.model ?? undefined,
          outcome: edgeStatus === "failed" ? "failed" : "completed",
          branch_kind: "subagent",
          root_run_id: rootThreadId,
          parent_run_id: parentByChild.get(thread.id),
          reason: edgeStatus ?? "archived",
          collapsed_by_default: true,
          extras: {
            provider: "codex",
            model_provider: thread.model_provider,
          },
          _raw: {
            provider: "codex",
            thread,
            edge_status: edgeStatus,
          },
        });
      }
    }

    for (const entry of histories) {
      const rootThreadId = getRootThreadId(entry.session_id, parentByChild, rootMemo);
      const promptIndex = (promptCounters.get(rootThreadId) ?? 0) + 1;
      promptCounters.set(rootThreadId, promptIndex);

      const thread = threadById.get(entry.session_id)!;
      const isRootThread = rootThreadId === entry.session_id;
      events.push({
        id: `codex:prompt:${entry.session_id}:${entry.ts}:${promptIndex}`,
        schema_version: 3,
        timestamp: toIsoFromSeconds(entry.ts),
        session_id: rootThreadId,
        hook_event_type: "UserPromptSubmit",
        cwd: thread.cwd,
        prompt: entry.text,
        message: entry.text,
        prompt_segment_id: `${rootThreadId}:prompt:${promptIndex}`,
        model: thread.model ?? undefined,
        branch_kind: isRootThread ? "main" : "subagent",
        root_run_id: rootThreadId,
        parent_run_id: isRootThread ? undefined : parentByChild.get(entry.session_id),
        agent_id: isRootThread ? undefined : entry.session_id,
        agent_type: isRootThread ? undefined : titleCase(thread.agent_role) ?? thread.agent_nickname ?? "Subagent",
        effect_level: "reasoning_or_coordination",
        tool_category: "coordination",
        extras: {
          provider: "codex",
          model_provider: thread.model_provider,
        },
        _raw: {
          provider: "codex",
          history: entry,
        },
      });
    }

    for (const row of relevantLogs) {
      if (!row.thread_id || !row.feedback_log_body || !threadById.has(row.thread_id)) continue;

      const thread = threadById.get(row.thread_id)!;
      const rootThreadId = getRootThreadId(row.thread_id, parentByChild, rootMemo);
      const isRootThread = rootThreadId === row.thread_id;
      const agentType = isRootThread
        ? undefined
        : titleCase(thread.agent_role) ?? thread.agent_nickname ?? "Subagent";
      const timestamp = toIsoFromSeconds(row.ts, row.ts_nanos);
      const parsedToolCall = parseToolCallBody(row.feedback_log_body);

      if (parsedToolCall) {
        const classification = classifyCodexToolCall(parsedToolCall.tool_name, parsedToolCall.tool_input);
        events.push({
          id: `codex:tool:${row.id}`,
          schema_version: 3,
          timestamp,
          session_id: rootThreadId,
          hook_event_type: "PostToolUse",
          cwd: thread.cwd,
          tool_name: parsedToolCall.tool_name,
          tool_input: parsedToolCall.tool_input,
          tool_use_id: parsedToolCall.turn_id ?? parsedToolCall.submission_id ?? `codex-tool-${row.id}`,
          model: parsedToolCall.model ?? thread.model ?? undefined,
          agent_id: isRootThread ? undefined : row.thread_id,
          agent_type: agentType,
          root_run_id: rootThreadId,
          parent_run_id: isRootThread ? undefined : parentByChild.get(row.thread_id),
          branch_kind: isRootThread ? "main" : "subagent",
          tool_category: classification.tool_category,
          effect_level: classification.effect_level,
          collapsed_by_default:
            classification.effect_level === "inspection_only" ||
            (!isRootThread && classification.effect_level === "reasoning_or_coordination"),
          extras: {
            provider: "codex",
            codex_log_level: row.level,
            codex_log_target: row.target,
          },
          _raw: {
            provider: "codex",
            log: row,
          },
        });
        continue;
      }

      const error = parseTurnError(row.feedback_log_body);
      if (!error) continue;

      events.push({
        id: `codex:error:${row.id}`,
        schema_version: 3,
        timestamp,
        session_id: rootThreadId,
        hook_event_type: "StopFailure",
        cwd: thread.cwd,
        error,
        model: thread.model ?? undefined,
        agent_id: isRootThread ? undefined : row.thread_id,
        agent_type: agentType,
        root_run_id: rootThreadId,
        parent_run_id: isRootThread ? undefined : parentByChild.get(row.thread_id),
        branch_kind: isRootThread ? "main" : "subagent",
        failure_class: "codex_turn_error",
        effect_level: "failure_or_anomaly",
        extras: {
          provider: "codex",
          codex_log_level: row.level,
          codex_log_target: row.target,
        },
        _raw: {
          provider: "codex",
          log: row,
        },
      });
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
  } catch {
    return [];
  } finally {
    stateDb.close();
    logsDb.close();
  }
}
