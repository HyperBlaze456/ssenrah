import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw, ExternalLink, Trash2 } from "lucide-react";
import type { IpcError } from "@/types";

interface ErrorBannerProps {
  error: IpcError;
  onRetry?: () => void;
  onOpenEditor?: () => void;
  onReset?: () => void;
  onDismiss?: () => void;
}

export function ErrorBanner({
  error,
  onRetry,
  onOpenEditor,
  onReset,
  onDismiss,
}: ErrorBannerProps) {
  const message = getErrorMessage(error);

  return (
    <Alert variant="destructive" className="mb-4">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Error</AlertTitle>
      <AlertDescription>
        <p className="mb-2">{message}</p>
        <div className="flex gap-2">
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw className="mr-1 h-3 w-3" /> Retry
            </Button>
          )}
          {onOpenEditor && (
            <Button variant="outline" size="sm" onClick={onOpenEditor}>
              <ExternalLink className="mr-1 h-3 w-3" /> Open in Editor
            </Button>
          )}
          {onReset && (
            <Button variant="outline" size="sm" onClick={onReset}>
              <Trash2 className="mr-1 h-3 w-3" /> Reset
            </Button>
          )}
          {onDismiss && (
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              Dismiss
            </Button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}

function getErrorMessage(error: IpcError): string {
  switch (error.kind) {
    case "not_found":
      return `File not found: ${error.path}`;
    case "permission_denied":
      return `Permission denied: ${error.path}`;
    case "parse_error":
      return `Invalid JSON in ${error.path}: ${error.message}`;
    case "write_failed":
      return `Write failed for ${error.path}: ${error.message}`;
    case "validation_error":
      return `Validation errors: ${error.errors.map((e) => e.message).join(", ")}`;
    case "no_project":
      return error.message;
    case "platform_error":
      return error.message;
  }
}
