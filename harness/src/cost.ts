/**
 * Cost tracker — calculates session cost from Claude Code transcript files.
 *
 * Reads the transcript JSONL (provided by hooks via transcript_path),
 * sums token usage from assistant messages, and applies model-specific pricing.
 */
import { readFileSync, existsSync } from "node:fs";

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
 * API-equivalent pricing per 1M tokens (March 2026).
 * Used as estimates — Claude Code users may be on flat-rate plans.
 */
const MODEL_PRICING: Record<string, ModelPricing> = {
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
 * Parse a Claude Code transcript file and compute session cost.
 *
 * Reads all assistant messages, sums their usage fields,
 * and applies model-specific pricing.
 *
 * Returns null if the transcript doesn't exist or has no usage data.
 */
export function calculateSessionCost(
  transcriptPath: string
): SessionCost | null {
  if (!existsSync(transcriptPath)) return null;

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
