import { useEffect, useMemo, useState } from "react";
import { useSettingsStore } from "@/lib/store/settings";
import { usePluginsStore } from "@/lib/store/plugins";
import { useUiStore } from "@/lib/store/ui";
import { ErrorBanner } from "@/components/shared/ErrorBanner";
import { PluginDetailView } from "./PluginDetailView";
import { MarketplaceConfig } from "./MarketplaceConfig";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { WritableScope } from "@/types";

const WRITABLE_SCOPES: WritableScope[] = ["user", "project", "local"];

export function PluginsPanel() {
  const scope = useUiStore((s) => s.activeScope);
  const settings = useSettingsStore((s) => s.getForScope(scope));
  const userSettings = useSettingsStore((s) => s.user);
  const projectSettings = useSettingsStore((s) => s.project);
  const localSettings = useSettingsStore((s) => s.local);
  const update = useSettingsStore((s) => s.update);

  const installed = usePluginsStore((s) => s.installed);
  const installedStatus = usePluginsStore((s) => s.installedStatus);
  const loadInstalled = usePluginsStore((s) => s.loadInstalled);
  const removePlugin = usePluginsStore((s) => s.removePlugin);

  const readOnly = scope === "managed";
  const writableScope = scope as WritableScope;

  const [tab, setTab] = useState("plugins");
  const [selectedPlugin, setSelectedPlugin] = useState<string | null>(null);

  useEffect(() => {
    loadInstalled();
  }, [loadInstalled]);

  const enabledPlugins = (settings?.enabledPlugins ?? {}) as Record<string, boolean>;

  const pluginEntries = useMemo(() => {
    const plugins = installed?.plugins;
    if (!plugins || typeof plugins !== "object") return [];
    return Object.entries(plugins);
  }, [installed]);

  const handleToggle = (pluginName: string, enabled: boolean) => {
    if (readOnly) return;
    update(writableScope, "enabledPlugins", {
      ...enabledPlugins,
      [pluginName]: enabled,
    });
  };

  const handleRemove = async (pluginName: string) => {
    await removePlugin(pluginName);
    // Strip enabledPlugins entry from every writable scope so the toggle
    // state doesn't outlive the install.
    const scopeSettings: Record<WritableScope, typeof userSettings> = {
      user: userSettings,
      project: projectSettings,
      local: localSettings,
    };
    for (const s of WRITABLE_SCOPES) {
      const current = (scopeSettings[s]?.enabledPlugins ?? {}) as Record<string, boolean>;
      if (pluginName in current) {
        const next = { ...current };
        delete next[pluginName];
        update(s, "enabledPlugins", next);
      }
    }
    if (selectedPlugin === pluginName) {
      setSelectedPlugin(null);
    }
  };

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="plugins">Plugins</TabsTrigger>
          <TabsTrigger value="marketplace">Marketplace</TabsTrigger>
        </TabsList>

        <TabsContent value="plugins">
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Plugins installed via Claude Code (<code>/plugin install</code>). Toggle to enable
              or disable; remove to uninstall.
            </p>

            {installedStatus.state === "error" && (
              <ErrorBanner
                error={installedStatus.error}
                onRetry={() => loadInstalled()}
              />
            )}

            {installedStatus.state === "loading" && pluginEntries.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-8">Loading…</p>
            )}

            {installedStatus.state !== "loading" &&
              installedStatus.state !== "error" &&
              pluginEntries.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-8">
                  No plugins installed.
                </p>
              )}

            <div className="space-y-2">
              {pluginEntries.map(([name, entries]) => {
                const primary = Array.isArray(entries) ? entries[0] : undefined;
                const enabled = enabledPlugins[name] ?? true;
                const version = primary?.version;
                const installScope = primary?.scope;
                return (
                  <Card
                    key={name}
                    className={selectedPlugin === name ? "ring-1 ring-primary" : "cursor-pointer"}
                    onClick={() => setSelectedPlugin(selectedPlugin === name ? null : name)}
                  >
                    <CardHeader className="py-3 px-4">
                      <div className="flex items-center justify-between">
                        <div className="flex flex-col gap-0.5">
                          <CardTitle className="text-sm font-mono">{name}</CardTitle>
                          {(version || installScope) && (
                            <span className="text-xs text-muted-foreground">
                              {[installScope, version].filter(Boolean).join(" · ")}
                            </span>
                          )}
                        </div>
                        <div
                          className="flex items-center gap-3"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Switch
                            checked={enabled}
                            onCheckedChange={(checked) => handleToggle(name, checked)}
                            disabled={readOnly}
                          />
                          {!readOnly && (
                            <button
                              onClick={() => handleRemove(name)}
                              className="text-xs text-muted-foreground hover:text-destructive"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                  </Card>
                );
              })}
            </div>

            {selectedPlugin && (
              <>
                <Separator />
                <PluginDetailView
                  name={selectedPlugin}
                  enabled={enabledPlugins[selectedPlugin] ?? true}
                />
              </>
            )}
          </div>
        </TabsContent>

        <TabsContent value="marketplace">
          <MarketplaceConfig />
        </TabsContent>
      </Tabs>
    </div>
  );
}
