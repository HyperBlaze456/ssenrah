import type { ConfigScope } from "@/types";
import { Button } from "@/components/ui/button";
import { FolderOpen } from "lucide-react";

interface EmptyStateProps {
  scope: ConfigScope;
  panelName: string;
  onCreateConfig?: () => void;
}

export function EmptyState({ scope, panelName, onCreateConfig }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <FolderOpen className="h-12 w-12 text-muted-foreground/50" />
      <div>
        <p className="text-sm text-muted-foreground">
          No {panelName.toLowerCase()} configured at <strong>{scope}</strong> scope.
        </p>
      </div>
      {onCreateConfig && scope !== "managed" && (
        <Button variant="outline" size="sm" onClick={onCreateConfig}>
          Create {scope} configuration
        </Button>
      )}
    </div>
  );
}
