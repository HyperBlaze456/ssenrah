import { invoke } from "./invoke";

export interface AgentEntry {
  filename: string;
  scope: string;
  frontmatter: Record<string, unknown>;
  bodyPreview: string;
}

export async function listAgents(scope?: string): Promise<AgentEntry[]> {
  return invoke<AgentEntry[]>("list_agents", { scope: scope ?? null });
}

export async function readAgent(
  scope: string,
  filename: string,
): Promise<{ frontmatter: Record<string, unknown>; body: string }> {
  return invoke("read_agent", { scope, filename });
}

export async function writeAgent(
  scope: string,
  filename: string,
  frontmatter: Record<string, unknown>,
  body: string,
): Promise<void> {
  return invoke<void>("write_agent", { scope, filename, frontmatter, body });
}

export async function deleteAgent(scope: string, filename: string): Promise<void> {
  return invoke<void>("delete_agent", { scope, filename });
}
