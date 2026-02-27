import { z } from "zod";

export const PluginManifestSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/, "Plugin name must be kebab-case"),
  version: z.string(),
  description: z.string(),
  author: z.object({
    name: z.string(),
    email: z.string().optional(),
    url: z.string().optional(),
  }).optional(),
  homepage: z.string().optional(),
  repository: z.string().optional(),
  license: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  commands: z.union([z.string(), z.array(z.string())]).optional(),
  agents: z.union([z.string(), z.array(z.string())]).optional(),
  skills: z.union([z.string(), z.array(z.string())]).optional(),
  hooks: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  mcpServers: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  lspServers: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  outputStyles: z.union([z.string(), z.array(z.string())]).optional(),
});
