import { useEffect, useState } from "react";
import { useMcpStore } from "@/lib/store/mcp";
import { useUiStore } from "@/lib/store/ui";
import { McpServerCard } from "./McpServerCard";
import { McpServerForm } from "./McpServerForm";
import { McpPolicyTab } from "./McpPolicyTab";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorBanner } from "@/components/shared/ErrorBanner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus } from "lucide-react";
import type { McpServerDefinition } from "@/lib/schemas/mcp";
import type { McpSource, WritableMcpSource } from "@/lib/ipc/mcp";

function scopeToMcpSource(scope: string): McpSource {
  if (scope === "project") return "project";
  if (scope === "managed") return "managed";
  return "user";
}

export function McpPanel() {
  const scope = useUiStore((s) => s.activeScope);
  const mcpSource = scopeToMcpSource(scope);
  const isWritable = mcpSource === "project" || mcpSource === "user";
  const readOnly = !isWritable;

  const config = useMcpStore((s) => s.getForSource(mcpSource));
  const status = useMcpStore((s) => s.status[mcpSource]);
  const load = useMcpStore((s) => s.load);
  const addServer = useMcpStore((s) => s.addServer);
  const updateServer = useMcpStore((s) => s.updateServer);
  const removeServer = useMcpStore((s) => s.removeServer);

  const [tab, setTab] = useState("servers");
  const [formOpen, setFormOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<{ name: string; def: McpServerDefinition } | null>(null);

  useEffect(() => {
    if (status.state === "idle") {
      load(mcpSource);
    }
  }, [mcpSource, status.state, load]);

  if (status.state === "error") {
    return <ErrorBanner error={status.error} onRetry={() => load(mcpSource)} />;
  }

  const servers = config?.mcpServers ?? {};
  const serverEntries = Object.entries(servers);

  const handleAdd = (name: string, def: McpServerDefinition) => {
    if (isWritable) {
      addServer(mcpSource as WritableMcpSource, name, def);
    }
  };

  const handleEdit = (name: string, def: McpServerDefinition) => {
    if (isWritable) {
      updateServer(mcpSource as WritableMcpSource, name, def);
    }
  };

  const handleDelete = (name: string) => {
    if (isWritable) {
      removeServer(mcpSource as WritableMcpSource, name);
    }
  };

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="servers">Servers</TabsTrigger>
          <TabsTrigger value="policy">Policy</TabsTrigger>
        </TabsList>

        <TabsContent value="servers">
          <div className="space-y-4">
            {!readOnly && (
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditingServer(null);
                    setFormOpen(true);
                  }}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Add Server
                </Button>
              </div>
            )}

            {config === null && (
              <EmptyState scope={scope} panelName="MCP Servers" />
            )}

            {serverEntries.length === 0 && config !== null && (
              <p className="text-xs text-muted-foreground py-8 text-center">
                No MCP servers configured at {scope} scope.
              </p>
            )}

            <div className="space-y-3">
              {serverEntries.map(([name, server]) => (
                <McpServerCard
                  key={name}
                  name={name}
                  server={server}
                  readOnly={readOnly}
                  onEdit={() => {
                    setEditingServer({ name, def: server });
                    setFormOpen(true);
                  }}
                  onDelete={() => handleDelete(name)}
                />
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="policy">
          <McpPolicyTab />
        </TabsContent>
      </Tabs>

      <McpServerForm
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditingServer(null);
        }}
        onSave={editingServer ? handleEdit : handleAdd}
        initialName={editingServer?.name}
        initialServer={editingServer?.def}
      />
    </div>
  );
}
