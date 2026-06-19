import { invoke } from "./invoke";
import type {
  InstalledPluginsFile,
  KnownMarketplaces,
  WritableScope,
} from "@/types";

export async function readInstalledPlugins(): Promise<InstalledPluginsFile | null> {
  return invoke<InstalledPluginsFile | null>("read_installed_plugins");
}

export async function readKnownMarketplaces(): Promise<KnownMarketplaces | null> {
  return invoke<KnownMarketplaces | null>("read_known_marketplaces");
}

export async function removeInstalledPlugin(
  pluginId: string,
  scope?: WritableScope,
): Promise<void> {
  return invoke<void>("remove_installed_plugin", { pluginId, scope });
}

export async function removeKnownMarketplace(name: string): Promise<void> {
  return invoke<void>("remove_known_marketplace", { name });
}
