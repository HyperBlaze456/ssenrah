import { ChildProcessWithoutNullStreams } from "child_process";
import { EventEmitter, once } from "events";
import { PassThrough } from "stream";
import { McpStdioClient, SpawnProcess } from "../harness/mcp-stdio-client";

class FakeChildProcess extends EventEmitter {
  public readonly stdin = new PassThrough();
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public readonly pid = 12345;
  public killed = false;

  public kill(): boolean {
    if (this.killed) {
      return true;
    }
    this.killed = true;
    this.emit("close", 0, null);
    return true;
  }
}

interface SpawnCall {
  command: string;
  args: string[];
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdio: "pipe";
  };
}

function createClient(requestTimeoutMs: number = 250): {
  client: McpStdioClient;
  child: FakeChildProcess;
  spawnCalls: SpawnCall[];
} {
  const child = new FakeChildProcess();
  const spawnCalls: SpawnCall[] = [];

  const spawnProcess: SpawnProcess = (command, args, options) => {
    spawnCalls.push({
      command,
      args: [...args],
      options,
    });
    return child as unknown as ChildProcessWithoutNullStreams;
  };

  const client = new McpStdioClient(
    {
      command: "node",
      args: ["fake-mcp-server.js"],
      cwd: "/tmp/fake",
      env: { TEST_ENV: "1" },
    },
    {
      spawnProcess,
      requestTimeoutMs,
    }
  );

  return {
    client,
    child,
    spawnCalls,
  };
}

function encodeFrame(payload: Record<string, unknown>): Buffer {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8"), body]);
}

function encodeLine(payload: Record<string, unknown>): Buffer {
  return Buffer.from(`${JSON.stringify(payload)}\n`, "utf8");
}

function decodeLine(line: Buffer): Record<string, unknown> {
  const lineText = line.toString("utf8").trim();
  if (!lineText) {
    throw new Error("Empty JSON-RPC line");
  }
  return JSON.parse(lineText) as Record<string, unknown>;
}

async function readNextRequest(child: FakeChildProcess): Promise<Record<string, unknown>> {
  const [chunk] = await once(child.stdin, "data");
  const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
  const newlineIndex = chunkBuffer.indexOf(0x0a);
  if (newlineIndex === -1) {
    throw new Error("Missing newline-delimited JSON-RPC message");
  }
  return decodeLine(chunkBuffer.subarray(0, newlineIndex));
}

describe("McpStdioClient", () => {
  it("runs initialize flow and sends initialized notification", async () => {
    const { client, child, spawnCalls } = createClient();

    const initializePromise = client.initialize();
    const initializeRequest = await readNextRequest(child);

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]).toEqual({
      command: "node",
      args: ["fake-mcp-server.js"],
      options: {
        cwd: "/tmp/fake",
        env: { TEST_ENV: "1" },
        stdio: "pipe",
      },
    });

    expect(initializeRequest.method).toBe("initialize");
    const requestId = initializeRequest.id as number;
    child.stdout.write(
      encodeLine({
        jsonrpc: "2.0",
        id: requestId,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          serverInfo: { name: "fake", version: "1.0.0" },
        },
      })
    );

    const initializedNotification = await readNextRequest(child);
    expect(initializedNotification.method).toBe("notifications/initialized");
    expect(initializedNotification.id).toBeUndefined();

    await expect(initializePromise).resolves.toEqual(
      expect.objectContaining({
        protocolVersion: "2024-11-05",
      })
    );

    await client.close();
  });

  it("supports tools/list and tools/call", async () => {
    const { client, child } = createClient();

    const listPromise = client.listTools();
    const listRequest = await readNextRequest(child);
    expect(listRequest.method).toBe("tools/list");
    child.stdout.write(
      encodeLine({
        jsonrpc: "2.0",
        id: listRequest.id,
        result: {
          tools: [{ name: "echo", description: "Echo tool" }],
        },
      })
    );

    await expect(listPromise).resolves.toEqual([{ name: "echo", description: "Echo tool" }]);

    const callPromise = client.callTool("echo", { text: "hello" });
    const callRequest = await readNextRequest(child);
    expect(callRequest.method).toBe("tools/call");
    expect(callRequest.params).toEqual({
      name: "echo",
      arguments: { text: "hello" },
    });
    child.stdout.write(
      encodeLine({
        jsonrpc: "2.0",
        id: callRequest.id,
        result: {
          content: [{ type: "text", text: "hello" }],
        },
      })
    );

    await expect(callPromise).resolves.toEqual({
      content: [{ type: "text", text: "hello" }],
    });

    await client.close();
  });

  it("supports resources and prompts methods", async () => {
    const { client, child } = createClient();

    const listResourcesPromise = client.listResources();
    const listResourcesRequest = await readNextRequest(child);
    expect(listResourcesRequest.method).toBe("resources/list");
    child.stdout.write(
      encodeLine({
        jsonrpc: "2.0",
        id: listResourcesRequest.id,
        result: {
          resources: [{ uri: "file:///tmp/data.txt" }],
        },
      })
    );

    await expect(listResourcesPromise).resolves.toEqual([{ uri: "file:///tmp/data.txt" }]);

    const readResourcePromise = client.readResource("file:///tmp/data.txt");
    const readResourceRequest = await readNextRequest(child);
    expect(readResourceRequest.method).toBe("resources/read");
    expect(readResourceRequest.params).toEqual({ uri: "file:///tmp/data.txt" });
    child.stdout.write(
      encodeLine({
        jsonrpc: "2.0",
        id: readResourceRequest.id,
        result: {
          contents: [{ uri: "file:///tmp/data.txt", text: "hello" }],
        },
      })
    );

    await expect(readResourcePromise).resolves.toEqual({
      contents: [{ uri: "file:///tmp/data.txt", text: "hello" }],
    });

    const listPromptsPromise = client.listPrompts();
    const listPromptsRequest = await readNextRequest(child);
    expect(listPromptsRequest.method).toBe("prompts/list");
    child.stdout.write(
      encodeLine({
        jsonrpc: "2.0",
        id: listPromptsRequest.id,
        result: {
          prompts: [{ name: "summarize" }],
        },
      })
    );

    await expect(listPromptsPromise).resolves.toEqual([{ name: "summarize" }]);

    const getPromptPromise = client.getPrompt("summarize", { format: "short" });
    const getPromptRequest = await readNextRequest(child);
    expect(getPromptRequest.method).toBe("prompts/get");
    expect(getPromptRequest.params).toEqual({
      name: "summarize",
      arguments: { format: "short" },
    });
    child.stdout.write(
      encodeLine({
        jsonrpc: "2.0",
        id: getPromptRequest.id,
        result: {
          messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        },
      })
    );

    await expect(getPromptPromise).resolves.toEqual({
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    });

    await client.close();
  });

  it("parses chunked Content-Length frames", async () => {
    const { client, child } = createClient();

    const listPromise = client.listTools();
    const request = await readNextRequest(child);

    const frame = encodeFrame({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        tools: [{ name: "chunked" }],
      },
    });

    child.stdout.write(frame.subarray(0, 10));
    child.stdout.write(frame.subarray(10, 25));
    child.stdout.write(frame.subarray(25));

    await expect(listPromise).resolves.toEqual([{ name: "chunked" }]);

    await client.close();
  });

  it("rejects requests on JSON-RPC errors", async () => {
    const { client, child } = createClient();

    const listPromise = client.listTools();
    const request = await readNextRequest(child);

    child.stdout.write(
      encodeLine({
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: -32000,
          message: "list failure",
        },
      })
    );

    await expect(listPromise).rejects.toThrow("list failure");
    await client.close();
  });

  it("times out if a response never arrives", async () => {
    const { client, child } = createClient(20);

    const listPromise = client.listTools();
    await readNextRequest(child);

    await expect(listPromise).rejects.toThrow("timed out");
    await client.close();
  });

  it("rejects pending requests when process closes", async () => {
    const { client, child } = createClient();

    const listPromise = client.listTools();
    await readNextRequest(child);

    child.emit("close", 0, null);
    await expect(listPromise).rejects.toThrow("closed");
    await client.close();
  });
});
