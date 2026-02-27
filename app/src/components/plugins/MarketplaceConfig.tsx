import { useState } from "react";
import { useSettingsStore } from "@/lib/store/settings";
import { useUiStore } from "@/lib/store/ui";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, X } from "lucide-react";
import type { WritableScope } from "@/types";

export function MarketplaceConfig() {
  const scope = useUiStore((s) => s.activeScope);
  const settings = useSettingsStore((s) => s.getForScope(scope));
  const update = useSettingsStore((s) => s.update);
  const readOnly = scope === "managed";
  const writableScope = scope as WritableScope;

  const extraKnown = settings?.extraKnownMarketplaces ?? {};
  const strictKnown = settings?.strictKnownMarketplaces ?? [];
  const blocked = settings?.blockedMarketplaces ?? [];

  const [newExtraKey, setNewExtraKey] = useState("");

  const handleAddExtra = () => {
    const key = newExtraKey.trim();
    if (!key) return;
    update(writableScope, "extraKnownMarketplaces", {
      ...extraKnown,
      [key]: {},
    });
    setNewExtraKey("");
  };

  const handleRemoveExtra = (key: string) => {
    const next = { ...extraKnown };
    delete next[key];
    update(writableScope, "extraKnownMarketplaces", next);
  };

  const handleAddStrict = () => {
    update(writableScope, "strictKnownMarketplaces", [...strictKnown, {}]);
  };

  const handleRemoveStrict = (index: number) => {
    update(
      writableScope,
      "strictKnownMarketplaces",
      strictKnown.filter((_: object, i: number) => i !== index),
    );
  };

  const handleAddBlocked = () => {
    update(writableScope, "blockedMarketplaces", [...blocked, {}]);
  };

  const handleRemoveBlocked = (index: number) => {
    update(
      writableScope,
      "blockedMarketplaces",
      blocked.filter((_: object, i: number) => i !== index),
    );
  };

  return (
    <div className="space-y-6">
      {/* Extra Known Marketplaces */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm">Extra Known Marketplaces</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3 pt-0 space-y-2">
          <p className="text-xs text-muted-foreground">
            Additional marketplace registries to recognize.
          </p>
          {Object.keys(extraKnown).map((key) => (
            <div
              key={key}
              className="flex items-center gap-2 rounded border border-border bg-muted/30 px-2 py-1.5"
            >
              <span className="flex-1 text-sm font-mono">{key}</span>
              {!readOnly && (
                <button
                  onClick={() => handleRemoveExtra(key)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
          {!readOnly && (
            <div className="flex gap-2">
              <Input
                value={newExtraKey}
                onChange={(e) => setNewExtraKey(e.target.value)}
                placeholder="Marketplace name..."
                className="flex-1 font-mono text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddExtra();
                }}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleAddExtra}
                disabled={!newExtraKey.trim()}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add
              </Button>
            </div>
          )}
          {Object.keys(extraKnown).length === 0 && (
            <p className="text-xs text-muted-foreground">No extra marketplaces configured.</p>
          )}
        </CardContent>
      </Card>

      <Separator />

      {/* Strict Known Marketplaces */}
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
          {strictKnown.map((_entry: object, index: number) => (
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

      {/* Blocked Marketplaces */}
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
          {blocked.map((_entry: object, index: number) => (
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
