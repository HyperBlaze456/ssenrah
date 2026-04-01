import { useEffect, useMemo, useState } from "react";
import { useMonitorStore } from "@/lib/store/monitor";
import {
  getPrimarySessionId,
  getSessionTranscriptPath,
  readDecisionChain,
  type DecisionChain,
} from "@/lib/telemetry";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Brain, MessageSquare, Wrench, User, AlertCircle } from "lucide-react";

function formatTime(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatSessionId(sessionId: string): string {
  return `${sessionId.slice(0, 8)}…${sessionId.slice(-4)}`;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function ReasoningPanel() {
  const events = useMonitorStore((state) => state.events);
  const loading = useMonitorStore((state) => state.loading);
  const error = useMonitorStore((state) => state.error);
  const startAutoRefresh = useMonitorStore((state) => state.startAutoRefresh);
  const stopAutoRefresh = useMonitorStore((state) => state.stopAutoRefresh);
  const focusedSessionIds = useMonitorStore((state) => state.focusedSessionIds);

  const [chain, setChain] = useState<DecisionChain | null>(null);
  const [chainLoading, setChainLoading] = useState(false);

  const primarySessionId = useMemo(
    () => getPrimarySessionId(events, focusedSessionIds),
    [events, focusedSessionIds],
  );
  const transcriptPath = useMemo(
    () => getSessionTranscriptPath(events, primarySessionId),
    [events, primarySessionId],
  );

  useEffect(() => {
    startAutoRefresh(10000);
    return () => stopAutoRefresh();
  }, [startAutoRefresh, stopAutoRefresh]);

  useEffect(() => {
    if (!transcriptPath) {
      setChain(null);
      setChainLoading(false);
      return;
    }

    let cancelled = false;
    setChainLoading(true);

    readDecisionChain(transcriptPath)
      .then((nextChain) => {
        if (!cancelled) {
          setChain(nextChain);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setChain(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setChainLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [transcriptPath]);

  if (error) {
    return (
      <div className="p-4 text-destructive">
        <AlertCircle className="mr-2 inline h-4 w-4" />
        Failed to load data: {error}
      </div>
    );
  }

  const timelineItems: Array<{ ts: string; type: "prompt" | "step"; idx: number }> = [];
  if (chain) {
    chain.prompts.forEach((prompt, index) => {
      timelineItems.push({ ts: prompt.timestamp, type: "prompt", idx: index });
    });
    chain.steps.forEach((step, index) => {
      timelineItems.push({ ts: step.timestamp, type: "step", idx: index });
    });
    timelineItems.sort((left, right) => left.ts.localeCompare(right.ts));
  }

  const recentItems = timelineItems.slice(-30);

  return (
    <div className="space-y-6">
      {chain && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Turns</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{chain.summary.total_turns}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Thinking</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{chain.summary.total_thinking_blocks}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Reasoning</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{chain.summary.total_reasoning_blocks}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Decisions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{chain.summary.total_decisions}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Models</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1">
                {chain.summary.models_used.map((model) => (
                  <Badge key={model} variant="outline" className="text-[10px]">
                    {model}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <Brain className="h-4 w-4" />
                Decision Chain
                {(loading || chainLoading) && (
                  <span className="text-xs text-muted-foreground animate-pulse">loading...</span>
                )}
              </CardTitle>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="secondary">
                  {focusedSessionIds.length > 0 ? "Focused session" : "Latest session"}
                </Badge>
                {primarySessionId && <span className="font-mono">{formatSessionId(primarySessionId)}</span>}
                {focusedSessionIds.length > 1 && (
                  <span>showing the most recent of {focusedSessionIds.length} focused sessions</span>
                )}
              </div>
            </div>
            {transcriptPath && (
              <span className="max-w-[320px] truncate text-[10px] text-muted-foreground">
                {transcriptPath}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!chain && !chainLoading && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No transcript data available for the selected session. Reasoning chains appear after sessions with transcript data.
            </p>
          )}

          {chain && (
            <div className="space-y-3">
              {recentItems.map((item, index) => {
                if (item.type === "prompt") {
                  const prompt = chain.prompts[item.idx]!;
                  return (
                    <div
                      key={`prompt-${index}`}
                      className="flex items-start gap-3 rounded-md border border-blue-500/10 bg-blue-500/5 px-3 py-2"
                    >
                      <User className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">{truncate(prompt.content, 200)}</p>
                      </div>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {formatTime(prompt.timestamp)}
                      </span>
                    </div>
                  );
                }

                const step = chain.steps[item.idx]!;
                return (
                  <div key={`step-${index}`} className="space-y-2 rounded-md border px-3 py-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">
                          {step.model}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">Turn {item.idx + 1}</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        {formatTime(step.timestamp)}
                      </span>
                    </div>

                    {step.thinking && (
                      <div className="flex items-start gap-2">
                        <Brain className="mt-0.5 h-3.5 w-3.5 shrink-0 text-purple-500" />
                        <p className="text-xs text-muted-foreground">{truncate(step.thinking, 300)}</p>
                      </div>
                    )}

                    {step.reasoning && (
                      <div className="flex items-start gap-2">
                        <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-500" />
                        <p className="text-sm">{truncate(step.reasoning, 300)}</p>
                      </div>
                    )}

                    {step.decisions.length > 0 && (
                      <div className="space-y-1">
                        {step.decisions.map((decision, decisionIndex) => (
                          <div key={decisionIndex} className="flex items-center gap-2">
                            <Wrench className="h-3.5 w-3.5 shrink-0 text-orange-500" />
                            <Badge variant="secondary" className="text-[10px]">
                              {decision.tool_name}
                            </Badge>
                            <span className="truncate text-[10px] text-muted-foreground">
                              {truncate(JSON.stringify(decision.tool_input), 80)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
