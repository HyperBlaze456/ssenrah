import { create } from "zustand";
import type { ConfigScope, LoadStatus, Settings, WritableScope } from "@/types";
import { readSettings, writeSettings } from "../ipc/settings";
import { SettingsSchema } from "../schemas/settings";
import { createDebouncedSaver } from "../config/debounce";

type DirtyFields = {
  user: Set<string>;
  project: Set<string>;
  local: Set<string>;
};

interface SettingsStore {
  user: Settings | null | undefined;
  project: Settings | null | undefined;
  local: Settings | null | undefined;
  managed: Settings | null | undefined;

  status: Record<ConfigScope, LoadStatus>;
  dirtyFields: DirtyFields;

  load: (scope: ConfigScope) => Promise<void>;
  loadAll: () => Promise<void>;
  getForScope: (scope: ConfigScope) => Settings | null | undefined;
  update: (scope: WritableScope, path: string, value: unknown) => void;
  save: (scope: WritableScope) => Promise<void>;
  clearDirty: (scope: WritableScope) => void;
  reloadFromDisk: (scope: ConfigScope) => Promise<void>;
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const result = { ...obj };
  const keys = path.split(".");
  let current: Record<string, unknown> = result;
  for (let i = 0; i < keys.length - 1; i++) {
    current[keys[i]] = { ...(current[keys[i]] as Record<string, unknown> | undefined) };
    current = current[keys[i]] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
  return result;
}

const debouncedSaver = createDebouncedSaver(500);

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  user: undefined,
  project: undefined,
  local: undefined,
  managed: undefined,

  status: {
    user: { state: "idle" },
    project: { state: "idle" },
    local: { state: "idle" },
    managed: { state: "idle" },
  },

  dirtyFields: {
    user: new Set<string>(),
    project: new Set<string>(),
    local: new Set<string>(),
  },

  load: async (scope) => {
    set((s) => ({ status: { ...s.status, [scope]: { state: "loading" } } }));
    try {
      const data = await readSettings(scope);
      set((s) => ({
        [scope]: data,
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
    await Promise.all([
      load("user"),
      load("project"),
      load("local"),
      load("managed"),
    ]);
  },

  getForScope: (scope) => {
    const state = get();
    return state[scope as keyof Pick<typeof state, "user" | "project" | "local" | "managed">];
  },

  update: (scope, path, value) => {
    const state = get();
    const current = (state[scope] ?? {}) as Record<string, unknown>;
    const updated = setNestedValue(current, path, value) as Settings;

    const newDirty = {
      ...state.dirtyFields,
      [scope]: new Set([...state.dirtyFields[scope], path]),
    };

    set({
      [scope]: updated,
      dirtyFields: newDirty,
    } as Partial<SettingsStore>);

    debouncedSaver(scope, () => get().save(scope));
  },

  save: async (scope) => {
    const state = get();
    const settings = state[scope];
    if (!settings) return;

    // Validate with Zod before saving
    const result = SettingsSchema.safeParse(settings);
    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
        code: issue.code,
      }));
      set((s) => ({
        status: {
          ...s.status,
          [scope]: { state: "error", error: { kind: "validation_error" as const, errors } },
        },
      }));
      return;
    }

    try {
      await writeSettings(scope, settings);
      // Clear dirty fields on success
      set((s) => ({
        dirtyFields: {
          ...s.dirtyFields,
          [scope]: new Set<string>(),
        },
        status: { ...s.status, [scope]: { state: "loaded" } },
      }));
    } catch (error) {
      set((s) => ({
        status: { ...s.status, [scope]: { state: "error", error } },
      }));
    }
  },

  clearDirty: (scope) => {
    set((s) => ({
      dirtyFields: {
        ...s.dirtyFields,
        [scope]: new Set<string>(),
      },
    }));
  },

  reloadFromDisk: async (scope) => {
    const { load, clearDirty } = get();
    if (scope !== "managed") {
      clearDirty(scope as WritableScope);
    }
    await load(scope);
  },
}));
