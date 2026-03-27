import { z } from "zod";

export const SkillFrontmatterSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  "argument-hint": z.string().optional(),
  "disable-model-invocation": z.boolean().optional(),
  "user-invocable": z.boolean().optional(),
  "allowed-tools": z.string().optional(),
  model: z.string().optional(),
  effort: z.enum(["low", "medium", "high", "max"]).optional(),
  context: z.literal("fork").optional(),
  agent: z.string().optional(),
  shell: z.enum(["bash", "powershell"]).optional(),
  paths: z.string().optional(),
  memory: z.enum(["user", "project", "local"]).optional(),
  background: z.boolean().optional(),
});

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;
