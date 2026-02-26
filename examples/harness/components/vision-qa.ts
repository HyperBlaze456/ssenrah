import path from "path";
import fs from "fs";
import type { AgentRunHook } from "../../agent/types";
import { appendSystemPrompt, mergeToolsByName } from "../hooks";
import { loadMarkdownSkill, renderSkillPrompt } from "../skills";

const DEFAULT_VISION_SKILL_PATH_CANDIDATES = [
  path.join(__dirname, "..", "..", "skills", "vision-qa.md"),
  path.resolve(process.cwd(), "skills", "vision-qa.md"),
  path.resolve(process.cwd(), "examples", "skills", "vision-qa.md"),
];

const DEFAULT_VISION_TOOL_PACKS = ["screenshot", "vision-analysis"];

/**
 * Harness component hook for Vision QA mode:
 * - injects markdown skill instructions
 * - optionally switches to a vision-capable model
 * - injects only the required screenshot/vision tool packs
 */
export function createVisionQAHook(options?: {
  skillPath?: string;
  toolPacks?: string[];
  model?: string;
  activateWhen?: (userMessage: string) => boolean;
}): AgentRunHook {
  const skillPath = options?.skillPath ?? resolveDefaultSkillPath();
  const toolPacks = options?.toolPacks ?? DEFAULT_VISION_TOOL_PACKS;
  const activateWhen =
    options?.activateWhen ??
    ((message: string) => /\b(vision|screenshot|ui qa|ux qa|image qa)\b/i.test(message));

  let cachedPrompt: string | null = null;

  return (context) => {
    if (!activateWhen(context.userMessage)) {
      return;
    }

    if (options?.model && options.model.trim() !== "") {
      context.settings.model = options.model;
    }

    if (context.toolRegistry) {
      const injectedTools = context.toolRegistry.resolvePacks(toolPacks);
      context.settings.tools = mergeToolsByName(
        context.settings.tools,
        injectedTools
      );
    }

    if (!cachedPrompt) {
      const skill = loadMarkdownSkill(skillPath);
      cachedPrompt = renderSkillPrompt(skill);
    }
    appendSystemPrompt(context, cachedPrompt);
  };
}

function resolveDefaultSkillPath(): string {
  for (const candidate of DEFAULT_VISION_SKILL_PATH_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return DEFAULT_VISION_SKILL_PATH_CANDIDATES[0];
}
