import { useEffect, useState } from "react";
import { useMonitorStore } from "@/lib/store/monitor";
import { readTextFile, exists, writeTextFile } from "@tauri-apps/plugin-fs";
import { homeDir } from "@tauri-apps/api/path";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Bell, Settings, Save, AlertCircle } from "lucide-react";

interface EscalationRule {
  name: string;
  condition: string;
  threshold: number;
  action: string;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
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
  const alerts = useMonitorStore((s) => s.getAlerts());
  const startAutoRefresh = useMonitorStore((s) => s.startAutoRefresh);
  const stopAutoRefresh = useMonitorStore((s) => s.stopAutoRefresh);

  const [rules, setRules] = useState<EscalationRule[]>([]);
  const [configLoading, setConfigLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showConfig, setShowConfig] = useState(false);

  useEffect(() => {
    startAutoRefresh(5000);
    return () => stopAutoRefresh();
  }, [startAutoRefresh, stopAutoRefresh]);

  // Load escalation config
  useEffect(() => {
    async function loadConfig() {
      try {
        const home = await homeDir();
        const configPath = `${home}.ssenrah/escalation.json`;
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
      const configPath = `${home}.ssenrah/escalation.json`;
      await writeTextFile(
        configPath,
        JSON.stringify({ rules }, null, 2) + "\n"
      );
    } catch (err) {
      console.error("Failed to save escalation config:", err);
    }
    setSaving(false);
  }

  function updateThreshold(index: number, value: string) {
    const num = parseFloat(value);
    if (isNaN(num)) return;
    setRules((prev) => {
      const next = [...prev];
      next[index] = { ...next[index]!, threshold: num };
      return next;
    });
  }

  const recentAlerts = alerts.slice(-20).reverse();

  return (
    <div className="space-y-6">
      {/* Alert feed */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Escalation Alerts
            </CardTitle>
            <Badge variant={alerts.length > 0 ? "destructive" : "secondary"}>
              {alerts.length}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {recentAlerts.length === 0 ? (
            <div className="text-center py-8">
              <Bell className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                No escalation alerts fired yet. Alerts trigger when session
                thresholds are exceeded.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentAlerts.map((alert) => {
                const raw = alert._raw as Record<string, unknown> | undefined;
                return (
                  <div
                    key={alert.id}
                    className="flex items-start gap-3 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2"
                  >
                    <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">
                        {(raw?.rule_name as string) ?? "Escalation"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {alert.message}
                      </p>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {formatTime(alert.timestamp)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Escalation config */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Escalation Rules
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowConfig(!showConfig)}
            >
              {showConfig ? "Hide" : "Configure"}
            </Button>
          </div>
        </CardHeader>
        {showConfig && (
          <CardContent>
            {configLoading ? (
              <p className="text-sm text-muted-foreground animate-pulse">
                Loading config...
              </p>
            ) : rules.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No escalation rules configured. Run{" "}
                <code className="bg-muted px-1 rounded">
                  bash harness/install.sh
                </code>{" "}
                to create defaults.
              </p>
            ) : (
              <div className="space-y-4">
                {rules.map((rule, i) => (
                  <div
                    key={i}
                    className="flex items-end gap-4 rounded-md border p-3"
                  >
                    <div className="flex-1">
                      <Label className="text-xs text-muted-foreground">
                        {rule.name}
                      </Label>
                      <p className="text-sm mt-1">
                        {conditionLabel(rule.condition)}
                      </p>
                    </div>
                    <div className="w-32">
                      <Label className="text-xs text-muted-foreground">
                        Threshold ({thresholdUnit(rule.condition)})
                      </Label>
                      <Input
                        type="number"
                        value={rule.threshold}
                        onChange={(e) => updateThreshold(i, e.target.value)}
                        className="mt-1 h-8"
                      />
                    </div>
                    <Badge variant="outline" className="shrink-0 mb-1">
                      {rule.action}
                    </Badge>
                  </div>
                ))}

                <Button
                  onClick={saveConfig}
                  disabled={saving}
                  size="sm"
                  className="gap-2"
                >
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
