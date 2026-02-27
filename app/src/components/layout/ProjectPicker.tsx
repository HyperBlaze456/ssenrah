import { useState, useEffect } from "react";
import { useProjectStore } from "@/lib/store/project";
import { useSettingsStore } from "@/lib/store/settings";
import { Button } from "@/components/ui/button";
import { FolderOpen, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const RECENT_KEY = "ssenrah:recent-projects";
const MAX_RECENT = 5;

function getRecentProjects(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  } catch { return []; }
}

function addRecentProject(path: string) {
  const recent = getRecentProjects().filter((p) => p !== path);
  recent.unshift(path);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}

export function ProjectPicker() {
  const info = useProjectStore((s) => s.info);
  const openProject = useProjectStore((s) => s.openProject);
  const loadAll = useSettingsStore((s) => s.loadAll);
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    setRecent(getRecentProjects());
  }, []);

  const handleBrowse = async () => {
    try {
      const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
      const selected = await openDialog({ directory: true, title: "Select project folder" });
      if (selected) {
        await openProject(selected as string);
        addRecentProject(selected as string);
        setRecent(getRecentProjects());
        await loadAll();
      }
    } catch {
      // User cancelled or error
    }
    setOpen(false);
  };

  const handleSelectRecent = async (path: string) => {
    await openProject(path);
    addRecentProject(path);
    setRecent(getRecentProjects());
    await loadAll();
    setOpen(false);
  };

  const currentPath = info?.projectRoot;
  const displayPath = currentPath
    ? currentPath.split("/").slice(-2).join("/")
    : "No project";

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-sm hover:bg-accent"
      >
        <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="max-w-[200px] truncate">{displayPath}</span>
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-md border border-border bg-popover p-2 shadow-md">
            {currentPath && (
              <div className="mb-2 rounded bg-muted/50 px-2 py-1.5">
                <p className="text-xs text-muted-foreground">Current project</p>
                <p className="truncate text-sm font-medium">{currentPath}</p>
              </div>
            )}

            {recent.length > 0 && (
              <div className="mb-2">
                <p className="mb-1 px-1 text-xs text-muted-foreground">Recent</p>
                {recent.map((path) => (
                  <button
                    key={path}
                    onClick={() => handleSelectRecent(path)}
                    className={cn(
                      "flex w-full items-center rounded px-2 py-1 text-left text-sm hover:bg-accent",
                      path === currentPath && "bg-accent/50"
                    )}
                  >
                    <span className="truncate">{path.split("/").slice(-2).join("/")}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="border-t border-border pt-2">
              <Button variant="outline" size="sm" className="w-full" onClick={handleBrowse}>
                <FolderOpen className="mr-2 h-3.5 w-3.5" />
                Browse...
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
