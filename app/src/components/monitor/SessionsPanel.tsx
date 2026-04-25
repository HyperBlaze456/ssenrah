import { useEffect, useMemo, useState } from "react";
import { useMonitorStore, computeSessions, useHarnessEvents } from "@/lib/store/monitor";
import { useUiStore } from "@/lib/store/ui";
import { formatProviderLabel } from "@/types";
import { getScopedEvents, summarizeAgents, summarizeTasks } from "@/lib/telemetry";
import {
  formatSeverityLabel,
  getSessionSeverity,
  getSeverityBadgeVariant,
  monitorSeverityRank,
} from "@/lib/monitor-utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Clock, Terminal, AlertCircle, Bot, DollarSign } from "lucide-react";

type SessionSortMode =
  | "recent"
  | "severity"
  | "errors"
  | "cost"
  | "duration"
  | "tools";

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hrs}h ${remainMins}m`;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatCost(usd: number): string {
  if (usd === 0) return "-";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function formatSessionId(sessionId: string): string {
  return `${sessionId.slice(0, 8)}…${sessionId.slice(-4)}`;
}

function formatOptionalDuration(seconds?: number): string {
  if (seconds === undefined) return "-";
  return formatDuration(seconds);
}

export function SessionsPanel() {
  const events = useHarnessEvents();
  const provider = useUiStore((state) => state.activeProvider);
  const loading = useMonitorStore((state) => state.loading);
  const error = useMonitorStore((state) => state.error);
  const startAutoRefresh = useMonitorStore((state) => state.startAutoRefresh);
  const stopAutoRefresh = useMonitorStore((state) => state.stopAutoRefresh);
  const focusedSessionIds = useMonitorStore((state) => state.focusedSessionIds);
  const toggleFocusedSession = useMonitorStore((state) => state.toggleFocusedSession);
  const focusSingleSession = useMonitorStore((state) => state.focusSingleSession);
  const clearFocusedSessions = useMonitorStore((state) => state.clearFocusedSessions);

  // Codex's branching unit is a thread, not a subagent. Adjust copy accordingly.
  const subagentLabel = provider === "codex" ? "Threads" : "Subagents";

  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SessionSortMode>("recent");

  const sessions = useMemo(() => computeSessions(events), [events]);
  const focusedSessions = useMemo(
    () => sessions.filter((session) => focusedSessionIds.includes(session.session_id)),
    [focusedSessionIds, sessions],
  );
  const focusedEvents = useMemo(
    () => (focusedSessionIds.length > 0 ? getScopedEvents(events, focusedSessionIds) : []),
    [events, focusedSessionIds],
  );
  const focusedAgentSummaries = useMemo(
    () => (focusedEvents.length > 0 ? summarizeAgents(focusedEvents) : []),
    [focusedEvents],
  );
  const focusedTaskSummaries = useMemo(
    () => (focusedEvents.length > 0 ? summarizeTasks(focusedEvents) : []),
    [focusedEvents],
  );

  const filteredSessions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const matching = sessions.filter((session) => {
      if (!normalizedQuery) return true;
      return (
        session.session_id.toLowerCase().includes(normalizedQuery) ||
        session.top_tools.some(([toolName]) =>
          toolName.toLowerCase().includes(normalizedQuery),
        )
      );
    });

    return [...matching].sort((left, right) => {
      switch (sortMode) {
        case "severity": {
          const severityDelta =
            monitorSeverityRank(getSessionSeverity(right)) -
            monitorSeverityRank(getSessionSeverity(left));
          if (severityDelta !== 0) return severityDelta;
          return right.errors - left.errors;
        }
        case "errors":
          return right.errors - left.errors || right.event_count - left.event_count;
        case "cost":
          return right.cost_usd - left.cost_usd;
        case "duration":
          return right.duration_seconds - left.duration_seconds;
        case "tools":
          return right.tool_uses - left.tool_uses;
        case "recent":
        default:
          return (
            new Date(right.last_event).getTime() -
            new Date(left.last_event).getTime()
          );
      }
    });
  }, [query, sessions, sortMode]);

  useEffect(() => {
    startAutoRefresh(5000);
    return () => stopAutoRefresh();
  }, [startAutoRefresh, stopAutoRefresh]);

  if (error) {
    return (
      <div className="p-4 text-destructive">
        <AlertCircle className="mr-2 inline h-4 w-4" />
        Failed to load sessions: {error}
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <Badge variant="outline">{formatProviderLabel(provider)} harness</Badge>
        <p className="text-sm text-muted-foreground">No {formatProviderLabel(provider)} sessions recorded yet.</p>
      </div>
    );
  }

  const showFocusedSessionColumn = focusedSessions.length > 1;

  return (
    <div className="space-y-4">
      {focusedSessions.length > 0 && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="space-y-4 py-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">Focused sessions</Badge>
                  <span className="text-sm font-medium">
                    {focusedSessions.length} active across monitor views
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
            </div>

            <div className="rounded-md border bg-background/80">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Session</TableHead>
                    <TableHead className="text-right">Events</TableHead>
                    <TableHead className="text-right">Errors</TableHead>
                    <TableHead className="text-right">Tools</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {focusedSessions.map((session) => (
                    <TableRow key={session.session_id}>
                      <TableCell className="font-mono text-xs">
                        {formatSessionId(session.session_id)}
                      </TableCell>
                      <TableCell className="text-right">{session.event_count}</TableCell>
                      <TableCell
                        className={cn(
                          "text-right",
                          session.errors > 0 && "font-medium text-destructive",
                        )}
                      >
                        {session.errors}
                      </TableCell>
                      <TableCell className="text-right">{session.tool_uses}</TableCell>
                      <TableCell className="text-right">{formatCost(session.cost_usd)}</TableCell>
                      <TableCell className="text-right">
                        {formatDuration(session.duration_seconds)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-medium">
                    <Bot className="h-4 w-4" />
                    Agent Telemetry
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {focusedAgentSummaries.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No agent telemetry in scope yet.</p>
                  ) : (
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {showFocusedSessionColumn && <TableHead>Session</TableHead>}
                            <TableHead>Actor</TableHead>
                            <TableHead>Kind</TableHead>
                            <TableHead className="text-right">Events</TableHead>
                            <TableHead className="text-right">Tools</TableHead>
                            <TableHead className="text-right">Fail</TableHead>
                            <TableHead className="text-right">Tasks</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {focusedAgentSummaries.slice(0, 8).map((agent) => (
                            <TableRow key={`${agent.session_id}:${agent.actor_id}`}>
                              {showFocusedSessionColumn && (
                                <TableCell className="font-mono text-[11px]">
                                  {formatSessionId(agent.session_id)}
                                </TableCell>
                              )}
                              <TableCell className="max-w-[180px] truncate">
                                {agent.actor_label}
                              </TableCell>
                              <TableCell className="capitalize text-muted-foreground">
                                {agent.actor_kind}
                              </TableCell>
                              <TableCell className="text-right">{agent.event_count}</TableCell>
                              <TableCell className="text-right">{agent.tool_calls}</TableCell>
                              <TableCell
                                className={cn(
                                  "text-right",
                                  agent.failures > 0 && "font-medium text-destructive",
                                )}
                              >
                                {agent.failures}
                              </TableCell>
                              <TableCell className="text-right">
                                {agent.tasks_completed}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Task Telemetry</CardTitle>
                </CardHeader>
                <CardContent>
                  {focusedTaskSummaries.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No task telemetry in scope yet.</p>
                  ) : (
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {showFocusedSessionColumn && <TableHead>Session</TableHead>}
                            <TableHead>Status</TableHead>
                            <TableHead>Owner</TableHead>
                            <TableHead className="text-right">Duration</TableHead>
                            <TableHead>Subject</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {focusedTaskSummaries.slice(0, 8).map((task) => (
                            <TableRow key={`${task.session_id}:${task.task_id}`}>
                              {showFocusedSessionColumn && (
                                <TableCell className="font-mono text-[11px]">
                                  {formatSessionId(task.session_id)}
                                </TableCell>
                              )}
                              <TableCell>
                                <Badge
                                  variant={task.status === "completed" ? "secondary" : "outline"}
                                  className="capitalize"
                                >
                                  {task.status}
                                </Badge>
                              </TableCell>
                              <TableCell className="max-w-[120px] truncate">
                                {task.owner}
                              </TableCell>
                              <TableCell className="text-right">
                                {formatOptionalDuration(task.duration_seconds)}
                              </TableCell>
                              <TableCell className="max-w-[240px] truncate">
                                {task.subject}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="flex flex-col gap-4 py-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="text-sm font-medium text-muted-foreground">
              {filteredSessions.length} of {sessions.length} session
              {sessions.length !== 1 ? "s" : ""}
            </h3>
            {loading && (
              <span className="text-xs text-muted-foreground animate-pulse">
                refreshing...
              </span>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_auto]">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Search sessions
              </label>
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Session id or tool"
                className="min-w-[220px]"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Sort by
              </label>
              <Select
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as SessionSortMode)}
              >
                <option value="recent">Latest activity</option>
                <option value="severity">Severity</option>
                <option value="errors">Errors</option>
                <option value="cost">Cost</option>
                <option value="duration">Duration</option>
                <option value="tools">Tool usage</option>
              </Select>
            </div>
            <div className="flex items-end gap-2">
              {query && (
                <Button variant="ghost" size="sm" onClick={() => setQuery("")}> 
                  Clear search
                </Button>
              )}
              {focusedSessionIds.length > 0 && (
                <Button variant="ghost" size="sm" onClick={clearFocusedSessions}>
                  Clear focus
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {filteredSessions.length === 0 ? (
        <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
          No sessions match the current search.
        </div>
      ) : (
        filteredSessions.map((session) => {
          const severity = getSessionSeverity(session);
          const isFocused = focusedSessionIds.includes(session.session_id);

          return (
            <Card
              key={session.session_id}
              className={cn(
                "transition-colors",
                isFocused && "border-primary bg-primary/5 shadow-sm",
              )}
            >
              <CardHeader className="pb-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-sm font-mono">
                        {formatSessionId(session.session_id)}
                      </CardTitle>
                      <Badge variant={getSeverityBadgeVariant(severity)}>
                        {formatSeverityLabel(severity)}
                      </Badge>
                      {isFocused && <Badge variant="secondary">Focused</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Started {formatTime(session.first_event)} · Last event {formatTime(session.last_event)}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant={isFocused ? "secondary" : "outline"}
                      size="sm"
                      onClick={() => toggleFocusedSession(session.session_id)}
                    >
                      {isFocused ? "Unfocus" : "Focus"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => focusSingleSession(session.session_id)}
                    >
                      Only this
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm lg:grid-cols-4">
                  <div className="flex items-center gap-2">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">Duration:</span>
                    <span className="font-medium">
                      {formatDuration(session.duration_seconds)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">Tool uses:</span>
                    <span className="font-medium">{session.tool_uses}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <AlertCircle
                      className={cn(
                        "h-3.5 w-3.5",
                        session.errors > 0
                          ? "text-destructive"
                          : "text-muted-foreground",
                      )}
                    />
                    <span className="text-muted-foreground">Errors:</span>
                    <span
                      className={cn(
                        "font-medium",
                        session.errors > 0 && "text-destructive",
                      )}
                    >
                      {session.errors}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">{subagentLabel}:</span>
                    <span className="font-medium">{session.subagents}</span>
                  </div>
                </div>

                {session.cost_usd > 0 && (
                  <div className="mt-3 flex items-center gap-2 text-sm">
                    <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">Est. cost:</span>
                    <span className="font-medium">{formatCost(session.cost_usd)}</span>
                  </div>
                )}

                {session.top_tools.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {session.top_tools.map(([name, count]) => (
                      <Badge
                        key={name}
                        variant="secondary"
                        className="px-1.5 py-0 text-[10px]"
                      >
                        {name}
                        <span className="ml-0.5 text-muted-foreground">{count}</span>
                      </Badge>
                    ))}
                  </div>
                )}

                <div className="mt-2 text-xs text-muted-foreground">
                  {session.event_count} events total
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
