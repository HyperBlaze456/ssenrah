import { cn } from "@/lib/utils";
import type { ConfigScope } from "@/types";
import { Lock } from "lucide-react";

const SCOPE_COLORS: Record<ConfigScope, string> = {
  user: "bg-blue-500/15 text-blue-700 border-blue-500/30 dark:bg-blue-500/20 dark:text-blue-400",
  project: "bg-green-500/15 text-green-700 border-green-500/30 dark:bg-green-500/20 dark:text-green-400",
  local: "bg-orange-500/15 text-orange-700 border-orange-500/30 dark:bg-orange-500/20 dark:text-orange-400",
  managed: "bg-red-500/15 text-red-700 border-red-500/30 dark:bg-red-500/20 dark:text-red-400",
};

const SCOPE_LABELS: Record<ConfigScope, string> = {
  user: "USR",
  project: "PRJ",
  local: "LCL",
  managed: "MGD",
};

interface ScopeBadgeProps {
  scope: ConfigScope;
  locked?: boolean;
}

export function ScopeBadge({ scope, locked }: ScopeBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        SCOPE_COLORS[scope]
      )}
    >
      {locked && <Lock className="h-2.5 w-2.5" />}
      {SCOPE_LABELS[scope]}
    </span>
  );
}
