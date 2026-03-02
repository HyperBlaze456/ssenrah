import {
  ResolvedMcpHarnessConfig,
  ResolvedMcpServerConfig,
} from "./mcp-config";
import {
  McpClient,
  McpRuntimeConfig,
  McpServerConfig,
} from "./mcp-runtime";
import { McpStdioClient } from "./mcp-stdio-client";

function toRuntimeServerConfig(
  serverName: string,
  server: ResolvedMcpServerConfig
): McpServerConfig {
  return {
    name: serverName,
    command: server.command,
    args: [...server.args],
    env: { ...server.env },
    cwd: server.cwd,
    allowlist: server.allowlist
        ? {
            tools: server.allowlist.tools ? [...server.allowlist.tools] : undefined,
            resources: server.allowlist.resources
              ? [...server.allowlist.resources]
              : undefined,
            prompts: server.allowlist.prompts
              ? [...server.allowlist.prompts]
              : undefined,
            toolRisks: server.allowlist.toolRisks
              ? { ...server.allowlist.toolRisks }
              : undefined,
            resourceRisks: server.allowlist.resourceRisks
              ? { ...server.allowlist.resourceRisks }
              : undefined,
            promptRisks: server.allowlist.promptRisks
              ? { ...server.allowlist.promptRisks }
              : undefined,
          }
        : undefined,
  };
}

export function toMcpRuntimeConfig(
  config: ResolvedMcpHarnessConfig
): McpRuntimeConfig {
  return {
    servers: Object.entries(config.servers).map(([serverName, server]) =>
      toRuntimeServerConfig(serverName, server)
    ),
  };
}

export function createStdioMcpClientFactory(): (
  server: McpServerConfig
) => McpClient {
  return (server: McpServerConfig): McpClient => {
    const client = new McpStdioClient({
      command: server.command,
      args: server.args ?? [],
      cwd: server.cwd,
      env: { ...process.env, ...(server.env ?? {}) },
    });

    return {
      async connect(): Promise<void> {
        await client.initialize();
      },
      async disconnect(): Promise<void> {
        await client.close();
      },
      listTools: () => client.listTools(),
      callTool: (name: string, input: Record<string, unknown>) =>
        client.callTool(name, input),
      listResources: () => client.listResources(),
      readResource: (uri: string) => client.readResource(uri),
      listPrompts: () => client.listPrompts(),
      getPrompt: (name: string, args?: Record<string, unknown>) =>
        client.getPrompt(name, args),
    };
  };
}
