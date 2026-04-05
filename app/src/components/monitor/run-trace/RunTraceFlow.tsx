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
  Shield,
  Sparkles,
  Terminal,
  User,
  Wrench,
} from "lucide-react";
import {
  formatDurationCompact,
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
}

interface VisibleNodeEntry {
  node: RunTraceNode;
  contextOnly: boolean;
}

interface VisibleLane {
  lane: RunTraceLane;
  nodes: VisibleNodeEntry[];
}

type LaneLabelNodeData = {
  variant: "lane-label";
  lane: RunTraceLane;
  visibleCount: number;
};

type EventFlowNodeData = {
  variant: "event";
  lane: RunTraceLane;
  node: RunTraceNode;
  severity: TelemetrySeverity;
  contextOnly: boolean;
};

type FlowNodeData = LaneLabelNodeData | EventFlowNodeData;

type FlowNode = Node<FlowNodeData, "laneLabel" | "event">;

const LANE_LABEL_X = 32;
const LANE_NODE_START_X = 310;
const MIN_TIMELINE_WIDTH = 2200;
const LANE_HEIGHT = 220;
const LANE_VERTICAL_START = 110;
const NODE_GAP = 84;

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

function getNodeWidth(node: RunTraceNode): number {
  switch (node.kind) {
    case "prompt":
      return 300;
    case "task":
      return 260;
    case "session":
      return 220;
    case "agent":
      return 240;
    case "failure":
      return 250;
    case "policy":
      return 240;
    case "inspection_block":
      return 230;
    case "tool":
    case "event":
    default:
      return 250;
  }
}

function getTrackColor(laneKind: RunTraceLaneKind): string {
  switch (laneKind) {
    case "main":
      return "hsl(var(--primary) / 0.48)";
    case "teammate":
      return "hsl(215 75% 55% / 0.45)";
    case "subagent":
    default:
      return "hsl(var(--border))";
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

function buildFlowElements(model: RunTraceModel, visibleLanes: VisibleLane[], selectedNodeId?: string) {
  const startMs = new Date(model.summary.first_timestamp).getTime();
  const endMs = new Date(model.summary.last_timestamp).getTime();
  const durationMs = Math.max(1, endMs - startMs);
  const maxNodeCount = Math.max(1, ...visibleLanes.map((lane) => lane.nodes.length));
  const timelineWidth = Math.max(MIN_TIMELINE_WIDTH, maxNodeCount * 320);

  const nodes: FlowNode[] = [];
  const edges: Edge[] = [];

  for (const [laneIndex, visibleLane] of visibleLanes.entries()) {
    const { lane } = visibleLane;
    const y = LANE_VERTICAL_START + laneIndex * LANE_HEIGHT;
    const labelNodeId = `${lane.id}:label`;

    nodes.push({
      id: labelNodeId,
      type: "laneLabel",
      position: { x: LANE_LABEL_X, y },
      data: {
        variant: "lane-label",
        lane,
        visibleCount: visibleLane.nodes.length,
      },
      draggable: false,
      selectable: false,
      focusable: false,
      sourcePosition: Position.Right,
    });

    let nextLeft = LANE_NODE_START_X;
    const orderedNodes = [...visibleLane.nodes].sort((left, right) =>
      left.node.start_timestamp.localeCompare(right.node.start_timestamp),
    );

    orderedNodes.forEach(({ node, contextOnly }) => {
      const width = getNodeWidth(node);
      const centerMs = new Date(node.start_timestamp).getTime() + node.duration_ms / 2;
      const leftPct = (centerMs - startMs) / durationMs;
      const idealLeft = LANE_NODE_START_X + leftPct * timelineWidth - width / 2;
      const left = Math.max(LANE_NODE_START_X, Math.max(idealLeft, nextLeft));
      nextLeft = left + width + NODE_GAP;

      nodes.push({
        id: node.id,
        type: "event",
        position: { x: left, y },
        data: {
          variant: "event",
          lane,
          node,
          severity: getNodeSeverity(node),
          contextOnly,
        },
        draggable: false,
        selectable: true,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        selected: node.id === selectedNodeId,
        style: {
          width,
        },
      });
    });

    if (orderedNodes.length === 0) {
      continue;
    }

    edges.push({
      id: `${lane.id}:lane-start`,
      source: labelNodeId,
      target: orderedNodes[0]!.node.id,
      type: "straight",
      style: {
        stroke: getTrackColor(lane.kind),
        strokeWidth: lane.kind === "main" ? 2.8 : 1.8,
        strokeDasharray: lane.kind === "main" ? undefined : "8 6",
      },
      selectable: false,
      focusable: false,
    });

    for (let index = 0; index < orderedNodes.length - 1; index += 1) {
      const current = orderedNodes[index]!.node;
      const next = orderedNodes[index + 1]!.node;
      edges.push({
        id: `${lane.id}:track:${current.id}:${next.id}`,
        source: current.id,
        target: next.id,
        type: "straight",
        style: {
          stroke: getTrackColor(lane.kind),
          strokeWidth: lane.kind === "main" ? 2.8 : 1.8,
          strokeDasharray: lane.kind === "main" ? undefined : "8 6",
        },
        selectable: false,
        focusable: false,
      });
    }

    if (lane.parent_lane_id && lane.branch_summary_node_id) {
      edges.push({
        id: `${lane.id}:branch`,
        source: lane.branch_summary_node_id,
        target: orderedNodes[0]!.node.id,
        type: "smoothstep",
        style: {
          stroke: "hsl(var(--primary) / 0.48)",
          strokeWidth: 2.2,
          strokeDasharray: lane.kind === "teammate" ? "10 8" : undefined,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: "hsl(var(--primary) / 0.48)",
          width: 16,
          height: 16,
        },
        selectable: false,
        focusable: false,
      });
    }
  }

  return { nodes, edges };
}

function LaneLabelNode({ data }: NodeProps<FlowNode>) {
  if (data.variant !== "lane-label") return null;

  const Icon = getLaneIcon(data.lane);
  return (
    <div
      className={cn(
        "w-[220px] rounded-2xl border bg-background/95 px-4 py-3 shadow-sm backdrop-blur",
        data.lane.kind === "main" ? "border-primary/35" : "border-border",
      )}
    >
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-0 !bg-transparent !opacity-0"
      />
      <div className="flex items-start gap-3">
        <div className="rounded-full border bg-muted p-2 text-muted-foreground shadow-sm">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-foreground">{data.lane.label}</p>
            <Badge variant={data.lane.kind === "main" ? "secondary" : "outline"} className="text-[10px]">
              {data.lane.kind}
            </Badge>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {data.visibleCount} visible node{data.visibleCount === 1 ? "" : "s"} · {data.lane.event_count} events
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {data.lane.failure_count > 0 && (
              <Badge variant="destructive" className="text-[10px]">
                {data.lane.failure_count} failure{data.lane.failure_count === 1 ? "" : "s"}
              </Badge>
            )}
            {data.lane.inspection_event_count > 0 && (
              <Badge variant="outline" className="text-[10px]">
                {data.lane.inspection_event_count} inspection
              </Badge>
            )}
            <Badge variant="secondary" className="text-[10px]">
              {formatDurationCompact(Math.round(data.lane.duration_ms / 1000))}
            </Badge>
          </div>
        </div>
      </div>
    </div>
  );
}

function EventNode({ data, selected }: NodeProps<FlowNode>) {
  if (data.variant !== "event") return null;

  const { lane, node, contextOnly, severity } = data;
  const Icon = getNodeIcon(node);

  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-3 shadow-lg backdrop-blur transition-all",
        getCategoryClasses(node.category),
        selected && "ring-2 ring-primary ring-offset-2",
        contextOnly && "opacity-70 saturate-75",
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-0 !bg-transparent !opacity-0"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-0 !bg-transparent !opacity-0"
      />
      <div className="flex items-start gap-3">
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
            <span>{lane.label}</span>
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
  laneLabel: LaneLabelNode,
  event: EventNode,
} satisfies NodeTypes;

export function RunTraceFlow({
  model,
  selectedNodeId,
  onSelectNode,
  onVisibleNodeIdsChange,
  filters,
}: RunTraceFlowProps) {
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<FlowNode, Edge> | null>(null);
  const { visibleLanes, matchedNodeCount, visibleNodeIds } = useMemo(
    () => buildVisibleLanes(model, filters),
    [filters, model],
  );
  const { nodes, edges } = useMemo(
    () => buildFlowElements(model, visibleLanes, selectedNodeId),
    [model, selectedNodeId, visibleLanes],
  );

  useEffect(() => {
    onVisibleNodeIdsChange?.(visibleNodeIds);
  }, [onVisibleNodeIdsChange, visibleNodeIds]);

  useEffect(() => {
    if (!reactFlowInstance || nodes.length === 0) return;

    const frame = window.requestAnimationFrame(() => {
      reactFlowInstance.fitView({
        padding: 0.16,
        duration: 280,
        minZoom: 0.2,
        maxZoom: 1.25,
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [edges.length, nodes.length, reactFlowInstance, model.session_id, model.selected_prompt_slice_id, filters]);

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
        nodeOrigin={[0, 0.5]}
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
