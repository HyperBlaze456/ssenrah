import { useEffect, useMemo, useRef, useState } from "react";
import { useMonitorStore, computeSessions } from "@/lib/store/monitor";
import {
  buildRunTraceInspector,
  deriveRunTraceModel,
  deriveRunTraceSummary,
  formatDurationCompact,
  getDefaultRunTraceNodeId,
  readDecisionChain,
  type DecisionChain,
  type RunTraceCategory,
  type RunTraceLane,
  type RunTraceModel,
  type RunTraceNode,
  type RunTraceSummary,
  type TelemetrySeverity,
} from "@/lib/telemetry";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  Bot,
  GitBranch,
  Shield,
  Sparkles,
  Terminal,
  User,
  Wrench,
} from "lucide-react";

interface SessionTraceEntry {
  session_id: string;
  trace: RunTraceSummary;
}

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

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
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

function getCategoryClasses(category: RunTraceCategory): string {
  switch (category) {
    case "failure_or_anomaly":
      return "border-destructive/40 bg-destructive/10 text-destructive";
    case "safety_or_policy":
      return "border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300";
    case "significant_side_effect":
      return "border-primary/40 bg-primary/10 text-primary";
    case "inspection_only":
      return "border-muted-foreground/20 bg-muted text-muted-foreground";
    case "reasoning_or_coordination":
    default:
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
}

function getNodeWidth(node: RunTraceNode): number {
  switch (node.kind) {
    case "prompt":
      return 220;
    case "agent":
      return 180;
    case "inspection_block":
      return 150;
    case "failure":
      return 170;
    case "policy":
      return 160;
    default:
      return 156;
  }
}

function getNodeIcon(node: RunTraceNode) {
  switch (node.kind) {
    case "agent":
      return Bot;
    case "policy":
      return Shield;
    case "failure":
      return AlertCircle;
    case "inspection_block":
      return Sparkles;
    case "tool":
      return Wrench;
    case "prompt":
      return User;
    default:
      return Terminal;
  }
}

function getLaneIcon(lane: RunTraceLane) {
  switch (lane.kind) {
    case "subagent":
      return Bot;
    case "teammate":
      return GitBranch;
    case "main":
    default:
      return Terminal;
  }
}

function getTimelineLayout(model: RunTraceModel, node: RunTraceNode) {
  const startMs = new Date(model.summary.first_timestamp).getTime();
  const endMs = new Date(model.summary.last_timestamp).getTime();
  const totalMs = Math.max(1, endMs - startMs);
  const centerMs = new Date(node.start_timestamp).getTime() + node.duration_ms / 2;
  const leftPct = ((centerMs - startMs) / totalMs) * 100;
  return {
    leftPct: Math.min(100, Math.max(0, leftPct)),
    width: getNodeWidth(node),
  };
}

function SessionList({
  entries,
  selectedSessionId,
  onSelect,
}: {
  entries: SessionTraceEntry[];
  selectedSessionId?: string;
  onSelect: (sessionId: string) => void;
}) {
  return (
    <div className="space-y-3">
      {entries.map(({ session_id, trace }) => {
        const selected = session_id === selectedSessionId;
        return (
          <button
            key={session_id}
            type="button"
            onClick={() => onSelect(session_id)}
            className={cn(
              "w-full rounded-lg border p-3 text-left transition-colors",
              selected
                ? "border-primary bg-primary/5 shadow-sm"
                : "border-border hover:border-primary/30 hover:bg-muted/50",
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={getSeverityVariant(trace.severity)}>{trace.severity}</Badge>
              <span className="font-mono text-xs text-muted-foreground">{formatSessionId(session_id)}</span>
            </div>
            <p className="mt-2 text-sm font-medium">{formatDateTime(trace.first_timestamp)}</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
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
              {trace.collapsed_helper_count > 0 && (
                <Badge variant="secondary" className="text-[10px]">
                  {trace.collapsed_helper_count} collapsed helper
                  {trace.collapsed_helper_count === 1 ? "" : "s"}
                </Badge>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function RunTimeline({
  model,
  selectedNodeId,
  onSelectNode,
  showInspectionNodes,
}: {
  model: RunTraceModel;
  selectedNodeId?: string;
  onSelectNode: (nodeId: string) => void;
  showInspectionNodes: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const visibleLanes = model.lanes.map((lane) => ({
    ...lane,
    nodes: showInspectionNodes
      ? lane.nodes
      : lane.nodes.filter((node) => node.kind !== "inspection_block"),
  }));

  const handleCanvasKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const container = scrollRef.current;
    if (!container) return;

    switch (event.key) {
      case "ArrowRight":
        container.scrollBy({ left: 160, behavior: "smooth" });
        event.preventDefault();
        break;
      case "ArrowLeft":
        container.scrollBy({ left: -160, behavior: "smooth" });
        event.preventDefault();
        break;
      case "ArrowDown":
        container.scrollBy({ top: 72, behavior: "smooth" });
        event.preventDefault();
        break;
      case "ArrowUp":
        container.scrollBy({ top: -72, behavior: "smooth" });
        event.preventDefault();
        break;
      default:
        break;
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="text-base">Single-session run trace</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Horizontal timeline with expanded multi-agent branches and collapsed read-only helpers.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>{formatTime(model.summary.first_timestamp)}</span>
            <span>→</span>
            <span>{formatTime(model.summary.last_timestamp)}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {model.prompt_slices.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {model.prompt_slices.map((slice) => (
              <Badge
                key={slice.id}
                variant={slice.id === model.selected_prompt_slice_id ? "secondary" : "outline"}
                className="max-w-full whitespace-normal text-left text-[10px]"
              >
                {slice.label}: {slice.prompt}
              </Badge>
            ))}
          </div>
        )}

        <div
          ref={scrollRef}
          tabIndex={0}
          onKeyDown={handleCanvasKeyDown}
          className="overflow-auto rounded-md border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <div className="min-w-[1480px]">
            {visibleLanes.map((lane) => {
              const LaneIcon = getLaneIcon(lane);
              return (
                <div
                  key={lane.id}
                  className="grid border-b last:border-b-0"
                  style={{ gridTemplateColumns: "220px minmax(0, 1fr)" }}
                >
                  <div className="sticky left-0 z-10 flex min-h-24 items-center gap-3 border-r bg-background/95 px-4 py-3 backdrop-blur">
                    <div className="rounded-full border bg-muted p-2 text-muted-foreground">
                      <LaneIcon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{lane.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {lane.kind} · {lane.event_count} events · {formatDurationCompact(Math.round(lane.duration_ms / 1000))}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {lane.failure_count > 0 && (
                          <Badge variant="destructive" className="text-[10px]">
                            {lane.failure_count} failure{lane.failure_count === 1 ? "" : "s"}
                          </Badge>
                        )}
                        {lane.inspection_event_count > 0 && (
                          <Badge variant="outline" className="text-[10px]">
                            {lane.inspection_event_count} inspection
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="relative min-h-24 bg-muted/10 px-4 py-3">
                    <div className="absolute left-0 right-0 top-1/2 h-px bg-border" />
                    {lane.nodes.map((node) => {
                      const Icon = getNodeIcon(node);
                      const layout = getTimelineLayout(model, node);
                      return (
                        <button
                          key={node.id}
                          type="button"
                          onClick={() => onSelectNode(node.id)}
                          title={node.title}
                          className={cn(
                            "absolute top-1/2 -translate-y-1/2 rounded-lg border px-3 py-2 text-left shadow-sm transition-all hover:-translate-y-[52%] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                            getCategoryClasses(node.category),
                            selectedNodeId === node.id && "ring-2 ring-primary ring-offset-2",
                          )}
                          style={{
                            left: `calc(${layout.leftPct}% - ${layout.width / 2}px)`,
                            width: `${layout.width}px`,
                          }}
                        >
                          <div className="flex items-start gap-2">
                            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                            <div className="min-w-0">
                              <p className="truncate text-xs font-semibold">{node.title}</p>
                              {node.subtitle && (
                                <p className="mt-0.5 line-clamp-2 text-[10px] opacity-80">{node.subtitle}</p>
                              )}
                              <div className="mt-1 flex flex-wrap gap-1 text-[9px] opacity-70">
                                <span>{formatTime(node.start_timestamp)}</span>
                                {node.tool_names.length > 0 && <span>{node.tool_names[0]}</span>}
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function InspectorPane({
  model,
  selectedNodeId,
}: {
  model: RunTraceModel;
  selectedNodeId?: string;
}) {
  const inspector = useMemo(
    () => (selectedNodeId ? buildRunTraceInspector(model, selectedNodeId) : null),
    [model, selectedNodeId],
  );
  const [decisionChain, setDecisionChain] = useState<DecisionChain | null>(null);
  const [loadingDecisionChain, setLoadingDecisionChain] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!inspector?.transcript_path) {
      setDecisionChain(null);
      setLoadingDecisionChain(false);
      return () => {
        cancelled = true;
      };
    }

    setLoadingDecisionChain(true);
    readDecisionChain(inspector.transcript_path)
      .then((chain) => {
        if (!cancelled) {
          setDecisionChain(chain);
          setLoadingDecisionChain(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDecisionChain(null);
          setLoadingDecisionChain(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [inspector?.transcript_path]);

  if (!inspector) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Inspector</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Select a node in the run trace to inspect ownership, actions, collapsed inspection details, and raw records.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="sticky top-0">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{inspector.lane.kind}</Badge>
          <Badge variant="outline">{inspector.node.kind}</Badge>
          <Badge variant={inspector.node.status === "failed" ? "destructive" : "outline"}>
            {inspector.node.status}
          </Badge>
        </div>
        <CardTitle className="text-base">{inspector.node.title}</CardTitle>
        {inspector.node.subtitle && (
          <p className="text-sm text-muted-foreground">{inspector.node.subtitle}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <section className="space-y-2">
          <h3 className="font-medium">Identity</h3>
          <div className="grid gap-2 rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
            <div className="flex items-center justify-between gap-3">
              <span>Lane</span>
              <span className="font-medium text-foreground">{inspector.lane.label}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Window</span>
              <span className="font-medium text-foreground">
                {formatTime(inspector.node.start_timestamp)} → {formatTime(inspector.node.end_timestamp)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Duration</span>
              <span className="font-medium text-foreground">
                {formatDurationCompact(Math.max(0, Math.round(inspector.node.duration_ms / 1000)))}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Models</span>
              <span className="text-right font-medium text-foreground">
                {inspector.models_used.length > 0 ? inspector.models_used.join(", ") : "n/a"}
              </span>
            </div>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="font-medium">Ownership</h3>
          <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
            <p>
              Actor <span className="font-medium text-foreground">{inspector.ownership.actor_label}</span> on the
              <span className="font-medium text-foreground"> {inspector.ownership.actor_kind}</span> lane.
            </p>
            {inspector.ownership.parent_lane_id && (
              <p className="mt-1">Spawned from {inspector.ownership.parent_lane_id}.</p>
            )}
            {inspector.ownership.task_ids.length > 0 && (
              <p className="mt-1">Tasks: {inspector.ownership.task_ids.join(", ")}</p>
            )}
            {inspector.prompt_slice && (
              <p className="mt-1 text-foreground">
                {inspector.prompt_slice.label}: {inspector.prompt_slice.prompt}
              </p>
            )}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="font-medium">Reasoning summary</h3>
          <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
            {loadingDecisionChain ? (
              <p>Loading transcript-derived reasoning…</p>
            ) : decisionChain ? (
              <div className="space-y-2">
                <p>
                  {decisionChain.summary.total_turns} turn{decisionChain.summary.total_turns === 1 ? "" : "s"} · {decisionChain.summary.total_decisions} tool decision
                  {decisionChain.summary.total_decisions === 1 ? "" : "s"}
                </p>
                {decisionChain.prompts.slice(0, 2).map((prompt) => (
                  <p key={`${prompt.timestamp}:${prompt.content}`} className="rounded bg-background p-2 text-foreground">
                    {prompt.content}
                  </p>
                ))}
                {decisionChain.steps.slice(0, 2).map((step) => (
                  <div key={`${step.timestamp}:${step.model}`} className="rounded bg-background p-2 text-foreground">
                    <p className="text-[11px] text-muted-foreground">{step.model}</p>
                    {step.reasoning && <p className="mt-1">{step.reasoning}</p>}
                    {step.thinking && !step.reasoning && <p className="mt-1">{step.thinking}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p>No transcript-derived reasoning preview was available for this node.</p>
            )}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="font-medium">Significant actions</h3>
          {inspector.significant_actions.length === 0 ? (
            <p className="text-xs text-muted-foreground">No significant actions in this selection.</p>
          ) : (
            <div className="space-y-2">
              {inspector.significant_actions.slice(0, 8).map((action) => (
                <div key={action.event_id} className="rounded-md border p-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={getSeverityVariant(action.severity)}>{action.severity}</Badge>
                    {action.tool_name && <Badge variant="outline">{action.tool_name}</Badge>}
                    <span className="text-muted-foreground">{formatTime(action.timestamp)}</span>
                  </div>
                  <p className="mt-2 font-medium">{action.label}</p>
                  {action.detail && <p className="mt-1 text-muted-foreground">{action.detail}</p>}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="font-medium">Collapsed inspection activity</h3>
          {inspector.inspection_actions.length === 0 ? (
            <p className="text-xs text-muted-foreground">No collapsed inspection activity for this node.</p>
          ) : (
            <details className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
              <summary className="cursor-pointer font-medium text-foreground">
                {inspector.inspection_actions.length} inspection step{inspector.inspection_actions.length === 1 ? "" : "s"}
              </summary>
              <div className="mt-3 space-y-2">
                {inspector.inspection_actions.slice(0, 20).map((action) => (
                  <div key={action.event_id} className="rounded border bg-background px-2 py-1.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-foreground">{action.label}</span>
                      <span>{formatTime(action.timestamp)}</span>
                    </div>
                    {action.detail && <p className="mt-1">{action.detail}</p>}
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="font-medium">Raw event drilldown</h3>
          <ScrollArea orientation="vertical" className="max-h-[280px] rounded-md border bg-muted/20 p-3">
            <div className="space-y-2 text-xs">
              {inspector.raw_records.map((record) => (
                <div key={record.event_id} className="rounded border bg-background px-2 py-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={getSeverityVariant(record.severity)}>{record.hook_event_type}</Badge>
                    <span className="text-muted-foreground">{formatTime(record.timestamp)}</span>
                    <span className="text-muted-foreground">{record.operation}</span>
                  </div>
                  <p className="mt-1 font-medium text-foreground">{record.summary}</p>
                  {record.detail && <p className="mt-1 text-muted-foreground">{record.detail}</p>}
                </div>
              ))}
            </div>
          </ScrollArea>
        </section>
      </CardContent>
    </Card>
  );
}

export function RunTracePanel() {
  const events = useMonitorStore((state) => state.events);
  const loading = useMonitorStore((state) => state.loading);
  const error = useMonitorStore((state) => state.error);
  const startAutoRefresh = useMonitorStore((state) => state.startAutoRefresh);
  const stopAutoRefresh = useMonitorStore((state) => state.stopAutoRefresh);
  const focusedSessionIds = useMonitorStore((state) => state.focusedSessionIds);
  const focusSingleSession = useMonitorStore((state) => state.focusSingleSession);

  const [query, setQuery] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>();
  const [selectedPromptSliceId, setSelectedPromptSliceId] = useState<string>("all");
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
  const [showInspectionNodes, setShowInspectionNodes] = useState(false);

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

  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return sessionEntries;
    return sessionEntries.filter(({ session_id, trace }) => {
      return (
        session_id.toLowerCase().includes(normalizedQuery) ||
        trace.top_tools.some(([tool]) => tool.toLowerCase().includes(normalizedQuery)) ||
        trace.models_used.some((model) => model.toLowerCase().includes(normalizedQuery))
      );
    });
  }, [query, sessionEntries]);

  useEffect(() => {
    if (selectedSessionId && filteredEntries.some((entry) => entry.session_id === selectedSessionId)) {
      return;
    }
    const preferred = focusedSessionIds.find((sessionId) =>
      filteredEntries.some((entry) => entry.session_id === sessionId),
    );
    setSelectedSessionId(preferred ?? filteredEntries[0]?.session_id);
  }, [filteredEntries, focusedSessionIds, selectedSessionId]);

  useEffect(() => {
    setSelectedPromptSliceId("all");
  }, [selectedSessionId]);

  const runModel = useMemo(
    () =>
      selectedSessionId
        ? deriveRunTraceModel(events, selectedSessionId, {
            promptSliceId: selectedPromptSliceId === "all" ? undefined : selectedPromptSliceId,
          })
        : null,
    [events, selectedPromptSliceId, selectedSessionId],
  );

  useEffect(() => {
    const defaultNodeId = getDefaultRunTraceNodeId(runModel);
    if (!runModel) {
      setSelectedNodeId(undefined);
      return;
    }
    if (selectedNodeId && runModel.lanes.some((lane) => lane.nodes.some((node) => node.id === selectedNodeId))) {
      return;
    }
    setSelectedNodeId(defaultNodeId);
  }, [runModel, selectedNodeId]);

  const selectedEntry = selectedSessionId
    ? sessionEntries.find((entry) => entry.session_id === selectedSessionId)
    : undefined;

  const handleSelectSession = (sessionId: string) => {
    setSelectedSessionId(sessionId);
    focusSingleSession(sessionId);
  };

  if (error) {
    return (
      <div className="p-4 text-destructive">
        <AlertCircle className="mr-2 inline h-4 w-4" />
        Failed to load run trace data: {error}
      </div>
    );
  }

  if (!loading && sessionEntries.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-sm text-muted-foreground">No recorded sessions yet. Run Trace appears once harness events exist.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Sessions</CardTitle>
            <p className="text-xs text-muted-foreground">
              Pick one session first, then inspect the full multi-agent run or slice by prompt.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by session, tool, or model"
            />
            <ScrollArea orientation="vertical" className="max-h-[720px] pr-1">
              <SessionList
                entries={filteredEntries}
                selectedSessionId={selectedSessionId}
                onSelect={handleSelectSession}
              />
            </ScrollArea>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {selectedEntry && (
            <Card>
              <CardContent className="flex flex-col gap-4 py-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={getSeverityVariant(selectedEntry.trace.severity)}>
                      {selectedEntry.trace.severity}
                    </Badge>
                    <span className="font-mono text-xs text-muted-foreground">
                      {formatSessionId(selectedEntry.session_id)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-medium">
                    {formatDateTime(selectedEntry.trace.first_timestamp)} · {formatDurationCompact(selectedEntry.trace.duration_seconds)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {selectedEntry.trace.expanded_branch_count} expanded branch
                    {selectedEntry.trace.expanded_branch_count === 1 ? "" : "es"} · {selectedEntry.trace.collapsed_helper_count} collapsed helper
                    {selectedEntry.trace.collapsed_helper_count === 1 ? "" : "s"} · {formatCost(selectedEntry.trace.total_cost_usd)}
                  </p>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Select
                    value={selectedPromptSliceId}
                    onChange={(event) => setSelectedPromptSliceId(event.target.value)}
                    className="min-w-[220px]"
                  >
                    <option value="all">Full session</option>
                    {runModel?.prompt_slices.map((slice) => (
                      <option key={slice.id} value={slice.id}>
                        {slice.label} · {slice.prompt.slice(0, 60)}
                      </option>
                    ))}
                  </Select>
                  <Button
                    variant={showInspectionNodes ? "secondary" : "outline"}
                    onClick={() => setShowInspectionNodes((value) => !value)}
                  >
                    {showInspectionNodes ? "Hide inspection blocks" : "Show inspection blocks"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {runModel ? (
            <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_360px]">
              <RunTimeline
                model={runModel}
                selectedNodeId={selectedNodeId}
                onSelectNode={setSelectedNodeId}
                showInspectionNodes={showInspectionNodes}
              />
              <InspectorPane model={runModel} selectedNodeId={selectedNodeId} />
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                Select a session to load the run trace.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
