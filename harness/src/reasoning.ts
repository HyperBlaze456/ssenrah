/**
 * Reasoning extractor — parses Claude Code transcripts to extract
 * decision chains: thinking → reasoning → tool decisions.
 *
 * V-3: "Log reasoning process and decision paths — the 'why' logging."
 *
 * Transcript entries are streamed: each assistant message.id may span
 * multiple JSONL entries (thinking block, text block, tool_use block).
 * We group by message.id to reconstruct full turns.
 */
import { readFileSync, existsSync } from "node:fs";

export interface ToolDecision {
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id: string;
}

export interface ReasoningStep {
  /** ISO timestamp of the first entry in this turn */
  timestamp: string;
  /** Model used for this turn */
  model: string;
  /** Extended thinking content (internal reasoning) */
  thinking?: string;
  /** Visible text reasoning shown to user */
  reasoning?: string;
  /** Tool calls made in this turn */
  decisions: ToolDecision[];
}

export interface UserPrompt {
  timestamp: string;
  content: string;
}

export interface ChainSummary {
  total_turns: number;
  total_thinking_blocks: number;
  total_reasoning_blocks: number;
  total_decisions: number;
  total_user_prompts: number;
  models_used: string[];
}

export interface DecisionChain {
  session_id: string;
  transcript_path: string;
  prompts: UserPrompt[];
  steps: ReasoningStep[];
  summary: ChainSummary;
}

interface TranscriptEntry {
  type: string;
  sessionId?: string;
  timestamp?: string;
  message?: {
    id?: string;
    model?: string;
    role?: string;
    content?: Array<{
      type: string;
      text?: string;
      thinking?: string;
      name?: string;
      id?: string;
      input?: Record<string, unknown>;
    }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Group consecutive assistant entries by message.id into turns.
 * Each turn may have thinking, text, and tool_use content blocks.
 */
function groupIntoTurns(entries: TranscriptEntry[]): Map<string, TranscriptEntry[]> {
  const turns = new Map<string, TranscriptEntry[]>();

  for (const entry of entries) {
    if (entry.type !== "assistant") continue;
    const msgId = entry.message?.id;
    if (!msgId) continue;

    const group = turns.get(msgId);
    if (group) {
      group.push(entry);
    } else {
      turns.set(msgId, [entry]);
    }
  }

  return turns;
}

/**
 * Extract a ReasoningStep from a group of transcript entries sharing the same message.id.
 */
function turnToStep(entries: TranscriptEntry[]): ReasoningStep {
  const first = entries[0]!;
  const model = first.message?.model ?? "unknown";
  const timestamp = (first.timestamp as string) ?? new Date().toISOString();

  let thinking: string | undefined;
  let reasoning: string | undefined;
  const decisions: ToolDecision[] = [];

  for (const entry of entries) {
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (block.type === "thinking" && block.thinking) {
        thinking = thinking
          ? thinking + "\n" + block.thinking
          : block.thinking;
      } else if (block.type === "text" && block.text) {
        reasoning = reasoning ? reasoning + "\n" + block.text : block.text;
      } else if (block.type === "tool_use" && block.name) {
        decisions.push({
          tool_name: block.name,
          tool_input: block.input ?? {},
          tool_use_id: block.id ?? "",
        });
      }
    }
  }

  return { timestamp, model, thinking, reasoning, decisions };
}

/**
 * Extract user prompts from transcript entries.
 */
function extractPrompts(entries: TranscriptEntry[]): UserPrompt[] {
  const prompts: UserPrompt[] = [];

  for (const entry of entries) {
    if (entry.type !== "user") continue;

    const timestamp = (entry.timestamp as string) ?? "";
    const message = entry.message;
    let content = "";

    if (typeof message?.content === "string") {
      content = message.content;
    } else if (Array.isArray(message?.content)) {
      content = message!.content
        .filter((b) => b.type === "text" && b.text)
        .map((b) => b.text)
        .join("\n");
    }

    if (content.trim()) {
      prompts.push({ timestamp, content: content.trim() });
    }
  }

  return prompts;
}

/**
 * Parse a transcript JSONL file into entries.
 */
function parseTranscript(transcriptPath: string): TranscriptEntry[] {
  if (!existsSync(transcriptPath)) return [];

  let content: string;
  try {
    content = readFileSync(transcriptPath, "utf-8");
  } catch {
    return [];
  }

  const entries: TranscriptEntry[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as TranscriptEntry);
    } catch {
      // skip malformed lines
    }
  }

  return entries;
}

/**
 * Extract the full decision chain from a Claude Code transcript.
 *
 * Groups assistant messages by message.id, extracts thinking/reasoning/tool_use,
 * and returns a structured chain with user prompts interleaved.
 */
export function extractDecisionChain(
  transcriptPath: string
): DecisionChain | null {
  const entries = parseTranscript(transcriptPath);
  if (entries.length === 0) return null;

  const sessionId =
    entries.find((e) => e.sessionId)?.sessionId ?? "unknown";

  const turns = groupIntoTurns(entries);
  const steps: ReasoningStep[] = [];

  // Process turns in insertion order (chronological since JSONL is append-only)
  for (const [, group] of turns) {
    const step = turnToStep(group);
    // Only include steps that have reasoning or decisions
    if (step.thinking || step.reasoning || step.decisions.length > 0) {
      steps.push(step);
    }
  }

  const prompts = extractPrompts(entries);

  const modelsUsed = [...new Set(steps.map((s) => s.model).filter((m) => m !== "unknown"))];

  const summary: ChainSummary = {
    total_turns: steps.length,
    total_thinking_blocks: steps.filter((s) => s.thinking).length,
    total_reasoning_blocks: steps.filter((s) => s.reasoning).length,
    total_decisions: steps.reduce((n, s) => n + s.decisions.length, 0),
    total_user_prompts: prompts.length,
    models_used: modelsUsed,
  };

  return {
    session_id: sessionId,
    transcript_path: transcriptPath,
    prompts,
    steps,
    summary,
  };
}

/**
 * Format a reasoning step for CLI display.
 */
function formatStep(step: ReasoningStep, index: number): string {
  const lines: string[] = [];
  const time = new Date(step.timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  lines.push(`  ┌─ Turn ${index + 1}  ${time}  [${step.model}]`);

  if (step.thinking) {
    const preview = step.thinking.length > 200
      ? step.thinking.slice(0, 200) + "…"
      : step.thinking;
    lines.push(`  │ 🧠 Thinking: ${preview.replace(/\n/g, "\n  │   ")}`);
  }

  if (step.reasoning) {
    const preview = step.reasoning.length > 200
      ? step.reasoning.slice(0, 200) + "…"
      : step.reasoning;
    lines.push(`  │ 💬 Reasoning: ${preview.replace(/\n/g, "\n  │   ")}`);
  }

  for (const d of step.decisions) {
    const inputPreview = JSON.stringify(d.tool_input);
    const truncated = inputPreview.length > 100
      ? inputPreview.slice(0, 100) + "…"
      : inputPreview;
    lines.push(`  │ → ${d.tool_name}(${truncated})`);
  }

  lines.push("  └─");
  return lines.join("\n");
}

/**
 * Format a full decision chain for CLI display.
 */
export function formatDecisionChain(chain: DecisionChain): string {
  const lines: string[] = [];

  lines.push("╔══════════════════════════════════════════════════════╗");
  lines.push("║        ssenrah — Decision Chain (V-3)               ║");
  lines.push("╠══════════════════════════════════════════════════════╣");
  lines.push(`║  Session:    ${chain.session_id.slice(0, 8).padEnd(40)} ║`);
  lines.push(`║  Turns:      ${String(chain.summary.total_turns).padEnd(40)} ║`);
  lines.push(`║  Thinking:   ${String(chain.summary.total_thinking_blocks).padEnd(40)} ║`);
  lines.push(`║  Reasoning:  ${String(chain.summary.total_reasoning_blocks).padEnd(40)} ║`);
  lines.push(`║  Decisions:  ${String(chain.summary.total_decisions).padEnd(40)} ║`);
  lines.push(`║  Prompts:    ${String(chain.summary.total_user_prompts).padEnd(40)} ║`);
  lines.push(`║  Models:     ${chain.summary.models_used.join(", ").padEnd(40).slice(0, 40)} ║`);
  lines.push("╚══════════════════════════════════════════════════════╝");
  lines.push("");

  // Interleave prompts and steps chronologically
  const allItems: Array<{ ts: string; type: "prompt" | "step"; idx: number }> = [];

  for (let i = 0; i < chain.prompts.length; i++) {
    allItems.push({ ts: chain.prompts[i]!.timestamp, type: "prompt", idx: i });
  }
  for (let i = 0; i < chain.steps.length; i++) {
    allItems.push({ ts: chain.steps[i]!.timestamp, type: "step", idx: i });
  }

  allItems.sort((a, b) => a.ts.localeCompare(b.ts));

  for (const item of allItems) {
    if (item.type === "prompt") {
      const p = chain.prompts[item.idx]!;
      const preview = p.content.length > 100
        ? p.content.slice(0, 100) + "…"
        : p.content;
      lines.push(`  ▶ User: ${preview}`);
      lines.push("");
    } else {
      lines.push(formatStep(chain.steps[item.idx]!, item.idx));
      lines.push("");
    }
  }

  return lines.join("\n");
}
