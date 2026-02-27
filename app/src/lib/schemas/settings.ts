import { z } from "zod";
import { HookEventSchema } from "./common";

export const HookDefinitionSchema = z.object({
  type: z.enum(["command", "prompt", "agent"]),
  command: z.string().optional(),
  prompt: z.string().optional(),
  timeout: z.number().positive().optional(),
}).refine(
  (h) => {
    if (h.type === "command") return !!h.command;
    if (h.type === "prompt") return !!h.prompt;
    return true;
  },
  { message: "command hooks require 'command', prompt hooks require 'prompt'" }
);

export const HookGroupSchema = z.object({
  matcher: z.string().optional(),
  hooks: z.array(HookDefinitionSchema).min(1),
});

export const McpServerMatcherSchema = z.union([
  z.object({ serverName: z.string() }),
  z.object({ serverCommand: z.array(z.string()) }),
  z.object({ serverUrl: z.string() }),
]);

export const SandboxNetworkSchema = z.object({
  allowedDomains: z.array(z.string()).optional(),
  allowManagedDomainsOnly: z.boolean().optional(),
  allowUnixSockets: z.array(z.string()).optional(),
  allowAllUnixSockets: z.boolean().optional(),
  allowLocalBinding: z.boolean().optional(),
  httpProxyPort: z.number().int().positive().optional(),
  socksProxyPort: z.number().int().positive().optional(),
}).optional();

export const SandboxSchema = z.object({
  enabled: z.boolean().optional(),
  autoAllowBashIfSandboxed: z.boolean().optional(),
  excludedCommands: z.array(z.string()).optional(),
  allowUnsandboxedCommands: z.boolean().optional(),
  network: SandboxNetworkSchema,
  enableWeakerNestedSandbox: z.boolean().optional(),
}).optional();

export const PermissionsSchema = z.object({
  allow: z.array(z.string()).optional(),
  ask: z.array(z.string()).optional(),
  deny: z.array(z.string()).optional(),
  additionalDirectories: z.array(z.string()).optional(),
  defaultMode: z.enum(["acceptEdits", "reviewAll"]).optional(),
  disableBypassPermissionsMode: z.literal("disable").optional(),
}).optional();

// Build hooks as a partial record of HookEvent -> HookGroup[]
const HookGroupArraySchema = z.array(HookGroupSchema);
const HooksRecordSchema = z.record(HookEventSchema, HookGroupArraySchema).optional();

export const SettingsSchema = z.object({
  permissions: PermissionsSchema,
  hooks: HooksRecordSchema,
  disableAllHooks: z.boolean().optional(),
  allowManagedHooksOnly: z.boolean().optional(),

  // MCP policy
  allowManagedMcpServersOnly: z.boolean().optional(),
  enableAllProjectMcpServers: z.boolean().optional(),
  enabledMcpjsonServers: z.array(z.string()).optional(),
  disabledMcpjsonServers: z.array(z.string()).optional(),
  allowedMcpServers: z.array(McpServerMatcherSchema).optional(),
  deniedMcpServers: z.array(McpServerMatcherSchema).optional(),

  // Sandbox
  sandbox: SandboxSchema,

  // Env
  env: z.record(z.string(), z.string()).optional(),
  apiKeyHelper: z.string().optional(),
  otelHeadersHelper: z.string().optional(),
  awsAuthRefresh: z.string().optional(),
  awsCredentialExport: z.string().optional(),

  // Model & Display
  model: z.string().optional(),
  availableModels: z.array(z.string()).optional(),
  outputStyle: z.string().optional(),
  language: z.string().optional(),
  statusLine: z.object({ type: z.literal("command"), command: z.string() }).optional(),
  fileSuggestion: z.object({ type: z.literal("command"), command: z.string() }).optional(),
  respectGitignore: z.boolean().optional(),
  prefersReducedMotion: z.boolean().optional(),
  spinnerTipsEnabled: z.boolean().optional(),
  spinnerTipsOverride: z.object({
    excludeDefault: z.boolean().optional(),
    tips: z.array(z.string()).optional(),
  }).optional(),
  spinnerVerbs: z.object({
    mode: z.enum(["append", "replace"]).optional(),
    verbs: z.array(z.string()).optional(),
  }).optional(),
  terminalProgressBarEnabled: z.boolean().optional(),
  showTurnDuration: z.boolean().optional(),
  alwaysThinkingEnabled: z.boolean().optional(),
  attribution: z.object({
    commit: z.string().optional(),
    pr: z.string().optional(),
  }).optional(),
  companyAnnouncements: z.array(z.string()).optional(),

  // Plugins
  enabledPlugins: z.record(z.string(), z.boolean()).optional(),
  extraKnownMarketplaces: z.record(z.string(), z.unknown()).optional(),
  strictKnownMarketplaces: z.array(z.object({})).optional(),
  blockedMarketplaces: z.array(z.object({})).optional(),

  // Session & Advanced
  cleanupPeriodDays: z.number().int().positive().optional(),
  plansDirectory: z.string().optional(),
  forceLoginMethod: z.enum(["claudeai", "console"]).optional(),
  forceLoginOrgUUID: z.string().optional(),
  autoUpdatesChannel: z.string().optional(),
  teammatesMode: z.string().optional(),
}).passthrough(); // Allow unknown keys to pass through
