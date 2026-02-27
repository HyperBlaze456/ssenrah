import { useSettingsStore } from "@/lib/store/settings";
import { useUiStore } from "@/lib/store/ui";
import { HookEditor } from "@/components/shared/HookEditor";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorBanner } from "@/components/shared/ErrorBanner";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import type { HookEvent, HookGroup, WritableScope } from "@/types";

export function HooksPanel() {
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
    return <EmptyState scope={scope} panelName="Hooks" />;
  }

  const hooks = settings?.hooks ?? {};
  const disableAll = settings?.disableAllHooks ?? false;
  const managedOnly = settings?.allowManagedHooksOnly ?? false;

  const handleHooksChange = (updated: Partial<Record<HookEvent, HookGroup[]>>) => {
    update(writableScope, "hooks", updated);
  };

  return (
    <div className="space-y-6">
      {/* Global hook toggles */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Switch
            checked={disableAll}
            onCheckedChange={(checked) =>
              update(writableScope, "disableAllHooks", checked || undefined)
            }
            disabled={readOnly}
          />
          <Label>Disable all hooks</Label>
        </div>

        <div className="flex items-center gap-3">
          <Switch
            checked={managedOnly}
            onCheckedChange={(checked) =>
              update(writableScope, "allowManagedHooksOnly", checked || undefined)
            }
            disabled={readOnly}
          />
          <Label>Allow managed hooks only</Label>
        </div>
      </div>

      <Separator />

      {/* Hook editor */}
      {disableAll ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          All hooks are disabled. Uncheck "Disable all hooks" above to configure hooks.
        </p>
      ) : (
        <HookEditor
          hooks={hooks}
          onChange={handleHooksChange}
          readOnly={readOnly}
        />
      )}
    </div>
  );
}
