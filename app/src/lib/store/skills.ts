import { create } from "zustand";
import type { LoadStatus, SkillScope } from "@/types";
import {
  listSkills,
  readSkill,
  writeSkill,
  deleteSkill,
  type SkillEntry,
} from "../ipc/skills";

interface SkillDetail {
  frontmatter: Record<string, unknown>;
  body: string;
}

interface SkillsStore {
  /** Flat list of all skills across scopes. */
  entries: SkillEntry[];
  /** Currently selected skill detail (loaded on demand). */
  selected: SkillDetail | null;
  selectedKey: { scope: string; directory: string } | null;

  listStatus: LoadStatus;
  detailStatus: LoadStatus;

  loadList: (scope?: SkillScope) => Promise<void>;
  loadDetail: (scope: string, directory: string) => Promise<void>;
  clearSelection: () => void;
  saveSkill: (
    scope: string,
    directory: string,
    frontmatter: Record<string, unknown>,
    body: string,
  ) => Promise<void>;
  removeSkill: (scope: string, directory: string) => Promise<void>;
}

export const useSkillsStore = create<SkillsStore>((set, get) => ({
  entries: [],
  selected: null,
  selectedKey: null,

  listStatus: { state: "idle" },
  detailStatus: { state: "idle" },

  loadList: async (scope) => {
    set({ listStatus: { state: "loading" } });
    try {
      const entries = await listSkills(scope);
      set({ entries, listStatus: { state: "loaded" } });
    } catch (error) {
      set({ listStatus: { state: "error", error } as LoadStatus });
    }
  },

  loadDetail: async (scope, directory) => {
    set({ detailStatus: { state: "loading" }, selectedKey: { scope, directory } });
    try {
      const detail = await readSkill(scope, directory);
      set({ selected: detail, detailStatus: { state: "loaded" } });
    } catch (error) {
      set({ selected: null, detailStatus: { state: "error", error } as LoadStatus });
    }
  },

  clearSelection: () => {
    set({ selected: null, selectedKey: null, detailStatus: { state: "idle" } });
  },

  saveSkill: async (scope, directory, frontmatter, body) => {
    await writeSkill(scope, directory, frontmatter, body);
    await get().loadList();
  },

  removeSkill: async (scope, directory) => {
    await deleteSkill(scope, directory);
    const state = get();
    if (state.selectedKey?.scope === scope && state.selectedKey?.directory === directory) {
      set({ selected: null, selectedKey: null, detailStatus: { state: "idle" } });
    }
    await get().loadList();
  },
}));
