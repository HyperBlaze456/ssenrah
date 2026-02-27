import { ScopeBadge } from "@/components/shared/ScopeBadge";
import { Tooltip } from "@/components/ui/tooltip";
import type { ConfigScope } from "@/types";
import { ArrowRight } from "lucide-react";

interface OverrideIndicatorProps {
  effectiveScope: ConfigScope;
  overriddenScopes: ConfigScope[];
}

export function OverrideIndicator({
  effectiveScope,
  overriddenScopes,
}: OverrideIndicatorProps) {
  const tooltipContent = (
    <span className="flex items-center gap-1.5">
      {overriddenScopes.map((scope) => (
        <span key={scope} className="line-through opacity-60">
          {scope}
        </span>
      ))}
      <ArrowRight className="h-3 w-3" />
      <span className="font-semibold">{effectiveScope}</span>
    </span>
  );

  return (
    <Tooltip content={tooltipContent} side="top">
      <span className="inline-flex items-center gap-1">
        <ScopeBadge scope={effectiveScope} />
        <span className="text-[10px] text-muted-foreground">
          (overrides {overriddenScopes.join(", ")})
        </span>
      </span>
    </Tooltip>
  );
}
