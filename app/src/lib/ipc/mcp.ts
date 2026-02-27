import { invoke } from "./invoke";
import type { McpConfig } from "@/lib/schemas/mcp";

export type McpSource = "project" | "user" | "managed";
export type WritableMcpSource = "project" | "user";

export async function readMcpConfig(source: McpSource): Promise<McpConfig | null> {
  return invoke<McpConfig | null>("read_mcp_config", { source });
}

export async function writeMcpConfig(source: WritableMcpSource, config: McpConfig): Promise<void> {
  return invoke<void>("write_mcp_config", { source, config });
}

export async function readManagedMcp(): Promise<McpConfig | null> {
  return invoke<McpConfig | null>("read_managed_mcp");
}
