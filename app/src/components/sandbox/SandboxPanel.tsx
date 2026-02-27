import { useSettingsStore } from "@/lib/store/settings";
import { useUiStore } from "@/lib/store/ui";
import { ListEditor } from "@/components/shared/ListEditor";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorBanner } from "@/components/shared/ErrorBanner";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WritableScope } from "@/types";

export function SandboxPanel() {
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
    return <EmptyState scope={scope} panelName="Sandbox" />;
  }

  const sandbox = settings?.sandbox ?? {};
  const network = sandbox.network ?? {};

  return (
    <div className="space-y-6">
      {/* Main toggles */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Switch
            checked={sandbox.enabled ?? false}
            onCheckedChange={(checked) => update(writableScope, "sandbox.enabled", checked)}
            disabled={readOnly}
          />
          <Label>Enable Sandbox</Label>
        </div>
        <div className="flex items-center gap-3">
          <Switch
            checked={sandbox.autoAllowBashIfSandboxed ?? false}
            onCheckedChange={(checked) => update(writableScope, "sandbox.autoAllowBashIfSandboxed", checked)}
            disabled={readOnly}
          />
          <Label>Auto-allow Bash when sandboxed</Label>
        </div>
        <div className="flex items-center gap-3">
          <Switch
            checked={sandbox.allowUnsandboxedCommands ?? false}
            onCheckedChange={(checked) => update(writableScope, "sandbox.allowUnsandboxedCommands", checked)}
            disabled={readOnly}
          />
          <Label>Allow unsandboxed commands</Label>
        </div>
        <div className="flex items-center gap-3">
          <Switch
            checked={sandbox.enableWeakerNestedSandbox ?? false}
            onCheckedChange={(checked) => update(writableScope, "sandbox.enableWeakerNestedSandbox", checked)}
            disabled={readOnly}
          />
          <Label>Enable weaker nested sandbox</Label>
        </div>
      </div>

      <Separator />

      {/* Excluded Commands */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Excluded Commands</h3>
        <p className="text-xs text-muted-foreground">Commands exempt from sandbox restrictions.</p>
        <ListEditor
          items={sandbox.excludedCommands ?? []}
          onChange={(cmds) => update(writableScope, "sandbox.excludedCommands", cmds)}
          placeholder="Add command..."
          readOnly={readOnly}
        />
      </div>

      <Separator />

      {/* Network Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Network Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch
              checked={network.allowManagedDomainsOnly ?? false}
              onCheckedChange={(checked) => update(writableScope, "sandbox.network.allowManagedDomainsOnly", checked)}
              disabled={readOnly}
            />
            <Label>Allow managed domains only</Label>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              checked={network.allowAllUnixSockets ?? false}
              onCheckedChange={(checked) => update(writableScope, "sandbox.network.allowAllUnixSockets", checked)}
              disabled={readOnly}
            />
            <Label>Allow all Unix sockets</Label>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              checked={network.allowLocalBinding ?? false}
              onCheckedChange={(checked) => update(writableScope, "sandbox.network.allowLocalBinding", checked)}
              disabled={readOnly}
            />
            <Label>Allow local binding</Label>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>HTTP Proxy Port</Label>
              <Input
                type="number"
                value={network.httpProxyPort ?? ""}
                onChange={(e) => update(writableScope, "sandbox.network.httpProxyPort", e.target.value ? Number(e.target.value) : undefined)}
                disabled={readOnly}
                placeholder="Port number"
              />
            </div>
            <div className="space-y-1">
              <Label>SOCKS Proxy Port</Label>
              <Input
                type="number"
                value={network.socksProxyPort ?? ""}
                onChange={(e) => update(writableScope, "sandbox.network.socksProxyPort", e.target.value ? Number(e.target.value) : undefined)}
                disabled={readOnly}
                placeholder="Port number"
              />
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-medium">Allowed Domains</h4>
            <ListEditor
              items={network.allowedDomains ?? []}
              onChange={(domains) => update(writableScope, "sandbox.network.allowedDomains", domains)}
              placeholder="*.example.com"
              readOnly={readOnly}
            />
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-medium">Allowed Unix Sockets</h4>
            <ListEditor
              items={network.allowUnixSockets ?? []}
              onChange={(sockets) => update(writableScope, "sandbox.network.allowUnixSockets", sockets)}
              placeholder="/path/to/socket"
              readOnly={readOnly}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
