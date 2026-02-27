import { useEffect, useState, useCallback } from "react";
import { useSkillsStore } from "@/lib/store/skills";
import { useUiStore } from "@/lib/store/ui";
import { SkillEditor } from "./SkillEditor";
import { ErrorBanner } from "@/components/shared/ErrorBanner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import type { SkillScope } from "@/types";
import type { SkillEntry } from "@/lib/ipc/skills";

const SCOPE_COLORS: Record<string, string> = {
  user: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  project: "bg-green-500/20 text-green-400 border-green-500/30",
};

function SkillCard({
  skill,
  isSelected,
  onSelect,
  onDelete,
}: {
  skill: SkillEntry;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const name =
    (skill.frontmatter.name as string) ??
    skill.directory.replace(/\.md$/, "").replace(/\/$/, "");
  const description = (skill.frontmatter.description as string) ?? "";

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
            <span className="text-sm font-medium truncate">/{name}</span>
            <span
              className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                SCOPE_COLORS[skill.scope] ?? ""
              }`}
            >
              {skill.scope === "user" ? "USR" : "PRJ"}
            </span>
            {typeof skill.frontmatter.agent === "string" && (
              <Badge variant="outline" className="text-[10px]">
                agent: {skill.frontmatter.agent}
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

export function SkillsPanel() {
  const rawScope = useUiStore((s) => s.activeScope);
  const scope: SkillScope = rawScope === "user" || rawScope === "project" ? rawScope : "user";
  const entries = useSkillsStore((s) => s.entries);
  const listStatus = useSkillsStore((s) => s.listStatus);
  const selectedKey = useSkillsStore((s) => s.selectedKey);
  const loadList = useSkillsStore((s) => s.loadList);
  const loadDetail = useSkillsStore((s) => s.loadDetail);
  const clearSelection = useSkillsStore((s) => s.clearSelection);
  const removeSkill = useSkillsStore((s) => s.removeSkill);

  const [editing, setEditing] = useState(false);
  const [editDirectory, setEditDirectory] = useState<string | null>(null);
  const [editScope, setEditScope] = useState<string>(scope);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const handleSelect = useCallback(
    (skillScope: string, directory: string) => {
      setEditScope(skillScope);
      setEditDirectory(directory);
      setEditing(true);
      loadDetail(skillScope, directory);
    },
    [loadDetail],
  );

  const handleNew = useCallback(() => {
    clearSelection();
    setEditScope(scope);
    setEditDirectory(null);
    setEditing(true);
  }, [scope, clearSelection]);

  const handleClose = useCallback(() => {
    setEditing(false);
    setEditDirectory(null);
    clearSelection();
  }, [clearSelection]);

  const handleDelete = useCallback(
    async (skillScope: string, directory: string) => {
      try {
        await removeSkill(skillScope, directory);
      } catch {
        // Error handled in store
      }
    },
    [removeSkill],
  );

  if (listStatus.state === "error") {
    return <ErrorBanner error={listStatus.error} onRetry={() => loadList()} />;
  }

  if (editing) {
    return (
      <SkillEditor
        scope={editScope}
        directory={editDirectory}
        onClose={handleClose}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Skills are slash commands defined as directories containing a SKILL.md or as
          standalone .md files in the commands directory. Each skill has frontmatter
          metadata and a markdown prompt body.
        </p>
        <Button size="sm" onClick={handleNew}>
          <Plus className="mr-1 h-3 w-3" /> New Skill
        </Button>
      </div>

      <Separator />

      {listStatus.state === "loading" && (
        <div className="flex items-center justify-center py-8">
          <span className="text-sm text-muted-foreground">Loading skills...</span>
        </div>
      )}

      {listStatus.state === "loaded" && entries.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
          <Sparkles className="h-12 w-12 text-muted-foreground/50" />
          <div>
            <p className="text-sm text-muted-foreground">
              No skills defined yet.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Create a skill to define reusable slash commands.
            </p>
          </div>
        </div>
      )}

      {entries.length > 0 && (
        <div className="grid gap-2">
          {entries.map((skill) => (
            <SkillCard
              key={`${skill.scope}/${skill.directory}`}
              skill={skill}
              isSelected={
                selectedKey?.scope === skill.scope &&
                selectedKey?.directory === skill.directory
              }
              onSelect={() => handleSelect(skill.scope, skill.directory)}
              onDelete={() => handleDelete(skill.scope, skill.directory)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
