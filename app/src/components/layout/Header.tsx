import { useProjectStore } from "@/lib/store/project";
import { ProjectPicker } from "@/components/layout/ProjectPicker";
import { Tooltip } from "@/components/ui/tooltip";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

function useTheme() {
  const [dark, setDark] = useState(() => {
    if (typeof window === "undefined") return false;
    return document.documentElement.classList.contains("dark") ||
      (!localStorage.getItem("theme") && window.matchMedia("(prefers-color-scheme: dark)").matches);
  });

  useEffect(() => {
    if (dark) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }, [dark]);

  return { dark, toggle: () => setDark((d) => !d) };
}

export function Header() {
  const platformInfo = useProjectStore((s) => s.platformInfo);
  const { dark, toggle } = useTheme();

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-card px-4" data-tauri-drag-region>
      <div className="flex items-center gap-3">
        <img src="/logo.png" alt="ssenrah" className="h-7 w-7" />
        <h1 className="text-lg font-bold tracking-tight text-primary">ssenrah</h1>
        {platformInfo && !platformInfo.claudeCodeInstalled && (
          <span className="text-xs text-muted-foreground">(Claude Code not detected)</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <ProjectPicker />
        <Tooltip content={dark ? "Switch to light mode" : "Switch to dark mode"} side="bottom">
          <button
            onClick={toggle}
            className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent transition-colors"
          >
            {dark ? (
              <Sun className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Moon className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
        </Tooltip>
      </div>
    </header>
  );
}
