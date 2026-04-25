import { useEffect, useMemo } from "react";
import { Bot, Sparkles } from "lucide-react";
import { useUiStore } from "@/lib/store/ui";
import { computeProviderCounts, useMonitorStore } from "@/lib/store/monitor";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Provider } from "@/types";

const HARNESS_OPTIONS: Array<{
  value: Provider;
  label: string;
  icon: typeof Bot;
  hint: string;
}> = [
  { value: "claude", label: "Claude", icon: Bot, hint: "Claude Code harness — hooks-driven capture" },
  { value: "codex", label: "Codex", icon: Sparkles, hint: "Codex harness — rollout/state ingestion" },
];

export function HarnessSwitcher() {
  const provider = useUiStore((s) => s.activeProvider);
  const setProvider = useUiStore((s) => s.setProvider);
  const events = useMonitorStore((s) => s.events);
  const startAutoRefresh = useMonitorStore((s) => s.startAutoRefresh);
  const stopAutoRefresh = useMonitorStore((s) => s.stopAutoRefresh);

  // We want the badge counts to feel live even when the user hasn't entered a monitor panel yet.
  useEffect(() => {
    startAutoRefresh(5000);
    return () => stopAutoRefresh();
  }, [startAutoRefresh, stopAutoRefresh]);

  const counts = useMemo(() => computeProviderCounts(events), [events]);

  return (
    <div
      role="tablist"
      aria-label="Active harness"
      className="ml-2 flex items-center gap-1 rounded-md border border-border bg-background p-0.5"
    >
      {HARNESS_OPTIONS.map((option) => {
        const Icon = option.icon;
        const active = provider === option.value;
        const badge = counts[option.value];

        return (
          <Tooltip key={option.value} content={option.hint} side="bottom">
            <button
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setProvider(option.value)}
              className={cn(
                "flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{option.label}</span>
              {badge > 0 && (
                <span
                  className={cn(
                    "ml-0.5 rounded-full px-1.5 py-0 text-[10px] tabular-nums",
                    active ? "bg-primary-foreground/20" : "bg-muted",
                  )}
                >
                  {badge > 999 ? "999+" : badge}
                </span>
              )}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
