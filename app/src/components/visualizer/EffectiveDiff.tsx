import { OverrideIndicator } from "./OverrideIndicator";
import type { EffectiveConfig } from "@/lib/ipc/effective";
import type { ConfigScope } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface EffectiveDiffProps {
  config: EffectiveConfig;
}

function formatValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  return JSON.stringify(value, null, 2);
}

export function EffectiveDiff({ config }: EffectiveDiffProps) {
  const overrides = config.overrides;

  if (overrides.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        No overrides detected. Each field is set by a single scope.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {overrides.length} field{overrides.length !== 1 ? "s" : ""} overridden
        by higher-precedence scopes.
      </p>
      {overrides.map((override) => (
        <Card key={override.path} className="border-border/60">
          <CardHeader className="py-3 px-4">
            <CardTitle className="flex items-center justify-between gap-2 text-sm">
              <code className="text-xs font-mono">{override.path}</code>
              <OverrideIndicator
                effectiveScope={override.effectiveScope as ConfigScope}
                overriddenScopes={override.overriddenScopes as ConfigScope[]}
              />
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 pt-0">
            <pre className="overflow-auto rounded border border-border/40 bg-muted/20 p-2 text-xs font-mono leading-relaxed text-foreground/80">
              {formatValue(override.effectiveValue)}
            </pre>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
