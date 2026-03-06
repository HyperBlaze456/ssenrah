import { useUiStore } from "@/lib/store/ui";
import { useProjectStore } from "@/lib/store/project";
import { PANELS, type ConfigScope } from "@/types";
import { ScopeBadge } from "../shared/ScopeBadge";
import { Tooltip } from "@/components/ui/tooltip";
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
        "flex flex-col border-r border-sidebar-border bg-sidebar transition-all duration-200",
        collapsed ? "w-14" : "w-60"
      )}
    >
      {/* Collapse toggle */}
      <div className="flex items-center border-b border-sidebar-border px-2 py-2">
        <Tooltip content={collapsed ? "Expand sidebar" : "Collapse sidebar"} side="right">
          <button
            onClick={toggleSidebar}
            className="flex h-7 w-7 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
          >
            <PanelLeft className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} />
          </button>
        </Tooltip>
        {!collapsed && (
          <span className="ml-2 text-xs font-medium text-sidebar-foreground/50 uppercase tracking-wider">
            Navigation
          </span>
        )}
      </div>

      {/* Scope selector */}
      <div className={cn("border-b border-sidebar-border", collapsed ? "px-1.5 py-2" : "px-3 py-3")}>
        {!collapsed && (
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-sidebar-foreground/50">Scope</p>
        )}
        <div className={cn("flex gap-1", collapsed ? "flex-col items-center" : "flex-col")}>
          {SCOPE_OPTIONS.map((opt) => {
            const disabled =
              (opt.value === "project" || opt.value === "local") && !hasProject;
            const btn = (
              <button
                key={opt.value}
                onClick={() => !disabled && setScope(opt.value)}
                disabled={disabled}
                className={cn(
                  "flex items-center gap-2 rounded-md text-sm transition-colors",
                  collapsed ? "justify-center px-1.5 py-1" : "px-2 py-1",
                  activeScope === opt.value
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                  disabled && "cursor-not-allowed opacity-30"
                )}
              >
                <ScopeBadge scope={opt.value} />
                {!collapsed && opt.label}
              </button>
            );
            if (collapsed) {
              return (
                <Tooltip key={opt.value} content={`${opt.label}${disabled ? " (no project)" : ""}`} side="right">
                  {btn}
                </Tooltip>
              );
            }
            return btn;
          })}
        </div>
      </div>

      {/* Panel navigation */}
      <nav className={cn("flex-1 overflow-y-auto py-2", collapsed ? "px-1.5" : "px-2")}>
        {!collapsed && (
          <p className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-sidebar-foreground/50">Panels</p>
        )}
        <div className="flex flex-col gap-0.5">
          {PANELS.map((panel) => {
            const Icon = getPanelIcon(panel.icon);
            const isActive = activePanel === panel.id;
            const scopeAvailable = panel.id === "effective" || panel.scopes.includes(activeScope);
            const btn = (
              <button
                key={panel.id}
                onClick={() => scopeAvailable && setPanel(panel.id)}
                disabled={!scopeAvailable}
                className={cn(
                  "flex w-full items-center rounded-md text-sm transition-colors",
                  collapsed ? "justify-center px-2 py-2" : "gap-2 px-2 py-1.5",
                  isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  !scopeAvailable && "opacity-30 cursor-not-allowed hover:bg-transparent"
                )}
              >
                <Icon className={cn("shrink-0", collapsed ? "h-[18px] w-[18px]" : "h-4 w-4")} />
                {!collapsed && <span>{panel.label}</span>}
              </button>
            );
            if (collapsed) {
              return (
                <Tooltip key={panel.id} content={`${panel.label}${!scopeAvailable ? " (not available)" : ""}`} side="right">
                  {btn}
                </Tooltip>
              );
            }
            return btn;
          })}
        </div>
      </nav>
    </aside>
  );
}
