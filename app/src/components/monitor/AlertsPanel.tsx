import { useEffect, useMemo, useState } from "react";
import { useMonitorStore, computeSessions, useHarnessEvents } from "@/lib/store/monitor";
import { readTextFile, exists, writeTextFile } from "@tauri-apps/plugin-fs";
import { homeDir, join } from "@tauri-apps/api/path";
import {
  formatSeverityLabel,
  getSeverityBadgeVariant,
  summarizeEscalationAlerts,
  type MonitorSeverity,
} from "@/lib/monitor-utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { AlertTriangle, Bell, Settings, Save } from "lucide-react";

type SeverityFilter = "all" | Exclude<MonitorSeverity, "info">;
type AlertSortMode = "severity" | "recent" | "oldest";

interface EscalationRule {
  name: string;
  condition: string;
  threshold: number;
  action: string;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatSessionId(sessionId: string): string {
  return `${sessionId.slice(0, 8)}…${sessionId.slice(-4)}`;
}

function formatMetric(value: number | null, unit: string): string {
  if (value === null) return "-";
  if (unit === "USD") return `$${value.toFixed(value < 10 ? 2 : 0)}`;
  return `${Math.round(value)} ${unit}`;
}

function conditionLabel(condition: string): string {
  switch (condition) {
    case "session_cost_exceeds":
      return "Cost exceeds";
    case "error_count_exceeds":
      return "Errors exceed";
    case "session_duration_exceeds":
      return "Duration exceeds";
    default:
      return condition;
  }
}

function thresholdUnit(condition: string): string {
  switch (condition) {
    case "session_cost_exceeds":
      return "USD";
    case "error_count_exceeds":
      return "errors";
    case "session_duration_exceeds":
      return "seconds";
    default:
      return "";
  }
}

export function AlertsPanel() {
  const events = useHarnessEvents();
  const startAutoRefresh = useMonitorStore((state) => state.startAutoRefresh);
  const stopAutoRefresh = useMonitorStore((state) => state.stopAutoRefresh);
  const focusedSessionIds = useMonitorStore((state) => state.focusedSessionIds);
  const focusSingleSession = useMonitorStore((state) => state.focusSingleSession);
  const clearFocusedSessions = useMonitorStore((state) => state.clearFocusedSessions);
  const showDismissedMonitorItems = useMonitorStore(
    (state) => state.showDismissedMonitorItems,
  );
  const toggleShowDismissedMonitorItems = useMonitorStore(
    (state) => state.toggleShowDismissedMonitorItems,
  );
  const dismissedAlertKeys = useMonitorStore((state) => state.dismissedAlertKeys);
  const dismissAlert = useMonitorStore((state) => state.dismissAlert);
  const dismissAlerts = useMonitorStore((state) => state.dismissAlerts);
  const restoreAlert = useMonitorStore((state) => state.restoreAlert);
  const restoreAlerts = useMonitorStore((state) => state.restoreAlerts);
  const clearDismissedAlerts = useMonitorStore((state) => state.clearDismissedAlerts);

  const [rules, setRules] = useState<EscalationRule[]>([]);
  const [configLoading, setConfigLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [query, setQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [sortMode, setSortMode] = useState<AlertSortMode>("severity");

  const sessions = useMemo(() => computeSessions(events), [events]);
  const focusedSessions = useMemo(
    () => sessions.filter((session) => focusedSessionIds.includes(session.session_id)),
    [focusedSessionIds, sessions],
  );
  const alertGroups = useMemo(
    () => summarizeEscalationAlerts(events.filter((event) => event.hook_event_type === "_escalation")),
    [events],
  );

  const visibleAlertGroups = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const scoped =
      focusedSessionIds.length > 0
        ? alertGroups.filter((alert) => focusedSessionIds.includes(alert.session_id))
        : alertGroups;

    const filtered = scoped.filter((alert) => {
      if (severityFilter !== "all" && alert.severity !== severityFilter) return false;
      if (!normalizedQuery) return true;
      return [
        alert.rule_name,
        alert.condition,
        alert.message,
        alert.session_id,
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });

    const sorted = [...filtered].sort((left, right) => {
      switch (sortMode) {
        case "oldest":
          return left.last_timestamp.localeCompare(right.last_timestamp);
        case "recent":
          return right.last_timestamp.localeCompare(left.last_timestamp);
        case "severity":
        default:
          if (left.severity !== right.severity) {
            return left.severity === "critical" ? -1 : 1;
          }
          return right.last_timestamp.localeCompare(left.last_timestamp);
      }
    });

    return sorted;
  }, [alertGroups, focusedSessionIds, query, severityFilter, sortMode]);

  const hiddenAlerts = visibleAlertGroups.filter((alert) => dismissedAlertKeys[alert.key]).length;
  const visibleAlertKeys = visibleAlertGroups.map((alert) => alert.key);
  const activeVisibleAlertKeys = visibleAlertGroups
    .filter((alert) => !dismissedAlertKeys[alert.key])
    .map((alert) => alert.key);
  const renderedAlerts = showDismissedMonitorItems
    ? visibleAlertGroups
    : visibleAlertGroups.filter((alert) => !dismissedAlertKeys[alert.key]);

  useEffect(() => {
    startAutoRefresh(5000);
    return () => stopAutoRefresh();
  }, [startAutoRefresh, stopAutoRefresh]);

  useEffect(() => {
    async function loadConfig() {
      try {
        const home = await homeDir();
        const configPath = await join(home, ".ssenrah", "escalation.json");
        const fileExists = await exists(configPath);
        if (!fileExists) {
          setRules([]);
          setConfigLoading(false);
          return;
        }
        const content = await readTextFile(configPath);
        const config = JSON.parse(content);
        setRules(config.rules ?? []);
      } catch {
        setRules([]);
      }
      setConfigLoading(false);
    }
    loadConfig();
  }, []);

  async function saveConfig() {
    setSaving(true);
    try {
      const home = await homeDir();
      const configPath = await join(home, ".ssenrah", "escalation.json");
      await writeTextFile(configPath, JSON.stringify({ rules }, null, 2) + "\n");
    } catch (err) {
      console.error("Failed to save escalation config:", err);
    }
    setSaving(false);
  }

  function updateThreshold(index: number, value: string) {
    const num = parseFloat(value);
    if (isNaN(num)) return;
    setRules((previous) => {
      const next = [...previous];
      next[index] = { ...next[index]!, threshold: num };
      return next;
    });
  }

  return (
    <div className="space-y-6">
      {focusedSessions.length > 0 && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex flex-col gap-3 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">Scoped to focused sessions</Badge>
                <span className="text-sm font-medium">
                  {focusedSessions.length} session{focusedSessions.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {focusedSessions.map((session) => (
                  <button
                    key={session.session_id}
                    type="button"
                    onClick={() => focusSingleSession(session.session_id)}
                    className="rounded-md border bg-background px-2 py-1 text-xs font-mono transition-colors hover:bg-muted"
                  >
                    {formatSessionId(session.session_id)}
                  </button>
                ))}
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={clearFocusedSessions}>
              Clear focus
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <AlertTriangle className="h-4 w-4" />
                Escalation Alerts
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                {renderedAlerts.length} grouped alerts visible
                {hiddenAlerts > 0 && !showDismissedMonitorItems
                  ? ` · ${hiddenAlerts} dismissed`
                  : ""}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px_160px]">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Search alerts
                </label>
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Rule, session, condition"
                  className="min-w-[240px]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Severity
                </label>
                <Select
                  value={severityFilter}
                  onChange={(event) =>
                    setSeverityFilter(event.target.value as SeverityFilter)
                  }
                >
                  <option value="all">All severities</option>
                  <option value="critical">Critical</option>
                  <option value="warning">Warning</option>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Sort by
                </label>
                <Select
                  value={sortMode}
                  onChange={(event) => setSortMode(event.target.value as AlertSortMode)}
                >
                  <option value="severity">Severity</option>
                  <option value="recent">Newest first</option>
                  <option value="oldest">Oldest first</option>
                </Select>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap gap-2">
            <Badge variant={getSeverityBadgeVariant("critical")}>
              {visibleAlertGroups.filter((alert) => alert.severity === "critical").length} critical
            </Badge>
            <Badge variant={getSeverityBadgeVariant("warning")}>
              {visibleAlertGroups.filter((alert) => alert.severity === "warning").length} warnings
            </Badge>
            <Button variant="ghost" size="sm" onClick={toggleShowDismissedMonitorItems}>
              {showDismissedMonitorItems ? "Hide dismissed" : "Show dismissed"}
            </Button>
            {activeVisibleAlertKeys.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => dismissAlerts(activeVisibleAlertKeys)}
              >
                Mark visible false alarms
              </Button>
            )}
            {visibleAlertKeys.length > 0 && hiddenAlerts > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => restoreAlerts(visibleAlertKeys)}
              >
                Restore visible
              </Button>
            )}
            {Object.keys(dismissedAlertKeys).length > 0 && (
              <Button variant="ghost" size="sm" onClick={clearDismissedAlerts}>
                Reset dismissed
              </Button>
            )}
            {(query || severityFilter !== "all") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setQuery("");
                  setSeverityFilter("all");
                  setSortMode("severity");
                }}
              >
                Clear filters
              </Button>
            )}
          </div>

          {renderedAlerts.length === 0 ? (
            <div className="py-8 text-center">
              <Bell className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {visibleAlertGroups.length === 0
                  ? "No escalation alerts match the current filters."
                  : "All matching alerts are dismissed."}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {renderedAlerts.map((alert) => {
                const dismissed = Boolean(dismissedAlertKeys[alert.key]);
                const unit = thresholdUnit(alert.condition);
                return (
                  <div
                    key={alert.key}
                    className={
                      alert.severity === "critical"
                        ? "rounded-md border border-destructive/20 bg-destructive/5 px-3 py-3"
                        : "rounded-md border border-yellow-500/20 bg-yellow-500/5 px-3 py-3"
                    }
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={getSeverityBadgeVariant(alert.severity)}>
                            {formatSeverityLabel(alert.severity)}
                          </Badge>
                          <Badge variant="secondary">{alert.rule_name}</Badge>
                          {alert.occurrences > 1 && (
                            <Badge variant="secondary">×{alert.occurrences}</Badge>
                          )}
                          <button
                            type="button"
                            onClick={() => focusSingleSession(alert.session_id)}
                            className="rounded-md border bg-background px-2 py-0.5 text-[10px] font-mono text-muted-foreground transition-colors hover:bg-muted"
                          >
                            {formatSessionId(alert.session_id)}
                          </button>
                        </div>
                        <p className="text-sm font-medium">{conditionLabel(alert.condition)}</p>
                        <p className="text-xs text-muted-foreground">
                          Threshold {formatMetric(alert.threshold, unit)} · Latest {formatMetric(alert.latest_actual, unit)}
                          {alert.peak_actual !== null && alert.occurrences > 1
                            ? ` · Peak ${formatMetric(alert.peak_actual, unit)}`
                            : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">{alert.message}</p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                        <span className="text-[10px] text-muted-foreground">
                          {formatTime(alert.last_timestamp)}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            dismissed ? restoreAlert(alert.key) : dismissAlert(alert.key)
                          }
                        >
                          {dismissed ? "Undo" : "Mark false alarm"}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Settings className="h-4 w-4" />
              Escalation Rules
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setShowConfig(!showConfig)}>
              {showConfig ? "Hide" : "Configure"}
            </Button>
          </div>
        </CardHeader>
        {showConfig && (
          <CardContent>
            {configLoading ? (
              <p className="animate-pulse text-sm text-muted-foreground">
                Loading config...
              </p>
            ) : rules.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No escalation rules configured. Run{" "}
                <code className="rounded bg-muted px-1">bash harness/install.sh</code>{" "}
                to create defaults.
              </p>
            ) : (
              <div className="space-y-4">
                {rules.map((rule, index) => (
                  <div key={index} className="flex items-end gap-4 rounded-md border p-3">
                    <div className="flex-1">
                      <Label className="text-xs text-muted-foreground">
                        {rule.name}
                      </Label>
                      <p className="mt-1 text-sm">{conditionLabel(rule.condition)}</p>
                    </div>
                    <div className="w-32">
                      <Label className="text-xs text-muted-foreground">
                        Threshold ({thresholdUnit(rule.condition)})
                      </Label>
                      <Input
                        type="number"
                        value={rule.threshold}
                        onChange={(event) => updateThreshold(index, event.target.value)}
                        className="mt-1 h-8"
                      />
                    </div>
                    <Badge variant="outline" className="mb-1 shrink-0">
                      {rule.action}
                    </Badge>
                  </div>
                ))}

                <Button onClick={saveConfig} disabled={saving} size="sm" className="gap-2">
                  <Save className="h-3.5 w-3.5" />
                  {saving ? "Saving..." : "Save Rules"}
                </Button>
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
