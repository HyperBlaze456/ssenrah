import { z } from "zod";

export const AgentFrontmatterSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/, "Must be lowercase with hyphens"),
  description: z.string().min(1),
  tools: z.string().optional(),
  disallowedTools: z.string().optional(),
  model: z.enum(["sonnet", "opus", "haiku", "inherit"]).optional(),
  permissionMode: z
    .enum(["default", "acceptEdits", "dontAsk", "bypassPermissions", "plan"])
    .optional(),
  maxTurns: z.number().int().min(1).max(100).optional(),
  skills: z.array(z.string()).optional(),
  background: z.boolean().optional(),
  isolation: z.literal("worktree").optional(),
  memory: z.enum(["user", "project", "local"]).optional(),
});

export type AgentFrontmatter = z.infer<typeof AgentFrontmatterSchema>;
