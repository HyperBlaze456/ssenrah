import { useCallback, useEffect, useMemo, useState } from "react";
import { computeSessions, useMonitorStore, useHarnessEvents } from "@/lib/store/monitor";
import {
  deriveRunTraceModel,
  deriveRunTraceSummary,
  formatDurationCompact,
  type RunTraceCategory,
  type RunTraceNodeKind,
  type RunTraceSummary,
  type TelemetrySeverity,
} from "@/lib/telemetry";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select } from "@/components/ui/select";
import { SessionPicker } from "@/components/monitor/SessionPicker";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Filter,
  MessageSquareText,
  PanelsTopLeft,
  RotateCcw,
  Search,
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
  const events = useHarnessEvents();
  const loading = useMonitorStore((state) => state.loading);
  const error = useMonitorStore((state) => state.error);
  const startAutoRefresh = useMonitorStore((state) => state.startAutoRefresh);
  const stopAutoRefresh = useMonitorStore((state) => state.stopAutoRefresh);
  const activeSessionId = useMonitorStore((state) => state.activeSessionId);

  const [selectedPromptSliceId, setSelectedPromptSliceId] = useState("all");
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
  const [nodeFilters, setNodeFilters] = useState<RunTraceNodeFilters>(DEFAULT_NODE_FILTERS);

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

  const sessions = useMemo(() => computeSessions(events), [events]);

  const resolvedSessionId = useMemo(() => {
    if (activeSessionId && sessionEntries.some((entry) => entry.session_id === activeSessionId)) {
      return activeSessionId;
    }
    return sessionEntries[0]?.session_id;
  }, [activeSessionId, sessionEntries]);

  useEffect(() => {
    setSelectedPromptSliceId("all");
    setSelectedNodeId(undefined);
  }, [resolvedSessionId]);

  const runModel = useMemo(
    () => (resolvedSessionId ? deriveRunTraceModel(events, resolvedSessionId) : null),
    [resolvedSessionId, events],
  );

  const activeEntry = useMemo(
    () => sessionEntries.find((entry) => entry.session_id === resolvedSessionId),
    [resolvedSessionId, sessionEntries],
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
        <div className="flex flex-wrap items-end gap-3">
          <SessionPicker sessions={sessions} selectClassName="min-w-[280px]" />

          <div className="flex items-end gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => handleStepPrompt(-1)}
              disabled={activePromptIndex <= 0}
              title="Previous user message ([ or Alt+←)"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Prompt slice</label>
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
            </div>

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

        <div className="mt-3 flex w-full min-w-0 items-center gap-2">
          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground">
            <MessageSquareText className="h-3.5 w-3.5" />
            Quick message switch
          </span>
          <ScrollArea orientation="horizontal" className="min-w-0 flex-1 whitespace-nowrap">
            <div className="flex w-max gap-2 pr-2">
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
          <FilterPill active={Boolean(resolvedSessionId)}>
            viewing {resolvedSessionId ? formatSessionId(resolvedSessionId) : "no session"}
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
                focusedPromptSliceId={
                  selectedPromptSliceId === "all" ? undefined : selectedPromptSliceId
                }
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
                  <p className="text-base font-medium">No session selected.</p>
                  <p className="text-sm text-muted-foreground">
                    Pick a session from the dropdown above to render its run trace.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

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
