import { useUiStore } from "@/lib/store/ui";
import { useProjectStore } from "@/lib/store/project";
import { PANELS, type ConfigScope } from "@/types";
import { ScopeBadge } from "../shared/ScopeBadge";
import { cn } from "@/lib/utils";
import * as Icons from "lucide-react";
import { PanelLeft } from "lucide-react";

const SCOPE_OPTIONS: { value: ConfigScope; label: string }[] = [
  { value: "user", label: "User" },
  { value: "project", label: "Project" },
  { value: "local", label: "Local" },
  { value: "managed", label: "Managed" },
];

function getPanelIcon(iconName: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const LucideIcon = (Icons as any)[iconName];
  return LucideIcon || Icons.Circle;
}

export function Sidebar() {
  const activePanel = useUiStore((s) => s.activePanel);
  const activeScope = useUiStore((s) => s.activeScope);
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const setPanel = useUiStore((s) => s.setPanel);
  const setScope = useUiStore((s) => s.setScope);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const projectInfo = useProjectStore((s) => s.info);

  const hasProject = !!projectInfo?.projectRoot;

  return (
    <aside
      className={cn(
        "flex flex-col border-r border-border bg-card transition-all duration-200",
        collapsed ? "w-12" : "w-60"
      )}
    >
      {/* Collapse toggle */}
      <button
        onClick={toggleSidebar}
        className="flex h-8 items-center justify-center hover:bg-accent"
      >
        <PanelLeft className={cn("h-4 w-4 text-muted-foreground transition-transform", collapsed && "rotate-180")} />
      </button>

      {/* Scope selector */}
      {!collapsed && (
        <div className="border-b border-border px-3 pb-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Scope</p>
          <div className="flex flex-col gap-1">
            {SCOPE_OPTIONS.map((opt) => {
              const disabled =
                (opt.value === "project" || opt.value === "local") && !hasProject;
              return (
                <button
                  key={opt.value}
                  onClick={() => !disabled && setScope(opt.value)}
                  disabled={disabled}
                  className={cn(
                    "flex items-center gap-2 rounded px-2 py-1 text-sm transition-colors",
                    activeScope === opt.value
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50",
                    disabled && "cursor-not-allowed opacity-40"
                  )}
                >
                  <ScopeBadge scope={opt.value} />
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Panel navigation */}
      <nav className="flex-1 overflow-y-auto px-1 py-2">
        {!collapsed && (
          <p className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Panels</p>
        )}
        {PANELS.map((panel) => {
          const Icon = getPanelIcon(panel.icon);
          const isActive = activePanel === panel.id;
          const scopeAvailable = panel.id === "effective" || panel.scopes.includes(activeScope);
          return (
            <button
              key={panel.id}
              onClick={() => setPanel(panel.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground hover:bg-accent",
                !scopeAvailable && "opacity-40"
              )}
              title={collapsed ? panel.label : undefined}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span>{panel.label}</span>}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
