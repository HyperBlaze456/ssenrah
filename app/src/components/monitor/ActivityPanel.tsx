import { useEffect } from "react";
import { useMonitorStore } from "@/lib/store/monitor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

function getEventColor(type: string): string {
  if (type.includes("Failure") || type.includes("error")) return "destructive";
  if (type === "_escalation") return "destructive";
  if (type.includes("Start")) return "default";
  if (type.includes("Stop") || type.includes("End")) return "secondary";
  return "outline";
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function EventDetail({ event }: { event: { hook_event_type: string; tool_name?: string; agent_type?: string; task_subject?: string; notification_type?: string; message?: string; error?: string; reason?: string; source?: string } }) {
  if (event.tool_name) return <span className="text-muted-foreground">{event.tool_name}</span>;
  if (event.agent_type) return <span className="text-muted-foreground">{event.agent_type}</span>;
  if (event.task_subject) return <span className="text-muted-foreground truncate max-w-[200px] inline-block align-bottom">{event.task_subject}</span>;
  if (event.error) return <span className="text-destructive truncate max-w-[200px] inline-block align-bottom">{event.error}</span>;
  if (event.notification_type) return <span className="text-muted-foreground">{event.notification_type}</span>;
  if (event.message) return <span className="text-muted-foreground truncate max-w-[200px] inline-block align-bottom">{event.message}</span>;
  if (event.reason) return <span className="text-muted-foreground">{event.reason}</span>;
  if (event.source) return <span className="text-muted-foreground">{event.source}</span>;
  return null;
}

export function ActivityPanel() {
  const events = useMonitorStore((s) => s.events);
  const loading = useMonitorStore((s) => s.loading);
  const error = useMonitorStore((s) => s.error);
  const summary = useMonitorStore((s) => s.getSummary());
  const startAutoRefresh = useMonitorStore((s) => s.startAutoRefresh);
  const stopAutoRefresh = useMonitorStore((s) => s.stopAutoRefresh);

  useEffect(() => {
    startAutoRefresh(3000);
    return () => stopAutoRefresh();
  }, [startAutoRefresh, stopAutoRefresh]);

  if (error) {
    return (
      <div className="p-4 text-destructive">
        <AlertCircle className="inline h-4 w-4 mr-2" />
        Failed to load events: {error}
      </div>
    );
  }

  const recentEvents = events.slice(-50).reverse();

  return (
    <div className="space-y-6">
      {/* Summary cards */}
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
              Tool Uses
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.tool_uses}</div>
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

      {/* Top tools */}
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

      {/* Event feed */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Recent Events
              {loading && (
                <span className="text-xs text-muted-foreground animate-pulse">
                  updating...
                </span>
              )}
            </CardTitle>
            <span className="text-xs text-muted-foreground">
              Showing last {recentEvents.length}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          {recentEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No events recorded yet. Start a Claude Code session with ssenrah
              hooks installed.
            </p>
          ) : (
            <div className="space-y-1">
              {recentEvents.map((event) => {
                const Icon = getEventIcon(event.hook_event_type);
                return (
                  <div
                    key={event.id}
                    className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50 transition-colors"
                  >
                    <span className="text-xs text-muted-foreground font-mono w-[70px] shrink-0">
                      {formatTime(event.timestamp)}
                    </span>
                    <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <Badge
                      variant={getEventColor(event.hook_event_type) as "default" | "secondary" | "destructive" | "outline"}
                      className="text-[10px] px-1.5 py-0 shrink-0"
                    >
                      {event.hook_event_type}
                    </Badge>
                    <EventDetail event={event} />
                    <span className="ml-auto text-[10px] text-muted-foreground font-mono shrink-0">
                      {event.session_id.slice(0, 8)}
                    </span>
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
