import { z } from "zod";

export const McpStdioServerSchema = z.object({
  type: z.literal("stdio").optional(),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export const McpHttpServerSchema = z.object({
  type: z.literal("http"),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
  oauth: z.object({
    clientId: z.string(),
    callbackPort: z.number().optional(),
  }).optional(),
});

export const McpSseServerSchema = z.object({
  type: z.literal("sse"),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
});

export const McpServerDefinitionSchema = z.union([
  McpStdioServerSchema,
  McpHttpServerSchema,
  McpSseServerSchema,
]);

export const McpConfigSchema = z.object({
  mcpServers: z.record(z.string(), McpServerDefinitionSchema),
});

export type McpServerDefinition = z.infer<typeof McpServerDefinitionSchema>;
export type McpConfig = z.infer<typeof McpConfigSchema>;
