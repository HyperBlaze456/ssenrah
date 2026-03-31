import { useEffect, useMemo, useState } from "react";
import { useMonitorStore, computeSessions } from "@/lib/store/monitor";
import {
  detectAnomalies,
  formatSeverityLabel,
  getAnomalyKey,
  getSeverityBadgeVariant,
  type AnomalyType,
} from "@/lib/monitor-utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Radar, AlertCircle, RefreshCw, Repeat, Zap, DollarSign, ArrowRightLeft } from "lucide-react";

type SeverityFilter = "all" | "warning" | "critical";
type AnomalySortMode = "severity" | "recent" | "oldest";

function anomalyIcon(type: AnomalyType) {
  switch (type) {
    case "infinite_loop":
      return Repeat;
    case "tool_thrashing":
      return ArrowRightLeft;
    case "error_cascade":
      return Zap;
    case "cost_spike":
      return DollarSign;
  }
}

function anomalyLabel(type: AnomalyType): string {
  switch (type) {
    case "infinite_loop":
      return "Infinite Loop";
    case "tool_thrashing":
      return "Tool Thrashing";
    case "error_cascade":
      return "Error Cascade";
    case "cost_spike":
      return "Cost Spike";
  }
}

function formatTime(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatSessionId(sessionId: string): string {
  return `${sessionId.slice(0, 8)}…${sessionId.slice(-4)}`;
}

export function AnomalyPanel() {
  const events = useMonitorStore((state) => state.events);
  const loading = useMonitorStore((state) => state.loading);
  const error = useMonitorStore((state) => state.error);
  const startAutoRefresh = useMonitorStore((state) => state.startAutoRefresh);
  const stopAutoRefresh = useMonitorStore((state) => state.stopAutoRefresh);
  const focusedSessionIds = useMonitorStore((state) => state.focusedSessionIds);
  const focusSingleSession = useMonitorStore((state) => state.focusSingleSession);
  const clearFocusedSessions = useMonitorStore((state) => state.clearFocusedSessions);
  const showDismissedMonitorItems = useMonitorStore(
    (state) => state.showDismissedMonitorItems,
  );
  const toggleShowDismissedMonitorItems = useMonitorStore(
    (state) => state.toggleShowDismissedMonitorItems,
  );
  const dismissedAnomalyKeys = useMonitorStore((state) => state.dismissedAnomalyKeys);
  const dismissAnomaly = useMonitorStore((state) => state.dismissAnomaly);
  const dismissAnomalies = useMonitorStore((state) => state.dismissAnomalies);
  const restoreAnomaly = useMonitorStore((state) => state.restoreAnomaly);
  const restoreAnomalies = useMonitorStore((state) => state.restoreAnomalies);
  const clearDismissedAnomalies = useMonitorStore(
    (state) => state.clearDismissedAnomalies,
  );

  const [query, setQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [sortMode, setSortMode] = useState<AnomalySortMode>("severity");

  const sessions = useMemo(() => computeSessions(events), [events]);
  const focusedSessions = useMemo(
    () => sessions.filter((session) => focusedSessionIds.includes(session.session_id)),
    [focusedSessionIds, sessions],
  );
  const anomalies = useMemo(() => detectAnomalies(events), [events]);

  const visibleAnomalies = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const scoped =
      focusedSessionIds.length > 0
        ? anomalies.filter((anomaly) => focusedSessionIds.includes(anomaly.session_id))
        : anomalies;

    const filtered = scoped.filter((anomaly) => {
      if (severityFilter !== "all" && anomaly.severity !== severityFilter) return false;
      if (!normalizedQuery) return true;
      return [anomaly.message, anomaly.type, anomaly.session_id, anomaly.evidence.pattern]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });

    return [...filtered].sort((left, right) => {
      switch (sortMode) {
        case "oldest":
          return left.timestamp.localeCompare(right.timestamp);
        case "recent":
          return right.timestamp.localeCompare(left.timestamp);
        case "severity":
        default:
          if (left.severity !== right.severity) {
            return left.severity === "critical" ? -1 : 1;
          }
          return right.timestamp.localeCompare(left.timestamp);
      }
    });
  }, [anomalies, focusedSessionIds, query, severityFilter, sortMode]);

  const hiddenAnomalies = visibleAnomalies.filter(
    (anomaly) => dismissedAnomalyKeys[getAnomalyKey(anomaly)],
  ).length;
  const visibleAnomalyKeys = visibleAnomalies.map((anomaly) => getAnomalyKey(anomaly));
  const activeVisibleAnomalyKeys = visibleAnomalies
    .filter((anomaly) => !dismissedAnomalyKeys[getAnomalyKey(anomaly)])
    .map((anomaly) => getAnomalyKey(anomaly));
  const renderedAnomalies = showDismissedMonitorItems
    ? visibleAnomalies
    : visibleAnomalies.filter(
        (anomaly) => !dismissedAnomalyKeys[getAnomalyKey(anomaly)],
      );

  useEffect(() => {
    startAutoRefresh(5000);
    return () => stopAutoRefresh();
  }, [startAutoRefresh, stopAutoRefresh]);

  if (error) {
    return (
      <div className="p-4 text-destructive">
        <AlertCircle className="mr-2 inline h-4 w-4" />
        Failed to load data: {error}
      </div>
    );
  }

  const critical = renderedAnomalies.filter((anomaly) => anomaly.severity === "critical").length;
  const warning = renderedAnomalies.filter((anomaly) => anomaly.severity === "warning").length;

  return (
    <div className="space-y-6">
      {focusedSessions.length > 0 && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex flex-col gap-3 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">Scoped to focused sessions</Badge>
                <span className="text-sm font-medium">
                  {focusedSessions.length} session{focusedSessions.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {focusedSessions.map((session) => (
                  <button
                    key={session.session_id}
                    type="button"
                    onClick={() => focusSingleSession(session.session_id)}
                    className="rounded-md border bg-background px-2 py-1 text-xs font-mono transition-colors hover:bg-muted"
                  >
                    {formatSessionId(session.session_id)}
                  </button>
                ))}
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={clearFocusedSessions}>
              Clear focus
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Anomalies</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={cn("text-2xl font-bold", renderedAnomalies.length > 0 && "text-destructive")}>
              {renderedAnomalies.length}
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

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <Radar className="h-4 w-4" />
                Detected Anomalies
                {loading && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />}
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                {renderedAnomalies.length} visible anomalies
                {hiddenAnomalies > 0 && !showDismissedMonitorItems
                  ? ` · ${hiddenAnomalies} dismissed`
                  : ""}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px_160px]">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Search anomalies
                </label>
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Session, message, pattern"
                  className="min-w-[240px]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Severity
                </label>
                <Select
                  value={severityFilter}
                  onChange={(event) =>
                    setSeverityFilter(event.target.value as SeverityFilter)
                  }
                >
                  <option value="all">All severities</option>
                  <option value="critical">Critical</option>
                  <option value="warning">Warning</option>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Sort by
                </label>
                <Select
                  value={sortMode}
                  onChange={(event) => setSortMode(event.target.value as AnomalySortMode)}
                >
                  <option value="severity">Severity</option>
                  <option value="recent">Newest first</option>
                  <option value="oldest">Oldest first</option>
                </Select>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={toggleShowDismissedMonitorItems}>
              {showDismissedMonitorItems ? "Hide dismissed" : "Show dismissed"}
            </Button>
            {activeVisibleAnomalyKeys.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => dismissAnomalies(activeVisibleAnomalyKeys)}
              >
                Mark visible false alarms
              </Button>
            )}
            {visibleAnomalyKeys.length > 0 && hiddenAnomalies > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => restoreAnomalies(visibleAnomalyKeys)}
              >
                Restore visible
              </Button>
            )}
            {Object.keys(dismissedAnomalyKeys).length > 0 && (
              <Button variant="ghost" size="sm" onClick={clearDismissedAnomalies}>
                Reset dismissed
              </Button>
            )}
            {(query || severityFilter !== "all") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setQuery("");
                  setSeverityFilter("all");
                  setSortMode("severity");
                }}
              >
                Clear filters
              </Button>
            )}
          </div>

          {renderedAnomalies.length === 0 ? (
            <div className="py-8 text-center">
              <Radar className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {visibleAnomalies.length === 0
                  ? "No anomalies detected for the current filters."
                  : "All matching anomalies are dismissed."}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {renderedAnomalies.map((anomaly) => {
                const Icon = anomalyIcon(anomaly.type);
                const anomalyKey = getAnomalyKey(anomaly);
                const dismissed = Boolean(dismissedAnomalyKeys[anomalyKey]);
                return (
                  <div
                    key={anomalyKey}
                    className={cn(
                      "rounded-md border px-3 py-3",
                      anomaly.severity === "critical"
                        ? "border-destructive/30 bg-destructive/5"
                        : "border-yellow-500/30 bg-yellow-500/5",
                    )}
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <Icon
                          className={cn(
                            "mt-0.5 h-4 w-4 shrink-0",
                            anomaly.severity === "critical" ? "text-destructive" : "text-yellow-500",
                          )}
                        />
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={getSeverityBadgeVariant(anomaly.severity)}>
                              {formatSeverityLabel(anomaly.severity)}
                            </Badge>
                            <Badge variant="secondary">{anomalyLabel(anomaly.type)}</Badge>
                            <button
                              type="button"
                              onClick={() => focusSingleSession(anomaly.session_id)}
                              className="rounded-md border bg-background px-2 py-0.5 text-[10px] font-mono text-muted-foreground transition-colors hover:bg-muted"
                            >
                              {formatSessionId(anomaly.session_id)}
                            </button>
                          </div>
                          <p className="text-sm">{anomaly.message}</p>
                          {anomaly.evidence.pattern && (
                            <p className="truncate text-[10px] text-muted-foreground">
                              {anomaly.evidence.pattern}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                        <span className="text-[10px] text-muted-foreground">
                          {formatTime(anomaly.timestamp)}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            dismissed ? restoreAnomaly(anomalyKey) : dismissAnomaly(anomalyKey)
                          }
                        >
                          {dismissed ? "Undo" : "Mark false alarm"}
                        </Button>
                      </div>
                    </div>
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
