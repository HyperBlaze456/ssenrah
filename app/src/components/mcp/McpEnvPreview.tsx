import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { McpServerDefinition } from "@/lib/schemas/mcp";

interface McpEnvPreviewProps {
  server: McpServerDefinition;
  serverName: string;
}

/**
 * Shows a preview of environment variable expansion for an MCP server config.
 * For stdio servers, displays the env vars that will be injected.
 * For http/sse servers, shows headers that will be sent.
 */
export function McpEnvPreview({ server, serverName }: McpEnvPreviewProps) {
  const isStdio = !("type" in server) || server.type === undefined || server.type === "stdio";
  const env = isStdio && "env" in server ? server.env ?? {} : {};
  const headers = !isStdio && "headers" in server ? server.headers ?? {} : {};

  const entries = isStdio ? Object.entries(env) : Object.entries(headers);
  const label = isStdio ? "Environment Variables" : "Headers";

  if (entries.length === 0) {
    return (
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-xs text-muted-foreground">
            {serverName} - {label} Preview
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3 pt-0">
          <p className="text-xs text-muted-foreground">
            No {label.toLowerCase()} configured for this server.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-xs text-muted-foreground">
          {serverName} - {label} Preview
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3 pt-0 space-y-1">
        {entries.map(([key, value]) => {
          const hasExpansion = typeof value === "string" && value.includes("$");
          return (
            <div key={key} className="flex items-center gap-2 text-xs">
              <span className="font-mono font-medium">{key}</span>
              <span className="text-muted-foreground">=</span>
              <span className="font-mono text-muted-foreground truncate flex-1">
                {value}
              </span>
              {hasExpansion && (
                <Badge variant="outline" className="text-[10px] shrink-0">
                  env ref
                </Badge>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
