/**
 * Cost tracker — calculates session cost from transcript files.
 *
 * Supports:
 * - Claude Code transcripts (assistant message usage blocks)
 * - Codex rollout transcripts (event_msg token_count snapshots)
 */
import { readFileSync, existsSync } from "node:fs";
import { parseCodexRollout } from "./codex-rollout.js";
import type { AgentEvent, CostKind } from "./types.js";

/** Token usage accumulator across a session's API calls. */
export interface TokenUsage {
  input_tokens: number;
  cache_creation_input_tokens: number;
  cache_creation_5m_input_tokens: number;
  cache_creation_1h_input_tokens: number;
  cache_read_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  web_search_requests: number;
}

/** Aggregated cost breakdown for a session. */
export interface SessionCost {
  model: string;
  input_tokens: number;
  cache_creation_input_tokens: number;
  cache_creation_5m_input_tokens: number;
  cache_creation_1h_input_tokens: number;
  cache_read_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  web_search_requests: number;
  service_tier?: string;
  total_tokens: number;
  main_total_tokens: number;
  sidechain_total_tokens: number;
  ttft_ms?: number;
  duration_ms?: number;
  cost_usd: number;
  /** Σ of CLI-injected per-message costUSD, when present. */
  reported_cost_usd?: number;
  cost_kind: CostKind;
}

/** Per-million-token pricing for a model (web_search is USD per request). */
interface ModelPricing {
  input: number;
  output: number;
  cache_read: number;
  /** 5-minute cache-creation write rate. */
  cache_creation: number;
  /** 1-hour cache-creation write rate; defaults to `cache_creation` when omitted. */
  cache_creation_1h?: number;
  /** USD per server-side web-search request. */
  web_search?: number;
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
    web_search: 0.01,
  },
  "gpt-5.4-mini": {
    input: 0.75,
    output: 4.5,
    cache_read: 0.075,
    cache_creation: 0.075,
    web_search: 0.01,
  },
  "gpt-5.4-nano": {
    input: 0.2,
    output: 1.25,
    cache_read: 0.02,
    cache_creation: 0.02,
    web_search: 0.01,
  },
  "gpt-5.3-codex": {
    input: 1.75,
    output: 14,
    cache_read: 0.175,
    cache_creation: 0.175,
    web_search: 0.01,
  },
  "claude-opus-4-6": {
    input: 15,
    output: 75,
    cache_read: 1.5,
    cache_creation: 18.75,
    cache_creation_1h: 30,
    web_search: 0.01,
  },
  "claude-sonnet-4-6": {
    input: 3,
    output: 15,
    cache_read: 0.3,
    cache_creation: 3.75,
    cache_creation_1h: 6,
    web_search: 0.01,
  },
  "claude-haiku-4-5": {
    input: 0.8,
    output: 4,
    cache_read: 0.08,
    cache_creation: 1,
    cache_creation_1h: 1.6,
    web_search: 0.01,
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
  const cacheCreation1hRate = pricing.cache_creation_1h ?? pricing.cache_creation;
  const inputCost = (usage.input_tokens / 1_000_000) * pricing.input;
  const outputCost = (usage.output_tokens / 1_000_000) * pricing.output;
  const cacheReadCost =
    (usage.cache_read_input_tokens / 1_000_000) * pricing.cache_read;
  // Any cache-creation tokens not attributed to the 1h tier are priced at the 5m rate
  // (covers flat `cache_creation_input_tokens` transcripts with no nested TTL split).
  const cacheCreation5m =
    usage.cache_creation_input_tokens - usage.cache_creation_1h_input_tokens;
  const cacheCreationCost =
    (cacheCreation5m / 1_000_000) * pricing.cache_creation +
    (usage.cache_creation_1h_input_tokens / 1_000_000) * cacheCreation1hRate;
  const webSearchCost = usage.web_search_requests * (pricing.web_search ?? 0);
  return inputCost + outputCost + cacheReadCost + cacheCreationCost + webSearchCost;
}

/** A zeroed token accumulator. */
function emptyUsage(): TokenUsage {
  return {
    input_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_creation_5m_input_tokens: 0,
    cache_creation_1h_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    web_search_requests: 0,
  };
}

function usageTotal(usage: TokenUsage): number {
  return (
    usage.input_tokens +
    usage.output_tokens +
    usage.cache_creation_input_tokens +
    usage.cache_read_input_tokens
  );
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
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
    const totals = emptyUsage();
    totals.input_tokens = codexRollout.latest_token_usage.input_tokens;
    totals.cache_read_input_tokens = codexRollout.latest_token_usage.cached_input_tokens;
    totals.output_tokens = codexRollout.latest_token_usage.output_tokens;
    totals.reasoning_output_tokens = codexRollout.latest_token_usage.reasoning_output_tokens;
    const pricing = getPricing(model);
    const cost_usd = calculateCost(totals, pricing);
    const total_tokens = usageTotal(totals);

    return {
      model,
      ...totals,
      total_tokens,
      main_total_tokens: total_tokens,
      sidechain_total_tokens: 0,
      cost_usd: round4(cost_usd),
      cost_kind: "recomputed",
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
  const totals = emptyUsage();
  let hasUsage = false;
  let mainTotalTokens = 0;
  let sidechainTotalTokens = 0;
  let reportedCost = 0;
  let hasReported = false;
  let totalDurationMs = 0;
  let hasDuration = false;
  let ttftMs: number | undefined;
  let serviceTier: string | undefined;

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

    const isSidechain = entry.isSidechain === true;

    // CLI-injected per-message fields live at the entry level, not inside `message`.
    if (typeof entry.costUSD === "number") {
      reportedCost += entry.costUSD;
      hasReported = true;
    }
    if (typeof entry.durationMs === "number") {
      totalDurationMs += entry.durationMs;
      hasDuration = true;
    }
    if (ttftMs === undefined && !isSidechain && typeof entry.ttftMs === "number") {
      ttftMs = entry.ttftMs;
    }

    const usage = message.usage as Record<string, unknown> | undefined;
    if (!usage) continue;

    hasUsage = true;
    const input = num(usage.input_tokens);
    const output = num(usage.output_tokens);
    const cacheRead = num(usage.cache_read_input_tokens);

    // `cache_creation` may be a nested TTL split object or a flat number on older transcripts.
    let create5m = 0;
    let create1h = 0;
    const cacheCreation = usage.cache_creation;
    if (cacheCreation && typeof cacheCreation === "object") {
      const split = cacheCreation as Record<string, unknown>;
      create5m = num(split.ephemeral_5m_input_tokens);
      create1h = num(split.ephemeral_1h_input_tokens);
    } else {
      create5m = num(usage.cache_creation_input_tokens);
    }
    const createTotal = create5m + create1h;

    const serverToolUse = usage.server_tool_use;
    const webSearch =
      serverToolUse && typeof serverToolUse === "object"
        ? num((serverToolUse as Record<string, unknown>).web_search_requests)
        : 0;

    if (typeof usage.service_tier === "string") serviceTier = usage.service_tier;

    totals.input_tokens += input;
    totals.output_tokens += output;
    totals.cache_read_input_tokens += cacheRead;
    totals.cache_creation_5m_input_tokens += create5m;
    totals.cache_creation_1h_input_tokens += create1h;
    totals.cache_creation_input_tokens += createTotal;
    totals.web_search_requests += webSearch;

    const messageTotal = input + output + createTotal + cacheRead;
    if (isSidechain) sidechainTotalTokens += messageTotal;
    else mainTotalTokens += messageTotal;
  }

  if (!hasUsage) return null;

  const pricing = getPricing(model);
  const cost_usd = calculateCost(totals, pricing);
  const total_tokens = usageTotal(totals);

  return {
    model,
    ...totals,
    service_tier: serviceTier,
    total_tokens,
    main_total_tokens: mainTotalTokens,
    sidechain_total_tokens: sidechainTotalTokens,
    ttft_ms: ttftMs,
    duration_ms: hasDuration ? totalDurationMs : undefined,
    cost_usd: round4(cost_usd),
    reported_cost_usd: hasReported ? round4(reportedCost) : undefined,
    cost_kind: "recomputed",
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
