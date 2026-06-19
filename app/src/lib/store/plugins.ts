import { create } from "zustand";
import type {
  InstalledPluginsFile,
  KnownMarketplaces,
  LoadStatus,
  WritableScope,
} from "@/types";
import {
  readInstalledPlugins,
  readKnownMarketplaces,
  removeInstalledPlugin,
  removeKnownMarketplace,
} from "../ipc/plugins";

interface PluginsStore {
  installed: InstalledPluginsFile | null;
  marketplaces: KnownMarketplaces | null;
  installedStatus: LoadStatus;
  marketplacesStatus: LoadStatus;

  loadInstalled: () => Promise<void>;
  loadMarketplaces: () => Promise<void>;
  loadAll: () => Promise<void>;

  removePlugin: (pluginId: string, scope?: WritableScope) => Promise<void>;
  removeMarketplace: (name: string) => Promise<void>;
}

export const usePluginsStore = create<PluginsStore>((set, get) => ({
  installed: null,
  marketplaces: null,
  installedStatus: { state: "idle" },
  marketplacesStatus: { state: "idle" },

  loadInstalled: async () => {
    set({ installedStatus: { state: "loading" } });
    try {
      const data = await readInstalledPlugins();
      set({ installed: data, installedStatus: { state: "loaded" } });
    } catch (error) {
      console.error("[plugins] read_installed_plugins failed:", error);
      set({ installedStatus: { state: "error", error: error as never } });
    }
  },

  loadMarketplaces: async () => {
    set({ marketplacesStatus: { state: "loading" } });
    try {
      const data = await readKnownMarketplaces();
      set({ marketplaces: data, marketplacesStatus: { state: "loaded" } });
    } catch (error) {
      console.error("[plugins] read_known_marketplaces failed:", error);
      set({ marketplacesStatus: { state: "error", error: error as never } });
    }
  },

  loadAll: async () => {
    const { loadInstalled, loadMarketplaces } = get();
    await Promise.all([loadInstalled(), loadMarketplaces()]);
  },

  removePlugin: async (pluginId, scope) => {
    await removeInstalledPlugin(pluginId, scope);
    await get().loadInstalled();
  },

  removeMarketplace: async (name) => {
    await removeKnownMarketplace(name);
    await get().loadMarketplaces();
  },
}));
