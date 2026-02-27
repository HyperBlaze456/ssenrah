import { useEffect, useCallback, useState } from "react";
import { useMemoryStore } from "@/lib/store/memory";
import { ErrorBanner } from "@/components/shared/ErrorBanner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import type { MemoryScope } from "@/types";

const SCOPES: { value: MemoryScope; label: string; description: string }[] = [
  { value: "user", label: "User", description: "~/.claude/CLAUDE.md -- shared across all projects" },
  { value: "project", label: "Project", description: ".claude/CLAUDE.md -- shared with team via git" },
  { value: "project_root", label: "Project Root", description: "CLAUDE.md -- at the repo root" },
  { value: "local", label: "Local", description: ".claude/CLAUDE.local.md -- local only, not committed" },
];

function LineCount({ content }: { content: string | null | undefined }) {
  if (!content) return null;
  const lines = content.split("\n").length;
  return (
    <span className="text-xs text-muted-foreground">
      {lines} {lines === 1 ? "line" : "lines"}
    </span>
  );
}

function ScopeEditor({ scope }: { scope: MemoryScope }) {
  const content = useMemoryStore((s) => s.getForScope(scope));
  const status = useMemoryStore((s) => s.status[scope]);
  const isDirty = useMemoryStore((s) => s.isDirty(scope));
  const update = useMemoryStore((s) => s.update);
  const load = useMemoryStore((s) => s.load);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      update(scope, e.target.value);
    },
    [scope, update],
  );

  if (status.state === "error") {
    return <ErrorBanner error={status.error} onRetry={() => load(scope)} />;
  }

  const isLoading = status.state === "loading" || content === undefined;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LineCount content={content} />
          {isDirty && (
            <Badge variant="outline" className="text-[10px] text-orange-400 border-orange-400/30">
              unsaved
            </Badge>
          )}
        </div>
        {status.state === "loading" && (
          <span className="text-xs text-muted-foreground">Loading...</span>
        )}
      </div>
      <Textarea
        value={content ?? ""}
        onChange={handleChange}
        disabled={isLoading}
        placeholder={
          content === null
            ? "No memory file exists at this scope yet. Start typing to create one."
            : "Enter markdown instructions for Claude..."
        }
        className="min-h-[400px] font-mono text-sm resize-y"
        spellCheck={false}
      />
    </div>
  );
}

export function MemoryPanel() {
  const loadAll = useMemoryStore((s) => s.loadAll);
  const [activeTab, setActiveTab] = useState<string>("user");

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-muted-foreground">
          Memory files (CLAUDE.md) contain markdown instructions that Claude reads at the start of
          each session. Each scope provides a different level of persistence and sharing.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full justify-start">
          {SCOPES.map((s) => (
            <TabsTrigger key={s.value} value={s.value}>
              {s.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {SCOPES.map((s) => (
          <TabsContent key={s.value} value={s.value} className="space-y-3 pt-2">
            <p className="text-xs text-muted-foreground">{s.description}</p>
            <ScopeEditor scope={s.value} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
