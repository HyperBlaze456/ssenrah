import { useMemo } from "react";
import { useSettingsStore } from "@/lib/store/settings";
import { useUiStore } from "@/lib/store/ui";
import { KeyValueEditor } from "@/components/shared/KeyValueEditor";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorBanner } from "@/components/shared/ErrorBanner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WritableScope } from "@/types";

const KNOWN_ENV_VARS = [
  "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_CUSTOM_HEADERS",
  "ANTHROPIC_MODEL", "ANTHROPIC_FOUNDRY_API_KEY", "ANTHROPIC_FOUNDRY_BASE_URL",
  "AWS_BEARER_TOKEN_BEDROCK",
  "CLAUDE_CODE_ENABLE_TELEMETRY", "CLAUDE_CODE_DISABLE_AUTO_MEMORY",
  "CLAUDE_CODE_DISABLE_BACKGROUND_TASKS", "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS",
  "CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
  "DISABLE_AUTOUPDATER", "DISABLE_ERROR_REPORTING", "DISABLE_TELEMETRY",
  "CLAUDE_CODE_MAX_OUTPUT_TOKENS", "CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS",
  "BASH_MAX_OUTPUT_LENGTH", "BASH_DEFAULT_TIMEOUT_MS",
  "MAX_THINKING_TOKENS", "MAX_MCP_OUTPUT_TOKENS",
  "MCP_TIMEOUT", "MCP_TOOL_TIMEOUT", "SLASH_COMMAND_TOOL_CHAR_BUDGET",
  "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_TMPDIR",
  "CLAUDE_CODE_ORGANIZATION_UUID", "CLAUDE_CODE_ACCOUNT_UUID",
  "CLAUDE_CODE_USER_EMAIL", "CLAUDE_CODE_HIDE_ACCOUNT_INFO",
  "CLAUDE_CODE_SHELL", "CLAUDE_CODE_EFFORT_LEVEL",
  "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE", "ENABLE_TOOL_SEARCH",
] as const;

interface EnvCategory {
  label: string;
  vars: string[];
}

const ENV_CATEGORIES: EnvCategory[] = [
  {
    label: "Authentication",
    vars: [
      "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_CUSTOM_HEADERS",
      "ANTHROPIC_MODEL", "ANTHROPIC_FOUNDRY_API_KEY", "ANTHROPIC_FOUNDRY_BASE_URL",
      "AWS_BEARER_TOKEN_BEDROCK",
    ],
  },
  {
    label: "Feature Toggles",
    vars: [
      "CLAUDE_CODE_ENABLE_TELEMETRY", "CLAUDE_CODE_DISABLE_AUTO_MEMORY",
      "CLAUDE_CODE_DISABLE_BACKGROUND_TASKS", "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS",
      "CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
      "DISABLE_AUTOUPDATER", "DISABLE_ERROR_REPORTING", "DISABLE_TELEMETRY",
      "ENABLE_TOOL_SEARCH",
    ],
  },
  {
    label: "Limits",
    vars: [
      "CLAUDE_CODE_MAX_OUTPUT_TOKENS", "CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS",
      "BASH_MAX_OUTPUT_LENGTH", "BASH_DEFAULT_TIMEOUT_MS",
      "MAX_THINKING_TOKENS", "MAX_MCP_OUTPUT_TOKENS",
      "MCP_TIMEOUT", "MCP_TOOL_TIMEOUT", "SLASH_COMMAND_TOOL_CHAR_BUDGET",
    ],
  },
  {
    label: "Operational",
    vars: [
      "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_TMPDIR",
      "CLAUDE_CODE_ORGANIZATION_UUID", "CLAUDE_CODE_ACCOUNT_UUID",
      "CLAUDE_CODE_USER_EMAIL", "CLAUDE_CODE_HIDE_ACCOUNT_INFO",
      "CLAUDE_CODE_SHELL", "CLAUDE_CODE_EFFORT_LEVEL",
      "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE",
    ],
  },
];

function shouldMaskKey(key: string): boolean {
  const upper = key.toUpperCase();
  return upper.includes("KEY") || upper.includes("TOKEN") || upper.includes("SECRET");
}

export function EnvPanel() {
  const scope = useUiStore((s) => s.activeScope);
  const settings = useSettingsStore((s) => s.getForScope(scope));
  const status = useSettingsStore((s) => s.status[scope]);
  const update = useSettingsStore((s) => s.update);
  const load = useSettingsStore((s) => s.load);
  const readOnly = scope === "managed";
  const writableScope = scope as WritableScope;

  const envEntries = settings?.env ?? {};

  const hasMaskedValues = useMemo(
    () => Object.keys(envEntries).some(shouldMaskKey),
    [envEntries],
  );

  if (status.state === "error") {
    return <ErrorBanner error={status.error} onRetry={() => load(scope)} />;
  }

  if (settings === null) {
    return <EmptyState scope={scope} panelName="Environment" />;
  }

  return (
    <div className="space-y-6">
      {/* Environment Variables */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Environment Variables</h3>
        <p className="text-xs text-muted-foreground">
          Variables injected into Claude Code sessions. Sensitive values containing KEY, TOKEN, or SECRET are masked.
        </p>
        <KeyValueEditor
          entries={envEntries}
          onChange={(entries) => update(writableScope, "env", entries)}
          keyPlaceholder="VARIABLE_NAME"
          valuePlaceholder="value"
          keyAutocomplete={[...KNOWN_ENV_VARS]}
          maskValues={hasMaskedValues}
          readOnly={readOnly}
        />
      </div>

      <Separator />

      {/* Helper Scripts */}
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-medium">Helper Scripts</h3>
          <p className="text-xs text-muted-foreground">
            Commands that dynamically provide credentials or headers at runtime.
          </p>
        </div>

        <div className="space-y-1">
          <Label htmlFor="apiKeyHelper">API Key Helper</Label>
          <Input
            id="apiKeyHelper"
            value={settings?.apiKeyHelper ?? ""}
            onChange={(e) => update(writableScope, "apiKeyHelper", e.target.value || undefined)}
            disabled={readOnly}
            placeholder="Command to retrieve API key"
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Shell command whose stdout provides the Anthropic API key.
          </p>
        </div>

        <div className="space-y-1">
          <Label htmlFor="otelHeadersHelper">OTel Headers Helper</Label>
          <Input
            id="otelHeadersHelper"
            value={settings?.otelHeadersHelper ?? ""}
            onChange={(e) => update(writableScope, "otelHeadersHelper", e.target.value || undefined)}
            disabled={readOnly}
            placeholder="Command to retrieve OpenTelemetry headers"
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Shell command whose stdout provides OpenTelemetry headers.
          </p>
        </div>

        <div className="space-y-1">
          <Label htmlFor="awsAuthRefresh">AWS Auth Refresh</Label>
          <Input
            id="awsAuthRefresh"
            value={settings?.awsAuthRefresh ?? ""}
            onChange={(e) => update(writableScope, "awsAuthRefresh", e.target.value || undefined)}
            disabled={readOnly}
            placeholder="Command to refresh AWS authentication"
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Shell command to refresh AWS authentication tokens.
          </p>
        </div>

        <div className="space-y-1">
          <Label htmlFor="awsCredentialExport">AWS Credential Export</Label>
          <Input
            id="awsCredentialExport"
            value={settings?.awsCredentialExport ?? ""}
            onChange={(e) => update(writableScope, "awsCredentialExport", e.target.value || undefined)}
            disabled={readOnly}
            placeholder="Command to export AWS credentials"
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Shell command to export AWS credentials into the environment.
          </p>
        </div>
      </div>

      <Separator />

      {/* Known Environment Variables Reference */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">Known Variables Reference</h3>
          <p className="text-xs text-muted-foreground">
            Recognized Claude Code environment variables grouped by category. Click to add.
          </p>
        </div>

        {ENV_CATEGORIES.map((category) => (
          <Card key={category.label}>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {category.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3 pt-0">
              <div className="flex flex-wrap gap-1.5">
                {category.vars.map((varName) => {
                  const isSet = varName in envEntries;
                  return (
                    <Badge
                      key={varName}
                      variant={isSet ? "default" : "outline"}
                      className={
                        readOnly
                          ? "cursor-default text-xs font-mono"
                          : "cursor-pointer text-xs font-mono hover:bg-primary/20"
                      }
                      onClick={() => {
                        if (readOnly || isSet) return;
                        update(writableScope, "env", { ...envEntries, [varName]: "" });
                      }}
                    >
                      {varName}
                    </Badge>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
