import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import type { ConflictInfo } from "@/types";

interface ConflictBannerProps {
  conflict: ConflictInfo;
  onKeepMine: () => void;
  onReload: () => void;
}

export function ConflictBanner({
  conflict,
  onKeepMine,
  onReload,
}: ConflictBannerProps) {
  return (
    <Alert variant="warning" className="mb-4">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>External changes detected</AlertTitle>
      <AlertDescription>
        <p className="mb-2">
          {conflict.file} was modified externally. Your unsaved changes to{" "}
          <strong>{conflict.conflictingFields.join(", ")}</strong> conflict with
          the external changes.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onKeepMine}>
            Keep my changes
          </Button>
          <Button variant="outline" size="sm" onClick={onReload}>
            Reload from disk
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
