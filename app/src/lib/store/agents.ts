import { create } from "zustand";
import type { LoadStatus, AgentScope } from "@/types";
import {
  listAgents,
  readAgent,
  writeAgent,
  deleteAgent,
  type AgentEntry,
} from "../ipc/agents";

interface AgentDetail {
  frontmatter: Record<string, unknown>;
  body: string;
}

interface AgentsStore {
  /** Flat list of all agents across scopes. */
  entries: AgentEntry[];
  /** Currently selected agent detail (loaded on demand). */
  selected: AgentDetail | null;
  selectedKey: { scope: string; filename: string } | null;

  listStatus: LoadStatus;
  detailStatus: LoadStatus;

  loadList: (scope?: AgentScope) => Promise<void>;
  loadDetail: (scope: string, filename: string) => Promise<void>;
  clearSelection: () => void;
  saveAgent: (
    scope: string,
    filename: string,
    frontmatter: Record<string, unknown>,
    body: string,
  ) => Promise<void>;
  removeAgent: (scope: string, filename: string) => Promise<void>;
}

export const useAgentsStore = create<AgentsStore>((set, get) => ({
  entries: [],
  selected: null,
  selectedKey: null,

  listStatus: { state: "idle" },
  detailStatus: { state: "idle" },

  loadList: async (scope) => {
    set({ listStatus: { state: "loading" } });
    try {
      const entries = await listAgents(scope);
      set({ entries, listStatus: { state: "loaded" } });
    } catch (error) {
      set({ listStatus: { state: "error", error } as LoadStatus });
    }
  },

  loadDetail: async (scope, filename) => {
    set({ detailStatus: { state: "loading" }, selectedKey: { scope, filename } });
    try {
      const detail = await readAgent(scope, filename);
      set({ selected: detail, detailStatus: { state: "loaded" } });
    } catch (error) {
      set({ selected: null, detailStatus: { state: "error", error } as LoadStatus });
    }
  },

  clearSelection: () => {
    set({ selected: null, selectedKey: null, detailStatus: { state: "idle" } });
  },

  saveAgent: async (scope, filename, frontmatter, body) => {
    await writeAgent(scope, filename, frontmatter, body);
    // Reload list to reflect changes
    await get().loadList();
  },

  removeAgent: async (scope, filename) => {
    await deleteAgent(scope, filename);
    const state = get();
    // If the deleted agent was selected, clear selection
    if (state.selectedKey?.scope === scope && state.selectedKey?.filename === filename) {
      set({ selected: null, selectedKey: null, detailStatus: { state: "idle" } });
    }
    // Reload list
    await get().loadList();
  },
}));
