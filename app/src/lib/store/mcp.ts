import { create } from "zustand";
import type { LoadStatus } from "@/types";
import type { McpConfig, McpServerDefinition } from "@/lib/schemas/mcp";
import { readMcpConfig, writeMcpConfig, readManagedMcp, type McpSource, type WritableMcpSource } from "@/lib/ipc/mcp";
import { createDebouncedSaver } from "@/lib/config/debounce";

interface McpStore {
  project: McpConfig | null | undefined;
  user: McpConfig | null | undefined;
  managed: McpConfig | null | undefined;

  status: Record<McpSource, LoadStatus>;

  load: (source: McpSource) => Promise<void>;
  loadAll: () => Promise<void>;
  addServer: (source: WritableMcpSource, name: string, def: McpServerDefinition) => void;
  updateServer: (source: WritableMcpSource, name: string, def: McpServerDefinition) => void;
  removeServer: (source: WritableMcpSource, name: string) => void;
  save: (source: WritableMcpSource) => Promise<void>;
  getForSource: (source: McpSource) => McpConfig | null | undefined;
}

const debouncedSave = createDebouncedSaver(500);

export const useMcpStore = create<McpStore>((set, get) => ({
  project: undefined,
  user: undefined,
  managed: undefined,

  status: {
    project: { state: "idle" },
    user: { state: "idle" },
    managed: { state: "idle" },
  },

  load: async (source) => {
    set((s) => ({ status: { ...s.status, [source]: { state: "loading" } } }));
    try {
      const data = source === "managed"
        ? await readManagedMcp()
        : await readMcpConfig(source);
      set((s) => ({
        [source]: data,
        status: { ...s.status, [source]: { state: "loaded" } },
      }));
    } catch (error) {
      set((s) => ({
        status: { ...s.status, [source]: { state: "error", error } },
      }));
    }
  },

  loadAll: async () => {
    const { load } = get();
    await Promise.all([
      load("project"),
      load("user"),
      load("managed"),
    ]);
  },

  getForSource: (source) => {
    const state = get();
    return state[source];
  },

  addServer: (source, name, def) => {
    const state = get();
    const current = state[source] ?? { mcpServers: {} };
    const updated: McpConfig = {
      mcpServers: { ...current.mcpServers, [name]: def },
    };

    set({ [source]: updated } as Partial<McpStore>);
    debouncedSave(source, () => get().save(source));
  },

  updateServer: (source, name, def) => {
    const state = get();
    const current = state[source] ?? { mcpServers: {} };
    const updated: McpConfig = {
      mcpServers: { ...current.mcpServers, [name]: def },
    };

    set({ [source]: updated } as Partial<McpStore>);
    debouncedSave(source, () => get().save(source));
  },

  removeServer: (source, name) => {
    const state = get();
    const current = state[source] ?? { mcpServers: {} };
    const { [name]: _, ...rest } = current.mcpServers;
    const updated: McpConfig = { mcpServers: rest };

    set({ [source]: updated } as Partial<McpStore>);
    debouncedSave(source, () => get().save(source));
  },

  save: async (source) => {
    const state = get();
    const config = state[source];
    if (!config) return;

    try {
      await writeMcpConfig(source, config);
      set((s) => ({
        status: { ...s.status, [source]: { state: "loaded" } },
      }));
    } catch (error) {
      set((s) => ({
        status: { ...s.status, [source]: { state: "error", error } },
      }));
    }
  },
}));
