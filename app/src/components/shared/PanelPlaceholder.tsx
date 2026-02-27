import type { PanelId } from "@/types";
import { Construction } from "lucide-react";

interface PanelPlaceholderProps {
  panelId: PanelId;
}

export function PanelPlaceholder({ panelId }: PanelPlaceholderProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      <Construction className="h-10 w-10 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">
        <strong>{panelId}</strong> panel — coming soon
      </p>
    </div>
  );
}
