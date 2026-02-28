import fs from "fs";
import path from "path";
import type { AgentRunHook } from "../agent/types";
import { appendSystemPrompt } from "./hooks";

export interface MarkdownSkill {
  name: string;
  path: string;
  summary?: string;
  metadata: Record<string, string>;
  instructions: string;
}

/**
 * Load a markdown skill document (optionally with YAML-like frontmatter).
 */
export function loadMarkdownSkill(skillPath: string): MarkdownSkill {
  const resolved = path.resolve(skillPath);
  const raw = fs.readFileSync(resolved, "utf-8");
  const { metadata, body } = splitFrontmatter(raw);

  const name =
    metadata["name"] ??
    path.basename(resolved, path.extname(resolved));

  return {
    name,
    path: resolved,
    summary: metadata["description"],
    metadata,
    instructions: body.trim(),
  };
}

/**
 * Format skill instructions into a system-prompt block.
 */
export function renderSkillPrompt(skill: MarkdownSkill): string {
  const headline = `Skill: ${skill.name}`;
  return `${headline}\n${"-".repeat(headline.length)}\n${skill.instructions}`;
}

/**
 * Hook that injects a markdown skill prompt when activation condition matches.
 */
export function createMarkdownSkillHook(
  skillPath: string,
  options?: {
    activateWhen?: (userMessage: string) => boolean;
  }
): AgentRunHook {
  let cached: MarkdownSkill | null = null;

  return (context) => {
    if (options?.activateWhen && !options.activateWhen(context.userMessage)) {
      return;
    }

    cached = cached ?? loadMarkdownSkill(skillPath);
    appendSystemPrompt(context, renderSkillPrompt(cached));
  };
}

function splitFrontmatter(raw: string): {
  metadata: Record<string, string>;
  body: string;
} {
  const trimmedStart = raw.trimStart();
  if (!trimmedStart.startsWith("---")) {
    return { metadata: {}, body: raw };
  }

  const lines = trimmedStart.split(/\r?\n/);
  if (lines.length < 3) {
    return { metadata: {}, body: raw };
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      endIndex = i;
      break;
    }
  }
  if (endIndex === -1) {
    return { metadata: {}, body: raw };
  }

  const metadata: Record<string, string> = {};
  for (const line of lines.slice(1, endIndex)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!key) continue;
    metadata[key] = stripWrappingQuotes(value);
  }

  const body = lines.slice(endIndex + 1).join("\n");
  return { metadata, body };
}

function stripWrappingQuotes(value: string): string {
  if (value.length < 2) return value;
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
