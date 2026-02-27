import { invoke } from "./invoke";

export interface SkillEntry {
  directory: string;
  scope: string;
  frontmatter: Record<string, unknown>;
  bodyPreview: string;
}

export async function listSkills(scope?: string): Promise<SkillEntry[]> {
  return invoke<SkillEntry[]>("list_skills", { scope: scope ?? null });
}

export async function readSkill(
  scope: string,
  directory: string,
): Promise<{ frontmatter: Record<string, unknown>; body: string }> {
  return invoke("read_skill", { scope, directory });
}

export async function writeSkill(
  scope: string,
  directory: string,
  frontmatter: Record<string, unknown>,
  body: string,
): Promise<void> {
  return invoke<void>("write_skill", { scope, directory, frontmatter, body });
}

export async function deleteSkill(scope: string, directory: string): Promise<void> {
  return invoke<void>("delete_skill", { scope, directory });
}

export async function readSkillFile(
  scope: string,
  directory: string,
  filename: string,
): Promise<string> {
  return invoke<string>("read_skill_file", { scope, directory, filename });
}

export async function writeSkillFile(
  scope: string,
  directory: string,
  filename: string,
  content: string,
): Promise<void> {
  return invoke<void>("write_skill_file", { scope, directory, filename, content });
}
