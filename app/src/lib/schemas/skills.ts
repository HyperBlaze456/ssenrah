import { z } from "zod";

export const SkillFrontmatterSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  "argument-hint": z.string().optional(),
  "disable-model-invocation": z.boolean().optional(),
  "user-invocable": z.boolean().optional(),
  "allowed-tools": z.string().optional(),
  model: z.string().optional(),
  context: z.literal("fork").optional(),
  agent: z.string().optional(),
});

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;
