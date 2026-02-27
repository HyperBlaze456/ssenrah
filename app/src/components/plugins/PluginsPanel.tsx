import { useState } from "react";
import { useSettingsStore } from "@/lib/store/settings";
import { useUiStore } from "@/lib/store/ui";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorBanner } from "@/components/shared/ErrorBanner";
import { PluginDetailView } from "./PluginDetailView";
import { MarketplaceConfig } from "./MarketplaceConfig";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import type { WritableScope } from "@/types";

export function PluginsPanel() {
  const scope = useUiStore((s) => s.activeScope);
  const settings = useSettingsStore((s) => s.getForScope(scope));
  const status = useSettingsStore((s) => s.status[scope]);
  const update = useSettingsStore((s) => s.update);
  const load = useSettingsStore((s) => s.load);
  const readOnly = scope === "managed";
  const writableScope = scope as WritableScope;

  const [tab, setTab] = useState("plugins");
  const [newPluginName, setNewPluginName] = useState("");
  const [selectedPlugin, setSelectedPlugin] = useState<string | null>(null);

  if (status.state === "error") {
    return <ErrorBanner error={status.error} onRetry={() => load(scope)} />;
  }

  if (settings === null) {
    return <EmptyState scope={scope} panelName="Plugins" />;
  }

  const enabledPlugins = settings?.enabledPlugins ?? {};
  const pluginEntries = Object.entries(enabledPlugins);

  const handleToggle = (pluginName: string, enabled: boolean) => {
    update(writableScope, "enabledPlugins", {
      ...enabledPlugins,
      [pluginName]: enabled,
    });
  };

  const handleAddPlugin = () => {
    const name = newPluginName.trim();
    if (!name) return;
    update(writableScope, "enabledPlugins", {
      ...enabledPlugins,
      [name]: true,
    });
    setNewPluginName("");
  };

  const handleRemovePlugin = (pluginName: string) => {
    const next = { ...enabledPlugins };
    delete next[pluginName];
    update(writableScope, "enabledPlugins", next);
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
            {/* Add plugin */}
            {!readOnly && (
              <div className="flex gap-2">
                <Input
                  value={newPluginName}
                  onChange={(e) => setNewPluginName(e.target.value)}
                  placeholder="Plugin name..."
                  className="flex-1 font-mono text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddPlugin();
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAddPlugin}
                  disabled={!newPluginName.trim()}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Add Plugin
                </Button>
              </div>
            )}

            {/* Plugin list */}
            {pluginEntries.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-8">
                No plugins configured.
              </p>
            )}

            <div className="space-y-2">
              {pluginEntries.map(([name, enabled]) => (
                <Card
                  key={name}
                  className={selectedPlugin === name ? "ring-1 ring-primary" : "cursor-pointer"}
                  onClick={() => setSelectedPlugin(selectedPlugin === name ? null : name)}
                >
                  <CardHeader className="py-3 px-4">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-mono">{name}</CardTitle>
                      <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                        <Switch
                          checked={enabled}
                          onCheckedChange={(checked) => handleToggle(name, checked)}
                          disabled={readOnly}
                        />
                        {!readOnly && (
                          <button
                            onClick={() => handleRemovePlugin(name)}
                            className="text-xs text-muted-foreground hover:text-destructive"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                </Card>
              ))}
            </div>

            {/* Detail view */}
            {selectedPlugin && (
              <>
                <Separator />
                <PluginDetailView
                  name={selectedPlugin}
                  enabled={enabledPlugins[selectedPlugin] ?? false}
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
