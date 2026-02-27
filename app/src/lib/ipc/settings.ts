import { invoke } from "./invoke";
import type { ConfigScope, WritableScope, Settings } from "@/types";

export async function readSettings(scope: ConfigScope): Promise<Settings | null> {
  return invoke<Settings | null>("read_settings", { scope });
}

export async function writeSettings(scope: WritableScope, settings: Settings): Promise<void> {
  return invoke<void>("write_settings", { scope, settings });
}

export async function ensureClaudeDir(): Promise<void> {
  return invoke<void>("ensure_claude_dir");
}
