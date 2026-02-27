import { create } from "zustand";
import type { PanelId, ConfigScope, ConflictInfo } from "@/types";

interface UiStore {
  activePanel: PanelId;
  activeScope: ConfigScope;
  sidebarCollapsed: boolean;
  effectiveConfigExpanded: boolean;
  conflicts: ConflictInfo[];

  setPanel: (panel: PanelId) => void;
  setScope: (scope: ConfigScope) => void;
  toggleSidebar: () => void;
  toggleEffectiveConfig: () => void;
  addConflict: (conflict: ConflictInfo) => void;
  resolveConflict: (id: string, resolution: "keep_mine" | "reload") => void;
}

export const useUiStore = create<UiStore>((set) => ({
  activePanel: "permissions",
  activeScope: "user",
  sidebarCollapsed: false,
  effectiveConfigExpanded: false,
  conflicts: [],

  setPanel: (panel) => set({ activePanel: panel }),
  setScope: (scope) => set({ activeScope: scope }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toggleEffectiveConfig: () => set((s) => ({ effectiveConfigExpanded: !s.effectiveConfigExpanded })),
  addConflict: (conflict) => set((s) => ({ conflicts: [...s.conflicts, conflict] })),
  resolveConflict: (id, _resolution) => set((s) => ({ conflicts: s.conflicts.filter((c) => c.id !== id) })),
}));
