import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import type { AgentEntry } from "@/lib/ipc/agents";

interface AgentCardProps {
  agent: AgentEntry;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

const SCOPE_COLORS: Record<string, string> = {
  user: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  project: "bg-green-500/20 text-green-400 border-green-500/30",
};

export function AgentCard({ agent, isSelected, onSelect, onDelete }: AgentCardProps) {
  const name = (agent.frontmatter.name as string) ?? agent.filename.replace(/\.md$/, "");
  const description = (agent.frontmatter.description as string) ?? "";
  const model = agent.frontmatter.model as string | undefined;

  return (
    <Card
      className={`cursor-pointer transition-colors hover:bg-accent/50 ${
        isSelected ? "border-primary bg-accent/30" : ""
      }`}
      onClick={onSelect}
    >
      <CardContent className="flex items-start justify-between gap-2 p-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{name}</span>
            <span
              className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                SCOPE_COLORS[agent.scope] ?? ""
              }`}
            >
              {agent.scope === "user" ? "USR" : "PRJ"}
            </span>
            {model && (
              <Badge variant="outline" className="text-[10px]">
                {model}
              </Badge>
            )}
          </div>
          {description && (
            <p className="mt-1 text-xs text-muted-foreground truncate">{description}</p>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </CardContent>
    </Card>
  );
}
