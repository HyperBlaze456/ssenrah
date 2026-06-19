# Claude Code metrics — L0–L2 field expansion (SCHEMA_VERSION 4)

Single source of truth for the metric/event fields added so agent-workflow flows can be
reconstructed *and measured* per node / lane / agent. Tracker (`tracker/src`) is the
canonical contract; the app (`app/src/lib/telemetry.ts`, `app/src/types/index.ts`,
`app/src/lib/schemas`) mirrors it field-for-field.

Goal framing: the tracker already rebuilds the *structural* flow graph
(`RunTrace` → `RunTraceLane` → `RunTraceNode`). These fields put trustworthy
**outcome**, **cost**, **tokens**, and **latency** values *onto* that graph.

`SCHEMA_VERSION` bumps **3 → 4** (`tracker/src/hook.ts`; mirror any app copy).

---

## L0 — graph correctness (hook field-name alignment)

Hooks emit some keys under different names than the tracker modelled, so data was
silently routed into `extras`. Add the canonical field and cross-fill with the existing
alias (same pattern as the existing `mcp_server` ↔ `mcp_server_name` pair).

| New `AgentEvent` field | Type | Cross-fill rule (in `hook.ts:toAgentEvent`) | Source event |
|---|---|---|---|
| `tool_output` | `unknown` | `tool_output ??= tool_response`; `tool_response ??= tool_output` | PostToolUse / PostToolUseFailure / PostToolBatch |
| `previous_cwd` | `string` | `previous_cwd ??= old_cwd`; `old_cwd ??= previous_cwd`; `new_cwd ??= cwd` | CwdChanged |
| `expanded_prompt` | `string` | direct map (already redacted by `redactPayload`) | UserPromptExpansion |
| `teammate_type` | `string` | direct map (was in `NORMALIZED_KEYS` but undeclared/unmapped) | Teammate/team events |

Add `tool_output`, `previous_cwd`, `expanded_prompt` to `NORMALIZED_KEYS`
(`teammate_type` is already present).

## L1 — per-node outcome / lifecycle fidelity (hooks only)

| New `AgentEvent` field | Type | Wiring | Source event |
|---|---|---|---|
| `completion_status` | `string` (`success`\|`failed`\|…) | feed `deriveOutcome`: TaskCompleted → `failed` when `completion_status==="failed"`, else `completed` | TaskCompleted |
| `effort_level` | `string` (`low`\|`medium`\|`high`\|`xhigh`\|`max`\|…) | `effort_level ?? (effort as {level})?.level` | tool-use / Stop / SubagentStop |

Also: `failure_class` now also derives from `error_type`
(`failure_class = failure_class ?? error_type ?? (name includes "Failure" ? name : undefined)`),
so `StopFailure.error_type` (rate_limit / overloaded / server_error / …) becomes a visible
failure class. `error_type` field already exists.

`TaskSummary.status` gains `"failed"` (telemetry.ts) — set from `completion_status` / outcome.

## L2 — per-node / lane / agent cost · tokens · latency (transcript)

All free on disk in the session transcript; no new ingestion architecture.

### `TokenUsageBreakdown` (new shared interface in `tracker/src/types.ts`, mirrored in app `types/index.ts`)

```ts
export interface TokenUsageBreakdown {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;          // = 5m + 1h
  cache_creation_5m_input_tokens?: number;
  cache_creation_1h_input_tokens?: number;
  reasoning_output_tokens?: number;              // Codex
  web_search_requests?: number;                  // server_tool_use
  service_tier?: string;                         // standard|priority|batch
  total_tokens: number;
  main_total_tokens?: number;                    // transcript isSidechain === false
  sidechain_total_tokens?: number;               // transcript isSidechain === true
}
```

### New `AgentEvent` fields (attached at Stop / SessionEnd, when cost is computed)

| Field | Type | Notes |
|---|---|---|
| `cost_kind` | `CostKind = "recomputed"\|"reported"\|"cumulative"\|"delta"` | labels `cost_usd`; our transcript total is `"recomputed"` (cumulative). Lets aggregators take-last/max, never SUM. |
| `token_usage` | `TokenUsageBreakdown` | the session breakdown carried on the terminal event |
| `ttft_ms` | `number` | first main-lane assistant `ttftMs` |
| `request_id` | `string` | reserved join key (hooks/OTel/transcript); populated when present on the payload |

Add `cost_kind`, `token_usage`, `ttft_ms`, `request_id` to `NORMALIZED_KEYS`.

### `cost.ts`

- `TokenUsage` accumulator gains: `cache_creation_5m_input_tokens`, `cache_creation_1h_input_tokens`,
  `reasoning_output_tokens`, `web_search_requests`.
- `ModelPricing` gains `cache_creation_1h` (USD/1M; Anthropic 1h write = 2× base input;
  Claude: opus 30 / sonnet 6 / haiku 1.6; GPT: fall back to `cache_creation`) and
  `web_search` (USD per request; Claude/GPT estimate `0.01` = $10 / 1k). When `cache_creation_1h`
  is absent, default to `cache_creation`.
- `calculateCost` = input + output + cache_read + `cache_creation_5m × cache_creation`
  + `cache_creation_1h × cache_creation_1h` + `web_search_requests × web_search`.
- `calculateSessionCost` (Claude branch) parses per assistant entry:
  - usage: nested `usage.cache_creation.{ephemeral_5m_input_tokens, ephemeral_1h_input_tokens}`
    (fall back to flat `usage.cache_creation_input_tokens` treated as 5m);
    `usage.server_tool_use.web_search_requests`; `usage.service_tier` (keep last seen).
  - entry-level CLI fields: `costUSD`, `durationMs`, `ttftMs`, `requestId`, `isSidechain`.
  - `reported_cost_usd` = Σ `costUSD` (when any present). `cost_usd` stays = **recomputed** total
    (complete, no regression); `cost_kind="recomputed"`. `ttft_ms` = first main assistant `ttftMs`;
    `duration_ms` = Σ `durationMs`. Split totals into `main_total_tokens` / `sidechain_total_tokens`
    by `isSidechain`.
- `SessionCost` gains all of the above (`TokenUsageBreakdown` fields + `service_tier`, `ttft_ms`,
  `duration_ms`, `reported_cost_usd?`, `cost_kind`).
- Codex branch: surface `reasoning_output_tokens` on `SessionCost` (cost unchanged — reasoning is
  already inside OpenAI `output_tokens`; do not double-charge).

### `telemetry.ts`

- `SessionSummary` gains token fields + `ttft_ms?`, `service_tier?`, `cost_kind?` — populated in
  `summarizeSessions` from the authoritative cost event's `token_usage`.
- `SessionCostSummary` gains `token_usage?`, `cost_kind?`, `ttft_ms?`, `reported_cost_usd?`
  (`getAuthoritativeSessionCostSummary` returns them from the latest snapshot — take-last, never sum).
- `AgentSummary` gains `cost_usd?`, `total_tokens?` — best-effort per actor from that actor's
  events carrying `cost_usd` / `token_usage` (main lane → `main_total_tokens`, subagent → `sidechain`).
- `TaskSummary.status` union gains `"failed"`.
- `RunTraceLane` gains `cost_usd?`, `total_tokens?` (best-effort from the lane actor's terminal cost
  event). `RunTraceNode` already has `duration_ms`.

## Out of scope (L3 / deferred)

OTel ingest (skill/plugin/agent/mcp/marketplace attribution, accept/reject rate, LoC/commit/PR,
compaction token delta, permission_mode_changed), `stop_reason` refusal classification, and
per-subagent cost from `agent_transcript_path`. Tracked for a later pass.

## Parity checklist

Every field above must exist in **both** `tracker/src` and the `app/src` mirror with identical
names/types. `SCHEMA_VERSION` 4 on both. Backward compatible: every new field is optional and,
when absent in old data, derivations behave exactly as before.
