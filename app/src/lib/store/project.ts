import { create } from "zustand";
import type { PlatformInfo, ProjectInfo } from "@/types";
import { getPlatformInfo, getProjectInfo, openProject as ipcOpenProject } from "../ipc/platform";

interface ProjectStore {
  info: ProjectInfo | null;
  platformInfo: PlatformInfo | null;
  loading: boolean;

  initialize: () => Promise<void>;
  openProject: (path: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export const useProjectStore = create<ProjectStore>((set) => ({
  info: null,
  platformInfo: null,
  loading: false,

  initialize: async () => {
    set({ loading: true });
    try {
      const [platformInfo, info] = await Promise.all([
        getPlatformInfo(),
        getProjectInfo(),
      ]);
      set({ platformInfo, info, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  openProject: async (path) => {
    set({ loading: true });
    try {
      const info = await ipcOpenProject(path);
      set({ info, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  refresh: async () => {
    try {
      const info = await getProjectInfo();
      set({ info });
    } catch {
      // ignore
    }
  },
}));
