/**
 * Cost tracker — calculates session cost from transcript files.
 *
 * Supports:
 * - Claude Code transcripts (assistant message usage blocks)
 * - Codex rollout transcripts (event_msg token_count snapshots)
 */
import { readFileSync, existsSync } from "node:fs";
import { parseCodexRollout } from "./codex-rollout.js";
import type { AgentEvent } from "./types.js";

/** Token usage breakdown for a single API call. */
export interface TokenUsage {
  input_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  output_tokens: number;
}

/** Aggregated cost breakdown for a session. */
export interface SessionCost {
  model: string;
  input_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
}

/** Per-million-token pricing for a model. */
interface ModelPricing {
  input: number;
  output: number;
  cache_read: number;
  cache_creation: number;
}

/**
 * API-equivalent pricing per 1M tokens (verified April 5, 2026 against official OpenAI / OpenAI API pricing pages).
 * Used as estimates — local CLI users may be on flat-rate plans or internal rate cards.
 */
const MODEL_PRICING: Record<string, ModelPricing> = {
  "gpt-5.4": {
    input: 2.5,
    output: 15,
    cache_read: 0.25,
    cache_creation: 0.25,
  },
  "gpt-5.4-mini": {
    input: 0.75,
    output: 4.5,
    cache_read: 0.075,
    cache_creation: 0.075,
  },
  "gpt-5.4-nano": {
    input: 0.2,
    output: 1.25,
    cache_read: 0.02,
    cache_creation: 0.02,
  },
  "gpt-5.3-codex": {
    input: 1.75,
    output: 14,
    cache_read: 0.175,
    cache_creation: 0.175,
  },
  "claude-opus-4-6": {
    input: 15,
    output: 75,
    cache_read: 1.5,
    cache_creation: 18.75,
  },
  "claude-sonnet-4-6": {
    input: 3,
    output: 15,
    cache_read: 0.3,
    cache_creation: 3.75,
  },
  "claude-haiku-4-5": {
    input: 0.8,
    output: 4,
    cache_read: 0.08,
    cache_creation: 1,
  },
};

/** Fallback pricing when model is unknown. Uses Sonnet pricing. */
const FALLBACK_PRICING: ModelPricing = MODEL_PRICING["claude-sonnet-4-6"]!;

/**
 * Resolve pricing for a model ID.
 * Handles partial matches (e.g. "claude-opus-4-6[1m]" → "claude-opus-4-6").
 */
function getPricing(model: string): ModelPricing {
  // Exact match
  if (MODEL_PRICING[model]) return MODEL_PRICING[model]!;

  // Prefix match (handles version suffixes like [1m])
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(key)) return pricing;
  }

  return FALLBACK_PRICING;
}

/** Calculate cost in USD from token counts and pricing. */
function calculateCost(usage: TokenUsage, pricing: ModelPricing): number {
  const inputCost = (usage.input_tokens / 1_000_000) * pricing.input;
  const outputCost = (usage.output_tokens / 1_000_000) * pricing.output;
  const cacheReadCost =
    (usage.cache_read_input_tokens / 1_000_000) * pricing.cache_read;
  const cacheCreationCost =
    (usage.cache_creation_input_tokens / 1_000_000) * pricing.cache_creation;
  return inputCost + outputCost + cacheReadCost + cacheCreationCost;
}

/**
 * Parse a transcript file and compute session cost.
 *
 * For Claude Code, sums assistant-message usage fields.
 * For Codex rollouts, uses the latest total token snapshot emitted in the transcript.
 *
 * Returns null if the transcript doesn't exist or has no usage data.
 */
export function calculateSessionCost(
  transcriptPath: string
): SessionCost | null {
  if (!existsSync(transcriptPath)) return null;

  const codexRollout = parseCodexRollout(transcriptPath);
  if (codexRollout?.latest_token_usage) {
    const latestTurnModel = [...codexRollout.turns].reverse().find((turn) => turn.model && turn.model !== "unknown")?.model;
    const model = latestTurnModel ?? "unknown";
    const totals: TokenUsage = {
      input_tokens: codexRollout.latest_token_usage.input_tokens,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: codexRollout.latest_token_usage.cached_input_tokens,
      output_tokens: codexRollout.latest_token_usage.output_tokens,
    };
    const pricing = getPricing(model);
    const cost_usd = calculateCost(totals, pricing);
    const total_tokens =
      totals.input_tokens +
      totals.output_tokens +
      totals.cache_creation_input_tokens +
      totals.cache_read_input_tokens;

    return {
      model,
      ...totals,
      total_tokens,
      cost_usd: Math.round(cost_usd * 10000) / 10000,
    };
  }

  let content: string;
  try {
    content = readFileSync(transcriptPath, "utf-8");
  } catch {
    return null;
  }

  const lines = content.split("\n").filter(Boolean);
  let model = "unknown";
  const totals: TokenUsage = {
    input_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 0,
  };

  let hasUsage = false;

  for (const line of lines) {
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type !== "assistant") continue;

    const message = entry.message as Record<string, unknown> | undefined;
    if (!message) continue;

    // Capture model from first assistant message
    if (model === "unknown" && typeof message.model === "string") {
      model = message.model;
    }

    const usage = message.usage as Record<string, number> | undefined;
    if (!usage) continue;

    hasUsage = true;
    totals.input_tokens += usage.input_tokens ?? 0;
    totals.output_tokens += usage.output_tokens ?? 0;
    totals.cache_creation_input_tokens +=
      usage.cache_creation_input_tokens ?? 0;
    totals.cache_read_input_tokens += usage.cache_read_input_tokens ?? 0;
  }

  if (!hasUsage) return null;

  const pricing = getPricing(model);
  const cost_usd = calculateCost(totals, pricing);
  const total_tokens =
    totals.input_tokens +
    totals.output_tokens +
    totals.cache_creation_input_tokens +
    totals.cache_read_input_tokens;

  return {
    model,
    ...totals,
    total_tokens,
    cost_usd: Math.round(cost_usd * 10000) / 10000, // 4 decimal places
  };
}

export function getAuthoritativeSessionCost(events: AgentEvent[], sessionId: string): number {
  const costEvents = events
    .filter((event) => event.session_id === sessionId && typeof event.cost_usd === "number")
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));

  if (costEvents.length === 0) return 0;
  return costEvents[costEvents.length - 1]!.cost_usd ?? 0;
}

export function getAuthoritativeTotalCost(events: AgentEvent[]): number {
  const sessionIds = [...new Set(events.map((event) => event.session_id))];
  return sessionIds.reduce(
    (sum, sessionId) => sum + getAuthoritativeSessionCost(events, sessionId),
    0,
  );
}

/**
 * Format a USD cost for display.
 */
export function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/**
 * Format a token count for display (e.g. 114511 → "114.5K").
 */
export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}K`;
  return `${(count / 1_000_000).toFixed(2)}M`;
}
