import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { PanelId, ConfigScope, ConflictInfo, Provider } from "@/types";

interface UiStore {
  activePanel: PanelId;
  activeScope: ConfigScope;
  activeProvider: Provider;
  sidebarCollapsed: boolean;
  effectiveConfigExpanded: boolean;
  conflicts: ConflictInfo[];

  setPanel: (panel: PanelId) => void;
  setScope: (scope: ConfigScope) => void;
  setProvider: (provider: Provider) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  toggleEffectiveConfig: () => void;
  addConflict: (conflict: ConflictInfo) => void;
  resolveConflict: (id: string, resolution: "keep_mine" | "reload") => void;
}

export const useUiStore = create<UiStore>()(
  persist(
    (set) => ({
      activePanel: "permissions",
      activeScope: "user",
      activeProvider: "claude",
      sidebarCollapsed: false,
      effectiveConfigExpanded: false,
      conflicts: [],

      setPanel: (panel) => set({ activePanel: panel }),
      setScope: (scope) => set({ activeScope: scope }),
      setProvider: (provider) =>
        set((state) => {
          // Codex has no config panels — bounce to a safe monitor panel when switching to it.
          if (provider === "codex") {
            const isConfigPanel = ["permissions", "hooks", "mcp", "memory", "agents", "skills", "plugins", "sandbox", "env", "display", "advanced", "effective"].includes(state.activePanel);
            return {
              activeProvider: provider,
              activePanel: isConfigPanel ? "activity" : state.activePanel,
            };
          }
          return { activeProvider: provider };
        }),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      toggleEffectiveConfig: () => set((s) => ({ effectiveConfigExpanded: !s.effectiveConfigExpanded })),
      addConflict: (conflict) => set((s) => ({ conflicts: [...s.conflicts, conflict] })),
      resolveConflict: (id, _resolution) => set((s) => ({ conflicts: s.conflicts.filter((c) => c.id !== id) })),
    }),
    {
      name: "ssenrah-ui",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        activeProvider: state.activeProvider,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    },
  ),
);
