import { useEffect, useMemo } from "react";
import { useMonitorStore, useHarnessEvents } from "@/lib/store/monitor";
import { getPrimarySessionId, verifySession, type SessionVerification } from "@/lib/telemetry";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CheckSquare, FileEdit, AlertCircle, TestTube, Clock } from "lucide-react";

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ${seconds % 60}s`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatSessionId(sessionId: string): string {
  return `${sessionId.slice(0, 8)}…${sessionId.slice(-4)}`;
}

export function VerifyPanel() {
  const events = useHarnessEvents();
  const loading = useMonitorStore((state) => state.loading);
  const error = useMonitorStore((state) => state.error);
  const startAutoRefresh = useMonitorStore((state) => state.startAutoRefresh);
  const stopAutoRefresh = useMonitorStore((state) => state.stopAutoRefresh);
  const focusedSessionIds = useMonitorStore((state) => state.focusedSessionIds);

  useEffect(() => {
    startAutoRefresh(5000);
    return () => stopAutoRefresh();
  }, [startAutoRefresh, stopAutoRefresh]);

  const primarySessionId = useMemo(
    () => getPrimarySessionId(events, focusedSessionIds),
    [events, focusedSessionIds],
  );
  const verification = useMemo<SessionVerification | null>(() => {
    if (!primarySessionId) return null;
    return verifySession(events, primarySessionId);
  }, [events, primarySessionId]);

  if (error) {
    return (
      <div className="p-4 text-destructive">
        <AlertCircle className="mr-2 inline h-4 w-4" />
        Failed to load data: {error}
      </div>
    );
  }

  if (!verification || !primarySessionId) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-sm text-muted-foreground">No sessions to verify yet.</p>
      </div>
    );
  }

  const verificationSummary = verification.summary;

  return (
    <div className="space-y-6">
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex flex-col gap-2 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">
                {focusedSessionIds.length > 0 ? "Focused session" : "Latest session"}
              </Badge>
              <span className="font-mono text-sm">{formatSessionId(primarySessionId)}</span>
            </div>
            {focusedSessionIds.length > 1 && (
              <p className="text-xs text-muted-foreground">
                Showing the most recent of {focusedSessionIds.length} focused sessions.
              </p>
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            {loading ? "refreshing…" : `${verificationSummary.total_events} events in scope`}
          </span>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Clock className="h-4 w-4" />
              Duration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatDuration(verificationSummary.duration_seconds)}</div>
            <p className="mt-1 text-xs text-muted-foreground">{verificationSummary.total_events} events</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <FileEdit className="h-4 w-4" />
              Files Changed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{verification.files_modified.length}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {verificationSummary.files_edited} edits, {verificationSummary.files_written} writes, {verificationSummary.files_read} reads
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <TestTube className="h-4 w-4" />
              Tests
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={cn("text-2xl font-bold", verificationSummary.tests_failed > 0 && "text-destructive")}>
              {verificationSummary.tests_run > 0
                ? `${verificationSummary.tests_run - verificationSummary.tests_failed}/${verificationSummary.tests_run}`
                : "None"}
            </div>
            {verificationSummary.tests_failed > 0 && (
              <p className="mt-1 text-xs text-destructive">{verificationSummary.tests_failed} failed</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <AlertCircle className="h-4 w-4" />
              Errors
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={cn("text-2xl font-bold", verificationSummary.errors > 0 && "text-destructive")}>
              {verificationSummary.errors}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <FileEdit className="h-4 w-4" />
            Modified Files
          </CardTitle>
        </CardHeader>
        <CardContent>
          {verification.files_modified.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No files modified.</p>
          ) : (
            <div className="space-y-1">
              {verification.files_modified.map((filePath) => (
                <div key={filePath} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted/50">
                  <FileEdit className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="font-mono text-xs">{filePath}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {verification.test_runs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <TestTube className="h-4 w-4" />
              Test Runs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {verification.test_runs.map((testRun, index) => (
                <div
                  key={`${testRun.timestamp}:${index}`}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                    testRun.failed ? "bg-destructive/5" : "bg-green-500/5",
                  )}
                >
                  <span className={cn("text-xs", testRun.failed ? "text-destructive" : "text-green-600")}>
                    {testRun.failed ? "✗" : "✓"}
                  </span>
                  <span className="w-[70px] shrink-0 font-mono text-xs text-muted-foreground">
                    {formatTime(testRun.timestamp)}
                  </span>
                  <span className="truncate font-mono text-xs">{testRun.command}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {verification.errors.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-destructive">
              <AlertCircle className="h-4 w-4" />
              Errors
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {verification.errors.slice(-10).map((entry, index) => (
                <div
                  key={`${entry.timestamp}:${index}`}
                  className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-2 py-1.5"
                >
                  <span className="w-[70px] shrink-0 font-mono text-xs text-muted-foreground">
                    {formatTime(entry.timestamp)}
                  </span>
                  {entry.tool_name && (
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {entry.tool_name}
                    </Badge>
                  )}
                  <span className="truncate text-xs text-destructive">{entry.error}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <CheckSquare className="h-4 w-4" />
            Verification Checklist
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            {verification.files_modified.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">☐</span>
                <span>
                  Review {verification.files_modified.length} modified file{verification.files_modified.length !== 1 ? "s" : ""}
                </span>
              </div>
            )}
            {verificationSummary.tests_run > 0 ? (
              verificationSummary.tests_failed > 0 ? (
                <div className="flex items-center gap-2 text-destructive">
                  <span>⚠</span>
                  <span>
                    {verificationSummary.tests_failed} test run{verificationSummary.tests_failed !== 1 ? "s" : ""} failed — investigate
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-green-600">
                  <span>✓</span>
                  <span>
                    All {verificationSummary.tests_run} test run{verificationSummary.tests_run !== 1 ? "s" : ""} passed
                  </span>
                </div>
              )
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">☐</span>
                <span>No tests were run — consider running tests</span>
              </div>
            )}
            {verification.errors.length > 0 && (
              <div className="flex items-center gap-2 text-destructive">
                <span>⚠</span>
                <span>
                  {verification.errors.length} error{verification.errors.length !== 1 ? "s" : ""} occurred — review above
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
