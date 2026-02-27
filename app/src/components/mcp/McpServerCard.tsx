import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2, Terminal, Globe, Radio } from "lucide-react";
import type { McpServerDefinition } from "@/lib/schemas/mcp";

interface McpServerCardProps {
  name: string;
  server: McpServerDefinition;
  readOnly?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}

function getTransportType(server: McpServerDefinition): "stdio" | "http" | "sse" {
  if ("type" in server && server.type === "http") return "http";
  if ("type" in server && server.type === "sse") return "sse";
  return "stdio";
}

function getTransportIcon(type: "stdio" | "http" | "sse") {
  switch (type) {
    case "stdio":
      return <Terminal className="h-3 w-3" />;
    case "http":
      return <Globe className="h-3 w-3" />;
    case "sse":
      return <Radio className="h-3 w-3" />;
  }
}

function getPreview(server: McpServerDefinition): string {
  const transport = getTransportType(server);
  if (transport === "stdio") {
    const s = server as { command: string; args?: string[] };
    const args = s.args?.length ? ` ${s.args.join(" ")}` : "";
    return `${s.command}${args}`;
  }
  return (server as { url: string }).url;
}

function getEnvCount(server: McpServerDefinition): number {
  if ("env" in server && server.env) {
    return Object.keys(server.env).length;
  }
  return 0;
}

export function McpServerCard({
  name,
  server,
  readOnly,
  onEdit,
  onDelete,
}: McpServerCardProps) {
  const transport = getTransportType(server);
  const envCount = getEnvCount(server);

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm">{name}</CardTitle>
            <Badge variant="secondary" className="text-xs gap-1">
              {getTransportIcon(transport)}
              {transport}
            </Badge>
            {envCount > 0 && (
              <Badge variant="outline" className="text-xs">
                {envCount} env var{envCount !== 1 ? "s" : ""}
              </Badge>
            )}
          </div>
          {!readOnly && (
            <div className="flex gap-1">
              {onEdit && (
                <Button variant="ghost" size="sm" onClick={onEdit} className="h-7 w-7 p-0">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              )}
              {onDelete && (
                <Button variant="ghost" size="sm" onClick={onDelete} className="h-7 w-7 p-0 text-destructive hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3 pt-0">
        <p className="text-xs font-mono text-muted-foreground truncate">
          {getPreview(server)}
        </p>
      </CardContent>
    </Card>
  );
}
