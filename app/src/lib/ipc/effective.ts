import { invoke } from "./invoke";
import type { ConfigScope } from "@/types";

export interface EffectiveConfig {
  settings: Record<string, unknown>;
  sources: Record<string, ConfigScope>;
  overrides: Override[];
}

export interface Override {
  path: string;
  effectiveScope: ConfigScope;
  overriddenScopes: ConfigScope[];
  effectiveValue: unknown;
}

export async function computeEffectiveConfig(): Promise<EffectiveConfig> {
  return invoke<EffectiveConfig>("compute_effective_config");
}
