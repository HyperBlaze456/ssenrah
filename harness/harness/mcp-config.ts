import fs from "fs";
import os from "os";
import path from "path";
import type { RiskLevel } from "./policy-engine";

export const DEFAULT_MCP_CONFIG_PATH = ".ssenrah/mcp.servers.json";

export type EnvironmentMap = Record<string, string | undefined>;

export interface McpAllowlistConfig {
  tools?: string[];
  resources?: string[];
  prompts?: string[];
  toolRisks?: Record<string, RiskLevel>;
  resourceRisks?: Record<string, RiskLevel>;
  promptRisks?: Record<string, RiskLevel>;
}

export interface McpServerConfig {
  transport?: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  allowlist?: McpAllowlistConfig;
}

export interface ResolvedMcpServerConfig {
  transport: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
  allowlist?: McpAllowlistConfig;
}

export interface McpHarnessConfig {
  servers: Record<string, McpServerConfig>;
}

export interface ResolvedMcpHarnessConfig {
  servers: Record<string, ResolvedMcpServerConfig>;
}

export interface ResolveMcpHarnessConfigEnvOptions {
  env?: EnvironmentMap;
  source?: string;
  allowEmptyServers?: boolean;
}

export interface LoadMcpHarnessConfigOptions extends ResolveMcpHarnessConfigEnvOptions {
  optional?: boolean;
}

const ENV_VAR_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SERVER_KEYS = new Set(["transport", "command", "args", "env", "cwd", "allowlist"]);
const ALLOWLIST_KEYS = new Set([
  "tools",
  "resources",
  "prompts",
  "toolRisks",
  "resourceRisks",
  "promptRisks",
]);

export function parseMcpHarnessConfig(raw: unknown, source?: string): McpHarnessConfig {
  const servers = extractServerMap(raw, source);
  const parsedServers: Record<string, McpServerConfig> = {};

  for (const [serverName, rawServer] of Object.entries(servers)) {
    if (serverName.trim().length === 0) {
      throw new Error(`${prefix(source)}MCP server names must be non-empty strings`);
    }
    parsedServers[serverName] = parseServerConfig(serverName, rawServer, source);
  }

  if (Object.keys(parsedServers).length === 0) {
    throw new Error(`${prefix(source)}MCP config must define at least one server`);
  }

  return { servers: parsedServers };
}

export function resolveMcpHarnessConfigEnv(
  config: McpHarnessConfig,
  options: ResolveMcpHarnessConfigEnvOptions = {}
): ResolvedMcpHarnessConfig {
  const env = options.env ?? process.env;
  const source = options.source;
  const serverEntries = Object.entries(config.servers ?? {});

  if (!options.allowEmptyServers && serverEntries.length === 0) {
    throw new Error(`${prefix(source)}MCP config must define at least one server`);
  }

  const resolvedServers: Record<string, ResolvedMcpServerConfig> = {};

  for (const [serverName, server] of serverEntries) {
    const transport = (server.transport ?? "stdio").toLowerCase();
    if (transport !== "stdio") {
      throw new Error(
        `${prefix(source)}MCP server '${serverName}' uses unsupported transport '${transport}'. Only stdio is supported`
      );
    }

    const command = interpolateEnvString(server.command, env, `${serverName}.command`);
    const args = (server.args ?? []).map((arg, index) => interpolateEnvString(arg, env, `${serverName}.args[${index}]`));

    const resolvedEnv: Record<string, string> = {};
    for (const [name, value] of Object.entries(server.env ?? {})) {
      resolvedEnv[name] = interpolateEnvString(value, env, `${serverName}.env.${name}`);
    }

    let cwd: string | undefined;
    if (server.cwd !== undefined) {
      cwd = interpolateEnvString(server.cwd, env, `${serverName}.cwd`);
    }

    resolvedServers[serverName] = {
      transport: "stdio",
      command,
      args,
      env: resolvedEnv,
      ...(cwd !== undefined ? { cwd } : {}),
      ...(server.allowlist !== undefined ? { allowlist: cloneAllowlist(server.allowlist) } : {}),
    };
  }

  return { servers: resolvedServers };
}

export function loadMcpHarnessConfig(
  filePath: string,
  options: LoadMcpHarnessConfigOptions = {}
): ResolvedMcpHarnessConfig {
  const resolvedPath = resolveConfigPath(filePath);
  const source = options.source ?? resolvedPath;

  let rawText: string;
  try {
    rawText = fs.readFileSync(resolvedPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT" && options.optional) {
      return { servers: {} };
    }
    throw new Error(`${prefix(source)}Failed to read MCP config file: ${toErrorMessage(error)}`);
  }

  let rawConfig: unknown;
  try {
    rawConfig = JSON.parse(rawText);
  } catch (error) {
    throw new Error(`${prefix(source)}Invalid JSON in MCP config file: ${toErrorMessage(error)}`);
  }

  const parsed = parseMcpHarnessConfig(rawConfig, source);
  return resolveMcpHarnessConfigEnv(parsed, { ...options, source });
}

export function interpolateEnvString(
  value: string,
  env: EnvironmentMap = process.env,
  context: string = "value"
): string {
  let output = "";
  let cursor = 0;

  while (cursor < value.length) {
    const start = value.indexOf("${", cursor);
    if (start === -1) {
      output += value.slice(cursor);
      break;
    }

    output += value.slice(cursor, start);

    const end = value.indexOf("}", start + 2);
    if (end === -1) {
      throw new Error(`Unclosed environment placeholder in ${context}: '${value}'`);
    }

    const variableName = value.slice(start + 2, end);
    if (variableName.length === 0) {
      throw new Error(`Empty environment placeholder in ${context}: '${value}'`);
    }

    if (!ENV_VAR_NAME_PATTERN.test(variableName)) {
      throw new Error(`Invalid environment variable name '${variableName}' in ${context}`);
    }

    const resolved = env[variableName];
    if (resolved === undefined) {
      throw new Error(`Environment variable '${variableName}' referenced in ${context} is not set`);
    }

    output += resolved;
    cursor = end + 1;
  }

  return output;
}

function extractServerMap(rawConfig: unknown, source?: string): Record<string, unknown> {
  const config = asObject(rawConfig, `${prefix(source)}MCP config`);

  const hasMcpServers = "mcpServers" in config;
  const hasServers = "servers" in config;

  if (hasMcpServers && hasServers) {
    throw new Error(`${prefix(source)}MCP config cannot include both 'mcpServers' and 'servers'`);
  }

  if (hasMcpServers) {
    return asObject(config.mcpServers, `${prefix(source)}MCP config.mcpServers`);
  }

  if (hasServers) {
    return asObject(config.servers, `${prefix(source)}MCP config.servers`);
  }

  return config;
}

function parseServerConfig(serverName: string, rawServer: unknown, source?: string): McpServerConfig {
  const context = `${prefix(source)}MCP server '${serverName}'`;
  const server = asObject(rawServer, context);
  ensureOnlyKnownKeys(server, SERVER_KEYS, context);

  const transport = parseOptionalTransport(server.transport, `${context}.transport`);
  const command = asNonEmptyString(server.command, `${context}.command`);

  let args: string[] | undefined;
  if (server.args !== undefined) {
    args = asStringArray(server.args, `${context}.args`);
  }

  let env: Record<string, string> | undefined;
  if (server.env !== undefined) {
    env = parseServerEnv(server.env, `${context}.env`);
  }

  let cwd: string | undefined;
  if (server.cwd !== undefined) {
    cwd = asNonEmptyString(server.cwd, `${context}.cwd`);
  }

  let allowlist: McpAllowlistConfig | undefined;
  if (server.allowlist !== undefined) {
    allowlist = parseAllowlist(server.allowlist, `${context}.allowlist`);
  }

  return {
    ...(transport !== undefined ? { transport } : {}),
    command,
    ...(args !== undefined ? { args } : {}),
    ...(env !== undefined ? { env } : {}),
    ...(cwd !== undefined ? { cwd } : {}),
    ...(allowlist !== undefined ? { allowlist } : {}),
  };
}

function parseOptionalTransport(value: unknown, context: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const transport = asNonEmptyString(value, context).toLowerCase();
  if (transport !== "stdio") {
    throw new Error(`${context} must be 'stdio' when provided`);
  }
  return transport;
}

function parseServerEnv(value: unknown, context: string): Record<string, string> {
  const envObject = asObject(value, context);
  const parsed: Record<string, string> = {};

  for (const [name, rawValue] of Object.entries(envObject)) {
    if (!ENV_VAR_NAME_PATTERN.test(name)) {
      throw new Error(`${context} contains invalid variable name '${name}'`);
    }
    parsed[name] = asString(rawValue, `${context}.${name}`);
  }

  return parsed;
}

function parseAllowlist(value: unknown, context: string): McpAllowlistConfig {
  const allowlist = asObject(value, context);
  ensureOnlyKnownKeys(allowlist, ALLOWLIST_KEYS, context);

  const tools = allowlist.tools !== undefined ? asStringArray(allowlist.tools, `${context}.tools`) : undefined;
  const resources =
    allowlist.resources !== undefined ? asStringArray(allowlist.resources, `${context}.resources`) : undefined;
  const prompts = allowlist.prompts !== undefined ? asStringArray(allowlist.prompts, `${context}.prompts`) : undefined;
  const toolRisks =
    allowlist.toolRisks !== undefined
      ? parseRiskMap(allowlist.toolRisks, `${context}.toolRisks`)
      : undefined;
  const resourceRisks =
    allowlist.resourceRisks !== undefined
      ? parseRiskMap(allowlist.resourceRisks, `${context}.resourceRisks`)
      : undefined;
  const promptRisks =
    allowlist.promptRisks !== undefined
      ? parseRiskMap(allowlist.promptRisks, `${context}.promptRisks`)
      : undefined;

  assertAllowlistRisks({
    tools,
    resources,
    prompts,
    toolRisks,
    resourceRisks,
    promptRisks,
    context,
  });

  return {
    ...(tools !== undefined ? { tools } : {}),
    ...(resources !== undefined ? { resources } : {}),
    ...(prompts !== undefined ? { prompts } : {}),
    ...(toolRisks !== undefined ? { toolRisks } : {}),
    ...(resourceRisks !== undefined ? { resourceRisks } : {}),
    ...(promptRisks !== undefined ? { promptRisks } : {}),
  };
}

function cloneAllowlist(allowlist: McpAllowlistConfig): McpAllowlistConfig {
  return {
    ...(allowlist.tools !== undefined ? { tools: [...allowlist.tools] } : {}),
    ...(allowlist.resources !== undefined ? { resources: [...allowlist.resources] } : {}),
    ...(allowlist.prompts !== undefined ? { prompts: [...allowlist.prompts] } : {}),
    ...(allowlist.toolRisks !== undefined
      ? { toolRisks: { ...allowlist.toolRisks } }
      : {}),
    ...(allowlist.resourceRisks !== undefined
      ? { resourceRisks: { ...allowlist.resourceRisks } }
      : {}),
    ...(allowlist.promptRisks !== undefined
      ? { promptRisks: { ...allowlist.promptRisks } }
      : {}),
  };
}

function parseRiskMap(value: unknown, context: string): Record<string, RiskLevel> {
  const riskMap = asObject(value, context);
  const parsed: Record<string, RiskLevel> = {};
  for (const [key, rawRisk] of Object.entries(riskMap)) {
    if (key.trim().length === 0) {
      throw new Error(`${context} contains an empty endpoint key`);
    }
    if (!isRiskLevel(rawRisk)) {
      throw new Error(
        `${context}.${key} must be one of read|write|exec|destructive`
      );
    }
    parsed[key] = rawRisk;
  }
  return parsed;
}

function isRiskLevel(value: unknown): value is RiskLevel {
  return (
    value === "read" ||
    value === "write" ||
    value === "exec" ||
    value === "destructive"
  );
}

function assertAllowlistRisks(input: {
  tools?: string[];
  resources?: string[];
  prompts?: string[];
  toolRisks?: Record<string, RiskLevel>;
  resourceRisks?: Record<string, RiskLevel>;
  promptRisks?: Record<string, RiskLevel>;
  context: string;
}): void {
  const {
    tools,
    resources,
    prompts,
    toolRisks,
    resourceRisks,
    promptRisks,
    context,
  } = input;

  for (const tool of tools ?? []) {
    if (!toolRisks?.[tool]) {
      throw new Error(`${context}.toolRisks is missing risk for tool "${tool}"`);
    }
  }
  for (const resource of resources ?? []) {
    if (!resourceRisks?.[resource]) {
      throw new Error(
        `${context}.resourceRisks is missing risk for resource "${resource}"`
      );
    }
  }
  for (const prompt of prompts ?? []) {
    if (!promptRisks?.[prompt]) {
      throw new Error(
        `${context}.promptRisks is missing risk for prompt "${prompt}"`
      );
    }
  }
}

function ensureOnlyKnownKeys(value: Record<string, unknown>, allowedKeys: Set<string>, context: string): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`${context} contains unknown key '${key}'`);
    }
  }
}

function asObject(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, context: string): string {
  if (typeof value !== "string") {
    throw new Error(`${context} must be a string`);
  }
  return value;
}

function asNonEmptyString(value: unknown, context: string): string {
  const parsed = asString(value, context);
  if (parsed.trim().length === 0) {
    throw new Error(`${context} must be a non-empty string`);
  }
  return parsed;
}

function asStringArray(value: unknown, context: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${context} must be an array of strings`);
  }

  return value.map((entry, index) => asString(entry, `${context}[${index}]`));
}

function resolveConfigPath(filePath: string): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  if (filePath.startsWith("~/")) {
    return path.join(os.homedir(), filePath.slice(2));
  }

  return path.resolve(filePath);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return typeof value === "object" && value !== null && "message" in value;
}

function toErrorMessage(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  return String(value);
}

function prefix(source?: string): string {
  return source === undefined ? "" : `[${source}] `;
}
