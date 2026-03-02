import type { ToolDefinition } from "../agent/types";
import type { RiskLevel } from "./policy-engine";
import { inferRiskLevel } from "./risk-inference";

export interface McpToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpDiscoveredTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: McpToolAnnotations;
  riskLevel?: RiskLevel;
  risk?: RiskLevel;
}

export interface McpDiscoveredResource {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface McpDiscoveredPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface McpDiscoveredPrompt {
  name: string;
  description?: string;
  arguments?: McpDiscoveredPromptArgument[];
}

export interface McpClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listTools(): Promise<McpDiscoveredTool[]>;
  callTool(name: string, input: Record<string, unknown>): Promise<unknown>;
  listResources?(): Promise<McpDiscoveredResource[]>;
  readResource?(uri: string): Promise<unknown>;
  listPrompts?(): Promise<McpDiscoveredPrompt[]>;
  getPrompt?(name: string, args?: Record<string, unknown>): Promise<unknown>;
}

export interface McpExposureAllowlist {
  tools?: string[];
  resources?: string[];
  prompts?: string[];
  toolRisks?: Record<string, RiskLevel>;
  resourceRisks?: Record<string, RiskLevel>;
  promptRisks?: Record<string, RiskLevel>;
  exposeResources?: boolean;
  exposePrompts?: boolean;
}

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  allowlist?: McpExposureAllowlist;
  client?: McpClient;
}

export interface McpRuntimeConfig {
  servers: McpServerConfig[];
}

export interface McpRuntimeOptions {
  config: McpRuntimeConfig;
  clientFactory?: (server: McpServerConfig) => McpClient;
}

export interface McpServerDiscovery {
  server: string;
  tools: McpDiscoveredTool[];
  resources: McpDiscoveredResource[];
  prompts: McpDiscoveredPrompt[];
}

export interface McpPackDefinitions {
  mcp?: ToolDefinition[];
  [packName: string]: ToolDefinition[] | undefined;
}

export interface McpServerDiagnostic {
  server: string;
  connected: boolean;
  discoveredTools: number;
  discoveredResources: number;
  discoveredPrompts: number;
  exposedTools: string[];
  errors: string[];
}

function sanitizeNameSegment(value: string): string {
  const normalized = value.trim().toLowerCase();
  const sanitized = normalized.replace(/[^a-z0-9_.-]+/g, "_");
  return sanitized.replace(/^_+|_+$/g, "") || "unnamed";
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return "unknown error";
}

function serializeToolOutput(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeInput(input: Record<string, unknown> | undefined): Record<string, unknown> {
  return isRecord(input) ? input : {};
}

function asSet(values?: string[]): Set<string> | null {
  if (!values) {
    return null;
  }
  return new Set(values);
}

function isRiskLevel(value: unknown): value is RiskLevel {
  return value === "read" || value === "write" || value === "exec" || value === "destructive";
}

function inferDiscoveredToolRisk(tool: McpDiscoveredTool): RiskLevel {
  const explicitRisk = tool.riskLevel ?? tool.risk;
  if (isRiskLevel(explicitRisk)) {
    return explicitRisk;
  }
  if (tool.annotations?.destructiveHint === true) {
    return "destructive";
  }
  if (tool.annotations?.readOnlyHint === true) {
    return "read";
  }
  return inferRiskLevel(tool.name);
}

function isToolAllowed(
  allowlist: Set<string> | null,
  namespacedToolName: string,
  rawToolName: string
): boolean {
  if (!allowlist) {
    return true;
  }
  return allowlist.has(rawToolName) || allowlist.has(namespacedToolName);
}

function isAllowedValue(allowlist: Set<string> | null, value: string): boolean {
  return !allowlist || allowlist.has(value);
}

const RISK_LEVEL_ORDER: Readonly<Record<RiskLevel, number>> = {
  read: 0,
  write: 1,
  exec: 2,
  destructive: 3,
};

function maxRisk(
  current: RiskLevel | undefined,
  next: RiskLevel
): RiskLevel {
  if (!current) return next;
  return RISK_LEVEL_ORDER[next] >= RISK_LEVEL_ORDER[current] ? next : current;
}

function filterResources(
  resources: McpDiscoveredResource[],
  allowlist: Set<string> | null
): McpDiscoveredResource[] {
  if (!allowlist) {
    return resources;
  }
  return resources.filter((resource) => allowlist.has(resource.uri));
}

function filterPrompts(
  prompts: McpDiscoveredPrompt[],
  allowlist: Set<string> | null
): McpDiscoveredPrompt[] {
  if (!allowlist) {
    return prompts;
  }
  return prompts.filter((prompt) => allowlist.has(prompt.name));
}

function makeEmptyInputSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {},
    required: [],
  };
}

function makeResourceReadInputSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      uri: {
        type: "string",
        description: "Resource URI to read.",
      },
    },
    required: ["uri"],
  };
}

function makePromptGetInputSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Prompt name to resolve.",
      },
      arguments: {
        type: "object",
        description: "Optional prompt arguments object.",
      },
    },
    required: ["name"],
  };
}

function cloneToolDefinitions(tools: ToolDefinition[]): ToolDefinition[] {
  return tools.map((tool) => ({ ...tool }));
}

function cloneDiagnostics(diagnostics: McpServerDiagnostic[]): McpServerDiagnostic[] {
  return diagnostics.map((item) => ({
    ...item,
    exposedTools: [...item.exposedTools],
    errors: [...item.errors],
  }));
}

function clonePackDefinitions(packDefinitions: McpPackDefinitions): McpPackDefinitions {
  const cloned: McpPackDefinitions = {};
  for (const [packName, tools] of Object.entries(packDefinitions)) {
    if (!tools) {
      continue;
    }
    cloned[packName] = cloneToolDefinitions(tools);
  }
  return cloned;
}

export function buildMcpToolName(server: string, toolName: string): string {
  return `mcp.${sanitizeNameSegment(server)}.tool.${sanitizeNameSegment(toolName)}`;
}

export function buildMcpResourceListToolName(server: string): string {
  return `mcp.${sanitizeNameSegment(server)}.resources.list`;
}

export function buildMcpResourceReadToolName(server: string): string {
  return `mcp.${sanitizeNameSegment(server)}.resources.read`;
}

export function buildMcpPromptListToolName(server: string): string {
  return `mcp.${sanitizeNameSegment(server)}.prompts.list`;
}

export function buildMcpPromptGetToolName(server: string): string {
  return `mcp.${sanitizeNameSegment(server)}.prompts.get`;
}

export class McpRuntime {
  private readonly servers: McpServerConfig[];
  private readonly clientFactory?: (server: McpServerConfig) => McpClient;
  private readonly clients = new Map<string, McpClient>();

  private started = false;
  private discovery: McpServerDiscovery[] = [];
  private toolDefinitions: ToolDefinition[] = [];
  private riskOverrides: Record<string, RiskLevel> = {};
  private diagnostics: McpServerDiagnostic[] = [];
  private packDefinitions: McpPackDefinitions = {};

  constructor(options: McpRuntimeOptions) {
    this.clientFactory = options.clientFactory;
    this.servers = options.config.servers.map((server) => ({
      ...server,
      name: server.name.trim(),
    }));
    this.validateServerConfig();
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    await this.connectClients();
    await this.refreshCaches();
    this.started = true;
  }

  async stop(): Promise<void> {
    const disconnects = Array.from(this.clients.values()).map((client) =>
      client.disconnect()
    );

    this.clients.clear();
    this.started = false;
    this.discovery = [];
    this.toolDefinitions = [];
    this.riskOverrides = {};
    this.diagnostics = [];
    this.packDefinitions = {};

    const results = await Promise.allSettled(disconnects);
    const firstRejection = results.find((result) => result.status === "rejected");
    if (firstRejection && firstRejection.status === "rejected") {
      throw firstRejection.reason;
    }
  }

  async getToolDefinitions(): Promise<ToolDefinition[]> {
    await this.ensureStarted();
    return cloneToolDefinitions(this.toolDefinitions);
  }

  async getRiskOverrides(): Promise<Record<string, RiskLevel>> {
    await this.ensureStarted();
    return { ...this.riskOverrides };
  }

  async getDiagnostics(): Promise<McpServerDiagnostic[]> {
    await this.ensureStarted();
    return cloneDiagnostics(this.diagnostics);
  }

  async getPackDefinitions(): Promise<McpPackDefinitions> {
    await this.ensureStarted();
    return clonePackDefinitions(this.packDefinitions);
  }

  private async ensureStarted(): Promise<void> {
    if (!this.started) {
      await this.start();
    }
  }

  private async connectClients(): Promise<void> {
    const connectedClients: Array<[string, McpClient]> = [];

    try {
      for (const server of this.servers) {
        const client = this.resolveClient(server);
        await client.connect();
        connectedClients.push([server.name, client]);
      }
    } catch (error) {
      await Promise.allSettled(
        connectedClients.map(([, client]) => client.disconnect())
      );
      throw error;
    }

    for (const [serverName, client] of connectedClients) {
      this.clients.set(serverName, client);
    }
  }

  private resolveClient(server: McpServerConfig): McpClient {
    if (this.clientFactory) {
      return this.clientFactory(server);
    }
    if (server.client) {
      return server.client;
    }
    throw new Error(
      `No MCP clientFactory provided and no injected client configured for "${server.name}"`
    );
  }

  private async refreshCaches(): Promise<void> {
    const discovery: McpServerDiscovery[] = [];
    const diagnostics: McpServerDiagnostic[] = [];
    const riskOverrides: Record<string, RiskLevel> = {};
    const packDefinitions: McpPackDefinitions = {};
    const allTools: ToolDefinition[] = [];

    for (const server of this.servers) {
      const client = this.clients.get(server.name);
      if (!client) {
        diagnostics.push({
          server: server.name,
          connected: false,
          discoveredTools: 0,
          discoveredResources: 0,
          discoveredPrompts: 0,
          exposedTools: [],
          errors: ["client_not_connected"],
        });
        continue;
      }

      const errors: string[] = [];
      const discoveredTools = await this.safeListTools(client, server.name, errors);
      const discoveredResources = await this.safeListResources(client, server.name, errors);
      const discoveredPrompts = await this.safeListPrompts(client, server.name, errors);

      discovery.push({
        server: server.name,
        tools: discoveredTools,
        resources: discoveredResources,
        prompts: discoveredPrompts,
      });

      const serverPack = this.buildServerPack({
        server,
        client,
        discoveredTools,
        discoveredResources,
        discoveredPrompts,
        riskOverrides,
      });

      if (serverPack.length > 0) {
        const packName = `mcp.${sanitizeNameSegment(server.name)}`;
        packDefinitions[packName] = serverPack;
        allTools.push(...serverPack);
      }

      diagnostics.push({
        server: server.name,
        connected: true,
        discoveredTools: discoveredTools.length,
        discoveredResources: discoveredResources.length,
        discoveredPrompts: discoveredPrompts.length,
        exposedTools: serverPack.map((tool) => tool.name),
        errors,
      });
    }

    if (allTools.length > 0) {
      packDefinitions["mcp"] = allTools;
    }

    this.discovery = discovery;
    this.toolDefinitions = allTools;
    this.riskOverrides = riskOverrides;
    this.diagnostics = diagnostics;
    this.packDefinitions = packDefinitions;
  }

  private async safeListTools(
    client: McpClient,
    serverName: string,
    errors: string[]
  ): Promise<McpDiscoveredTool[]> {
    try {
      return await client.listTools();
    } catch (error) {
      errors.push(`list_tools_failed: ${toErrorMessage(error)}`);
      return [];
    }
  }

  private async safeListResources(
    client: McpClient,
    serverName: string,
    errors: string[]
  ): Promise<McpDiscoveredResource[]> {
    if (!client.listResources) {
      return [];
    }
    try {
      return await client.listResources();
    } catch (error) {
      errors.push(`list_resources_failed: ${toErrorMessage(error)}`);
      return [];
    }
  }

  private async safeListPrompts(
    client: McpClient,
    serverName: string,
    errors: string[]
  ): Promise<McpDiscoveredPrompt[]> {
    if (!client.listPrompts) {
      return [];
    }
    try {
      return await client.listPrompts();
    } catch (error) {
      errors.push(`list_prompts_failed: ${toErrorMessage(error)}`);
      return [];
    }
  }

  private buildServerPack(input: {
    server: McpServerConfig;
    client: McpClient;
    discoveredTools: McpDiscoveredTool[];
    discoveredResources: McpDiscoveredResource[];
    discoveredPrompts: McpDiscoveredPrompt[];
    riskOverrides: Record<string, RiskLevel>;
  }): ToolDefinition[] {
    const {
      server,
      client,
      discoveredTools,
      discoveredResources,
      discoveredPrompts,
      riskOverrides,
    } = input;

    const toolAllowlist = asSet(server.allowlist?.tools);
    const resourceAllowlist = asSet(server.allowlist?.resources);
    const promptAllowlist = asSet(server.allowlist?.prompts);
    const toolRiskMap = server.allowlist?.toolRisks ?? {};
    const resourceRiskMap = server.allowlist?.resourceRisks ?? {};
    const promptRiskMap = server.allowlist?.promptRisks ?? {};

    const pack: ToolDefinition[] = [];

    for (const discoveredTool of discoveredTools) {
      const namespacedToolName = buildMcpToolName(server.name, discoveredTool.name);
      if (!isToolAllowed(toolAllowlist, namespacedToolName, discoveredTool.name)) {
        continue;
      }

      pack.push({
        name: namespacedToolName,
        description:
          discoveredTool.description ||
          `Invoke MCP tool "${discoveredTool.name}" on "${server.name}".`,
        inputSchema: discoveredTool.inputSchema ?? makeEmptyInputSchema(),
        run: async (inputValue) => {
          try {
            const result = await client.callTool(
              discoveredTool.name,
              normalizeInput(inputValue)
            );
            return serializeToolOutput(result);
          } catch (error) {
            return `Error running MCP tool "${discoveredTool.name}" on "${server.name}": ${toErrorMessage(
              error
            )}`;
          }
        },
      });

      riskOverrides[namespacedToolName] =
        toolRiskMap[discoveredTool.name] ??
        toolRiskMap[namespacedToolName] ??
        inferDiscoveredToolRisk(discoveredTool);
    }

    if (this.shouldExposeResourceTools(server, client)) {
      const listName = buildMcpResourceListToolName(server.name);
      const readName = buildMcpResourceReadToolName(server.name);
      let resourceRisk: RiskLevel | undefined;
      for (const resource of discoveredResources) {
        if (!isAllowedValue(resourceAllowlist, resource.uri)) {
          continue;
        }
        const configuredRisk = resourceRiskMap[resource.uri];
        resourceRisk = maxRisk(resourceRisk, configuredRisk ?? "read");
      }

      pack.push({
        name: listName,
        description: `List MCP resources exposed by "${server.name}".`,
        inputSchema: makeEmptyInputSchema(),
        run: async () => {
          if (!client.listResources) {
            return `Error: MCP server "${server.name}" does not support resources`;
          }
          try {
            const resources = await client.listResources();
            return serializeToolOutput(filterResources(resources, resourceAllowlist));
          } catch (error) {
            return `Error listing MCP resources on "${server.name}": ${toErrorMessage(
              error
            )}`;
          }
        },
      });

      pack.push({
        name: readName,
        description: `Read an MCP resource from "${server.name}".`,
        inputSchema: makeResourceReadInputSchema(),
        run: async (inputValue) => {
          if (!client.readResource) {
            return `Error: MCP server "${server.name}" does not support resource reads`;
          }

          const uriValue = inputValue["uri"];
          const uri = typeof uriValue === "string" ? uriValue.trim() : "";
          if (!uri) {
            return `Error reading MCP resource on "${server.name}": "uri" must be a non-empty string`;
          }
          if (!isAllowedValue(resourceAllowlist, uri)) {
            return `Error: resource "${uri}" is not allowlisted for "${server.name}"`;
          }

          try {
            const result = await client.readResource(uri);
            return serializeToolOutput(result);
          } catch (error) {
            return `Error reading MCP resource "${uri}" on "${server.name}": ${toErrorMessage(
              error
            )}`;
          }
        },
      });

      riskOverrides[listName] = resourceRisk ?? "read";
      riskOverrides[readName] = resourceRisk ?? "read";
    }

    if (this.shouldExposePromptTools(server, client)) {
      const listName = buildMcpPromptListToolName(server.name);
      const getName = buildMcpPromptGetToolName(server.name);
      let promptRisk: RiskLevel | undefined;
      for (const prompt of discoveredPrompts) {
        if (!isAllowedValue(promptAllowlist, prompt.name)) {
          continue;
        }
        const configuredRisk = promptRiskMap[prompt.name];
        promptRisk = maxRisk(promptRisk, configuredRisk ?? "read");
      }

      pack.push({
        name: listName,
        description: `List MCP prompts exposed by "${server.name}".`,
        inputSchema: makeEmptyInputSchema(),
        run: async () => {
          if (!client.listPrompts) {
            return `Error: MCP server "${server.name}" does not support prompts`;
          }
          try {
            const prompts = await client.listPrompts();
            return serializeToolOutput(filterPrompts(prompts, promptAllowlist));
          } catch (error) {
            return `Error listing MCP prompts on "${server.name}": ${toErrorMessage(
              error
            )}`;
          }
        },
      });

      pack.push({
        name: getName,
        description: `Resolve an MCP prompt from "${server.name}".`,
        inputSchema: makePromptGetInputSchema(),
        run: async (inputValue) => {
          if (!client.getPrompt) {
            return `Error: MCP server "${server.name}" does not support prompt resolution`;
          }

          const nameValue = inputValue["name"];
          const promptName = typeof nameValue === "string" ? nameValue.trim() : "";
          if (!promptName) {
            return `Error resolving MCP prompt on "${server.name}": "name" must be a non-empty string`;
          }
          if (!isAllowedValue(promptAllowlist, promptName)) {
            return `Error: prompt "${promptName}" is not allowlisted for "${server.name}"`;
          }

          const argsValue = inputValue["arguments"];
          const args = isRecord(argsValue) ? argsValue : undefined;

          try {
            const result = await client.getPrompt(promptName, args);
            return serializeToolOutput(result);
          } catch (error) {
            return `Error resolving MCP prompt "${promptName}" on "${server.name}": ${toErrorMessage(
              error
            )}`;
          }
        },
      });

      riskOverrides[listName] = promptRisk ?? "read";
      riskOverrides[getName] = promptRisk ?? "read";
    }

    return pack;
  }

  private shouldExposeResourceTools(
    server: McpServerConfig,
    client: McpClient
  ): boolean {
    if (server.allowlist?.exposeResources === false) {
      return false;
    }
    if (Array.isArray(server.allowlist?.resources) && server.allowlist?.resources.length === 0) {
      return false;
    }
    return Boolean(client.listResources && client.readResource);
  }

  private shouldExposePromptTools(server: McpServerConfig, client: McpClient): boolean {
    if (server.allowlist?.exposePrompts === false) {
      return false;
    }
    if (Array.isArray(server.allowlist?.prompts) && server.allowlist?.prompts.length === 0) {
      return false;
    }
    return Boolean(client.listPrompts && client.getPrompt);
  }

  private validateServerConfig(): void {
    if (this.servers.length === 0) {
      throw new Error("MCP runtime requires at least one server");
    }

    const seen = new Set<string>();
    const seenSanitized = new Set<string>();
    for (const server of this.servers) {
      if (!server.name) {
        throw new Error("MCP server name must be non-empty");
      }
      if (seen.has(server.name)) {
        throw new Error(`Duplicate MCP server name "${server.name}"`);
      }
      seen.add(server.name);
      const sanitized = sanitizeNameSegment(server.name);
      if (seenSanitized.has(sanitized)) {
        throw new Error(
          `MCP server name "${server.name}" collides after sanitization ("${sanitized}")`
        );
      }
      seenSanitized.add(sanitized);
    }
  }
}
