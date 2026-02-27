import { useSettingsStore } from "@/lib/store/settings";
import { useUiStore } from "@/lib/store/ui";
import { ListEditor } from "@/components/shared/ListEditor";
import { ErrorBanner } from "@/components/shared/ErrorBanner";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import type { WritableScope } from "@/types";

export function McpPolicyTab() {
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

  if (!settings) {
    return (
      <p className="text-xs text-muted-foreground text-center py-8">
        No settings loaded for this scope.
      </p>
    );
  }

  const allowManagedOnly = settings.allowManagedMcpServersOnly ?? false;
  const enableAllProject = settings.enableAllProjectMcpServers ?? false;
  const enabledServers = settings.enabledMcpjsonServers ?? [];
  const disabledServers = settings.disabledMcpjsonServers ?? [];
  const allowedMatchers = (settings.allowedMcpServers ?? []) as unknown[];
  const deniedMatchers = (settings.deniedMcpServers ?? []) as unknown[];

  return (
    <div className="space-y-6">
      {/* Policy toggles */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Switch
            checked={allowManagedOnly}
            onCheckedChange={(checked) =>
              update(writableScope, "allowManagedMcpServersOnly", checked || undefined)
            }
            disabled={readOnly}
          />
          <Label>Allow managed MCP servers only</Label>
        </div>

        <div className="flex items-center gap-3">
          <Switch
            checked={enableAllProject}
            onCheckedChange={(checked) =>
              update(writableScope, "enableAllProjectMcpServers", checked || undefined)
            }
            disabled={readOnly}
          />
          <Label>Enable all project MCP servers</Label>
        </div>
      </div>

      <Separator />

      {/* Enabled MCP JSON Servers */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Enabled MCP JSON Servers</h3>
        <p className="text-xs text-muted-foreground">
          Server names explicitly enabled from .mcp.json files.
        </p>
        <ListEditor
          items={enabledServers}
          onChange={(items) => update(writableScope, "enabledMcpjsonServers", items)}
          placeholder="Server name..."
          readOnly={readOnly}
          addLabel="Add"
        />
      </div>

      <Separator />

      {/* Disabled MCP JSON Servers */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Disabled MCP JSON Servers</h3>
        <p className="text-xs text-muted-foreground">
          Server names explicitly disabled from .mcp.json files.
        </p>
        <ListEditor
          items={disabledServers}
          onChange={(items) => update(writableScope, "disabledMcpjsonServers", items)}
          placeholder="Server name..."
          readOnly={readOnly}
          addLabel="Add"
        />
      </div>

      <Separator />

      {/* Allowed / Denied MCP Servers */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Allowed MCP Servers</h3>
        <p className="text-xs text-muted-foreground">
          Server matchers that are explicitly allowed. Configure via settings JSON for complex matcher types
          (serverName, serverCommand, serverUrl).
        </p>
        {allowedMatchers.length === 0 ? (
          <p className="text-xs text-muted-foreground">No allowed server matchers configured.</p>
        ) : (
          <div className="space-y-1">
            {allowedMatchers.map((matcher: unknown, idx: number) => (
              <div
                key={idx}
                className="rounded border border-border bg-muted/30 px-2 py-1.5 text-xs font-mono"
              >
                {JSON.stringify(matcher)}
              </div>
            ))}
          </div>
        )}
      </div>

      <Separator />

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Denied MCP Servers</h3>
        <p className="text-xs text-muted-foreground">
          Server matchers that are explicitly denied.
        </p>
        {deniedMatchers.length === 0 ? (
          <p className="text-xs text-muted-foreground">No denied server matchers configured.</p>
        ) : (
          <div className="space-y-1">
            {deniedMatchers.map((matcher: unknown, idx: number) => (
              <div
                key={idx}
                className="rounded border border-border bg-muted/30 px-2 py-1.5 text-xs font-mono"
              >
                {JSON.stringify(matcher)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
