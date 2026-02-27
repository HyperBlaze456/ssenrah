import { useEffect } from "react";
import { useUiStore } from "@/lib/store/ui";
import { useEffectiveStore } from "@/lib/store/effective";
import { ScopeBadge } from "@/components/shared/ScopeBadge";
import { EffectiveStructured } from "@/components/visualizer/EffectiveStructured";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronUp, ChevronDown, Layers } from "lucide-react";
import type { ConfigScope } from "@/types";

export function EffectiveConfigFooter() {
  const expanded = useUiStore((s) => s.effectiveConfigExpanded);
  const toggle = useUiStore((s) => s.toggleEffectiveConfig);
  const config = useEffectiveStore((s) => s.config);
  const loading = useEffectiveStore((s) => s.loading);
  const recompute = useEffectiveStore((s) => s.recompute);

  useEffect(() => {
    if (expanded && !config && !loading) {
      recompute();
    }
  }, [expanded, config, loading, recompute]);

  const overrideCount = config?.overrides.length ?? 0;
  const fieldCount = config ? Object.keys(config.sources).length : 0;

  // Collect unique scopes that contribute to the effective config.
  const contributingScopes: ConfigScope[] = config
    ? ([...new Set(Object.values(config.sources))] as ConfigScope[])
    : [];

  return (
    <div className="border-t border-border bg-background">
      {/* Collapsed bar */}
      <button
        onClick={toggle}
        className="flex w-full items-center justify-between px-4 py-2 text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Layers className="h-3.5 w-3.5" />
          <span className="font-medium">Effective Config</span>
          {fieldCount > 0 && (
            <span className="text-muted-foreground/70">
              {fieldCount} field{fieldCount !== 1 ? "s" : ""}
            </span>
          )}
          {overrideCount > 0 && (
            <span className="text-orange-400">
              {overrideCount} override{overrideCount !== 1 ? "s" : ""}
            </span>
          )}
          {contributingScopes.length > 0 && (
            <div className="flex items-center gap-1 ml-1">
              {contributingScopes.map((scope) => (
                <ScopeBadge key={scope} scope={scope} />
              ))}
            </div>
          )}
        </div>
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronUp className="h-3.5 w-3.5" />
        )}
      </button>

      {/* Expanded content */}
      {expanded && config && (
        <ScrollArea className="max-h-64 px-4 pb-3">
          <EffectiveStructured config={config} />
        </ScrollArea>
      )}

      {expanded && loading && !config && (
        <div className="px-4 py-4 text-xs text-muted-foreground text-center">
          Computing effective config...
        </div>
      )}
    </div>
  );
}
