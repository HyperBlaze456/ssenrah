import { useEffect, useMemo } from "react";
import type { SessionSummary } from "@/types";
import { useMonitorStore } from "@/lib/store/monitor";
import { Select } from "@/components/ui/select";
import { getSessionSeverity, formatSeverityLabel } from "@/lib/monitor-utils";
import { cn } from "@/lib/utils";

interface SessionPickerProps {
  sessions: SessionSummary[];
  className?: string;
  label?: string;
  selectClassName?: string;
}

function formatSessionId(sessionId: string): string {
  return `${sessionId.slice(0, 8)}…${sessionId.slice(-4)}`;
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

export function SessionPicker({
  sessions,
  className,
  label = "Session",
  selectClassName,
}: SessionPickerProps) {
  const activeSessionId = useMonitorStore((state) => state.activeSessionId);
  const setActiveSessionId = useMonitorStore((state) => state.setActiveSessionId);

  const orderedSessions = useMemo(
    () =>
      [...sessions].sort(
        (left, right) =>
          new Date(right.last_event).getTime() - new Date(left.last_event).getTime(),
      ),
    [sessions],
  );

  const fallbackSessionId = orderedSessions[0]?.session_id;
  const resolvedSessionId =
    activeSessionId && orderedSessions.some((session) => session.session_id === activeSessionId)
      ? activeSessionId
      : fallbackSessionId;

  // Auto-pin to the latest session if nothing is selected, or if the previously
  // selected one no longer exists. This way panels never need to handle the
  // "no session" edge case.
  useEffect(() => {
    if (!resolvedSessionId) return;
    if (resolvedSessionId !== activeSessionId) {
      setActiveSessionId(resolvedSessionId);
    }
  }, [activeSessionId, resolvedSessionId, setActiveSessionId]);

  if (orderedSessions.length === 0) {
    return null;
  }

  return (
    <div className={cn("space-y-1", className)}>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Select
        value={resolvedSessionId ?? ""}
        onChange={(event) => setActiveSessionId(event.target.value || null)}
        className={cn("min-w-[260px]", selectClassName)}
      >
        {orderedSessions.map((session) => {
          const severity = getSessionSeverity(session);
          return (
            <option key={session.session_id} value={session.session_id}>
              {formatSessionId(session.session_id)} · {formatTime(session.last_event)} ·{" "}
              {formatSeverityLabel(severity)}
            </option>
          );
        })}
      </Select>
    </div>
  );
}
