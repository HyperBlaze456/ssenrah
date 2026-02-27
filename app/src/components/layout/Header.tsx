import { useProjectStore } from "@/lib/store/project";
import { ProjectPicker } from "@/components/layout/ProjectPicker";
import { Settings } from "lucide-react";

export function Header() {
  const platformInfo = useProjectStore((s) => s.platformInfo);

  return (
    <header className="flex h-12 items-center justify-between border-b border-border bg-card px-4">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-bold tracking-tight text-primary">ssenrah</h1>
        {platformInfo && !platformInfo.claudeCodeInstalled && (
          <span className="text-xs text-muted-foreground">(Claude Code not detected)</span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <ProjectPicker />
        <button className="rounded p-1 hover:bg-accent">
          <Settings className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>
    </header>
  );
}
