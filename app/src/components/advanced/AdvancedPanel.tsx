import { useSettingsStore } from "@/lib/store/settings";
import { useUiStore } from "@/lib/store/ui";
import { ListEditor } from "@/components/shared/ListEditor";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorBanner } from "@/components/shared/ErrorBanner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WritableScope } from "@/types";

export function AdvancedPanel() {
  const scope = useUiStore((s) => s.activeScope);
  const settings = useSettingsStore((s) => s.getForScope(scope));
  const status = useSettingsStore((s) => s.status[scope]);
  const update = useSettingsStore((s) => s.update);
  const load = useSettingsStore((s) => s.load);
  const readOnly = scope === "managed";
  const writableScope = scope as WritableScope;

  if (status.state === "error") {
    return <ErrorBanner error={status.error} onRetry={() => load(scope)} />;
  }

  if (settings === null) {
    return <EmptyState scope={scope} panelName="Advanced" />;
  }

  return (
    <div className="space-y-6">
      {/* Session Settings */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium">Session Settings</h3>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="cleanupPeriodDays">Cleanup Period (days)</Label>
            <Input
              id="cleanupPeriodDays"
              type="number"
              min={0}
              value={settings?.cleanupPeriodDays ?? ""}
              onChange={(e) =>
                update(writableScope, "cleanupPeriodDays", e.target.value ? Number(e.target.value) : undefined)
              }
              disabled={readOnly}
              placeholder="Days before cleanup"
            />
            <p className="text-xs text-muted-foreground">
              Number of days before old session data is cleaned up.
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="plansDirectory">Plans Directory</Label>
            <Input
              id="plansDirectory"
              value={settings?.plansDirectory ?? ""}
              onChange={(e) => update(writableScope, "plansDirectory", e.target.value || undefined)}
              disabled={readOnly}
              placeholder="/path/to/plans"
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Directory where plan files are stored.
            </p>
          </div>
        </div>
      </div>

      <Separator />

      {/* Authentication & Updates */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium">Authentication & Updates</h3>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="forceLoginMethod">Force Login Method</Label>
            <Select
              id="forceLoginMethod"
              value={settings?.forceLoginMethod ?? ""}
              onChange={(e) =>
                update(
                  writableScope,
                  "forceLoginMethod",
                  e.target.value || undefined,
                )
              }
              disabled={readOnly}
              className="w-full"
            >
              <option value="">Not set</option>
              <option value="claudeai">Claude AI</option>
              <option value="console">Console</option>
            </Select>
            <p className="text-xs text-muted-foreground">
              Override the login provider.
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="forceLoginOrgUUID">Force Login Org UUID</Label>
            <Input
              id="forceLoginOrgUUID"
              value={settings?.forceLoginOrgUUID ?? ""}
              onChange={(e) => update(writableScope, "forceLoginOrgUUID", e.target.value || undefined)}
              disabled={readOnly}
              placeholder="Organization UUID"
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Force login to a specific organization.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="autoUpdatesChannel">Auto-Updates Channel</Label>
            <Input
              id="autoUpdatesChannel"
              value={settings?.autoUpdatesChannel ?? ""}
              onChange={(e) => update(writableScope, "autoUpdatesChannel", e.target.value || undefined)}
              disabled={readOnly}
              placeholder="e.g. stable, beta"
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Release channel for automatic updates.
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="teammatesMode">Teammates Mode</Label>
            <Input
              id="teammatesMode"
              value={settings?.teammatesMode ?? ""}
              onChange={(e) => update(writableScope, "teammatesMode", e.target.value || undefined)}
              disabled={readOnly}
              placeholder="Teammates mode"
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Controls teammate agent behavior.
            </p>
          </div>
        </div>
      </div>

      <Separator />

      {/* Hook Controls */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium">Hook Controls</h3>
        <p className="text-xs text-muted-foreground">
          Global overrides for hook execution.
        </p>

        <div className="flex items-center gap-3">
          <Switch
            checked={settings?.disableAllHooks ?? false}
            onCheckedChange={(checked) => update(writableScope, "disableAllHooks", checked)}
            disabled={readOnly}
          />
          <Label>Disable all hooks</Label>
        </div>

        <div className="flex items-center gap-3">
          <Switch
            checked={settings?.allowManagedHooksOnly ?? false}
            onCheckedChange={(checked) => update(writableScope, "allowManagedHooksOnly", checked)}
            disabled={readOnly}
          />
          <Label>Allow managed hooks only</Label>
        </div>
      </div>

      <Separator />

      {/* MCP Policy */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">MCP Policy</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Switch
              checked={settings?.allowManagedMcpServersOnly ?? false}
              onCheckedChange={(checked) =>
                update(writableScope, "allowManagedMcpServersOnly", checked)
              }
              disabled={readOnly}
            />
            <Label>Allow managed MCP servers only</Label>
          </div>

          <div className="flex items-center gap-3">
            <Switch
              checked={settings?.enableAllProjectMcpServers ?? false}
              onCheckedChange={(checked) =>
                update(writableScope, "enableAllProjectMcpServers", checked)
              }
              disabled={readOnly}
            />
            <Label>Enable all project MCP servers</Label>
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* Company Announcements */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Company Announcements</h3>
        <p className="text-xs text-muted-foreground">
          Messages displayed to users at session start.
        </p>
        <ListEditor
          items={settings?.companyAnnouncements ?? []}
          onChange={(announcements) =>
            update(writableScope, "companyAnnouncements", announcements.length > 0 ? announcements : undefined)
          }
          placeholder="Add announcement..."
          readOnly={readOnly}
          addLabel="Add Announcement"
        />
      </div>
    </div>
  );
}
