import { useEffect, useMemo } from "react";
import { useMonitorStore } from "@/lib/store/monitor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  CheckSquare,
  FileEdit,
  AlertCircle,
  TestTube,
  Clock,
} from "lucide-react";
import type { AgentEvent } from "@/types";

interface FileChange {
  file_path: string;
  action: "edit" | "write" | "read";
  timestamp: string;
}

interface CommandExecution {
  command: string;
  timestamp: string;
  is_test: boolean;
  failed: boolean;
}

interface SessionVerification {
  session_id: string;
  files_modified: string[];
  commands: CommandExecution[];
  test_runs: CommandExecution[];
  errors: Array<{ timestamp: string; tool_name?: string; error: string }>;
  summary: {
    total_events: number;
    files_edited: number;
    files_written: number;
    files_read: number;
    commands_run: number;
    tests_run: number;
    tests_failed: number;
    errors: number;
    duration_seconds: number;
  };
}

const TEST_PATTERNS = [
  /\bnpm\s+test\b/,
  /\bnpx\s+(vitest|jest|mocha|ava)\b/,
  /\bvitest\s+run\b/,
  /\bjest\b/,
  /\bpytest\b/,
  /\bcargo\s+test\b/,
  /\bgo\s+test\b/,
  /\bmake\s+test\b/,
];

function isTestCommand(command: string): boolean {
  return TEST_PATTERNS.some((p) => p.test(command));
}

function buildVerification(events: AgentEvent[], sessionId: string): SessionVerification {
  const sessionEvents = events.filter((e) => e.session_id === sessionId);

  const fileChanges: FileChange[] = [];
  const commands: CommandExecution[] = [];
  const errors: Array<{ timestamp: string; tool_name?: string; error: string }> = [];

  for (const e of sessionEvents) {
    if (e.hook_event_type === "PostToolUse" && e.tool_name) {
      const input = (e.tool_input ?? {}) as Record<string, unknown>;
      const filePath = (input.file_path as string) ?? (input.path as string);

      if (filePath && (e.tool_name === "Edit" || e.tool_name === "Write" || e.tool_name === "Read")) {
        fileChanges.push({
          file_path: filePath,
          action: e.tool_name.toLowerCase() as "edit" | "write" | "read",
          timestamp: e.timestamp,
        });
      }

      if (e.tool_name === "Bash") {
        const cmd = (input.command as string) ?? "";
        if (cmd) {
          commands.push({ command: cmd, timestamp: e.timestamp, is_test: isTestCommand(cmd), failed: false });
        }
      }
    }

    if (e.hook_event_type === "PostToolUseFailure") {
      errors.push({ timestamp: e.timestamp, tool_name: e.tool_name, error: e.error ?? "Unknown error" });
      if (e.tool_name === "Bash") {
        const input = (e.tool_input ?? {}) as Record<string, unknown>;
        const cmd = (input.command as string) ?? "";
        if (cmd) {
          commands.push({ command: cmd, timestamp: e.timestamp, is_test: isTestCommand(cmd), failed: true });
        }
      }
    }

    if (e.hook_event_type === "StopFailure") {
      errors.push({ timestamp: e.timestamp, error: e.error ?? "Session stop failure" });
    }
  }

  const modifications = fileChanges.filter((f) => f.action === "edit" || f.action === "write");
  const filesModified = [...new Set(modifications.map((f) => f.file_path))];
  const testRuns = commands.filter((c) => c.is_test);

  let duration = 0;
  if (sessionEvents.length >= 2) {
    duration = Math.round(
      (new Date(sessionEvents[sessionEvents.length - 1]!.timestamp).getTime() -
        new Date(sessionEvents[0]!.timestamp).getTime()) / 1000
    );
  }

  return {
    session_id: sessionId,
    files_modified: filesModified,
    commands,
    test_runs: testRuns,
    errors,
    summary: {
      total_events: sessionEvents.length,
      files_edited: fileChanges.filter((f) => f.action === "edit").length,
      files_written: fileChanges.filter((f) => f.action === "write").length,
      files_read: fileChanges.filter((f) => f.action === "read").length,
      commands_run: commands.length,
      tests_run: testRuns.length,
      tests_failed: testRuns.filter((t) => t.failed).length,
      errors: errors.length,
      duration_seconds: duration,
    },
  };
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ${seconds % 60}s`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function VerifyPanel() {
  const events = useMonitorStore((s) => s.events);
  const loading = useMonitorStore((s) => s.loading);
  const error = useMonitorStore((s) => s.error);
  const startAutoRefresh = useMonitorStore((s) => s.startAutoRefresh);
  const stopAutoRefresh = useMonitorStore((s) => s.stopAutoRefresh);

  useEffect(() => {
    startAutoRefresh(5000);
    return () => stopAutoRefresh();
  }, [startAutoRefresh, stopAutoRefresh]);

  // Get most recent session
  const verification = useMemo(() => {
    if (events.length === 0) return null;
    const sessions = [...new Set(events.map((e) => e.session_id))];
    const sessionId = sessions[sessions.length - 1]!;
    return buildVerification(events, sessionId);
  }, [events]);

  if (error) {
    return (
      <div className="p-4 text-destructive">
        <AlertCircle className="inline h-4 w-4 mr-2" />
        Failed to load data: {error}
      </div>
    );
  }

  if (!verification) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-sm text-muted-foreground">No sessions to verify yet.</p>
      </div>
    );
  }

  const v = verification;

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Duration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatDuration(v.summary.duration_seconds)}</div>
            <p className="text-xs text-muted-foreground mt-1">{v.summary.total_events} events</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <FileEdit className="h-4 w-4" />
              Files Changed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{v.files_modified.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {v.summary.files_edited} edits, {v.summary.files_written} writes
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TestTube className="h-4 w-4" />
              Tests
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={cn("text-2xl font-bold", v.summary.tests_failed > 0 && "text-destructive")}>
              {v.summary.tests_run > 0
                ? `${v.summary.tests_run - v.summary.tests_failed}/${v.summary.tests_run}`
                : "None"}
            </div>
            {v.summary.tests_failed > 0 && (
              <p className="text-xs text-destructive mt-1">{v.summary.tests_failed} failed</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              Errors
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={cn("text-2xl font-bold", v.summary.errors > 0 && "text-destructive")}>
              {v.summary.errors}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Modified files */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FileEdit className="h-4 w-4" />
            Modified Files
            {loading && <span className="text-xs text-muted-foreground animate-pulse">refreshing...</span>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {v.files_modified.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No files modified.</p>
          ) : (
            <div className="space-y-1">
              {v.files_modified.map((f) => (
                <div key={f} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted/50">
                  <FileEdit className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="font-mono text-xs">{f}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Test runs */}
      {v.test_runs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TestTube className="h-4 w-4" />
              Test Runs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {v.test_runs.map((t, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                    t.failed ? "bg-destructive/5" : "bg-green-500/5"
                  )}
                >
                  <span className={cn("text-xs", t.failed ? "text-destructive" : "text-green-600")}>
                    {t.failed ? "✗" : "✓"}
                  </span>
                  <span className="text-xs text-muted-foreground font-mono w-[70px] shrink-0">
                    {formatTime(t.timestamp)}
                  </span>
                  <span className="font-mono text-xs truncate">{t.command}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Errors */}
      {v.errors.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-destructive">
              <AlertCircle className="h-4 w-4" />
              Errors
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {v.errors.slice(-10).map((err, i) => (
                <div key={i} className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-2 py-1.5">
                  <span className="text-xs text-muted-foreground font-mono w-[70px] shrink-0">
                    {formatTime(err.timestamp)}
                  </span>
                  {err.tool_name && (
                    <Badge variant="outline" className="text-[10px] shrink-0">{err.tool_name}</Badge>
                  )}
                  <span className="text-xs text-destructive truncate">{err.error}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Verification checklist */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <CheckSquare className="h-4 w-4" />
            Verification Checklist
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            {v.files_modified.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">☐</span>
                <span>Review {v.files_modified.length} modified file{v.files_modified.length !== 1 ? "s" : ""}</span>
              </div>
            )}
            {v.summary.tests_run > 0 ? (
              v.summary.tests_failed > 0 ? (
                <div className="flex items-center gap-2 text-destructive">
                  <span>⚠</span>
                  <span>{v.summary.tests_failed} test run{v.summary.tests_failed !== 1 ? "s" : ""} failed — investigate</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-green-600">
                  <span>✓</span>
                  <span>All {v.summary.tests_run} test run{v.summary.tests_run !== 1 ? "s" : ""} passed</span>
                </div>
              )
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">☐</span>
                <span>No tests were run — consider running tests</span>
              </div>
            )}
            {v.errors.length > 0 && (
              <div className="flex items-center gap-2 text-destructive">
                <span>⚠</span>
                <span>{v.errors.length} error{v.errors.length !== 1 ? "s" : ""} occurred — review above</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
