import { create } from "zustand";
import type { LoadStatus, MemoryScope } from "@/types";
import { readMemory, writeMemory } from "../ipc/memory";
import { createDebouncedSaver } from "../config/debounce";

const MEMORY_SCOPES: MemoryScope[] = ["user", "project", "project_root", "local"];

interface MemoryStore {
  user: string | null | undefined;
  project: string | null | undefined;
  projectRoot: string | null | undefined;
  local: string | null | undefined;

  dirtyScopes: Set<MemoryScope>;
  status: Record<MemoryScope, LoadStatus>;

  load: (scope: MemoryScope) => Promise<void>;
  loadAll: () => Promise<void>;
  getForScope: (scope: MemoryScope) => string | null | undefined;
  update: (scope: MemoryScope, content: string) => void;
  save: (scope: MemoryScope) => Promise<void>;
  isDirty: (scope: MemoryScope) => boolean;
}

/** Map MemoryScope to the store property key. */
function scopeKey(scope: MemoryScope): "user" | "project" | "projectRoot" | "local" {
  if (scope === "project_root") return "projectRoot";
  return scope;
}

const debouncedSaver = createDebouncedSaver(800);

export const useMemoryStore = create<MemoryStore>((set, get) => ({
  user: undefined,
  project: undefined,
  projectRoot: undefined,
  local: undefined,

  dirtyScopes: new Set<MemoryScope>(),

  status: {
    user: { state: "idle" },
    project: { state: "idle" },
    project_root: { state: "idle" },
    local: { state: "idle" },
  },

  load: async (scope) => {
    set((s) => ({
      status: { ...s.status, [scope]: { state: "loading" } },
    }));
    try {
      const content = await readMemory(scope);
      const key = scopeKey(scope);
      set((s) => ({
        [key]: content,
        status: { ...s.status, [scope]: { state: "loaded" } },
      }));
    } catch (error) {
      set((s) => ({
        status: { ...s.status, [scope]: { state: "error", error } },
      }));
    }
  },

  loadAll: async () => {
    const { load } = get();
    await Promise.all(MEMORY_SCOPES.map((s) => load(s)));
  },

  getForScope: (scope) => {
    const state = get();
    return state[scopeKey(scope)];
  },

  update: (scope, content) => {
    const key = scopeKey(scope);
    const newDirty = new Set(get().dirtyScopes);
    newDirty.add(scope);

    set({
      [key]: content,
      dirtyScopes: newDirty,
    } as Partial<MemoryStore>);

    debouncedSaver(scope, () => get().save(scope));
  },

  save: async (scope) => {
    const state = get();
    const content = state[scopeKey(scope)];
    if (content === null || content === undefined) return;

    try {
      await writeMemory(scope, content);
      const newDirty = new Set(state.dirtyScopes);
      newDirty.delete(scope);
      set((s) => ({
        dirtyScopes: newDirty,
        status: { ...s.status, [scope]: { state: "loaded" } },
      }));
    } catch (error) {
      set((s) => ({
        status: { ...s.status, [scope]: { state: "error", error } },
      }));
    }
  },

  isDirty: (scope) => {
    return get().dirtyScopes.has(scope);
  },
}));
