import { useEffect, useMemo } from "react";
import { useMonitorStore } from "@/lib/store/monitor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Radar, AlertCircle, RefreshCw, Repeat, Zap, DollarSign, ArrowRightLeft } from "lucide-react";
import type { AgentEvent } from "@/types";

type AnomalyType = "infinite_loop" | "tool_thrashing" | "error_cascade" | "cost_spike";
type AnomalySeverity = "warning" | "critical";

interface Anomaly {
  type: AnomalyType;
  severity: AnomalySeverity;
  session_id: string;
  timestamp: string;
  message: string;
  evidence: {
    events: string[];
    pattern?: string;
    count?: number;
    window_seconds?: number;
  };
}

const LOOP_THRESHOLD = 5;
const THRASH_TOOL_COUNT = 8;
const THRASH_WINDOW_MS = 30000;
const ERROR_CASCADE_COUNT = 5;
const ERROR_CASCADE_WINDOW_MS = 60000;
const COST_SPIKE_USD = 2.0;

function detectAnomalies(events: AgentEvent[]): Anomaly[] {
  const anomalies: Anomaly[] = [];

  const sessions = new Map<string, AgentEvent[]>();
  for (const e of events) {
    const list = sessions.get(e.session_id);
    if (list) list.push(e);
    else sessions.set(e.session_id, [e]);
  }

  for (const [sessionId, sessionEvents] of sessions) {
    // Infinite loops
    const toolEvents = sessionEvents.filter((e) => e.hook_event_type === "PostToolUse" && e.tool_name);
    const sigCounts = new Map<string, number>();
    for (const e of toolEvents) {
      const sig = `${e.tool_name}::${JSON.stringify(e.tool_input ?? {})}`;
      sigCounts.set(sig, (sigCounts.get(sig) ?? 0) + 1);
    }
    for (const [sig, count] of sigCounts) {
      if (count >= LOOP_THRESHOLD) {
        anomalies.push({
          type: "infinite_loop",
          severity: count >= LOOP_THRESHOLD * 2 ? "critical" : "warning",
          session_id: sessionId,
          timestamp: toolEvents[toolEvents.length - 1]?.timestamp ?? "",
          message: `"${sig.split("::")[0]}" called ${count}× with identical input`,
          evidence: { events: [], pattern: sig.slice(0, 200), count },
        });
      }
    }

    // Error cascades
    const errors = sessionEvents.filter(
      (e) => e.hook_event_type === "PostToolUseFailure" || e.hook_event_type === "StopFailure"
    );
    for (let i = 0; i < errors.length; i++) {
      const start = new Date(errors[i]!.timestamp).getTime();
      let windowCount = 0;
      for (let j = i; j < errors.length; j++) {
        if (new Date(errors[j]!.timestamp).getTime() - start > ERROR_CASCADE_WINDOW_MS) break;
        windowCount++;
      }
      if (windowCount >= ERROR_CASCADE_COUNT) {
        anomalies.push({
          type: "error_cascade",
          severity: windowCount >= ERROR_CASCADE_COUNT * 2 ? "critical" : "warning",
          session_id: sessionId,
          timestamp: errors[i]!.timestamp,
          message: `${windowCount} errors in ${ERROR_CASCADE_WINDOW_MS / 1000}s`,
          evidence: { events: [], count: windowCount, window_seconds: ERROR_CASCADE_WINDOW_MS / 1000 },
        });
        break;
      }
    }

    // Tool thrashing
    const toolAndErrors = sessionEvents.filter(
      (e) => e.hook_event_type === "PostToolUse" || e.hook_event_type === "PostToolUseFailure"
    );
    for (let i = 0; i < toolAndErrors.length; i++) {
      const start = new Date(toolAndErrors[i]!.timestamp).getTime();
      const window = [];
      const distinctTools = new Set<string>();
      for (let j = i; j < toolAndErrors.length; j++) {
        if (new Date(toolAndErrors[j]!.timestamp).getTime() - start > THRASH_WINDOW_MS) break;
        window.push(toolAndErrors[j]!);
        if (toolAndErrors[j]!.tool_name) distinctTools.add(toolAndErrors[j]!.tool_name!);
      }
      if (distinctTools.size >= THRASH_TOOL_COUNT) {
        const failures = window.filter((e) => e.hook_event_type === "PostToolUseFailure").length;
        if (failures / window.length > 0.3) {
          anomalies.push({
            type: "tool_thrashing",
            severity: failures / window.length > 0.5 ? "critical" : "warning",
            session_id: sessionId,
            timestamp: window[window.length - 1]?.timestamp ?? "",
            message: `${distinctTools.size} tools in ${THRASH_WINDOW_MS / 1000}s, ${Math.round((failures / window.length) * 100)}% failures`,
            evidence: { events: [], pattern: [...distinctTools].join(", "), count: window.length },
          });
          break;
        }
      }
    }

    // Cost spikes
    const totalCost = sessionEvents.reduce((sum, e) => sum + (e.cost_usd ?? 0), 0);
    if (totalCost > COST_SPIKE_USD) {
      anomalies.push({
        type: "cost_spike",
        severity: totalCost > COST_SPIKE_USD * 3 ? "critical" : "warning",
        session_id: sessionId,
        timestamp: sessionEvents[sessionEvents.length - 1]?.timestamp ?? "",
        message: `Session cost $${totalCost.toFixed(2)} exceeds $${COST_SPIKE_USD.toFixed(2)}`,
        evidence: { events: [], count: 1 },
      });
    }
  }

  anomalies.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return anomalies;
}

function anomalyIcon(type: AnomalyType) {
  switch (type) {
    case "infinite_loop": return Repeat;
    case "tool_thrashing": return ArrowRightLeft;
    case "error_cascade": return Zap;
    case "cost_spike": return DollarSign;
  }
}

function anomalyLabel(type: AnomalyType): string {
  switch (type) {
    case "infinite_loop": return "Infinite Loop";
    case "tool_thrashing": return "Tool Thrashing";
    case "error_cascade": return "Error Cascade";
    case "cost_spike": return "Cost Spike";
  }
}

function formatTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

export function AnomalyPanel() {
  const events = useMonitorStore((s) => s.events);
  const loading = useMonitorStore((s) => s.loading);
  const error = useMonitorStore((s) => s.error);
  const startAutoRefresh = useMonitorStore((s) => s.startAutoRefresh);
  const stopAutoRefresh = useMonitorStore((s) => s.stopAutoRefresh);

  const anomalies = useMemo(() => detectAnomalies(events), [events]);

  useEffect(() => {
    startAutoRefresh(5000);
    return () => stopAutoRefresh();
  }, [startAutoRefresh, stopAutoRefresh]);

  if (error) {
    return (
      <div className="p-4 text-destructive">
        <AlertCircle className="inline h-4 w-4 mr-2" />
        Failed to load data: {error}
      </div>
    );
  }

  const critical = anomalies.filter((a) => a.severity === "critical").length;
  const warning = anomalies.filter((a) => a.severity === "warning").length;

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Anomalies</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={cn("text-2xl font-bold", anomalies.length > 0 && "text-destructive")}>
              {anomalies.length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Critical</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={cn("text-2xl font-bold", critical > 0 && "text-destructive")}>
              {critical}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Warning</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={cn("text-2xl font-bold", warning > 0 && "text-yellow-500")}>
              {warning}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Anomaly list */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Radar className="h-4 w-4" />
              Detected Anomalies
              {loading && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {anomalies.length === 0 ? (
            <div className="text-center py-8">
              <Radar className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                No anomalies detected. Agent behavior is within normal patterns.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {anomalies.map((anomaly, i) => {
                const Icon = anomalyIcon(anomaly.type);
                return (
                  <div
                    key={i}
                    className={cn(
                      "flex items-start gap-3 rounded-md border px-3 py-2",
                      anomaly.severity === "critical"
                        ? "border-destructive/30 bg-destructive/5"
                        : "border-yellow-500/30 bg-yellow-500/5"
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-4 w-4 shrink-0 mt-0.5",
                        anomaly.severity === "critical" ? "text-destructive" : "text-yellow-500"
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge
                          variant={anomaly.severity === "critical" ? "destructive" : "outline"}
                          className="text-[10px] px-1.5 py-0"
                        >
                          {anomaly.severity}
                        </Badge>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          {anomalyLabel(anomaly.type)}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {anomaly.session_id.slice(0, 8)}
                        </span>
                      </div>
                      <p className="text-sm">{anomaly.message}</p>
                      {anomaly.evidence.pattern && (
                        <p className="text-[10px] text-muted-foreground mt-1 truncate">
                          {anomaly.evidence.pattern}
                        </p>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {formatTime(anomaly.timestamp)}
                    </span>
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
