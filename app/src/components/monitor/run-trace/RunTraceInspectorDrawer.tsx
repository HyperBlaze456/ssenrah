import { useEffect, useMemo, useState } from "react";
import { PanelRightClose } from "lucide-react";
import {
  buildRunTraceInspector,
  formatDurationCompact,
  readDecisionChain,
  type DecisionChain,
  type RunTraceModel,
  type TelemetrySeverity,
} from "@/lib/telemetry";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface RunTraceInspectorDrawerProps {
  model: RunTraceModel;
  selectedNodeId?: string;
  onClose: () => void;
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

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2 border-b pb-5 last:border-b-0 last:pb-0">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

export function RunTraceInspectorDrawer({
  model,
  selectedNodeId,
  onClose,
}: RunTraceInspectorDrawerProps) {
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

  return (
    <aside
      className={cn(
        "absolute inset-y-0 right-0 z-30 w-[420px] border-l bg-background/95 shadow-2xl backdrop-blur transition-transform duration-200",
        inspector ? "translate-x-0" : "translate-x-full pointer-events-none",
      )}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Node details
            </p>
            <h2 className="mt-1 truncate text-lg font-semibold">
              {inspector?.node.title ?? "Inspector"}
            </h2>
            {inspector?.node.subtitle && (
              <p className="mt-1 text-sm text-muted-foreground">{inspector.node.subtitle}</p>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close node details">
            <PanelRightClose className="h-4 w-4" />
          </Button>
        </div>

        {!inspector ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
            Click a node to open the right-hand detail drawer.
          </div>
        ) : (
          <ScrollArea className="flex-1 px-5 py-4">
            <div className="space-y-5 pb-6 text-sm">
              <Section title="Overview">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{inspector.lane.kind}</Badge>
                  <Badge variant="outline">{inspector.node.kind}</Badge>
                  <Badge variant={inspector.node.status === "failed" ? "destructive" : "outline"}>
                    {inspector.node.status}
                  </Badge>
                </div>
                <div className="grid gap-2 rounded-xl border bg-muted/15 p-3 text-xs text-muted-foreground">
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
                    <span>Tools</span>
                    <span className="text-right font-medium text-foreground">
                      {inspector.node.tool_names.length > 0 ? inspector.node.tool_names.join(", ") : "n/a"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Models</span>
                    <span className="text-right font-medium text-foreground">
                      {inspector.models_used.length > 0 ? inspector.models_used.join(", ") : "n/a"}
                    </span>
                  </div>
                </div>
              </Section>

              <Section title="Ownership">
                <div className="rounded-xl border bg-muted/15 p-3 text-xs text-muted-foreground">
                  <p>
                    Actor <span className="font-medium text-foreground">{inspector.ownership.actor_label}</span>
                    <span className="font-medium text-foreground"> on the {inspector.ownership.actor_kind}</span> lane.
                  </p>
                  {inspector.ownership.parent_lane_id && (
                    <p className="mt-1">Spawned from {inspector.ownership.parent_lane_id}.</p>
                  )}
                  {inspector.ownership.task_ids.length > 0 && (
                    <p className="mt-1 break-all">Tasks: {inspector.ownership.task_ids.join(", ")}</p>
                  )}
                  {inspector.prompt_slice && (
                    <p className="mt-2 text-foreground">
                      {inspector.prompt_slice.label}: {inspector.prompt_slice.prompt}
                    </p>
                  )}
                  {inspector.transcript_path && (
                    <p className="mt-2 break-all text-[11px]">Transcript: {inspector.transcript_path}</p>
                  )}
                </div>
              </Section>

              <Section title="Reasoning summary">
                <div className="rounded-xl border bg-muted/15 p-3 text-xs text-muted-foreground">
                  {loadingDecisionChain ? (
                    <p>Loading transcript-derived reasoning…</p>
                  ) : decisionChain ? (
                    <div className="space-y-3">
                      <p>
                        {decisionChain.summary.total_turns} turn{decisionChain.summary.total_turns === 1 ? "" : "s"} · {" "}
                        {decisionChain.summary.total_decisions} tool decision
                        {decisionChain.summary.total_decisions === 1 ? "" : "s"}
                      </p>
                      {decisionChain.prompts.slice(0, 2).map((prompt) => (
                        <p key={`${prompt.timestamp}:${prompt.content}`} className="rounded-lg bg-background p-2 text-foreground">
                          {prompt.content}
                        </p>
                      ))}
                      {decisionChain.steps.slice(0, 2).map((step) => (
                        <div key={`${step.timestamp}:${step.model}`} className="rounded-lg bg-background p-2 text-foreground">
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
              </Section>

              <Section title="Significant actions">
                {inspector.significant_actions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No significant actions in this selection.</p>
                ) : (
                  <div className="space-y-2">
                    {inspector.significant_actions.map((action) => (
                      <div key={action.event_id} className="rounded-xl border p-3 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={getSeverityVariant(action.severity)}>{action.severity}</Badge>
                          {action.tool_name && <Badge variant="outline">{action.tool_name}</Badge>}
                          <span className="text-muted-foreground">{formatTime(action.timestamp)}</span>
                        </div>
                        <p className="mt-2 font-medium text-foreground">{action.label}</p>
                        {action.detail && <p className="mt-1 text-muted-foreground">{action.detail}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              <Section title="Collapsed inspection activity">
                {inspector.inspection_actions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No collapsed inspection activity for this node.</p>
                ) : (
                  <div className="space-y-2">
                    {inspector.inspection_actions.map((action) => (
                      <div key={action.event_id} className="rounded-xl border bg-muted/15 p-3 text-xs text-muted-foreground">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium text-foreground">{action.label}</span>
                          <span>{formatTime(action.timestamp)}</span>
                        </div>
                        {action.detail && <p className="mt-1">{action.detail}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              <Section title="Raw event drilldown">
                <div className="space-y-2">
                  {inspector.raw_records.map((record) => (
                    <div key={record.event_id} className="rounded-xl border bg-muted/15 p-3 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={getSeverityVariant(record.severity)}>{record.hook_event_type}</Badge>
                        <span className="text-muted-foreground">{formatTime(record.timestamp)}</span>
                        <span className="text-muted-foreground">{record.operation}</span>
                      </div>
                      <p className="mt-2 font-medium text-foreground">{record.summary}</p>
                      {record.detail && <p className="mt-1 text-muted-foreground">{record.detail}</p>}
                    </div>
                  ))}
                </div>
              </Section>
            </div>
          </ScrollArea>
        )}
      </div>
    </aside>
  );
}
