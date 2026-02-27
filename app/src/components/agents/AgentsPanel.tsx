import { useEffect, useState, useCallback } from "react";
import { useAgentsStore } from "@/lib/store/agents";
import { useUiStore } from "@/lib/store/ui";
import { AgentCard } from "./AgentCard";
import { AgentEditor } from "./AgentEditor";
import { ErrorBanner } from "@/components/shared/ErrorBanner";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Plus, Bot } from "lucide-react";
import type { AgentScope } from "@/types";

export function AgentsPanel() {
  const rawScope = useUiStore((s) => s.activeScope);
  const scope: AgentScope = rawScope === "user" || rawScope === "project" ? rawScope : "user";
  const entries = useAgentsStore((s) => s.entries);
  const listStatus = useAgentsStore((s) => s.listStatus);
  const selectedKey = useAgentsStore((s) => s.selectedKey);
  const loadList = useAgentsStore((s) => s.loadList);
  const loadDetail = useAgentsStore((s) => s.loadDetail);
  const clearSelection = useAgentsStore((s) => s.clearSelection);
  const removeAgent = useAgentsStore((s) => s.removeAgent);

  const [editing, setEditing] = useState(false);
  const [editFilename, setEditFilename] = useState<string | null>(null);
  const [editScope, setEditScope] = useState<string>(scope);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const handleSelect = useCallback(
    (agentScope: string, filename: string) => {
      setEditScope(agentScope);
      setEditFilename(filename);
      setEditing(true);
      loadDetail(agentScope, filename);
    },
    [loadDetail],
  );

  const handleNew = useCallback(() => {
    clearSelection();
    setEditScope(scope);
    setEditFilename(null);
    setEditing(true);
  }, [scope, clearSelection]);

  const handleClose = useCallback(() => {
    setEditing(false);
    setEditFilename(null);
    clearSelection();
  }, [clearSelection]);

  const handleDelete = useCallback(
    async (agentScope: string, filename: string) => {
      try {
        await removeAgent(agentScope, filename);
      } catch {
        // Error handled in store
      }
    },
    [removeAgent],
  );

  if (listStatus.state === "error") {
    return <ErrorBanner error={listStatus.error} onRetry={() => loadList()} />;
  }

  if (editing) {
    return (
      <AgentEditor
        scope={editScope}
        filename={editFilename}
        onClose={handleClose}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Agent definitions are .md files with YAML frontmatter in the agents directory.
          Each agent defines tools, model, permissions, and a prompt.
        </p>
        <Button size="sm" onClick={handleNew}>
          <Plus className="mr-1 h-3 w-3" /> New Agent
        </Button>
      </div>

      <Separator />

      {listStatus.state === "loading" && (
        <div className="flex items-center justify-center py-8">
          <span className="text-sm text-muted-foreground">Loading agents...</span>
        </div>
      )}

      {listStatus.state === "loaded" && entries.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
          <Bot className="h-12 w-12 text-muted-foreground/50" />
          <div>
            <p className="text-sm text-muted-foreground">
              No agents defined yet.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Create an agent to define reusable sub-agent configurations.
            </p>
          </div>
        </div>
      )}

      {entries.length > 0 && (
        <div className="grid gap-2">
          {entries.map((agent) => (
            <AgentCard
              key={`${agent.scope}/${agent.filename}`}
              agent={agent}
              isSelected={
                selectedKey?.scope === agent.scope &&
                selectedKey?.filename === agent.filename
              }
              onSelect={() => handleSelect(agent.scope, agent.filename)}
              onDelete={() => handleDelete(agent.scope, agent.filename)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
