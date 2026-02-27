import { useSettingsStore } from "@/lib/store/settings";
import { useUiStore } from "@/lib/store/ui";
import { RuleBuilder } from "@/components/shared/RuleBuilder";
import { ListEditor } from "@/components/shared/ListEditor";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorBanner } from "@/components/shared/ErrorBanner";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import type { WritableScope } from "@/types";

export function PermissionsPanel() {
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
    return <EmptyState scope={scope} panelName="Permissions" />;
  }

  const permissions = settings?.permissions ?? {};

  return (
    <div className="space-y-6">
      {/* Default Mode */}
      <div className="space-y-2">
        <Label>Default Permission Mode</Label>
        <Select
          value={permissions.defaultMode ?? ""}
          onChange={(e) => update(writableScope, "permissions.defaultMode", e.target.value || undefined)}
          disabled={readOnly}
          className="w-64"
        >
          <option value="">Not set</option>
          <option value="acceptEdits">Accept Edits</option>
          <option value="reviewAll">Review All</option>
        </Select>
      </div>

      {/* Bypass mode */}
      <div className="flex items-center gap-3">
        <Switch
          checked={permissions.disableBypassPermissionsMode === "disable"}
          onCheckedChange={(checked) =>
            update(writableScope, "permissions.disableBypassPermissionsMode", checked ? "disable" : undefined)
          }
          disabled={readOnly}
        />
        <Label>Disable bypass permissions mode</Label>
      </div>

      <Separator />

      {/* Allow Rules */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-green-400">Allow Rules</h3>
        <p className="text-xs text-muted-foreground">Tools and patterns that are auto-approved.</p>
        <RuleBuilder
          rules={permissions.allow ?? []}
          category="allow"
          onChange={(rules) => update(writableScope, "permissions.allow", rules)}
          readOnly={readOnly}
        />
      </div>

      <Separator />

      {/* Ask Rules */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-yellow-400">Ask Rules</h3>
        <p className="text-xs text-muted-foreground">Tools that prompt the user before executing.</p>
        <RuleBuilder
          rules={permissions.ask ?? []}
          category="ask"
          onChange={(rules) => update(writableScope, "permissions.ask", rules)}
          readOnly={readOnly}
        />
      </div>

      <Separator />

      {/* Deny Rules */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-red-400">Deny Rules</h3>
        <p className="text-xs text-muted-foreground">Tools and patterns that are blocked.</p>
        <RuleBuilder
          rules={permissions.deny ?? []}
          category="deny"
          onChange={(rules) => update(writableScope, "permissions.deny", rules)}
          readOnly={readOnly}
        />
      </div>

      <Separator />

      {/* Additional Directories */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Additional Directories</h3>
        <p className="text-xs text-muted-foreground">Extra directories Claude can access beyond the project root.</p>
        <ListEditor
          items={permissions.additionalDirectories ?? []}
          onChange={(dirs) => update(writableScope, "permissions.additionalDirectories", dirs)}
          placeholder="Add directory path..."
          readOnly={readOnly}
          addLabel="Add Directory"
        />
      </div>
    </div>
  );
}
