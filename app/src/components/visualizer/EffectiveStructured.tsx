import { ScopeBadge } from "@/components/shared/ScopeBadge";
import type { EffectiveConfig } from "@/lib/ipc/effective";
import type { ConfigScope } from "@/types";
import { Separator } from "@/components/ui/separator";

interface EffectiveStructuredProps {
  config: EffectiveConfig;
}

function formatValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function isScalar(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  );
}

interface FieldRowProps {
  path: string;
  value: unknown;
  scope: ConfigScope | undefined;
}

function FieldRow({ path, value, scope }: FieldRowProps) {
  const label = path.split(".").pop() ?? path;

  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <code className="text-xs text-muted-foreground truncate">{label}</code>
        {scope && <ScopeBadge scope={scope} />}
      </div>
      <code className="text-xs text-foreground/80 text-right break-all max-w-[60%]">
        {formatValue(value)}
      </code>
    </div>
  );
}

interface GroupProps {
  groupKey: string;
  value: unknown;
  sources: Record<string, ConfigScope>;
  prefix?: string;
}

function Group({ groupKey, value, sources, prefix }: GroupProps) {
  const fullPath = prefix ? `${prefix}.${groupKey}` : groupKey;

  if (isScalar(value) || Array.isArray(value)) {
    return (
      <FieldRow
        path={fullPath}
        value={value}
        scope={sources[fullPath]}
      />
    );
  }

  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();

    return (
      <div className="space-y-1">
        <h4 className="text-xs font-semibold text-foreground/70 uppercase tracking-wider pt-2">
          {groupKey}
        </h4>
        <div className="pl-3 border-l border-border/50 space-y-0.5">
          {keys.map((key) => (
            <Group
              key={key}
              groupKey={key}
              value={obj[key]}
              sources={sources}
              prefix={fullPath}
            />
          ))}
        </div>
      </div>
    );
  }

  return null;
}

export function EffectiveStructured({ config }: EffectiveStructuredProps) {
  const settings = config.settings;
  const sources = config.sources as Record<string, ConfigScope>;
  const topKeys = Object.keys(settings).sort();

  if (topKeys.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        No effective configuration. All scopes are empty.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {topKeys.map((key, index) => (
        <div key={key}>
          {index > 0 && <Separator className="mb-4" />}
          <Group
            groupKey={key}
            value={settings[key]}
            sources={sources}
          />
        </div>
      ))}
    </div>
  );
}
