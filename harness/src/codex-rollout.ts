import { existsSync, readFileSync } from "node:fs";

export interface CodexRolloutEntry {
  timestamp?: string;
  type: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CodexRolloutPrompt {
  timestamp: string;
  content: string;
}

export interface CodexRolloutToolCall {
  call_id: string;
  timestamp: string;
  turn_id?: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  kind: "function" | "custom";
}

export interface CodexRolloutToolResult {
  call_id: string;
  timestamp: string;
  success: boolean;
  output?: unknown;
  error?: string;
  raw_payload?: Record<string, unknown>;
}

export interface CodexRolloutTurn {
  turn_id: string;
  timestamp: string;
  model: string;
  reasoning_summaries: string[];
  has_encrypted_reasoning: boolean;
  assistant_output?: string;
  decisions: Array<{
    tool_name: string;
    tool_input: Record<string, unknown>;
    tool_use_id: string;
  }>;
}

export interface CodexTokenUsageSummary {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
}

export interface CodexRolloutData {
  session_id: string;
  transcript_path: string;
  started_at: string;
  ended_at: string;
  cwd: string;
  source?: string;
  model_provider?: string;
  prompts: CodexRolloutPrompt[];
  turns: CodexRolloutTurn[];
  tool_calls: CodexRolloutToolCall[];
  tool_results: CodexRolloutToolResult[];
  latest_token_usage?: CodexTokenUsageSummary;
  spawn_events: Array<{ timestamp: string; payload: Record<string, unknown> }>;
  close_events: Array<{ timestamp: string; payload: Record<string, unknown> }>;
  has_task_complete: boolean;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractSummaryTexts(summary: unknown): string[] {
  if (!Array.isArray(summary)) return [];
  return summary
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string") {
        return (item as { text: string }).text;
      }
      return null;
    })
    .filter((value): value is string => Boolean(value))
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseToolInput(value: unknown, toolName: string): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value === "string") {
    const parsed = safeJsonParse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    if (toolName === "apply_patch") return { patch: value };
    return { raw: value };
  }

  return {};
}

function parseToolResultOutput(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const parsed = safeJsonParse(value);
  return parsed ?? value;
}

function ensureTurn(
  turns: CodexRolloutTurn[],
  turnById: Map<string, CodexRolloutTurn>,
  turnId: string,
  timestamp: string,
  model = "unknown",
): CodexRolloutTurn {
  const existing = turnById.get(turnId);
  if (existing) return existing;

  const turn: CodexRolloutTurn = {
    turn_id: turnId,
    timestamp,
    model,
    reasoning_summaries: [],
    has_encrypted_reasoning: false,
    decisions: [],
  };
  turns.push(turn);
  turnById.set(turnId, turn);
  return turn;
}

function normalizeTimestamp(value: unknown, fallback: string): string {
  return typeof value === "string" && value ? value : fallback;
}

export function readCodexRolloutEntries(transcriptPath: string): CodexRolloutEntry[] {
  if (!existsSync(transcriptPath)) return [];

  let content: string;
  try {
    content = readFileSync(transcriptPath, "utf-8");
  } catch {
    return [];
  }

  const entries: CodexRolloutEntry[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    const parsed = safeJsonParse(line);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof (parsed as { type?: unknown }).type === "string") {
      entries.push(parsed as CodexRolloutEntry);
    }
  }
  return entries;
}

export function isCodexRolloutTranscript(transcriptPath: string): boolean {
  const entries = readCodexRolloutEntries(transcriptPath);
  if (entries.length === 0) return false;
  return entries.some((entry) =>
    entry.type === "session_meta" ||
    entry.type === "turn_context" ||
    entry.type === "response_item" ||
    entry.type === "event_msg",
  );
}

export function parseCodexRollout(transcriptPath: string): CodexRolloutData | null {
  const entries = readCodexRolloutEntries(transcriptPath);
  if (entries.length === 0) return null;
  if (!entries.some((entry) => entry.type === "session_meta")) return null;

  const firstTimestamp = normalizeTimestamp(entries[0]?.timestamp, new Date().toISOString());
  const lastTimestamp = normalizeTimestamp(entries[entries.length - 1]?.timestamp, firstTimestamp);
  const sessionMeta = entries.find((entry) => entry.type === "session_meta")?.payload;
  const sessionId =
    typeof sessionMeta?.id === "string"
      ? sessionMeta.id
      : transcriptPath.match(/([0-9a-f]{8,}-[0-9a-f-]{10,})\.jsonl$/i)?.[1] ?? "unknown";
  const startedAt = normalizeTimestamp(sessionMeta?.timestamp, firstTimestamp);
  const cwd = typeof sessionMeta?.cwd === "string" ? sessionMeta.cwd : "";
  const source = typeof sessionMeta?.source === "string" ? sessionMeta.source : undefined;
  const modelProvider = typeof sessionMeta?.model_provider === "string" ? sessionMeta.model_provider : undefined;

  const prompts: CodexRolloutPrompt[] = [];
  const turns: CodexRolloutTurn[] = [];
  const toolCalls: CodexRolloutToolCall[] = [];
  const toolResults = new Map<string, CodexRolloutToolResult>();
  const spawnEvents: Array<{ timestamp: string; payload: Record<string, unknown> }> = [];
  const closeEvents: Array<{ timestamp: string; payload: Record<string, unknown> }> = [];
  const turnById = new Map<string, CodexRolloutTurn>();
  const callToTurnId = new Map<string, string>();
  const callTimestamps = new Map<string, string>();
  let activeTurnId: string | undefined;
  let assistantOutputByTurn = new Map<string, string>();
  let taskCompleteByTurn = new Map<string, string>();
  let latestTokenUsage: CodexTokenUsageSummary | undefined;
  let hasTaskComplete = false;

  for (const entry of entries) {
    const timestamp = normalizeTimestamp(entry.timestamp, startedAt);

    if (entry.type === "turn_context") {
      const payload = entry.payload ?? {};
      const turnId = typeof payload.turn_id === "string" ? payload.turn_id : `turn:${turns.length + 1}`;
      const model = typeof payload.model === "string" ? payload.model : "unknown";
      activeTurnId = turnId;
      ensureTurn(turns, turnById, turnId, timestamp, model);
      continue;
    }

    if (entry.type === "response_item") {
      const payload = entry.payload ?? {};
      const responseType = payload.type;
      const turn = activeTurnId ? ensureTurn(turns, turnById, activeTurnId, timestamp) : undefined;

      if (responseType === "reasoning") {
        if (!turn) continue;
        turn.reasoning_summaries.push(...extractSummaryTexts(payload.summary));
        if (typeof payload.encrypted_content === "string" && payload.encrypted_content) {
          turn.has_encrypted_reasoning = true;
        }
        continue;
      }

      if (responseType === "message" && payload.role === "assistant") {
        const content = Array.isArray(payload.content) ? payload.content : [];
        const text = content
          .filter((item) => item && typeof item === "object" && (item as { type?: unknown }).type === "output_text")
          .map((item) => (item as { text?: unknown }).text)
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          .join("\n");

        if (turn && text) {
          assistantOutputByTurn.set(turn.turn_id, assistantOutputByTurn.get(turn.turn_id) ? `${assistantOutputByTurn.get(turn.turn_id)}\n${text}` : text);
        }
        continue;
      }

      if ((responseType === "function_call" || responseType === "custom_tool_call") && typeof payload.call_id === "string" && typeof payload.name === "string") {
        const turnId = activeTurnId;
        const toolCall: CodexRolloutToolCall = {
          call_id: payload.call_id,
          timestamp,
          turn_id: turnId,
          tool_name: payload.name,
          tool_input: parseToolInput(responseType === "function_call" ? payload.arguments : payload.input, payload.name),
          kind: responseType === "custom_tool_call" ? "custom" : "function",
        };
        toolCalls.push(toolCall);
        callTimestamps.set(toolCall.call_id, timestamp);
        if (turnId) {
          callToTurnId.set(toolCall.call_id, turnId);
          const ensuredTurn = ensureTurn(turns, turnById, turnId, timestamp);
          ensuredTurn.decisions.push({
            tool_name: toolCall.tool_name,
            tool_input: toolCall.tool_input,
            tool_use_id: toolCall.call_id,
          });
        }
        continue;
      }

      if ((responseType === "function_call_output" || responseType === "custom_tool_call_output") && typeof payload.call_id === "string") {
        toolResults.set(payload.call_id, {
          call_id: payload.call_id,
          timestamp,
          success: true,
          output: parseToolResultOutput(payload.output),
          raw_payload: payload,
        });
      }
      continue;
    }

    if (entry.type !== "event_msg") continue;
    const payload = entry.payload ?? {};
    const eventType = payload.type;

    if (eventType === "user_message" && typeof payload.message === "string") {
      prompts.push({ timestamp, content: payload.message });
      continue;
    }

    if (eventType === "token_count") {
      const total = payload.info && typeof payload.info === "object"
        ? (payload.info as { total_token_usage?: Record<string, unknown> }).total_token_usage
        : undefined;
      if (total) {
        latestTokenUsage = {
          input_tokens: Number(total.input_tokens ?? 0),
          cached_input_tokens: Number(total.cached_input_tokens ?? 0),
          output_tokens: Number(total.output_tokens ?? 0),
          reasoning_output_tokens: Number(total.reasoning_output_tokens ?? 0),
          total_tokens: Number(total.total_tokens ?? 0),
        };
      }
      continue;
    }

    if (eventType === "agent_message" && typeof payload.message === "string" && activeTurnId) {
      assistantOutputByTurn.set(
        activeTurnId,
        assistantOutputByTurn.get(activeTurnId)
          ? `${assistantOutputByTurn.get(activeTurnId)}\n${payload.message}`
          : payload.message,
      );
      continue;
    }

    if (eventType === "task_complete" && typeof payload.turn_id === "string" && typeof payload.last_agent_message === "string") {
      hasTaskComplete = true;
      taskCompleteByTurn.set(payload.turn_id, payload.last_agent_message);
      continue;
    }

    if (eventType === "collab_agent_spawn_end") {
      spawnEvents.push({ timestamp, payload });
    } else if (eventType === "collab_close_end") {
      closeEvents.push({ timestamp, payload });
    }

    if (typeof payload.call_id !== "string") continue;

    if (eventType === "exec_command_end") {
      toolResults.set(payload.call_id, {
        call_id: payload.call_id,
        timestamp,
        success: Number(payload.exit_code ?? 0) === 0 && payload.status !== "failed",
        output: payload.aggregated_output ?? payload.formatted_output ?? payload.stdout,
        error:
          Number(payload.exit_code ?? 0) === 0 && payload.status !== "failed"
            ? undefined
            : typeof payload.stderr === "string" && payload.stderr
              ? payload.stderr
              : typeof payload.aggregated_output === "string"
                ? payload.aggregated_output
                : "Command failed",
        raw_payload: payload,
      });
      continue;
    }

    if (eventType === "patch_apply_end") {
      toolResults.set(payload.call_id, {
        call_id: payload.call_id,
        timestamp,
        success: payload.success !== false,
        output: payload.changes ?? payload.stdout,
        error: payload.success === false ? String(payload.stderr ?? "Patch apply failed") : undefined,
        raw_payload: payload,
      });
      continue;
    }

    if (eventType === "mcp_tool_call_end") {
      const result = payload.result as Record<string, unknown> | undefined;
      const ok = Boolean(result && Object.prototype.hasOwnProperty.call(result, "Ok"));
      toolResults.set(payload.call_id, {
        call_id: payload.call_id,
        timestamp,
        success: ok,
        output: ok ? result?.Ok : undefined,
        error: ok ? undefined : JSON.stringify(result ?? payload.result ?? {}),
        raw_payload: payload,
      });
      continue;
    }

    if (eventType === "collab_agent_spawn_end" || eventType === "collab_waiting_end" || eventType === "collab_close_end") {
      toolResults.set(payload.call_id, {
        call_id: payload.call_id,
        timestamp,
        success: payload.status !== "failed",
        output: payload,
        raw_payload: payload,
      });
    }
  }

  for (const turn of turns) {
    const assistantOutput = assistantOutputByTurn.get(turn.turn_id);
    if (assistantOutput) {
      turn.assistant_output = assistantOutput;
      continue;
    }
    const fallbackMessage = taskCompleteByTurn.get(turn.turn_id);
    if (fallbackMessage) {
      turn.assistant_output = fallbackMessage;
    }
  }

  return {
    session_id: sessionId,
    transcript_path: transcriptPath,
    started_at: startedAt,
    ended_at: lastTimestamp,
    cwd,
    source,
    model_provider: modelProvider,
    prompts,
    turns,
    tool_calls: toolCalls,
    tool_results: [...toolResults.values()].sort((left, right) => left.timestamp.localeCompare(right.timestamp)),
    latest_token_usage: latestTokenUsage,
    spawn_events: spawnEvents,
    close_events: closeEvents,
    has_task_complete: hasTaskComplete,
  };
}
