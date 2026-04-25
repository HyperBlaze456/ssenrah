import { useEffect, useMemo, useState } from "react";
import { useMonitorStore, computeSessions, useHarnessEvents } from "@/lib/store/monitor";
import { useUiStore } from "@/lib/store/ui";
import { formatProviderLabel } from "@/types";
import {
  deriveActorFlows,
  deriveTelemetryTimeline,
  getPrimarySessionId,
  getScopedEvents,
  summarizeTasks,
  type ActorFlow,
  type FlowStatus,
  type TelemetryRecord,
  type TelemetrySeverity,
} from "@/lib/telemetry";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  Activity,
  AlertCircle,
  Bell,
  Bot,
  CheckCircle,
  FileText,
  Play,
  Square,
  Terminal,
} from "lucide-react";

type SeverityFilter = "all" | TelemetrySeverity;
type ActivitySortMode = "severity" | "recent" | "oldest";
type ActivityViewMode = "flow" | "timeline";

function telemetrySeverityRank(severity: TelemetrySeverity): number {
  switch (severity) {
    case "error":
      return 3;
    case "warning":
      return 2;
    case "info":
    default:
      return 1;
  }
}

function getSeverityBadgeVariant(
  severity: TelemetrySeverity,
): "secondary" | "outline" | "destructive" {
  switch (severity) {
    case "error":
      return "destructive";
    case "warning":
      return "outline";
    case "info":
    default:
      return "secondary";
  }
}

function formatSeverityLabel(severity: TelemetrySeverity): string {
  switch (severity) {
    case "error":
      return "Error";
    case "warning":
      return "Warning";
    case "info":
    default:
      return "Info";
  }
}

function getFlowStatusVariant(
  status: FlowStatus,
): "secondary" | "outline" | "destructive" {
  switch (status) {
    case "failed":
      return "destructive";
    case "completed":
      return "secondary";
    case "active":
    default:
      return "outline";
  }
}

function formatFlowStatus(status: FlowStatus): string {
  switch (status) {
    case "failed":
      return "Failed";
    case "completed":
      return "Completed";
    case "active":
    default:
      return "Active";
  }
}

function getTelemetryIcon(record: TelemetryRecord) {
  if (record.operation.startsWith("tool.")) return Terminal;
  if (record.operation.startsWith("agent.")) return Bot;
  if (record.operation.startsWith("session.")) {
    return record.operation.endsWith("start") ? Play : Square;
  }
  if (record.operation.startsWith("task.")) return CheckCircle;
  if (record.operation.startsWith("notification") || record.operation.startsWith("alert.")) {
    return Bell;
  }
  if (record.operation.startsWith("file.") || record.operation.startsWith("config.")) {
    return FileText;
  }
  return Activity;
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

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function matchesQuery(record: TelemetryRecord, query: string): boolean {
  if (!query) return true;

  return [
    record.session_id,
    record.hook_event_type,
    record.operation,
    record.actor_label,
    record.actor_kind,
    record.summary,
    record.detail,
    record.resource,
    record.task_id,
    record.tool_name,
    record.model,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function StepRow({ record }: { record: TelemetryRecord }) {
  const Icon = getTelemetryIcon(record);

  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2",
        record.severity === "error" && "border-destructive/20 bg-destructive/5",
        record.severity === "warning" && "border-yellow-500/20 bg-yellow-500/5",
      )}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={getSeverityBadgeVariant(record.severity)}>
                {formatSeverityLabel(record.severity)}
              </Badge>
              <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                {record.operation}
              </Badge>
              {record.tool_name && (
                <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                  {record.tool_name}
                </Badge>
              )}
              {record.model && (
                <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                  {truncate(record.model, 24)}
                </Badge>
              )}
            </div>
            <p className="text-sm font-medium">{record.summary}</p>
            {record.detail && <p className="text-xs text-muted-foreground">{record.detail}</p>}
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
              <span>{record.hook_event_type}</span>
              {record.resource && <span>{truncate(record.resource, 80)}</span>}
              {record.task_id && <span>task {truncate(record.task_id, 18)}</span>}
            </div>
          </div>
        </div>
        <span className="shrink-0 text-[10px] text-muted-foreground">{formatTime(record.timestamp)}</span>
      </div>
    </div>
  );
}

function FlowActorCard({ actor }: { actor: ActorFlow }) {
  return (
    <Card
      className={cn(
        actor.status === "failed" && "border-destructive/25",
        actor.status === "active" && "border-primary/20",
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{actor.actor_label}</Badge>
              <Badge variant="outline" className="capitalize">
                {actor.actor_kind}
              </Badge>
              <Badge variant={getFlowStatusVariant(actor.status)}>
                {formatFlowStatus(actor.status)}
              </Badge>
              {actor.failures > 0 && (
                <Badge variant="destructive">{actor.failures} failure{actor.failures !== 1 ? "s" : ""}</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {actor.step_count} step{actor.step_count !== 1 ? "s" : ""} · {actor.tool_count} tool event
              {actor.tool_count !== 1 ? "s" : ""} · {formatTime(actor.first_timestamp)} → {formatTime(actor.last_timestamp)}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {actor.groups.map((group) => (
          <div key={group.key} className="rounded-md border bg-background/70 px-3 py-3">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={getFlowStatusVariant(group.status)}>{formatFlowStatus(group.status)}</Badge>
                  <Badge variant="outline">{group.task_id ? "Task flow" : "Session flow"}</Badge>
                  <span className="text-sm font-medium">{group.label}</span>
                  {group.task_id && (
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {truncate(group.task_id, 18)}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {group.step_count} step{group.step_count !== 1 ? "s" : ""} · {group.tool_count} tool event
                  {group.tool_count !== 1 ? "s" : ""} · {formatTime(group.first_timestamp)} → {formatTime(group.last_timestamp)}
                </p>
              </div>
            </div>

            <div className="mt-3 space-y-2 border-l pl-3">
              {group.records.map((record) => (
                <StepRow key={record.event_id} record={record} />
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function ActivityPanel() {
  const events = useHarnessEvents();
  const provider = useUiStore((state) => state.activeProvider);
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
  const [viewMode, setViewMode] = useState<ActivityViewMode>("flow");

  const sessions = useMemo(() => computeSessions(events), [events]);
  const focusedSessions = useMemo(
    () => sessions.filter((session) => focusedSessionIds.includes(session.session_id)),
    [focusedSessionIds, sessions],
  );
  const scopedEvents = useMemo(() => getScopedEvents(events, focusedSessionIds), [events, focusedSessionIds]);
  const primarySessionId = useMemo(
    () => getPrimarySessionId(scopedEvents, focusedSessionIds),
    [scopedEvents, focusedSessionIds],
  );

  const allScopedRecords = useMemo(() => deriveTelemetryTimeline(scopedEvents), [scopedEvents]);
  const sessionRecords = useMemo(
    () => (primarySessionId ? deriveTelemetryTimeline(scopedEvents, { session: primarySessionId }) : []),
    [primarySessionId, scopedEvents],
  );
  const sessionTaskCount = useMemo(
    () => (primarySessionId ? summarizeTasks(scopedEvents, { session: primarySessionId }).length : 0),
    [primarySessionId, scopedEvents],
  );

  const normalizedQuery = query.trim().toLowerCase();
  const filteredSessionRecords = useMemo(
    () =>
      sessionRecords.filter((record) => {
        if (severityFilter !== "all" && record.severity !== severityFilter) return false;
        return matchesQuery(record, normalizedQuery);
      }),
    [normalizedQuery, sessionRecords, severityFilter],
  );

  const flowActors = useMemo(() => deriveActorFlows(filteredSessionRecords), [filteredSessionRecords]);

  const visibleTimelineRecords = useMemo(() => {
    const filteredRecords = allScopedRecords.filter((record) => {
      if (severityFilter !== "all" && record.severity !== severityFilter) return false;
      return matchesQuery(record, normalizedQuery);
    });

    return [...filteredRecords]
      .sort((left, right) => {
        switch (sortMode) {
          case "oldest":
            return left.timestamp.localeCompare(right.timestamp);
          case "recent":
            return right.timestamp.localeCompare(left.timestamp);
          case "severity":
          default: {
            const severityDelta = telemetrySeverityRank(right.severity) - telemetrySeverityRank(left.severity);
            if (severityDelta !== 0) return severityDelta;
            return right.timestamp.localeCompare(left.timestamp);
          }
        }
      })
      .slice(0, 150);
  }, [allScopedRecords, normalizedQuery, severityFilter, sortMode]);

  const visibleRecordCounts = useMemo(() => {
    const activeRecords = viewMode === "flow" ? filteredSessionRecords : visibleTimelineRecords;
    return {
      error: activeRecords.filter((record) => record.severity === "error").length,
      warning: activeRecords.filter((record) => record.severity === "warning").length,
      info: activeRecords.filter((record) => record.severity === "info").length,
    };
  }, [filteredSessionRecords, viewMode, visibleTimelineRecords]);

  useEffect(() => {
    startAutoRefresh(3000);
    return () => stopAutoRefresh();
  }, [startAutoRefresh, stopAutoRefresh]);

  if (error) {
    return (
      <div className="p-4 text-destructive">
        <AlertCircle className="mr-2 inline h-4 w-4" />
        Failed to load telemetry: {error}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <Badge variant="outline">{formatProviderLabel(provider)} harness</Badge>
        <p className="text-sm text-muted-foreground">
          No {formatProviderLabel(provider)} events recorded yet.
        </p>
        <p className="text-xs text-muted-foreground">
          {provider === "codex"
            ? "Run `npx tsx tracker/src/cli.ts codex sync` to import any existing Codex sessions."
            : "Start a Claude Code session — events will stream here."}
        </p>
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

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {viewMode === "flow" ? "Flow Steps" : "Timeline Rows"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {viewMode === "flow" ? filteredSessionRecords.length : visibleTimelineRecords.length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Sessions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{focusedSessionIds.length || sessions.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Actors</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {viewMode === "flow" ? flowActors.length : deriveActorFlows(visibleTimelineRecords).length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Tasks</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {viewMode === "flow" ? sessionTaskCount : summarizeTasks(scopedEvents).length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Errors</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={cn("text-2xl font-bold", visibleRecordCounts.error > 0 && "text-destructive")}>
              {visibleRecordCounts.error}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <Activity className="h-4 w-4" />
                {viewMode === "flow" ? "Execution Flow" : "Telemetry Timeline"}
                {loading && <span className="text-xs text-muted-foreground animate-pulse">updating...</span>}
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                {viewMode === "flow"
                  ? primarySessionId
                    ? `${focusedSessionIds.length > 0 ? "Focused" : "Latest"} session ${formatSessionId(primarySessionId)} shown as actor → task → tool flow.`
                    : "Select or create a session to inspect the execution flow."
                  : `Showing ${visibleTimelineRecords.length} normalized rows from ${scopedEvents.length} raw events.`}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)_160px_160px]">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">View</label>
                <div className="flex gap-2">
                  <Button
                    variant={viewMode === "flow" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setViewMode("flow")}
                  >
                    Flow
                  </Button>
                  <Button
                    variant={viewMode === "timeline" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setViewMode("timeline")}
                  >
                    Timeline
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Search telemetry</label>
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Operation, actor, task, tool, resource"
                  className="min-w-[260px]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Severity</label>
                <Select
                  value={severityFilter}
                  onChange={(event) => setSeverityFilter(event.target.value as SeverityFilter)}
                >
                  <option value="all">All severities</option>
                  <option value="error">Errors</option>
                  <option value="warning">Warnings</option>
                  <option value="info">Info</option>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Sort by</label>
                <Select
                  value={sortMode}
                  onChange={(event) => setSortMode(event.target.value as ActivitySortMode)}
                  disabled={viewMode === "flow"}
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
            <Badge variant={getSeverityBadgeVariant("error")}>{visibleRecordCounts.error} errors</Badge>
            <Badge variant={getSeverityBadgeVariant("warning")}>{visibleRecordCounts.warning} warnings</Badge>
            <Badge variant={getSeverityBadgeVariant("info")}>{visibleRecordCounts.info} info</Badge>
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

          {viewMode === "flow" ? (
            !primarySessionId ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No session selected yet. Start a run or focus a session to inspect the execution flow.
              </p>
            ) : filteredSessionRecords.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No flow steps match the current filters for {formatSessionId(primarySessionId)}.
              </p>
            ) : (
              <div className="space-y-4">
                {flowActors.map((actor) => (
                  <FlowActorCard key={actor.actor_id} actor={actor} />
                ))}
              </div>
            )
          ) : visibleTimelineRecords.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No telemetry rows match the current filters.
            </p>
          ) : (
            <div className="space-y-2">
              {visibleTimelineRecords.map((record) => (
                <StepRow key={record.event_id} record={record} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
