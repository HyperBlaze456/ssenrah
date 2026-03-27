import { useEffect, useMemo } from "react";
import { useMonitorStore, computeSessions } from "@/lib/store/monitor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Clock, Terminal, AlertCircle, Bot, DollarSign } from "lucide-react";

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hrs}h ${remainMins}m`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
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

export function SessionsPanel() {
  const events = useMonitorStore((s) => s.events);
  const loading = useMonitorStore((s) => s.loading);
  const error = useMonitorStore((s) => s.error);
  const startAutoRefresh = useMonitorStore((s) => s.startAutoRefresh);
  const stopAutoRefresh = useMonitorStore((s) => s.stopAutoRefresh);
  const sessions = useMemo(() => computeSessions(events), [events]);

  useEffect(() => {
    startAutoRefresh(5000);
    return () => stopAutoRefresh();
  }, [startAutoRefresh, stopAutoRefresh]);

  if (error) {
    return (
      <div className="p-4 text-destructive">
        <AlertCircle className="inline h-4 w-4 mr-2" />
        Failed to load sessions: {error}
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-sm text-muted-foreground">
          No sessions recorded yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">
          {sessions.length} session{sessions.length !== 1 ? "s" : ""}
        </h3>
        {loading && (
          <span className="text-xs text-muted-foreground animate-pulse">
            refreshing...
          </span>
        )}
      </div>

      {sessions.map((session) => (
        <Card key={session.session_id}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-mono">
                {session.session_id.slice(0, 8)}
              </CardTitle>
              <span className="text-xs text-muted-foreground">
                {formatTime(session.first_event)}
              </span>
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
                      : "text-muted-foreground"
                  )}
                />
                <span className="text-muted-foreground">Errors:</span>
                <span
                  className={cn(
                    "font-medium",
                    session.errors > 0 && "text-destructive"
                  )}
                >
                  {session.errors}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Subagents:</span>
                <span className="font-medium">{session.subagents}</span>
              </div>
            </div>

            {/* Cost */}
            {session.cost_usd > 0 && (
              <div className="mt-3 flex items-center gap-2 text-sm">
                <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Est. cost:</span>
                <span className="font-medium">{formatCost(session.cost_usd)}</span>
              </div>
            )}

            {/* Top tools */}
            {session.top_tools.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {session.top_tools.map(([name, count]) => (
                  <Badge
                    key={name}
                    variant="secondary"
                    className="text-[10px] px-1.5 py-0"
                  >
                    {name}{" "}
                    <span className="ml-0.5 text-muted-foreground">
                      {count}
                    </span>
                  </Badge>
                ))}
              </div>
            )}

            <div className="mt-2 text-xs text-muted-foreground">
              {session.event_count} events total
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
