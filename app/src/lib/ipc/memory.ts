import { invoke } from "./invoke";

export async function readMemory(scope: string): Promise<string | null> {
  return invoke<string | null>("read_memory", { scope });
}

export async function writeMemory(scope: string, content: string): Promise<void> {
  return invoke<void>("write_memory", { scope, content });
}
