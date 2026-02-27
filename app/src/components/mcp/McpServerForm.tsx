import { useState } from "react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ListEditor } from "@/components/shared/ListEditor";
import { KeyValueEditor } from "@/components/shared/KeyValueEditor";
import type { McpServerDefinition } from "@/lib/schemas/mcp";

type TransportType = "stdio" | "http" | "sse";

interface McpServerFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (name: string, server: McpServerDefinition) => void;
  initialName?: string;
  initialServer?: McpServerDefinition;
}

function getTransportType(server?: McpServerDefinition): TransportType {
  if (!server) return "stdio";
  if ("type" in server && server.type === "http") return "http";
  if ("type" in server && server.type === "sse") return "sse";
  return "stdio";
}

export function McpServerForm({
  open,
  onOpenChange,
  onSave,
  initialName,
  initialServer,
}: McpServerFormProps) {
  const isEdit = !!initialName;
  const [name, setName] = useState(initialName ?? "");
  const [transport, setTransport] = useState<TransportType>(getTransportType(initialServer));

  // stdio fields
  const [command, setCommand] = useState(
    initialServer && "command" in initialServer ? initialServer.command : "",
  );
  const [args, setArgs] = useState<string[]>(
    initialServer && "args" in initialServer ? initialServer.args ?? [] : [],
  );
  const [env, setEnv] = useState<Record<string, string>>(
    initialServer && "env" in initialServer ? initialServer.env ?? {} : {},
  );

  // http/sse fields
  const [url, setUrl] = useState(
    initialServer && "url" in initialServer ? initialServer.url : "",
  );
  const [headers, setHeaders] = useState<Record<string, string>>(
    initialServer && "headers" in initialServer ? initialServer.headers ?? {} : {},
  );

  // oauth fields (http only)
  const [oauthClientId, setOauthClientId] = useState(
    initialServer && "oauth" in initialServer && initialServer.oauth
      ? initialServer.oauth.clientId
      : "",
  );
  const [oauthCallbackPort, setOauthCallbackPort] = useState(
    initialServer && "oauth" in initialServer && initialServer.oauth?.callbackPort
      ? String(initialServer.oauth.callbackPort)
      : "",
  );

  const handleSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    let server: McpServerDefinition;

    if (transport === "stdio") {
      if (!command.trim()) return;
      server = {
        command: command.trim(),
        ...(args.length > 0 ? { args } : {}),
        ...(Object.keys(env).length > 0 ? { env } : {}),
      };
    } else if (transport === "http") {
      if (!url.trim()) return;
      const oauth = oauthClientId.trim()
        ? {
            clientId: oauthClientId.trim(),
            ...(oauthCallbackPort ? { callbackPort: Number(oauthCallbackPort) } : {}),
          }
        : undefined;
      server = {
        type: "http" as const,
        url: url.trim(),
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
        ...(oauth ? { oauth } : {}),
      };
    } else {
      if (!url.trim()) return;
      server = {
        type: "sse" as const,
        url: url.trim(),
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      };
    }

    onSave(trimmedName, server);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{isEdit ? "Edit MCP Server" : "Add MCP Server"}</DialogTitle>
        <DialogDescription>
          Configure the connection details for the MCP server.
        </DialogDescription>
      </DialogHeader>

      <div className="mt-4 space-y-4 max-h-[60vh] overflow-y-auto">
        {/* Server Name */}
        <div className="space-y-1">
          <Label htmlFor="server-name">Server Name</Label>
          <Input
            id="server-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-server"
            className="font-mono text-sm"
            disabled={isEdit}
          />
        </div>

        {/* Transport Type */}
        <div className="space-y-1">
          <Label htmlFor="transport-type">Transport Type</Label>
          <Select
            id="transport-type"
            value={transport}
            onChange={(e) => setTransport(e.target.value as TransportType)}
          >
            <option value="stdio">stdio</option>
            <option value="http">http</option>
            <option value="sse">sse</option>
          </Select>
        </div>

        <Separator />

        {/* stdio fields */}
        {transport === "stdio" && (
          <>
            <div className="space-y-1">
              <Label htmlFor="command">Command</Label>
              <Input
                id="command"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="npx -y @modelcontextprotocol/server-filesystem"
                className="font-mono text-sm"
              />
            </div>

            <div className="space-y-1">
              <Label>Arguments</Label>
              <ListEditor
                items={args}
                onChange={setArgs}
                placeholder="Add argument..."
                addLabel="Add"
              />
            </div>

            <div className="space-y-1">
              <Label>Environment Variables</Label>
              <KeyValueEditor
                entries={env}
                onChange={setEnv}
                keyPlaceholder="ENV_VAR"
                valuePlaceholder="value"
                maskValues
              />
            </div>
          </>
        )}

        {/* http fields */}
        {transport === "http" && (
          <>
            <div className="space-y-1">
              <Label htmlFor="url">URL</Label>
              <Input
                id="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/mcp"
                className="font-mono text-sm"
              />
            </div>

            <div className="space-y-1">
              <Label>Headers</Label>
              <KeyValueEditor
                entries={headers}
                onChange={setHeaders}
                keyPlaceholder="Header-Name"
                valuePlaceholder="value"
              />
            </div>

            <Separator />

            <div className="space-y-3">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                OAuth (optional)
              </Label>
              <div className="space-y-1">
                <Label htmlFor="oauth-client-id">Client ID</Label>
                <Input
                  id="oauth-client-id"
                  value={oauthClientId}
                  onChange={(e) => setOauthClientId(e.target.value)}
                  placeholder="client-id"
                  className="font-mono text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="oauth-callback-port">Callback Port</Label>
                <Input
                  id="oauth-callback-port"
                  value={oauthCallbackPort}
                  onChange={(e) => setOauthCallbackPort(e.target.value)}
                  placeholder="8080"
                  type="number"
                  className="font-mono text-sm"
                />
              </div>
            </div>
          </>
        )}

        {/* sse fields */}
        {transport === "sse" && (
          <>
            <div className="space-y-1">
              <Label htmlFor="url-sse">URL</Label>
              <Input
                id="url-sse"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/sse"
                className="font-mono text-sm"
              />
            </div>

            <div className="space-y-1">
              <Label>Headers</Label>
              <KeyValueEditor
                entries={headers}
                onChange={setHeaders}
                keyPlaceholder="Header-Name"
                valuePlaceholder="value"
              />
            </div>
          </>
        )}
      </div>

      <DialogFooter className="mt-6">
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={!name.trim()}>
          {isEdit ? "Save Changes" : "Add Server"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
