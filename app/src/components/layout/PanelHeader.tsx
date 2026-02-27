import type { ConfigScope } from "@/types";
import { ScopeBadge } from "../shared/ScopeBadge";
import { Lock } from "lucide-react";

interface PanelHeaderProps {
  title: string;
  scope: ConfigScope;
  readOnly?: boolean;
}

export function PanelHeader({ title, scope, readOnly }: PanelHeaderProps) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-6 py-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <ScopeBadge scope={scope} locked={readOnly} />
      {readOnly && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Lock className="h-3 w-3" />
          Read-only
        </span>
      )}
    </div>
  );
}
