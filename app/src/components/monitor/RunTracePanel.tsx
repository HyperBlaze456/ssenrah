import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeSessions, useMonitorStore } from "@/lib/store/monitor";
import {
  deriveRunTraceModel,
  deriveRunTraceSummary,
  formatDurationCompact,
  type RunTraceCategory,
  type RunTraceNodeKind,
  type RunTraceSummary,
  type TelemetrySeverity,
} from "@/lib/telemetry";
import { useUiStore } from "@/lib/store/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Filter,
  LayoutPanelLeft,
  MessageSquareText,
  PanelsTopLeft,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { RunTraceFlow, type RunTraceNodeFilters } from "./run-trace/RunTraceFlow";
import { RunTraceInspectorDrawer } from "./run-trace/RunTraceInspectorDrawer";

interface SessionTraceEntry {
  session_id: string;
  trace: RunTraceSummary;
}

const DEFAULT_NODE_FILTERS: RunTraceNodeFilters = {
  query: "",
  severity: "all",
  lane: "all",
  category: "all",
  kind: "all",
  tool: "all",
  excludeSuccessfulBash: false,
  excludeInspectionOnly: false,
};

function formatSessionId(sessionId: string): string {
  return `${sessionId.slice(0, 8)}…${sessionId.slice(-4)}`;
}

function formatDateTime(timestamp: string): string {
  return new Date(timestamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatCost(usd: number): string {
  if (!usd) return "$0.0000";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function getSeverityVariant(
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

function FilterPill({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "rounded-full border px-2.5 py-1 text-[11px] font-medium",
        active
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-border bg-muted/20 text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function countActiveNodeFilters(filters: RunTraceNodeFilters): number {
  let count = 0;
  if (filters.query.trim()) count += 1;
  if (filters.severity !== "all") count += 1;
  if (filters.lane !== "all") count += 1;
  if (filters.category !== "all") count += 1;
  if (filters.kind !== "all") count += 1;
  if (filters.tool !== "all") count += 1;
  if (filters.excludeSuccessfulBash) count += 1;
  if (filters.excludeInspectionOnly) count += 1;
  return count;
}

export function RunTracePanel() {
  const events = useMonitorStore((state) => state.events);
  const loading = useMonitorStore((state) => state.loading);
  const error = useMonitorStore((state) => state.error);
  const startAutoRefresh = useMonitorStore((state) => state.startAutoRefresh);
  const stopAutoRefresh = useMonitorStore((state) => state.stopAutoRefresh);
  const focusedSessionIds = useMonitorStore((state) => state.focusedSessionIds);
  const toggleFocusedSession = useMonitorStore((state) => state.toggleFocusedSession);
  const clearFocusedSessions = useMonitorStore((state) => state.clearFocusedSessions);

  const setSidebarCollapsed = useUiStore((state) => state.setSidebarCollapsed);

  const [sessionQuery, setSessionQuery] = useState("");
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(true);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  const [selectedPromptSliceId, setSelectedPromptSliceId] = useState("all");
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
  const [nodeFilters, setNodeFilters] = useState<RunTraceNodeFilters>(DEFAULT_NODE_FILTERS);
  const autoCollapsedSidebarRef = useRef(false);

  useEffect(() => {
    startAutoRefresh(4000);
    return () => stopAutoRefresh();
  }, [startAutoRefresh, stopAutoRefresh]);

  const sessionEntries = useMemo<SessionTraceEntry[]>(() => {
    return computeSessions(events)
      .map((session) => ({
        session_id: session.session_id,
        trace: deriveRunTraceSummary(events, session.session_id),
      }))
      .filter((entry): entry is SessionTraceEntry => Boolean(entry.trace))
      .map((entry) => ({ session_id: entry.session_id, trace: entry.trace as RunTraceSummary }));
  }, [events]);

  const selectedSessionIds = useMemo(
    () => focusedSessionIds.filter((sessionId) => sessionEntries.some((entry) => entry.session_id === sessionId)),
    [focusedSessionIds, sessionEntries],
  );

  const filteredSessionEntries = useMemo(() => {
    const normalizedQuery = sessionQuery.trim().toLowerCase();
    if (!normalizedQuery) return sessionEntries;

    return sessionEntries.filter(({ session_id, trace }) => {
      return (
        session_id.toLowerCase().includes(normalizedQuery) ||
        trace.top_tools.some(([tool]) => tool.toLowerCase().includes(normalizedQuery)) ||
        trace.models_used.some((model) => model.toLowerCase().includes(normalizedQuery))
      );
    });
  }, [sessionEntries, sessionQuery]);

  useEffect(() => {
    if (selectedSessionIds.length === 0) {
      setActiveSessionId(undefined);
      setSelectedNodeId(undefined);
      setSelectedPromptSliceId("all");
      setSessionDrawerOpen(true);
      autoCollapsedSidebarRef.current = false;
      return;
    }

    if (!activeSessionId || !selectedSessionIds.includes(activeSessionId)) {
      setActiveSessionId(selectedSessionIds[0]);
    }
  }, [activeSessionId, selectedSessionIds]);

  useEffect(() => {
    if (selectedSessionIds.length > 0 && !autoCollapsedSidebarRef.current) {
      setSidebarCollapsed(true);
      setSessionDrawerOpen(false);
      autoCollapsedSidebarRef.current = true;
    }
  }, [selectedSessionIds.length, setSidebarCollapsed]);

  useEffect(() => {
    setSelectedPromptSliceId("all");
    setSelectedNodeId(undefined);
  }, [activeSessionId]);

  const runModel = useMemo(
    () =>
      activeSessionId
        ? deriveRunTraceModel(events, activeSessionId, {
            promptSliceId: selectedPromptSliceId === "all" ? undefined : selectedPromptSliceId,
          })
        : null,
    [activeSessionId, events, selectedPromptSliceId],
  );

  const activeEntry = useMemo(
    () => sessionEntries.find((entry) => entry.session_id === activeSessionId),
    [activeSessionId, sessionEntries],
  );

  const promptOptions = useMemo(
    () => [
      {
        id: "all",
        label: "Full session",
        subtitle: activeEntry ? `${activeEntry.trace.prompt_count} prompt slices` : "Entire run",
      },
      ...(runModel?.prompt_slices.map((slice) => ({
        id: slice.id,
        label: slice.label,
        subtitle: slice.prompt,
      })) ?? []),
    ],
    [activeEntry, runModel?.prompt_slices],
  );

  const activePromptIndex = useMemo(
    () => promptOptions.findIndex((option) => option.id === selectedPromptSliceId),
    [promptOptions, selectedPromptSliceId],
  );

  const selectedEntries = useMemo(
    () =>
      selectedSessionIds
        .map((sessionId) => sessionEntries.find((entry) => entry.session_id === sessionId))
        .filter((entry): entry is SessionTraceEntry => Boolean(entry)),
    [selectedSessionIds, sessionEntries],
  );

  const availableTools = useMemo(() => {
    if (!runModel) return [];
    return [...new Set(runModel.lanes.flatMap((lane) => lane.nodes.flatMap((node) => node.tool_names)))].sort(
      (left, right) => left.localeCompare(right),
    );
  }, [runModel]);

  useEffect(() => {
    if (nodeFilters.tool !== "all" && !availableTools.includes(nodeFilters.tool)) {
      setNodeFilters((current) => ({ ...current, tool: "all" }));
    }
  }, [availableTools, nodeFilters.tool]);

  useEffect(() => {
    if (selectedNodeId && runModel && !runModel.lanes.some((lane) => lane.nodes.some((node) => node.id === selectedNodeId))) {
      setSelectedNodeId(undefined);
    }
  }, [runModel, selectedNodeId]);

  const handleToggleSession = (sessionId: string) => {
    const isSelected = selectedSessionIds.includes(sessionId);
    toggleFocusedSession(sessionId);

    if (!isSelected) {
      setActiveSessionId(sessionId);
      return;
    }

    if (activeSessionId === sessionId) {
      const nextSelected = selectedSessionIds.filter((candidate) => candidate !== sessionId);
      setActiveSessionId(nextSelected[0]);
    }
  };

  const handleOpenSession = (sessionId: string) => {
    if (!selectedSessionIds.includes(sessionId)) {
      toggleFocusedSession(sessionId);
    }
    setActiveSessionId(sessionId);
    setSessionDrawerOpen(false);
  };

  const handleStepPrompt = useCallback(
    (direction: -1 | 1) => {
      if (activePromptIndex < 0) return;
      const nextOption = promptOptions[activePromptIndex + direction];
      if (!nextOption) return;
      setSelectedPromptSliceId(nextOption.id);
    },
    [activePromptIndex, promptOptions],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (promptOptions.length <= 1) return;

      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName;
      if (
        tagName === "INPUT" ||
        tagName === "TEXTAREA" ||
        tagName === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }

      if (event.key === "[" || (event.altKey && event.key === "ArrowLeft")) {
        event.preventDefault();
        handleStepPrompt(-1);
      }

      if (event.key === "]" || (event.altKey && event.key === "ArrowRight")) {
        event.preventDefault();
        handleStepPrompt(1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleStepPrompt, promptOptions.length]);

  const activeFilterCount = useMemo(() => countActiveNodeFilters(nodeFilters), [nodeFilters]);

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-destructive">
        <AlertCircle className="mr-2 inline h-4 w-4" />
        Failed to load run trace data: {error}
      </div>
    );
  }

  if (!loading && sessionEntries.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center">
        <div className="space-y-2">
          <p className="text-base font-medium">No recorded sessions yet.</p>
          <p className="text-sm text-muted-foreground">
            Run Trace appears once harness events exist.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-1 min-h-0 flex-col bg-background">
      <div className="border-b bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setSessionDrawerOpen((open) => !open)}>
            <LayoutPanelLeft className="h-4 w-4" />
            Sessions
            <Badge variant="secondary" className="ml-1 text-[10px]">
              {selectedSessionIds.length}
            </Badge>
          </Button>

          <Select
            value={activeSessionId ?? ""}
            onChange={(event) => setActiveSessionId(event.target.value || undefined)}
            className="min-w-[220px]"
            disabled={selectedEntries.length === 0}
          >
            <option value="">Active session</option>
            {selectedEntries.map((entry) => (
              <option key={entry.session_id} value={entry.session_id}>
                {formatSessionId(entry.session_id)} · {formatDurationCompact(entry.trace.duration_seconds)}
              </option>
            ))}
          </Select>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => handleStepPrompt(-1)}
              disabled={activePromptIndex <= 0}
              title="Previous user message ([ or Alt+←)"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>

            <Select
              value={selectedPromptSliceId}
              onChange={(event) => setSelectedPromptSliceId(event.target.value)}
              className="min-w-[260px]"
              disabled={!runModel}
            >
              {promptOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label} · {option.subtitle.slice(0, 72)}
                </option>
              ))}
            </Select>

            <Button
              variant="outline"
              size="icon"
              onClick={() => handleStepPrompt(1)}
              disabled={activePromptIndex < 0 || activePromptIndex >= promptOptions.length - 1}
              title="Next user message (] or Alt+→)"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <Button
            variant="ghost"
            onClick={() => setNodeFilters(DEFAULT_NODE_FILTERS)}
            disabled={activeFilterCount === 0}
          >
            <RotateCcw className="h-4 w-4" />
            Reset filters
          </Button>

          <Button variant="ghost" onClick={() => clearFocusedSessions()} disabled={selectedSessionIds.length === 0}>
            <X className="h-4 w-4" />
            Clear selection
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[260px] flex-1 max-w-[420px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={nodeFilters.query}
              onChange={(event) => setNodeFilters((current) => ({ ...current, query: event.target.value }))}
              className="pl-9"
              placeholder="Filter nodes by title, tool, task, or actor"
            />
          </div>

          <Select
            value={nodeFilters.severity}
            onChange={(event) =>
              setNodeFilters((current) => ({
                ...current,
                severity: event.target.value as RunTraceNodeFilters["severity"],
              }))
            }
            className="w-[150px]"
          >
            <option value="all">All severities</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
          </Select>

          <Select
            value={nodeFilters.lane}
            onChange={(event) =>
              setNodeFilters((current) => ({
                ...current,
                lane: event.target.value as RunTraceNodeFilters["lane"],
              }))
            }
            className="w-[150px]"
          >
            <option value="all">All lanes</option>
            <option value="main">Main lane</option>
            <option value="subagent">Subagents</option>
            <option value="teammate">Teammates</option>
          </Select>

          <Select
            value={nodeFilters.category}
            onChange={(event) =>
              setNodeFilters((current) => ({
                ...current,
                category: event.target.value as RunTraceCategory | "all",
              }))
            }
            className="w-[180px]"
          >
            <option value="all">All categories</option>
            <option value="reasoning_or_coordination">Reasoning / coordination</option>
            <option value="significant_side_effect">Significant side effect</option>
            <option value="safety_or_policy">Safety / policy</option>
            <option value="failure_or_anomaly">Failure / anomaly</option>
            <option value="inspection_only">Inspection only</option>
          </Select>

          <Select
            value={nodeFilters.kind}
            onChange={(event) =>
              setNodeFilters((current) => ({
                ...current,
                kind: event.target.value as RunTraceNodeKind | "all",
              }))
            }
            className="w-[150px]"
          >
            <option value="all">All node types</option>
            <option value="session">Session</option>
            <option value="prompt">Prompt</option>
            <option value="task">Task</option>
            <option value="tool">Tool</option>
            <option value="agent">Agent</option>
            <option value="inspection_block">Inspection block</option>
            <option value="policy">Policy</option>
            <option value="failure">Failure</option>
            <option value="event">Event</option>
          </Select>

          <Select
            value={nodeFilters.tool}
            onChange={(event) => setNodeFilters((current) => ({ ...current, tool: event.target.value }))}
            className="min-w-[180px]"
          >
            <option value="all">All tools</option>
            {availableTools.map((toolName) => (
              <option key={toolName} value={toolName}>
                {toolName}
              </option>
            ))}
          </Select>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <MessageSquareText className="h-3.5 w-3.5" />
            Quick message switch
          </span>
          <ScrollArea orientation="horizontal" className="max-w-full whitespace-nowrap">
            <div className="flex gap-2 pr-2">
              {promptOptions.map((option, index) => {
                const active = option.id === selectedPromptSliceId;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setSelectedPromptSliceId(option.id)}
                    className={cn(
                      "max-w-[260px] rounded-full border px-3 py-1.5 text-left text-xs transition-colors",
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-background hover:border-primary/30 hover:bg-muted/40",
                    )}
                    title={option.subtitle}
                  >
                    <span className="font-medium">{index === 0 ? "All" : `Msg ${index}`}</span>
                    <span className="ml-1 text-muted-foreground">
                      {option.id === "all" ? option.subtitle : option.subtitle.slice(0, 46)}
                    </span>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Exclude noise</span>
          <Button
            variant={nodeFilters.excludeSuccessfulBash ? "secondary" : "outline"}
            size="sm"
            onClick={() =>
              setNodeFilters((current) => ({
                ...current,
                excludeSuccessfulBash: !current.excludeSuccessfulBash,
              }))
            }
          >
            {nodeFilters.excludeSuccessfulBash ? "Showing" : "Hide"} successful Bash
          </Button>
          <Button
            variant={nodeFilters.excludeInspectionOnly ? "secondary" : "outline"}
            size="sm"
            onClick={() =>
              setNodeFilters((current) => ({
                ...current,
                excludeInspectionOnly: !current.excludeInspectionOnly,
              }))
            }
          >
            {nodeFilters.excludeInspectionOnly ? "Showing" : "Hide"} inspection-only
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Filter className="h-3.5 w-3.5" />
          <FilterPill active={selectedSessionIds.length > 0}>
            {selectedSessionIds.length} selected session{selectedSessionIds.length === 1 ? "" : "s"}
          </FilterPill>
          <FilterPill active={Boolean(activeSessionId)}>
            viewing {activeSessionId ? formatSessionId(activeSessionId) : "no session"}
          </FilterPill>
          <FilterPill active={activeFilterCount > 0}>{activeFilterCount} active node filter{activeFilterCount === 1 ? "" : "s"}</FilterPill>
          {activeEntry && (
            <>
              <Badge variant={getSeverityVariant(activeEntry.trace.severity)}>
                {activeEntry.trace.severity}
              </Badge>
              <span>{formatDateTime(activeEntry.trace.first_timestamp)}</span>
              <span>·</span>
              <span>{formatDurationCompact(activeEntry.trace.duration_seconds)}</span>
              <span>·</span>
              <span>{activeEntry.trace.expanded_branch_count} expanded branch{activeEntry.trace.expanded_branch_count === 1 ? "" : "es"}</span>
              <span>·</span>
              <span>{formatCost(activeEntry.trace.total_cost_usd)}</span>
            </>
          )}
        </div>
      </div>

      <div className="relative flex-1 min-h-0 overflow-hidden">
        <div
          className="h-full w-full transition-[padding] duration-200"
          style={{
            paddingLeft: sessionDrawerOpen ? 360 : 0,
            paddingRight: selectedNodeId ? 420 : 0,
          }}
        >
          <div className="h-full p-4">
            {runModel ? (
              <RunTraceFlow
                model={runModel}
                filters={nodeFilters}
                selectedNodeId={selectedNodeId}
                onSelectNode={setSelectedNodeId}
                onVisibleNodeIdsChange={(visibleNodeIds) => {
                  if (selectedNodeId && !visibleNodeIds.includes(selectedNodeId)) {
                    setSelectedNodeId(undefined);
                  }
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center rounded-2xl border border-dashed bg-muted/10 px-6 text-center">
                <div className="max-w-lg space-y-3">
                  <PanelsTopLeft className="mx-auto h-8 w-8 text-muted-foreground" />
                  <p className="text-base font-medium">Choose one or more sessions to enter the flow view.</p>
                  <p className="text-sm text-muted-foreground">
                    After you select sessions, the picker collapses, the navigation sidebar closes, and the full React Flow viewer takes over the screen.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        <aside
          className={cn(
            "absolute inset-y-0 left-0 z-20 w-[360px] border-r bg-background/95 shadow-2xl backdrop-blur transition-transform duration-200",
            sessionDrawerOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="flex h-full flex-col">
            <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                  Session picker
                </p>
                <h2 className="mt-1 text-lg font-semibold">Select sessions</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Build a working set, then inspect one active session in the full flow view.
                </p>
              </div>
              {selectedSessionIds.length > 0 && (
                <Button variant="ghost" size="icon" onClick={() => setSessionDrawerOpen(false)}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>

            <div className="border-b px-5 py-4">
              <Input
                value={sessionQuery}
                onChange={(event) => setSessionQuery(event.target.value)}
                placeholder="Search by session, tool, or model"
              />
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <FilterPill active={selectedSessionIds.length > 0}>
                  {selectedSessionIds.length} selected
                </FilterPill>
                <FilterPill active={Boolean(activeSessionId)}>
                  active {activeSessionId ? formatSessionId(activeSessionId) : "none"}
                </FilterPill>
              </div>
            </div>

            <ScrollArea className="flex-1 px-4 py-4">
              <div className="space-y-3">
                {filteredSessionEntries.map(({ session_id, trace }) => {
                  const selected = selectedSessionIds.includes(session_id);
                  const active = activeSessionId === session_id;
                  return (
                    <div
                      key={session_id}
                      className={cn(
                        "rounded-2xl border p-4 transition-colors",
                        active
                          ? "border-primary bg-primary/5 shadow-sm"
                          : selected
                            ? "border-primary/40 bg-primary/[0.03]"
                            : "border-border hover:border-primary/30 hover:bg-muted/40",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => handleOpenSession(session_id)}>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={getSeverityVariant(trace.severity)}>{trace.severity}</Badge>
                            {active && (
                              <Badge variant="secondary" className="text-[10px]">
                                active
                              </Badge>
                            )}
                          </div>
                          <p className="mt-2 font-mono text-xs text-muted-foreground">{formatSessionId(session_id)}</p>
                          <p className="mt-2 text-sm font-medium">{formatDateTime(trace.first_timestamp)}</p>
                        </button>
                        <Button
                          variant={selected ? "secondary" : "outline"}
                          size="sm"
                          onClick={() => handleToggleSession(session_id)}
                        >
                          {selected ? (
                            <>
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Selected
                            </>
                          ) : (
                            "Add"
                          )}
                        </Button>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                        <span>{trace.prompt_count} prompt{trace.prompt_count === 1 ? "" : "s"}</span>
                        <span>{trace.branch_count} branch{trace.branch_count === 1 ? "" : "es"}</span>
                        <span>{formatDurationCompact(trace.duration_seconds)}</span>
                        <span>{formatCost(trace.total_cost_usd)}</span>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-1">
                        {trace.top_tools.slice(0, 3).map(([tool, count]) => (
                          <Badge key={`${session_id}:${tool}`} variant="outline" className="text-[10px]">
                            {tool} × {count}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  );
                })}

                {filteredSessionEntries.length === 0 && (
                  <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                    No sessions match that query.
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </aside>

        {runModel && (
          <RunTraceInspectorDrawer
            model={runModel}
            selectedNodeId={selectedNodeId}
            onClose={() => setSelectedNodeId(undefined)}
          />
        )}
      </div>
    </div>
  );
}
