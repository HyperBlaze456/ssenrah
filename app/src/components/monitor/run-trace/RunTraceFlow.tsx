import { useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  PanOnScrollMode,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  Bot,
  AlertCircle,
  GitBranch,
  MessageSquareText,
  Shield,
  Sparkles,
  Terminal,
  User,
  Wrench,
} from "lucide-react";
import {
  formatDurationCompact,
  type PromptSlice,
  type RunTraceCategory,
  type RunTraceLane,
  type RunTraceLaneKind,
  type RunTraceModel,
  type RunTraceNode,
  type RunTraceNodeKind,
  type TelemetrySeverity,
} from "@/lib/telemetry";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface RunTraceNodeFilters {
  query: string;
  severity: "all" | TelemetrySeverity;
  lane: "all" | RunTraceLaneKind;
  category: "all" | RunTraceCategory;
  kind: "all" | RunTraceNodeKind;
  tool: string;
  excludeSuccessfulBash: boolean;
  excludeInspectionOnly: boolean;
}

interface RunTraceFlowProps {
  model: RunTraceModel;
  selectedNodeId?: string;
  onSelectNode: (nodeId: string | undefined) => void;
  onVisibleNodeIdsChange?: (nodeIds: string[]) => void;
  filters: RunTraceNodeFilters;
  focusedPromptSliceId?: string;
}

interface VisibleNodeEntry {
  node: RunTraceNode;
  contextOnly: boolean;
}

interface VisibleLane {
  lane: RunTraceLane;
  nodes: VisibleNodeEntry[];
}

interface ColumnTrack {
  lane: RunTraceLane;
  isMain: boolean;
  events: VisibleNodeEntry[];
}

interface MessageColumn {
  id: string;
  label: string;
  promptText: string;
  startTimestamp: string;
  sliceIndex: number;
  startMs: number;
  endMs: number;
  tracks: ColumnTrack[];
  promptSlice?: PromptSlice;
}

interface ColumnLayout {
  column: MessageColumn;
  x: number;
  width: number;
  height: number;
  trackXById: Map<string, number>;
  eventYById: Map<string, number>;
  pxPerSec: number;
}

type EventFlowNodeData = {
  variant: "event";
  lane: RunTraceLane;
  node: RunTraceNode;
  severity: TelemetrySeverity;
  contextOnly: boolean;
};

type MessageHeaderNodeData = {
  variant: "message-header";
  column: MessageColumn;
  width: number;
  focused: boolean;
};

type FlowNodeData = EventFlowNodeData | MessageHeaderNodeData;

type FlowNode = Node<FlowNodeData, "event" | "messageHeader">;

const COLUMN_HEADER_HEIGHT = 96;
const COLUMN_HEADER_GAP = 28;
const TRACK_WIDTH = 280;
const TRACK_GAP = 28;
const COLUMN_GAP = 96;
const MIN_EVENT_GAP = 18;
const ESTIMATED_CARD_HEIGHT = 118;
const MIN_COL_HEIGHT = 420;
const MAX_COL_HEIGHT = 1800;
const IDEAL_PX_PER_SEC = 8;
const PRE_PROMPT_COLUMN_ID = "pre-prompt";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
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

function getNodeSeverity(node: RunTraceNode): TelemetrySeverity {
  if (node.status === "failed" || node.category === "failure_or_anomaly") return "error";
  if (node.category === "safety_or_policy") return "warning";
  return "info";
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

function getLaneAccent(laneKind: RunTraceLaneKind): string {
  switch (laneKind) {
    case "main":
      return "before:bg-primary/70";
    case "teammate":
      return "before:bg-blue-500/70";
    case "subagent":
    default:
      return "before:bg-emerald-500/60";
  }
}

function getLaneIcon(laneKind: RunTraceLaneKind) {
  switch (laneKind) {
    case "subagent":
      return Bot;
    case "teammate":
      return GitBranch;
    case "main":
    default:
      return Terminal;
  }
}

function getCategoryClasses(category: RunTraceCategory): string {
  switch (category) {
    case "failure_or_anomaly":
      return "border-destructive/45 bg-destructive/10 text-destructive";
    case "safety_or_policy":
      return "border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300";
    case "significant_side_effect":
      return "border-primary/40 bg-primary/10 text-primary";
    case "inspection_only":
      return "border-muted-foreground/25 bg-muted/80 text-muted-foreground";
    case "reasoning_or_coordination":
    default:
      return "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
}

function getTrackColor(laneKind: RunTraceLaneKind): string {
  switch (laneKind) {
    case "main":
      return "hsl(var(--primary) / 0.55)";
    case "teammate":
      return "hsl(215 75% 55% / 0.55)";
    case "subagent":
    default:
      return "hsl(150 60% 45% / 0.55)";
  }
}

function matchesNodeFilters(
  node: RunTraceNode,
  lane: RunTraceLane,
  filters: RunTraceNodeFilters,
): boolean {
  if (
    filters.excludeSuccessfulBash &&
    node.kind === "tool" &&
    node.tool_names.includes("Bash") &&
    node.category !== "failure_or_anomaly"
  ) {
    return false;
  }

  if (filters.excludeInspectionOnly && node.category === "inspection_only") {
    return false;
  }

  if (filters.lane !== "all" && lane.kind !== filters.lane) return false;
  if (filters.severity !== "all" && getNodeSeverity(node) !== filters.severity) return false;
  if (filters.category !== "all" && node.category !== filters.category) return false;
  if (filters.kind !== "all" && node.kind !== filters.kind) return false;
  if (filters.tool !== "all" && !node.tool_names.includes(filters.tool)) return false;

  const normalizedQuery = filters.query.trim().toLowerCase();
  if (!normalizedQuery) return true;

  return [node.title, node.subtitle, lane.label, lane.kind, ...node.tool_names, ...node.task_ids]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(normalizedQuery));
}

function buildVisibleLanes(model: RunTraceModel, filters: RunTraceNodeFilters) {
  const mainLane = model.lanes.find((lane) => lane.kind === "main");
  const contextNodeIds = new Set<string>();
  const matchedNodeIds = new Set<string>();
  const visibleAuxiliaryLanes: VisibleLane[] = [];

  for (const lane of model.lanes) {
    if (lane.kind === "main") continue;

    const matchingNodes = lane.nodes.filter((node) => matchesNodeFilters(node, lane, filters));
    if (matchingNodes.length === 0) continue;

    visibleAuxiliaryLanes.push({
      lane,
      nodes: matchingNodes.map((node) => ({ node, contextOnly: false })),
    });

    for (const node of matchingNodes) {
      matchedNodeIds.add(node.id);
    }

    if (lane.branch_summary_node_id) {
      contextNodeIds.add(lane.branch_summary_node_id);
    }
  }

  let visibleMainLane: VisibleLane | null = null;
  if (mainLane) {
    const visibleNodes = mainLane.nodes
      .filter((node) => matchesNodeFilters(node, mainLane, filters) || contextNodeIds.has(node.id))
      .map((node) => {
        const contextOnly = !matchesNodeFilters(node, mainLane, filters) && contextNodeIds.has(node.id);
        if (!contextOnly) {
          matchedNodeIds.add(node.id);
        }
        return { node, contextOnly };
      });

    if (visibleNodes.length > 0) {
      visibleMainLane = {
        lane: mainLane,
        nodes: visibleNodes,
      };
    }
  }

  const visibleLanes = [
    ...(visibleMainLane ? [visibleMainLane] : []),
    ...visibleAuxiliaryLanes.sort((left, right) =>
      left.lane.start_timestamp.localeCompare(right.lane.start_timestamp),
    ),
  ];

  return {
    visibleLanes,
    matchedNodeCount: matchedNodeIds.size,
    visibleNodeIds: visibleLanes.flatMap((lane) => lane.nodes.map((entry) => entry.node.id)),
  };
}

function buildMessageColumns(
  model: RunTraceModel,
  visibleLanes: VisibleLane[],
): MessageColumn[] {
  type ColumnDraft = Omit<MessageColumn, "tracks" | "startMs" | "endMs"> & {
    tracks: Map<string, ColumnTrack>;
  };

  const drafts = new Map<string, ColumnDraft>();

  model.prompt_slices.forEach((slice, index) => {
    drafts.set(slice.id, {
      id: slice.id,
      label: `Msg ${index + 1}`,
      promptText: slice.prompt,
      startTimestamp: slice.start_timestamp,
      sliceIndex: index,
      promptSlice: slice,
      tracks: new Map(),
    });
  });

  drafts.set(PRE_PROMPT_COLUMN_ID, {
    id: PRE_PROMPT_COLUMN_ID,
    label: "Session start",
    promptText: "Session-level events before the first user message",
    startTimestamp: model.summary.first_timestamp,
    sliceIndex: -1,
    tracks: new Map(),
  });

  for (const visibleLane of visibleLanes) {
    const lane = visibleLane.lane;
    for (const entry of visibleLane.nodes) {
      const rawSliceId = entry.node.prompt_slice_id ?? PRE_PROMPT_COLUMN_ID;
      const draft = drafts.get(rawSliceId) ?? drafts.get(PRE_PROMPT_COLUMN_ID)!;

      let track = draft.tracks.get(lane.id);
      if (!track) {
        track = {
          lane,
          isMain: lane.kind === "main",
          events: [],
        };
        draft.tracks.set(lane.id, track);
      }
      track.events.push(entry);
    }
  }

  const columns: MessageColumn[] = [];

  for (const draft of drafts.values()) {
    if (draft.tracks.size === 0) continue;

    const tracks = Array.from(draft.tracks.values());

    for (const track of tracks) {
      track.events.sort((left, right) =>
        left.node.start_timestamp.localeCompare(right.node.start_timestamp),
      );
    }

    let startMs = Number.POSITIVE_INFINITY;
    let endMs = Number.NEGATIVE_INFINITY;
    for (const track of tracks) {
      for (const entry of track.events) {
        const eventStart = new Date(entry.node.start_timestamp).getTime();
        const eventEnd = eventStart + Math.max(0, entry.node.duration_ms);
        if (eventStart < startMs) startMs = eventStart;
        if (eventEnd > endMs) endMs = eventEnd;
      }
    }
    if (!Number.isFinite(startMs)) startMs = new Date(draft.startTimestamp).getTime();
    if (!Number.isFinite(endMs)) endMs = startMs;

    tracks.sort((left, right) => {
      if (left.isMain && !right.isMain) return -1;
      if (!left.isMain && right.isMain) return 1;
      const leftStart = left.events[0]
        ? new Date(left.events[0].node.start_timestamp).getTime()
        : 0;
      const rightStart = right.events[0]
        ? new Date(right.events[0].node.start_timestamp).getTime()
        : 0;
      return leftStart - rightStart;
    });

    columns.push({
      id: draft.id,
      label: draft.label,
      promptText: draft.promptText,
      startTimestamp: draft.startTimestamp,
      sliceIndex: draft.sliceIndex,
      promptSlice: draft.promptSlice,
      startMs,
      endMs,
      tracks,
    });
  }

  columns.sort((left, right) => left.sliceIndex - right.sliceIndex);
  return columns;
}

function layoutColumns(columns: MessageColumn[]): ColumnLayout[] {
  const layouts: ColumnLayout[] = [];
  let currentX = 0;

  for (const column of columns) {
    const numTracks = column.tracks.length;
    const width = numTracks * TRACK_WIDTH + Math.max(0, numTracks - 1) * TRACK_GAP;

    const trackXById = new Map<string, number>();
    column.tracks.forEach((track, index) => {
      trackXById.set(track.lane.id, currentX + index * (TRACK_WIDTH + TRACK_GAP));
    });

    const durationSec = Math.max(1, (column.endMs - column.startMs) / 1000);
    const targetHeight = clamp(durationSec * IDEAL_PX_PER_SEC, MIN_COL_HEIGHT, MAX_COL_HEIGHT);
    const pxPerSec = targetHeight / durationSec;

    const eventYById = new Map<string, number>();
    const baseY = COLUMN_HEADER_HEIGHT + COLUMN_HEADER_GAP;

    let maxBottom = baseY;
    for (const track of column.tracks) {
      let prevBottom = -Infinity;
      for (const entry of track.events) {
        const startMs = new Date(entry.node.start_timestamp).getTime();
        const proportionalY = baseY + ((startMs - column.startMs) / 1000) * pxPerSec;
        const y = Math.max(proportionalY, prevBottom + MIN_EVENT_GAP);
        eventYById.set(entry.node.id, y);
        prevBottom = y + ESTIMATED_CARD_HEIGHT;
        if (prevBottom > maxBottom) maxBottom = prevBottom;
      }
    }

    const height = Math.max(MIN_COL_HEIGHT, maxBottom - baseY + COLUMN_HEADER_HEIGHT);

    layouts.push({
      column,
      x: currentX,
      width,
      height,
      trackXById,
      eventYById,
      pxPerSec,
    });

    currentX += width + COLUMN_GAP;
  }

  return layouts;
}

function buildFlowElements(
  layouts: ColumnLayout[],
  selectedNodeId?: string,
  focusedPromptSliceId?: string,
) {
  const nodes: FlowNode[] = [];
  const edges: Edge[] = [];

  for (const layout of layouts) {
    const { column } = layout;

    nodes.push({
      id: `header:${column.id}`,
      type: "messageHeader",
      position: { x: layout.x, y: 0 },
      data: {
        variant: "message-header",
        column,
        width: layout.width,
        focused: focusedPromptSliceId === column.id,
      },
      draggable: false,
      selectable: false,
      focusable: false,
      style: { width: layout.width },
    });

    for (const track of column.tracks) {
      const trackX = layout.trackXById.get(track.lane.id)!;

      track.events.forEach((entry, eventIndex) => {
        const y = layout.eventYById.get(entry.node.id)!;
        nodes.push({
          id: entry.node.id,
          type: "event",
          position: { x: trackX, y },
          data: {
            variant: "event",
            lane: track.lane,
            node: entry.node,
            severity: getNodeSeverity(entry.node),
            contextOnly: entry.contextOnly,
          },
          draggable: false,
          selectable: true,
          selected: entry.node.id === selectedNodeId,
          style: { width: TRACK_WIDTH },
        });

        if (eventIndex > 0) {
          const prev = track.events[eventIndex - 1]!.node;
          edges.push({
            id: `seq:${track.lane.id}:${prev.id}:${entry.node.id}`,
            source: prev.id,
            sourceHandle: "bottom",
            target: entry.node.id,
            targetHandle: "top",
            type: "straight",
            style: {
              stroke: getTrackColor(track.lane.kind),
              strokeWidth: track.isMain ? 2.6 : 1.8,
              strokeDasharray: track.isMain ? undefined : "8 6",
            },
            selectable: false,
            focusable: false,
          });
        }
      });

      const branchSummaryNodeId = track.lane.branch_summary_node_id;
      if (!track.isMain && branchSummaryNodeId && track.events.length > 0) {
        const parentInColumn = column.tracks
          .flatMap((other) => other.events)
          .some((other) => other.node.id === branchSummaryNodeId);
        if (parentInColumn) {
          const firstEvent = track.events[0]!.node;
          edges.push({
            id: `fork:${track.lane.id}:${firstEvent.id}`,
            source: branchSummaryNodeId,
            sourceHandle: "fork-out",
            target: firstEvent.id,
            targetHandle: "top",
            type: "step",
            style: {
              stroke: getTrackColor(track.lane.kind),
              strokeWidth: 2.2,
              strokeDasharray: track.lane.kind === "teammate" ? "10 6" : "6 6",
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: getTrackColor(track.lane.kind),
              width: 16,
              height: 16,
            },
            selectable: false,
            focusable: false,
          });
        }
      }
    }
  }

  return { nodes, edges };
}

function MessageHeaderNode({ data }: NodeProps<FlowNode>) {
  if (data.variant !== "message-header") return null;
  const { column } = data;
  const isPrePrompt = column.id === PRE_PROMPT_COLUMN_ID;
  const totalEvents = column.tracks.reduce((sum, track) => sum + track.events.length, 0);
  const trackCount = column.tracks.length;

  return (
    <div
      className={cn(
        "rounded-2xl border bg-background/95 px-4 py-3 shadow-md backdrop-blur transition-[border-color,box-shadow]",
        isPrePrompt ? "border-muted-foreground/30" : "border-primary/35",
        data.focused && "border-primary ring-2 ring-primary/40",
      )}
      style={{ width: data.width }}
    >
      <div className="flex items-center gap-2">
        <div
          className={cn(
            "rounded-full border bg-muted p-1.5",
            isPrePrompt ? "text-muted-foreground" : "text-primary",
          )}
        >
          <MessageSquareText className="h-3.5 w-3.5" />
        </div>
        <Badge variant={isPrePrompt ? "outline" : "secondary"} className="text-[10px]">
          {column.label}
        </Badge>
        <span className="text-[11px] text-muted-foreground">{formatTime(column.startTimestamp)}</span>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {formatDurationCompact(Math.max(0, Math.round((column.endMs - column.startMs) / 1000)))}
        </span>
      </div>
      <p className="mt-2 line-clamp-2 text-xs text-foreground/90">{column.promptText || "—"}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        <Badge variant="outline" className="text-[10px]">
          {totalEvents} event{totalEvents === 1 ? "" : "s"}
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          {trackCount} track{trackCount === 1 ? "" : "s"}
        </Badge>
      </div>
    </div>
  );
}

function EventNode({ data, selected }: NodeProps<FlowNode>) {
  if (data.variant !== "event") return null;

  const { lane, node, contextOnly, severity } = data;
  const Icon = getNodeIcon(node);
  const LaneIcon = getLaneIcon(lane.kind);

  return (
    <div
      className={cn(
        "relative rounded-2xl border px-4 py-3 shadow-lg backdrop-blur transition-all",
        "before:absolute before:left-0 before:top-3 before:bottom-3 before:w-1 before:rounded-full",
        getCategoryClasses(node.category),
        getLaneAccent(lane.kind),
        selected && "ring-2 ring-primary ring-offset-2",
        contextOnly && "opacity-70 saturate-75",
      )}
    >
      <Handle
        id="top"
        type="target"
        position={Position.Top}
        className="!h-2 !w-2 !border-0 !bg-transparent !opacity-0"
      />
      <Handle
        id="bottom"
        type="source"
        position={Position.Bottom}
        className="!h-2 !w-2 !border-0 !bg-transparent !opacity-0"
      />
      <Handle
        id="fork-out"
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-0 !bg-transparent !opacity-0"
      />
      <div className="flex items-start gap-3 pl-2">
        <div className="mt-0.5 rounded-full border bg-background/80 p-2 shadow-sm">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold">{node.title}</p>
            <Badge variant={getSeverityVariant(severity)} className="text-[10px]">
              {severity}
            </Badge>
            {contextOnly && (
              <Badge variant="outline" className="text-[10px]">
                context
              </Badge>
            )}
          </div>
          {node.subtitle && <p className="mt-1 line-clamp-2 text-xs opacity-80">{node.subtitle}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-1 text-[11px] opacity-80">
            <span className="inline-flex items-center gap-1">
              <LaneIcon className="h-3 w-3" />
              {lane.label}
            </span>
            <span>•</span>
            <span>{formatTime(node.start_timestamp)}</span>
            <span>•</span>
            <span>{formatDurationCompact(Math.max(0, Math.round(node.duration_ms / 1000)))}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            <Badge variant="outline" className="text-[10px]">
              {node.kind}
            </Badge>
            {node.tool_names.slice(0, 2).map((toolName) => (
              <Badge key={`${node.id}:${toolName}`} variant="secondary" className="text-[10px]">
                {toolName}
              </Badge>
            ))}
            {node.task_ids.slice(0, 1).map((taskId) => (
              <Badge key={`${node.id}:${taskId}`} variant="outline" className="max-w-[140px] truncate text-[10px]">
                {taskId}
              </Badge>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const nodeTypes = {
  event: EventNode,
  messageHeader: MessageHeaderNode,
} satisfies NodeTypes;

export function RunTraceFlow({
  model,
  selectedNodeId,
  onSelectNode,
  onVisibleNodeIdsChange,
  filters,
  focusedPromptSliceId,
}: RunTraceFlowProps) {
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<FlowNode, Edge> | null>(null);
  const { visibleLanes, matchedNodeCount, visibleNodeIds } = useMemo(
    () => buildVisibleLanes(model, filters),
    [filters, model],
  );

  const columns = useMemo(
    () => buildMessageColumns(model, visibleLanes),
    [model, visibleLanes],
  );

  const layouts = useMemo(() => layoutColumns(columns), [columns]);

  const { nodes, edges } = useMemo(
    () => buildFlowElements(layouts, selectedNodeId, focusedPromptSliceId),
    [layouts, selectedNodeId, focusedPromptSliceId],
  );

  useEffect(() => {
    onVisibleNodeIdsChange?.(visibleNodeIds);
  }, [onVisibleNodeIdsChange, visibleNodeIds]);

  useEffect(() => {
    if (!reactFlowInstance || nodes.length === 0) return;

    const focusLayout = focusedPromptSliceId
      ? layouts.find((entry) => entry.column.id === focusedPromptSliceId)
      : undefined;

    const frame = window.requestAnimationFrame(() => {
      if (focusLayout) {
        reactFlowInstance.fitBounds(
          {
            x: focusLayout.x,
            y: 0,
            width: focusLayout.width,
            height: focusLayout.height,
          },
          { padding: 0.18, duration: 320 },
        );
        return;
      }
      reactFlowInstance.fitView({
        padding: 0.16,
        duration: 280,
        minZoom: 0.2,
        maxZoom: 1.25,
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [edges.length, nodes.length, reactFlowInstance, model.session_id, focusedPromptSliceId, filters, layouts]);

  if (matchedNodeCount === 0 || nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-2xl border border-dashed bg-muted/10 px-6 text-center">
        <div className="max-w-md space-y-2">
          <p className="text-base font-medium">No nodes match the current filters.</p>
          <p className="text-sm text-muted-foreground">
            Adjust severity, lane, tool, or text filters to bring nodes back into view.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full rounded-2xl border bg-background/70 shadow-sm">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodeOrigin={[0, 0]}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        panOnDrag
        panOnScroll
        panOnScrollMode={PanOnScrollMode.Free}
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        zoomOnPinch
        selectionOnDrag={false}
        fitView
        minZoom={0.2}
        maxZoom={1.5}
        onInit={setReactFlowInstance}
        onPaneClick={() => onSelectNode(undefined)}
        onNodeClick={(_event, node) => {
          if (node.data?.variant !== "event") return;
          onSelectNode(node.id);
        }}
        className="bg-[radial-gradient(circle_at_top,_hsl(var(--muted))_0%,_transparent_55%)]"
      >
        <Background gap={28} size={1} color="hsl(var(--border))" />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  );
}
