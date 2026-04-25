import { useEffect, useMemo, useState } from "react";
import { useMonitorStore, useHarnessEvents } from "@/lib/store/monitor";
import {
  getSessionIdsByRecency,
  getSessionTranscriptPath,
  readSessionCost,
  type SessionCost,
} from "@/lib/telemetry";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DollarSign, Coins, Zap, Database, AlertCircle } from "lucide-react";

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

function formatSessionId(sessionId: string): string {
  return `${sessionId.slice(0, 8)}…${sessionId.slice(-4)}`;
}

export function CostPanel() {
  const events = useHarnessEvents();
  const loading = useMonitorStore((state) => state.loading);
  const error = useMonitorStore((state) => state.error);
  const startAutoRefresh = useMonitorStore((state) => state.startAutoRefresh);
  const stopAutoRefresh = useMonitorStore((state) => state.stopAutoRefresh);
  const focusedSessionIds = useMonitorStore((state) => state.focusedSessionIds);

  const [costs, setCosts] = useState<SessionCost[]>([]);
  const [costLoading, setCostLoading] = useState(false);

  const scopedSessionIds = useMemo(
    () => getSessionIdsByRecency(events, focusedSessionIds),
    [events, focusedSessionIds],
  );

  useEffect(() => {
    startAutoRefresh(10000);
    return () => stopAutoRefresh();
  }, [startAutoRefresh, stopAutoRefresh]);

  useEffect(() => {
    if (scopedSessionIds.length === 0) {
      setCosts([]);
      setCostLoading(false);
      return;
    }

    let cancelled = false;
    setCostLoading(true);

    Promise.all(
      scopedSessionIds.map(async (sessionId) => {
        const transcriptPath = getSessionTranscriptPath(events, sessionId);
        if (!transcriptPath) return null;
        return readSessionCost(transcriptPath, sessionId);
      }),
    )
      .then((results) => {
        if (cancelled) return;
        setCosts(results.filter((cost): cost is SessionCost => cost !== null));
      })
      .finally(() => {
        if (!cancelled) {
          setCostLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [events, scopedSessionIds]);

  if (error) {
    return (
      <div className="p-4 text-destructive">
        <AlertCircle className="mr-2 inline h-4 w-4" />
        Failed to load cost data: {error}
      </div>
    );
  }

  const grandTotal = costs.reduce((sum, cost) => sum + cost.cost_usd, 0);
  const totalTokens = costs.reduce((sum, cost) => sum + cost.total_tokens, 0);

  return (
    <div className="space-y-6">
      {focusedSessionIds.length > 0 && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex flex-col gap-2 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">Focused sessions</Badge>
                <span className="text-sm font-medium">
                  {scopedSessionIds.length} session{scopedSessionIds.length !== 1 ? "s" : ""} in cost scope
                </span>
              </div>
              {focusedSessionIds.length > 1 && (
                <p className="text-xs text-muted-foreground">
                  Cost totals are limited to the focused sessions.
                </p>
              )}
            </div>
            <span className="text-xs text-muted-foreground">
              {loading || costLoading ? "refreshing…" : `${costs.length} transcript${costs.length !== 1 ? "s" : ""} loaded`}
            </span>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <DollarSign className="h-4 w-4" />
              Total Estimated Cost
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{formatCost(grandTotal)}</div>
            <p className="mt-1 text-xs text-muted-foreground">API-equivalent pricing</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Coins className="h-4 w-4" />
              Total Tokens
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{formatTokens(totalTokens)}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              across {costs.length} session{costs.length !== 1 ? "s" : ""}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Zap className="h-4 w-4" />
              Avg. per Session
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {costs.length > 0 ? formatCost(grandTotal / costs.length) : "$0.00"}
            </div>
          </CardContent>
        </Card>
      </div>

      {(costLoading || loading) && costs.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground animate-pulse">
          Loading cost data from transcripts...
        </p>
      )}

      {costs.length === 0 && !costLoading && !loading && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No transcript data available yet. Cost data appears after sessions end.
        </p>
      )}

      {costs.map((cost) => (
        <Card key={cost.session_id}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm font-mono">
                {formatSessionId(cost.session_id)}
                <Badge variant="outline" className="text-[10px]">
                  {cost.model}
                </Badge>
              </CardTitle>
              <span className="text-lg font-bold">{formatCost(cost.cost_usd)}</span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
              <div className="rounded-md bg-muted/50 p-3">
                <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Coins className="h-3 w-3" />
                  Input
                </div>
                <div className="font-semibold">{formatTokens(cost.input_tokens)}</div>
              </div>
              <div className="rounded-md bg-muted/50 p-3">
                <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Zap className="h-3 w-3" />
                  Output
                </div>
                <div className="font-semibold">{formatTokens(cost.output_tokens)}</div>
              </div>
              <div className="rounded-md bg-muted/50 p-3">
                <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Database className="h-3 w-3" />
                  Cache Read
                </div>
                <div className="font-semibold">{formatTokens(cost.cache_read_input_tokens)}</div>
              </div>
              <div className="rounded-md bg-muted/50 p-3">
                <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Database className="h-3 w-3" />
                  Cache Write
                </div>
                <div className="font-semibold">{formatTokens(cost.cache_creation_input_tokens)}</div>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between border-t pt-3 text-sm">
              <span className="text-muted-foreground">Total tokens</span>
              <span className="font-semibold">{formatTokens(cost.total_tokens)}</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
