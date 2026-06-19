import { useEffect } from "react";
import { useSettingsStore } from "@/lib/store/settings";
import { usePluginsStore } from "@/lib/store/plugins";
import { useUiStore } from "@/lib/store/ui";
import { ErrorBanner } from "@/components/shared/ErrorBanner";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, X } from "lucide-react";
import type { WritableScope } from "@/types";

const WRITABLE_SCOPES: WritableScope[] = ["user", "project", "local"];

export function MarketplaceConfig() {
  const scope = useUiStore((s) => s.activeScope);
  const settings = useSettingsStore((s) => s.getForScope(scope));
  const userSettings = useSettingsStore((s) => s.user);
  const projectSettings = useSettingsStore((s) => s.project);
  const localSettings = useSettingsStore((s) => s.local);
  const update = useSettingsStore((s) => s.update);

  const marketplaces = usePluginsStore((s) => s.marketplaces);
  const marketplacesStatus = usePluginsStore((s) => s.marketplacesStatus);
  const loadMarketplaces = usePluginsStore((s) => s.loadMarketplaces);
  const removeMarketplace = usePluginsStore((s) => s.removeMarketplace);

  const readOnly = scope === "managed";
  const writableScope = scope as WritableScope;

  useEffect(() => {
    loadMarketplaces();
  }, [loadMarketplaces]);

  const strictKnown = (settings?.strictKnownMarketplaces ?? []) as object[];
  const blocked = (settings?.blockedMarketplaces ?? []) as object[];

  const handleRemoveMarketplace = async (name: string) => {
    await removeMarketplace(name);
    const scopeSettings: Record<WritableScope, typeof userSettings> = {
      user: userSettings,
      project: projectSettings,
      local: localSettings,
    };
    for (const s of WRITABLE_SCOPES) {
      const current = (scopeSettings[s]?.extraKnownMarketplaces ?? {}) as Record<string, unknown>;
      if (name in current) {
        const next = { ...current };
        delete next[name];
        update(s, "extraKnownMarketplaces", next);
      }
    }
  };

  const handleAddStrict = () => {
    update(writableScope, "strictKnownMarketplaces", [...strictKnown, {}]);
  };

  const handleRemoveStrict = (index: number) => {
    update(
      writableScope,
      "strictKnownMarketplaces",
      strictKnown.filter((_, i) => i !== index),
    );
  };

  const handleAddBlocked = () => {
    update(writableScope, "blockedMarketplaces", [...blocked, {}]);
  };

  const handleRemoveBlocked = (index: number) => {
    update(
      writableScope,
      "blockedMarketplaces",
      blocked.filter((_, i) => i !== index),
    );
  };

  return (
    <div className="space-y-6">
      {/* Known Marketplaces — sourced from ~/.claude/plugins/known_marketplaces.json */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm">Known Marketplaces</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3 pt-0 space-y-2">
          <p className="text-xs text-muted-foreground">
            Marketplaces registered with Claude Code. Remove to fully unregister.
          </p>

          {marketplacesStatus.state === "error" && (
            <ErrorBanner
              error={marketplacesStatus.error}
              onRetry={() => loadMarketplaces()}
            />
          )}

          {marketplaces && Object.keys(marketplaces).length === 0 && (
            <p className="text-xs text-muted-foreground">No marketplaces registered.</p>
          )}

          {marketplaces &&
            Object.entries(marketplaces).map(([name, entry]) => {
              const repo = entry?.source?.repo;
              const sourceKind = entry?.source?.source;
              return (
                <div
                  key={name}
                  className="flex items-center gap-2 rounded border border-border bg-muted/30 px-2 py-1.5"
                >
                  <div className="flex flex-1 flex-col">
                    <span className="text-sm font-mono">{name}</span>
                    {(repo || sourceKind) && (
                      <span className="text-xs text-muted-foreground">
                        {[sourceKind, repo].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </div>
                  {!readOnly && (
                    <button
                      onClick={() => handleRemoveMarketplace(name)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`Remove ${name}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
        </CardContent>
      </Card>

      <Separator />

      {/* Strict Known Marketplaces — settings.json policy field */}
      <Card>
        <CardHeader className="py-3 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Strict Known Marketplaces</CardTitle>
            {!readOnly && (
              <Button variant="ghost" size="sm" onClick={handleAddStrict} className="h-7 px-2 text-xs">
                <Plus className="mr-1 h-3 w-3" />
                Add
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-3 pt-0 space-y-2">
          <p className="text-xs text-muted-foreground">
            Marketplace definitions enforced by policy.
          </p>
          {strictKnown.map((_entry, index) => (
            <div
              key={index}
              className="flex items-center gap-2 rounded border border-border bg-muted/30 px-2 py-1.5"
            >
              <span className="flex-1 text-sm text-muted-foreground">Entry {index + 1}</span>
              {!readOnly && (
                <button
                  onClick={() => handleRemoveStrict(index)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
          {strictKnown.length === 0 && (
            <p className="text-xs text-muted-foreground">No strict marketplace entries.</p>
          )}
        </CardContent>
      </Card>

      <Separator />

      {/* Blocked Marketplaces — settings.json policy field */}
      <Card>
        <CardHeader className="py-3 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Blocked Marketplaces</CardTitle>
            {!readOnly && (
              <Button variant="ghost" size="sm" onClick={handleAddBlocked} className="h-7 px-2 text-xs">
                <Plus className="mr-1 h-3 w-3" />
                Add
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-3 pt-0 space-y-2">
          <p className="text-xs text-muted-foreground">
            Marketplace registries blocked by policy.
          </p>
          {blocked.map((_entry, index) => (
            <div
              key={index}
              className="flex items-center gap-2 rounded border border-border bg-muted/30 px-2 py-1.5"
            >
              <span className="flex-1 text-sm text-muted-foreground">Entry {index + 1}</span>
              {!readOnly && (
                <button
                  onClick={() => handleRemoveBlocked(index)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
          {blocked.length === 0 && (
            <p className="text-xs text-muted-foreground">No blocked marketplace entries.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
