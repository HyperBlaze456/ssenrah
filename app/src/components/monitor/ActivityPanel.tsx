import { useEffect, useMemo, useState } from "react";
import { useMonitorStore, computeSummary, computeSessions } from "@/lib/store/monitor";
import {
  formatSeverityLabel,
  getEventFingerprint,
  getEventSeverity,
  getSeverityBadgeVariant,
  monitorSeverityRank,
  type MonitorSeverity,
} from "@/lib/monitor-utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  Activity,
  Terminal,
  FileText,
  AlertCircle,
  Bot,
  Play,
  Square,
  Bell,
  CheckCircle,
} from "lucide-react";
import type { AgentEvent } from "@/types";

type SeverityFilter = "all" | MonitorSeverity;
type ActivitySortMode = "severity" | "recent" | "oldest";

interface EventGroup {
  key: string;
  representative: AgentEvent;
  severity: MonitorSeverity;
  count: number;
  firstTimestamp: string;
  lastTimestamp: string;
}

function getEventIcon(type: string) {
  if (type.includes("ToolUse")) return Terminal;
  if (type.includes("Subagent")) return Bot;
  if (type.includes("Session")) return type.includes("Start") ? Play : Square;
  if (type.includes("Task")) return CheckCircle;
  if (type.includes("Notification")) return Bell;
  if (type.includes("Failure") || type.includes("error")) return AlertCircle;
  if (type.includes("Stop")) return Square;
  return FileText;
}

function getEventColor(type: string) {
  if (type.includes("Failure") || type.includes("error")) return "destructive";
  if (type === "_escalation") return "destructive";
  if (type.includes("Start")) return "default";
  if (type.includes("Stop") || type.includes("End")) return "secondary";
  return "outline";
}

function formatTime(iso: string): string {
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

function matchesQuery(event: AgentEvent, query: string): boolean {
  if (!query) return true;
  const haystack = [
    event.session_id,
    event.hook_event_type,
    event.tool_name,
    event.message,
    event.error,
    event.reason,
    event.notification_type,
    event.task_subject,
    event.agent_type,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(query);
}

function EventDetail({ event }: { event: AgentEvent }) {
  if (event.tool_name) {
    return <span className="text-muted-foreground">{event.tool_name}</span>;
  }
  if (event.agent_type) {
    return <span className="text-muted-foreground">{event.agent_type}</span>;
  }
  if (event.task_subject) {
    return (
      <span className="inline-block max-w-[240px] truncate align-bottom text-muted-foreground">
        {event.task_subject}
      </span>
    );
  }
  if (event.error) {
    return (
      <span className="inline-block max-w-[240px] truncate align-bottom text-destructive">
        {event.error}
      </span>
    );
  }
  if (event.notification_type) {
    return <span className="text-muted-foreground">{event.notification_type}</span>;
  }
  if (event.message) {
    return (
      <span className="inline-block max-w-[280px] truncate align-bottom text-muted-foreground">
        {event.message}
      </span>
    );
  }
  if (event.reason) {
    return <span className="text-muted-foreground">{event.reason}</span>;
  }
  return null;
}

export function ActivityPanel() {
  const events = useMonitorStore((state) => state.events);
  const loading = useMonitorStore((state) => state.loading);
  const error = useMonitorStore((state) => state.error);
  const startAutoRefresh = useMonitorStore((state) => state.startAutoRefresh);
  const stopAutoRefresh = useMonitorStore((state) => state.stopAutoRefresh);
  const focusedSessionIds = useMonitorStore((state) => state.focusedSessionIds);
  const focusSingleSession = useMonitorStore((state) => state.focusSingleSession);
  const clearFocusedSessions = useMonitorStore((state) => state.clearFocusedSessions);

  const [query, setQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [sortMode, setSortMode] = useState<ActivitySortMode>("severity");

  const sessions = useMemo(() => computeSessions(events), [events]);
  const focusedSessions = useMemo(
    () => sessions.filter((session) => focusedSessionIds.includes(session.session_id)),
    [focusedSessionIds, sessions],
  );
  const scopedEvents = useMemo(
    () =>
      focusedSessionIds.length > 0
        ? events.filter((event) => focusedSessionIds.includes(event.session_id))
        : events,
    [events, focusedSessionIds],
  );
  const summary = useMemo(() => computeSummary(scopedEvents), [scopedEvents]);

  const visibleGroups = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filteredEvents = scopedEvents.filter((event) => {
      const severity = getEventSeverity(event);
      if (severityFilter !== "all" && severity !== severityFilter) return false;
      return matchesQuery(event, normalizedQuery);
    });

    const grouped = new Map<string, EventGroup>();
    for (const event of filteredEvents) {
      const key = getEventFingerprint(event);
      const severity = getEventSeverity(event);
      const existing = grouped.get(key);
      if (!existing) {
        grouped.set(key, {
          key,
          representative: event,
          severity,
          count: 1,
          firstTimestamp: event.timestamp,
          lastTimestamp: event.timestamp,
        });
        continue;
      }

      existing.count += 1;
      if (event.timestamp < existing.firstTimestamp) {
        existing.firstTimestamp = event.timestamp;
      }
      if (event.timestamp >= existing.lastTimestamp) {
        existing.lastTimestamp = event.timestamp;
        existing.representative = event;
      }
      if (monitorSeverityRank(severity) > monitorSeverityRank(existing.severity)) {
        existing.severity = severity;
      }
    }

    return [...grouped.values()]
      .sort((left, right) => {
        switch (sortMode) {
          case "oldest":
            return left.firstTimestamp.localeCompare(right.firstTimestamp);
          case "recent":
            return right.lastTimestamp.localeCompare(left.lastTimestamp);
          case "severity":
          default: {
            const severityDelta =
              monitorSeverityRank(right.severity) - monitorSeverityRank(left.severity);
            if (severityDelta !== 0) return severityDelta;
            return right.lastTimestamp.localeCompare(left.lastTimestamp);
          }
        }
      })
      .slice(0, 100);
  }, [query, scopedEvents, severityFilter, sortMode]);

  const severityCounts = useMemo(
    () => ({
      critical: visibleGroups.filter((group) => group.severity === "critical").length,
      warning: visibleGroups.filter((group) => group.severity === "warning").length,
      info: visibleGroups.filter((group) => group.severity === "info").length,
    }),
    [visibleGroups],
  );

  useEffect(() => {
    startAutoRefresh(3000);
    return () => stopAutoRefresh();
  }, [startAutoRefresh, stopAutoRefresh]);

  if (error) {
    return (
      <div className="p-4 text-destructive">
        <AlertCircle className="mr-2 inline h-4 w-4" />
        Failed to load events: {error}
      </div>
    );
  }

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

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Events
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.total_events}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Sessions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.session_count}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Critical / Warning
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {severityCounts.critical}
              <span className="mx-1 text-muted-foreground">/</span>
              <span className="text-yellow-500">{severityCounts.warning}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Errors
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={cn("text-2xl font-bold", summary.errors > 0 && "text-destructive")}>
              {summary.errors}
            </div>
          </CardContent>
        </Card>
      </div>

      {summary.top_tools.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Top Tools</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {summary.top_tools.map(([name, count]) => (
                <Badge key={name} variant="secondary" className="gap-1">
                  {name}
                  <span className="ml-1 text-muted-foreground">{count}</span>
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <Activity className="h-4 w-4" />
                Event Feed
                {loading && (
                  <span className="text-xs text-muted-foreground animate-pulse">
                    updating...
                  </span>
                )}
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Showing {visibleGroups.length} grouped rows from {scopedEvents.length} raw events.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px_160px]">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Search events
                </label>
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Tool, error, message, session"
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
                  <option value="info">Info</option>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Sort by
                </label>
                <Select
                  value={sortMode}
                  onChange={(event) => setSortMode(event.target.value as ActivitySortMode)}
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
            <Badge variant={getSeverityBadgeVariant("critical")}>
              {severityCounts.critical} critical
            </Badge>
            <Badge variant={getSeverityBadgeVariant("warning")}>
              {severityCounts.warning} warnings
            </Badge>
            <Badge variant={getSeverityBadgeVariant("info")}>
              {severityCounts.info} info
            </Badge>
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

          {visibleGroups.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No events match the current filters.
            </p>
          ) : (
            <div className="space-y-2">
              {visibleGroups.map((group) => {
                const event = group.representative;
                const Icon = getEventIcon(event.hook_event_type);
                return (
                  <div
                    key={group.key}
                    className={cn(
                      "rounded-md border px-3 py-2 transition-colors hover:bg-muted/40",
                      group.severity === "critical" && "border-destructive/25 bg-destructive/5",
                      group.severity === "warning" && "border-yellow-500/25 bg-yellow-500/5",
                    )}
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={getSeverityBadgeVariant(group.severity)}>
                              {formatSeverityLabel(group.severity)}
                            </Badge>
                            <Badge
                              variant={getEventColor(event.hook_event_type) as "default" | "secondary" | "destructive" | "outline"}
                              className="px-1.5 py-0 text-[10px]"
                            >
                              {event.hook_event_type}
                            </Badge>
                            {group.count > 1 && (
                              <Badge variant="secondary">×{group.count}</Badge>
                            )}
                            <button
                              type="button"
                              onClick={() => focusSingleSession(event.session_id)}
                              className="rounded-md border px-2 py-0.5 text-[10px] font-mono text-muted-foreground transition-colors hover:bg-background"
                            >
                              {formatSessionId(event.session_id)}
                            </button>
                          </div>
                          <div className="text-sm">
                            <EventDetail event={event} />
                          </div>
                          <p className="text-[10px] text-muted-foreground">
                            {group.count > 1
                              ? `Seen ${group.count} times from ${formatTime(group.firstTimestamp)} to ${formatTime(group.lastTimestamp)}`
                              : `Seen at ${formatTime(group.lastTimestamp)}`}
                          </p>
                        </div>
                      </div>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {formatTime(group.lastTimestamp)}
                      </span>
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
