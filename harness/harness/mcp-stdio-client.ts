import { ChildProcessWithoutNullStreams, spawn } from "child_process";

const FRAME_SEPARATOR = Buffer.from("\r\n\r\n");
const NEWLINE_BYTE = 0x0a;
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const DEFAULT_PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_CLIENT_INFO = {
  name: "ssenrah-harness",
  version: "1.0.0",
};

export interface McpClient {
  initialize(): Promise<McpInitializeResult>;
  listTools(): Promise<McpToolDefinition[]>;
  callTool(name: string, input: Record<string, unknown>): Promise<McpToolCallResult>;
  listResources(): Promise<McpResourceDefinition[]>;
  readResource(uri: string): Promise<McpReadResourceResult>;
  listPrompts(): Promise<McpPromptDefinition[]>;
  getPrompt(name: string, args?: Record<string, unknown>): Promise<McpGetPromptResult>;
  close(): Promise<void>;
}

export interface McpStdioClientConfig {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  protocolVersion?: string;
  clientInfo?: {
    name: string;
    version: string;
  };
}

export type SpawnProcess = (
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdio: "pipe";
  }
) => ChildProcessWithoutNullStreams;

export interface McpStdioClientOptions {
  requestTimeoutMs?: number;
  spawnProcess?: SpawnProcess;
}

export interface McpInitializeResult {
  protocolVersion?: string;
  capabilities?: Record<string, unknown>;
  serverInfo?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface McpToolDefinition {
  name: string;
  [key: string]: unknown;
}

export interface McpToolCallResult {
  content?: unknown[];
  isError?: boolean;
  [key: string]: unknown;
}

export interface McpResourceDefinition {
  uri: string;
  [key: string]: unknown;
}

export interface McpReadResourceResult {
  contents?: unknown[];
  [key: string]: unknown;
}

export interface McpPromptDefinition {
  name: string;
  [key: string]: unknown;
}

export interface McpGetPromptResult {
  messages?: unknown[];
  [key: string]: unknown;
}

interface PendingRequest {
  method: string;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface JsonRpcResponse {
  id?: unknown;
  result?: unknown;
  error?: unknown;
}

export class McpStdioClient implements McpClient {
  private readonly command: string;
  private readonly args: string[];
  private readonly cwd?: string;
  private readonly env?: NodeJS.ProcessEnv;
  private readonly protocolVersion: string;
  private readonly clientInfo: {
    name: string;
    version: string;
  };
  private readonly requestTimeoutMs: number;
  private readonly spawnProcess: SpawnProcess;

  private childProcess?: ChildProcessWithoutNullStreams;
  private nextRequestId = 1;
  private pendingRequests = new Map<number, PendingRequest>();
  private responseBuffer = Buffer.alloc(0);

  constructor(config: McpStdioClientConfig, options: McpStdioClientOptions = {}) {
    this.command = asNonEmptyString(config.command, "MCP stdio command");
    this.args = parseArgs(config.args);
    this.cwd = config.cwd;
    this.env = config.env;
    this.protocolVersion = config.protocolVersion ?? DEFAULT_PROTOCOL_VERSION;
    this.clientInfo = config.clientInfo ?? DEFAULT_CLIENT_INFO;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.spawnProcess = options.spawnProcess ?? defaultSpawnProcess;
  }

  public async initialize(): Promise<McpInitializeResult> {
    const result = await this.request<McpInitializeResult>("initialize", {
      protocolVersion: this.protocolVersion,
      capabilities: {},
      clientInfo: this.clientInfo,
    });

    await this.notify("notifications/initialized", {});
    return result;
  }

  public async listTools(): Promise<McpToolDefinition[]> {
    const result = await this.request<Record<string, unknown>>("tools/list", {});
    const tools = result.tools;
    if (tools === undefined) {
      return [];
    }
    if (!Array.isArray(tools)) {
      throw new Error("Invalid tools/list response: expected 'tools' to be an array");
    }
    return tools as McpToolDefinition[];
  }

  public async callTool(name: string, input: Record<string, unknown>): Promise<McpToolCallResult> {
    const toolName = asNonEmptyString(name, "MCP tool name");
    if (!isObject(input)) {
      throw new Error("MCP tool input must be an object");
    }
    return this.request<McpToolCallResult>("tools/call", { name: toolName, arguments: input });
  }

  public async listResources(): Promise<McpResourceDefinition[]> {
    const result = await this.request<Record<string, unknown>>("resources/list", {});
    const resources = result.resources;
    if (resources === undefined) {
      return [];
    }
    if (!Array.isArray(resources)) {
      throw new Error("Invalid resources/list response: expected 'resources' to be an array");
    }
    return resources as McpResourceDefinition[];
  }

  public async readResource(uri: string): Promise<McpReadResourceResult> {
    const resourceUri = asNonEmptyString(uri, "MCP resource uri");
    return this.request<McpReadResourceResult>("resources/read", { uri: resourceUri });
  }

  public async listPrompts(): Promise<McpPromptDefinition[]> {
    const result = await this.request<Record<string, unknown>>("prompts/list", {});
    const prompts = result.prompts;
    if (prompts === undefined) {
      return [];
    }
    if (!Array.isArray(prompts)) {
      throw new Error("Invalid prompts/list response: expected 'prompts' to be an array");
    }
    return prompts as McpPromptDefinition[];
  }

  public async getPrompt(name: string, args?: Record<string, unknown>): Promise<McpGetPromptResult> {
    const promptName = asNonEmptyString(name, "MCP prompt name");
    if (args !== undefined && !isObject(args)) {
      throw new Error("MCP prompt arguments must be an object when provided");
    }

    return this.request<McpGetPromptResult>("prompts/get", {
      name: promptName,
      ...(args === undefined ? {} : { arguments: args }),
    });
  }

  public async close(): Promise<void> {
    const child = this.childProcess;
    if (!child) {
      return;
    }

    this.detachChildListeners(child);
    this.childProcess = undefined;
    this.responseBuffer = Buffer.alloc(0);
    this.rejectAllPending(new Error("MCP client was closed"));

    if (!child.killed) {
      child.kill();
    }
  }

  private async request<TResult>(method: string, params: Record<string, unknown>): Promise<TResult> {
    const requestMethod = asNonEmptyString(method, "JSON-RPC method");
    const child = await this.ensureConnected();
    const requestId = this.nextRequestId++;

    const payload = {
      jsonrpc: "2.0",
      id: requestId,
      method: requestMethod,
      params,
    };

    return new Promise<TResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`MCP request '${requestMethod}' timed out after ${this.requestTimeoutMs}ms`));
      }, this.requestTimeoutMs);

      this.pendingRequests.set(requestId, {
        method: requestMethod,
        timeout,
        resolve: (result) => resolve(result as TResult),
        reject,
      });

      const message = encodeStdioMessage(payload);
      child.stdin.write(message, (error?: Error | null) => {
        if (!error) {
          return;
        }
        const pending = this.pendingRequests.get(requestId);
        if (!pending) {
          return;
        }
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(requestId);
        pending.reject(new Error(`Failed to send MCP request '${requestMethod}': ${error.message}`));
      });
    });
  }

  private async notify(method: string, params: Record<string, unknown>): Promise<void> {
    const child = await this.ensureConnected();
    const payload = {
      jsonrpc: "2.0",
      method,
      params,
    };

    const message = encodeStdioMessage(payload);
    await new Promise<void>((resolve, reject) => {
      child.stdin.write(message, (error?: Error | null) => {
        if (error) {
          reject(new Error(`Failed to send MCP notification '${method}': ${error.message}`));
          return;
        }
        resolve();
      });
    });
  }

  private async ensureConnected(): Promise<ChildProcessWithoutNullStreams> {
    if (this.childProcess) {
      return this.childProcess;
    }

    const child = this.spawnProcess(this.command, [...this.args], {
      cwd: this.cwd,
      env: this.env,
      stdio: "pipe",
    });

    this.childProcess = child;
    child.stdout.on("data", this.handleStdoutData);
    child.on("close", this.handleProcessClose);
    child.on("error", this.handleProcessError);
    return child;
  }

  private readonly handleStdoutData = (chunk: Buffer | string): void => {
    const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.responseBuffer = Buffer.concat([this.responseBuffer, chunkBuffer]);

    try {
      this.drainResponseBuffer();
    } catch (error) {
      this.responseBuffer = Buffer.alloc(0);
      this.rejectAllPending(new Error(`Failed to parse MCP stdio response: ${toErrorMessage(error)}`));
    }
  };

  private readonly handleProcessClose = (): void => {
    this.childProcess = undefined;
    this.responseBuffer = Buffer.alloc(0);
    this.rejectAllPending(new Error("MCP stdio process closed"));
  };

  private readonly handleProcessError = (error: Error): void => {
    this.rejectAllPending(new Error(`MCP stdio process error: ${error.message}`));
  };

  private drainResponseBuffer(): void {
    while (this.responseBuffer.length > 0) {
      const headerEndIndex = this.responseBuffer.indexOf(FRAME_SEPARATOR);
      if (headerEndIndex !== -1) {
        const headerText = this.responseBuffer
          .subarray(0, headerEndIndex)
          .toString("utf8");
        if (hasContentLengthHeader(headerText)) {
          const contentLength = parseContentLength(headerText);
          const bodyStart = headerEndIndex + FRAME_SEPARATOR.length;
          const bodyEnd = bodyStart + contentLength;

          if (this.responseBuffer.length < bodyEnd) {
            return;
          }

          const bodyBuffer = this.responseBuffer.subarray(bodyStart, bodyEnd);
          this.responseBuffer = this.responseBuffer.subarray(bodyEnd);

          const payload = parseJsonObject(bodyBuffer.toString("utf8"));
          this.handleResponse(payload);
          continue;
        }
      }

      const lineEndIndex = this.responseBuffer.indexOf(NEWLINE_BYTE);
      if (lineEndIndex === -1) {
        return;
      }

      const lineBuffer = this.responseBuffer.subarray(0, lineEndIndex);
      this.responseBuffer = this.responseBuffer.subarray(lineEndIndex + 1);

      const lineText = lineBuffer.toString("utf8").trim();
      if (!lineText || !looksLikeJsonObject(lineText)) {
        continue;
      }

      const payload = parseJsonObject(lineText);
      this.handleResponse(payload);
    }
  }

  private handleResponse(response: JsonRpcResponse): void {
    if (typeof response.id !== "number") {
      return;
    }

    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(response.id);

    if (response.error !== undefined) {
      pending.reject(toJsonRpcError(response.error, pending.method));
      return;
    }

    if (response.result === undefined) {
      pending.reject(new Error(`MCP response for '${pending.method}' did not include a result`));
      return;
    }

    pending.resolve(response.result);
  }

  private rejectAllPending(error: Error): void {
    for (const [requestId, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pendingRequests.delete(requestId);
    }
  }

  private detachChildListeners(child: ChildProcessWithoutNullStreams): void {
    child.stdout.off("data", this.handleStdoutData);
    child.off("close", this.handleProcessClose);
    child.off("error", this.handleProcessError);
  }
}

function parseArgs(args: string[] | undefined): string[] {
  if (args === undefined) {
    return [];
  }

  if (!Array.isArray(args)) {
    throw new Error("MCP stdio args must be an array of strings");
  }

  return args.map((arg, index) => asString(arg, `MCP stdio args[${index}]`));
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

function encodeStdioMessage(payload: Record<string, unknown>): Buffer {
  return Buffer.from(`${JSON.stringify(payload)}\n`, "utf8");
}

function hasContentLengthHeader(headerText: string): boolean {
  return /(?:^|\r\n)Content-Length:\s*\d+/i.test(headerText);
}

function looksLikeJsonObject(lineText: string): boolean {
  return lineText.trimStart().startsWith("{");
}

function parseContentLength(headerText: string): number {
  const match = headerText.match(/(?:^|\r\n)Content-Length:\s*(\d+)(?:\r\n|$)/i);
  if (!match) {
    throw new Error("Missing Content-Length header");
  }

  const length = Number(match[1]);
  if (!Number.isInteger(length) || length < 0) {
    throw new Error("Invalid Content-Length header");
  }

  return length;
}

function parseJsonObject(jsonText: string): JsonRpcResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new Error(`Invalid JSON payload: ${toErrorMessage(error)}`);
  }

  if (!isObject(parsed)) {
    throw new Error("JSON-RPC payload must be an object");
  }

  return parsed as JsonRpcResponse;
}

function toJsonRpcError(error: unknown, method: string): Error {
  if (isObject(error)) {
    const code = typeof error.code === "number" ? error.code : undefined;
    const message = typeof error.message === "string" ? error.message : "Unknown JSON-RPC error";
    if (code === undefined) {
      return new Error(`MCP request '${method}' failed: ${message}`);
    }
    return new Error(`MCP request '${method}' failed (${code}): ${message}`);
  }
  return new Error(`MCP request '${method}' failed with an unknown JSON-RPC error`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toErrorMessage(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  return String(value);
}

const defaultSpawnProcess: SpawnProcess = (command, args, options) => spawn(command, args, options);
