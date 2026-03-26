import { useEffect, useState } from "react";
import { useMonitorStore } from "@/lib/store/monitor";
import { readTextFile, exists } from "@tauri-apps/plugin-fs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { DollarSign, Coins, Zap, Database, AlertCircle } from "lucide-react";

interface SessionCost {
  session_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  total_tokens: number;
  cost_usd: number;
}

interface ModelPricing {
  input: number;
  output: number;
  cache_read: number;
  cache_creation: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-6": { input: 15, output: 75, cache_read: 1.5, cache_creation: 18.75 },
  "claude-sonnet-4-6": { input: 3, output: 15, cache_read: 0.3, cache_creation: 3.75 },
  "claude-haiku-4-5": { input: 0.8, output: 4, cache_read: 0.08, cache_creation: 1 },
};

const FALLBACK_PRICING = MODEL_PRICING["claude-sonnet-4-6"]!;

function getPricing(model: string): ModelPricing {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model]!;
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(key)) return pricing;
  }
  return FALLBACK_PRICING;
}

function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}K`;
  return `${(count / 1_000_000).toFixed(2)}M`;
}

function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

async function parseTranscriptCost(
  transcriptPath: string,
  sessionId: string
): Promise<SessionCost | null> {
  try {
    const fileExists = await exists(transcriptPath);
    if (!fileExists) return null;

    const content = await readTextFile(transcriptPath);
    const lines = content.split("\n").filter(Boolean);

    let model = "unknown";
    const totals = {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
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

      if (model === "unknown" && typeof message.model === "string") {
        model = message.model;
      }

      const usage = message.usage as Record<string, number> | undefined;
      if (!usage) continue;

      hasUsage = true;
      totals.input_tokens += usage.input_tokens ?? 0;
      totals.output_tokens += usage.output_tokens ?? 0;
      totals.cache_read_input_tokens += usage.cache_read_input_tokens ?? 0;
      totals.cache_creation_input_tokens +=
        usage.cache_creation_input_tokens ?? 0;
    }

    if (!hasUsage) return null;

    const pricing = getPricing(model);
    const cost_usd =
      (totals.input_tokens / 1_000_000) * pricing.input +
      (totals.output_tokens / 1_000_000) * pricing.output +
      (totals.cache_read_input_tokens / 1_000_000) * pricing.cache_read +
      (totals.cache_creation_input_tokens / 1_000_000) * pricing.cache_creation;

    const total_tokens =
      totals.input_tokens +
      totals.output_tokens +
      totals.cache_read_input_tokens +
      totals.cache_creation_input_tokens;

    return {
      session_id: sessionId,
      model,
      ...totals,
      total_tokens,
      cost_usd: Math.round(cost_usd * 10000) / 10000,
    };
  } catch {
    return null;
  }
}

export function CostPanel() {
  const events = useMonitorStore((s) => s.events);
  const loading = useMonitorStore((s) => s.loading);
  const error = useMonitorStore((s) => s.error);
  const startAutoRefresh = useMonitorStore((s) => s.startAutoRefresh);
  const stopAutoRefresh = useMonitorStore((s) => s.stopAutoRefresh);

  const [costs, setCosts] = useState<SessionCost[]>([]);
  const [costLoading, setCostLoading] = useState(false);

  useEffect(() => {
    startAutoRefresh(10000);
    return () => stopAutoRefresh();
  }, [startAutoRefresh, stopAutoRefresh]);

  // Extract transcript paths and compute costs
  useEffect(() => {
    if (events.length === 0) return;

    const sessionTranscripts = new Map<string, string>();
    for (const e of events) {
      const raw = e._raw as Record<string, unknown> | undefined;
      if (raw?.transcript_path && typeof raw.transcript_path === "string") {
        sessionTranscripts.set(e.session_id, raw.transcript_path);
      }
    }

    if (sessionTranscripts.size === 0) return;

    setCostLoading(true);
    Promise.all(
      [...sessionTranscripts.entries()].map(([sessionId, path]) =>
        parseTranscriptCost(path, sessionId)
      )
    ).then((results) => {
      setCosts(results.filter((c): c is SessionCost => c !== null));
      setCostLoading(false);
    });
  }, [events]);

  if (error) {
    return (
      <div className="p-4 text-destructive">
        <AlertCircle className="inline h-4 w-4 mr-2" />
        Failed to load cost data: {error}
      </div>
    );
  }

  const grandTotal = costs.reduce((sum, c) => sum + c.cost_usd, 0);
  const totalTokens = costs.reduce((sum, c) => sum + c.total_tokens, 0);

  return (
    <div className="space-y-6">
      {/* Grand total card */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Total Estimated Cost
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{formatCost(grandTotal)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              API-equivalent pricing
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Coins className="h-4 w-4" />
              Total Tokens
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{formatTokens(totalTokens)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              across {costs.length} session{costs.length !== 1 ? "s" : ""}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Avg. per Session
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {costs.length > 0
                ? formatCost(grandTotal / costs.length)
                : "$0.00"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Per-session breakdown */}
      {(costLoading || loading) && costs.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8 animate-pulse">
          Loading cost data from transcripts...
        </p>
      )}

      {costs.length === 0 && !costLoading && !loading && (
        <p className="text-sm text-muted-foreground text-center py-8">
          No transcript data available yet. Cost data appears after sessions end.
        </p>
      )}

      {costs.map((cost) => (
        <Card key={cost.session_id}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-mono flex items-center gap-2">
                {cost.session_id.slice(0, 8)}
                <Badge variant="outline" className="text-[10px]">
                  {cost.model}
                </Badge>
              </CardTitle>
              <span className="text-lg font-bold">
                {formatCost(cost.cost_usd)}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
              <div>
                <span className="text-muted-foreground block text-xs mb-1">
                  Input
                </span>
                <span className="font-medium">
                  {formatTokens(cost.input_tokens)}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block text-xs mb-1">
                  Output
                </span>
                <span className="font-medium">
                  {formatTokens(cost.output_tokens)}
                </span>
              </div>
              <div className="flex items-start gap-1">
                <Database className="h-3 w-3 text-muted-foreground mt-0.5" />
                <div>
                  <span className="text-muted-foreground block text-xs mb-1">
                    Cache Read
                  </span>
                  <span className="font-medium">
                    {formatTokens(cost.cache_read_input_tokens)}
                  </span>
                </div>
              </div>
              <div className="flex items-start gap-1">
                <Database className="h-3 w-3 text-muted-foreground mt-0.5" />
                <div>
                  <span className="text-muted-foreground block text-xs mb-1">
                    Cache Created
                  </span>
                  <span className="font-medium">
                    {formatTokens(cost.cache_creation_input_tokens)}
                  </span>
                </div>
              </div>
            </div>

            {/* Token distribution bar */}
            <div className="mt-4">
              <div className="flex h-2 rounded-full overflow-hidden bg-muted">
                {cost.total_tokens > 0 && (
                  <>
                    <div
                      className="bg-blue-500"
                      style={{
                        width: `${(cost.input_tokens / cost.total_tokens) * 100}%`,
                      }}
                      title={`Input: ${formatTokens(cost.input_tokens)}`}
                    />
                    <div
                      className="bg-green-500"
                      style={{
                        width: `${(cost.output_tokens / cost.total_tokens) * 100}%`,
                      }}
                      title={`Output: ${formatTokens(cost.output_tokens)}`}
                    />
                    <div
                      className="bg-purple-400"
                      style={{
                        width: `${(cost.cache_read_input_tokens / cost.total_tokens) * 100}%`,
                      }}
                      title={`Cache Read: ${formatTokens(cost.cache_read_input_tokens)}`}
                    />
                    <div
                      className="bg-orange-400"
                      style={{
                        width: `${(cost.cache_creation_input_tokens / cost.total_tokens) * 100}%`,
                      }}
                      title={`Cache Created: ${formatTokens(cost.cache_creation_input_tokens)}`}
                    />
                  </>
                )}
              </div>
              <div className="flex gap-4 mt-1.5 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-blue-500" /> Input
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-green-500" /> Output
                </span>
                <span className="flex items-center gap-1">
                  <span className={cn("h-2 w-2 rounded-full bg-purple-400")} /> Cache Read
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-orange-400" /> Cache Created
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
