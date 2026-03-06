import {
  McpClient,
  McpRuntime,
  McpServerConfig,
  buildMcpPromptGetToolName,
  buildMcpPromptListToolName,
  buildMcpResourceListToolName,
  buildMcpResourceReadToolName,
  buildMcpToolName,
} from "../harness/mcp-runtime";

function parseJson(text: string): unknown {
  return JSON.parse(text);
}

describe("McpRuntime", () => {
  it("builds namespaced tool definitions, packs, and risk overrides", async () => {
    const alphaClient = {
      connect: jest.fn(async () => undefined),
      disconnect: jest.fn(async () => undefined),
      listTools: jest.fn(async () => [
        {
          name: "list_docs",
          description: "List docs",
          annotations: { readOnlyHint: true },
          inputSchema: { type: "object", properties: {}, required: [] },
        },
        {
          name: "create_doc",
          description: "Create doc",
          inputSchema: {
            type: "object",
            properties: { title: { type: "string" } },
            required: ["title"],
          },
        },
      ]),
      callTool: jest.fn(async (name: string, input: Record<string, unknown>) => ({
        server: "alpha",
        name,
        input,
      })),
      listResources: jest.fn(async () => [{ uri: "resource://docs/readme" }]),
      readResource: jest.fn(async (uri: string) => ({
        server: "alpha",
        uri,
        content: "alpha resource",
      })),
      listPrompts: jest.fn(async () => [{ name: "summarize_doc" }]),
      getPrompt: jest.fn(async (name: string, args?: Record<string, unknown>) => ({
        server: "alpha",
        name,
        args,
      })),
    } satisfies McpClient;

    const betaClient = {
      connect: jest.fn(async () => undefined),
      disconnect: jest.fn(async () => undefined),
      listTools: jest.fn(async () => [
        {
          name: "run_job",
          description: "Run a job",
          annotations: { destructiveHint: true },
          inputSchema: { type: "object", properties: {}, required: [] },
        },
      ]),
      callTool: jest.fn(async (name: string, input: Record<string, unknown>) => ({
        server: "beta",
        name,
        input,
      })),
    } satisfies McpClient;

    const servers: McpServerConfig[] = [
      { name: "alpha", command: "alpha-mcp" },
      { name: "beta", command: "beta-mcp" },
    ];

    const runtime = new McpRuntime({
      config: { servers },
      clientFactory: (server) => {
        if (server.name === "alpha") return alphaClient;
        if (server.name === "beta") return betaClient;
        throw new Error(`unexpected server: ${server.name}`);
      },
    });

    const tools = await runtime.getToolDefinitions();
    const toolNames = tools.map((tool) => tool.name);

    expect(toolNames).toContain(buildMcpToolName("alpha", "list_docs"));
    expect(toolNames).toContain(buildMcpToolName("alpha", "create_doc"));
    expect(toolNames).toContain(buildMcpToolName("beta", "run_job"));
    expect(toolNames).toContain(buildMcpResourceListToolName("alpha"));
    expect(toolNames).toContain(buildMcpResourceReadToolName("alpha"));
    expect(toolNames).toContain(buildMcpPromptListToolName("alpha"));
    expect(toolNames).toContain(buildMcpPromptGetToolName("alpha"));

    const createDocTool = tools.find(
      (tool) => tool.name === buildMcpToolName("alpha", "create_doc")
    );
    expect(createDocTool).toBeDefined();
    const createDocOutput = await createDocTool!.run({ title: "Doc A" });
    expect(alphaClient.callTool).toHaveBeenCalledWith("create_doc", {
      title: "Doc A",
    });
    expect(parseJson(createDocOutput)).toEqual({
      server: "alpha",
      name: "create_doc",
      input: { title: "Doc A" },
    });

    const riskOverrides = await runtime.getRiskOverrides();
    expect(riskOverrides[buildMcpToolName("alpha", "list_docs")]).toBe("read");
    expect(riskOverrides[buildMcpToolName("alpha", "create_doc")]).toBe("write");
    expect(riskOverrides[buildMcpToolName("beta", "run_job")]).toBe(
      "destructive"
    );
    expect(riskOverrides[buildMcpResourceReadToolName("alpha")]).toBe("read");
    expect(riskOverrides[buildMcpPromptGetToolName("alpha")]).toBe("read");

    const packs = await runtime.getPackDefinitions();
    expect(packs["mcp"]).toBeDefined();
    expect(packs["mcp.alpha"]).toBeDefined();
    expect(packs["mcp.beta"]).toBeDefined();
    expect(packs["mcp"]!.length).toBe(tools.length);
    expect(
      packs["mcp.alpha"]!.every((tool) => tool.name.startsWith("mcp.alpha."))
    ).toBe(true);
    expect(
      packs["mcp.beta"]!.every((tool) => tool.name.startsWith("mcp.beta."))
    ).toBe(true);
  });

  it("enforces allowlist exposure for tools, resources, and prompts", async () => {
    const alphaClient = {
      connect: jest.fn(async () => undefined),
      disconnect: jest.fn(async () => undefined),
      listTools: jest.fn(async () => [
        { name: "allowed_tool", inputSchema: { type: "object", properties: {} } },
        { name: "blocked_tool", inputSchema: { type: "object", properties: {} } },
      ]),
      callTool: jest.fn(async (name: string, input: Record<string, unknown>) => ({
        name,
        input,
      })),
      listResources: jest.fn(async () => [
        { uri: "resource://safe" },
        { uri: "resource://blocked" },
      ]),
      readResource: jest.fn(async (uri: string) => ({ uri })),
      listPrompts: jest.fn(async () => [
        { name: "safe_prompt" },
        { name: "blocked_prompt" },
      ]),
      getPrompt: jest.fn(async (name: string, args?: Record<string, unknown>) => ({
        name,
        args,
      })),
    } satisfies McpClient;

    const runtime = new McpRuntime({
      config: {
        servers: [
          {
            name: "alpha",
            command: "alpha-mcp",
            allowlist: {
              tools: [buildMcpToolName("alpha", "allowed_tool")],
              resources: ["resource://safe"],
              prompts: ["safe_prompt"],
            },
          },
        ],
      },
      clientFactory: () => alphaClient,
    });

    const tools = await runtime.getToolDefinitions();
    const names = tools.map((tool) => tool.name);

    expect(names).toContain(buildMcpToolName("alpha", "allowed_tool"));
    expect(names).not.toContain(buildMcpToolName("alpha", "blocked_tool"));
    expect(names).toContain(buildMcpResourceListToolName("alpha"));
    expect(names).toContain(buildMcpResourceReadToolName("alpha"));
    expect(names).toContain(buildMcpPromptListToolName("alpha"));
    expect(names).toContain(buildMcpPromptGetToolName("alpha"));

    const resourceListTool = tools.find(
      (tool) => tool.name === buildMcpResourceListToolName("alpha")
    );
    expect(resourceListTool).toBeDefined();
    const resourceListOutput = await resourceListTool!.run({});
    expect(parseJson(resourceListOutput)).toEqual([{ uri: "resource://safe" }]);

    const resourceReadTool = tools.find(
      (tool) => tool.name === buildMcpResourceReadToolName("alpha")
    );
    expect(resourceReadTool).toBeDefined();
    const blockedResourceRead = await resourceReadTool!.run({
      uri: "resource://blocked",
    });
    expect(blockedResourceRead).toMatch(/not allowlisted/);
    expect(alphaClient.readResource).not.toHaveBeenCalled();

    const safeResourceRead = await resourceReadTool!.run({
      uri: "resource://safe",
    });
    expect(parseJson(safeResourceRead)).toEqual({ uri: "resource://safe" });
    expect(alphaClient.readResource).toHaveBeenCalledWith("resource://safe");

    const promptListTool = tools.find(
      (tool) => tool.name === buildMcpPromptListToolName("alpha")
    );
    expect(promptListTool).toBeDefined();
    const promptListOutput = await promptListTool!.run({});
    expect(parseJson(promptListOutput)).toEqual([{ name: "safe_prompt" }]);

    const promptGetTool = tools.find(
      (tool) => tool.name === buildMcpPromptGetToolName("alpha")
    );
    expect(promptGetTool).toBeDefined();
    const blockedPrompt = await promptGetTool!.run({ name: "blocked_prompt" });
    expect(blockedPrompt).toMatch(/not allowlisted/);
    expect(alphaClient.getPrompt).not.toHaveBeenCalled();

    const safePrompt = await promptGetTool!.run({
      name: "safe_prompt",
      arguments: { topic: "x" },
    });
    expect(parseJson(safePrompt)).toEqual({
      name: "safe_prompt",
      args: { topic: "x" },
    });
    expect(alphaClient.getPrompt).toHaveBeenCalledWith("safe_prompt", {
      topic: "x",
    });
  });

  it("returns diagnostics including per-server exposure and discovery failures", async () => {
    const alphaClient = {
      connect: jest.fn(async () => undefined),
      disconnect: jest.fn(async () => undefined),
      listTools: jest.fn(async () => [
        { name: "ping", inputSchema: { type: "object", properties: {} } },
      ]),
      callTool: jest.fn(async () => "pong"),
    } satisfies McpClient;

    const betaClient = {
      connect: jest.fn(async () => undefined),
      disconnect: jest.fn(async () => undefined),
      listTools: jest.fn(async () => {
        throw new Error("beta tools failed");
      }),
      callTool: jest.fn(async () => "never"),
    } satisfies McpClient;

    const runtime = new McpRuntime({
      config: {
        servers: [
          { name: "alpha", command: "alpha-mcp" },
          { name: "beta", command: "beta-mcp" },
        ],
      },
      clientFactory: (server) => {
        if (server.name === "alpha") return alphaClient;
        return betaClient;
      },
    });

    const diagnostics = await runtime.getDiagnostics();
    const alphaDiag = diagnostics.find((item) => item.server === "alpha");
    const betaDiag = diagnostics.find((item) => item.server === "beta");

    expect(alphaDiag).toBeDefined();
    expect(alphaDiag!.connected).toBe(true);
    expect(alphaDiag!.discoveredTools).toBe(1);
    expect(alphaDiag!.exposedTools).toContain(buildMcpToolName("alpha", "ping"));
    expect(alphaDiag!.errors).toEqual([]);

    expect(betaDiag).toBeDefined();
    expect(betaDiag!.connected).toBe(true);
    expect(betaDiag!.discoveredTools).toBe(0);
    expect(betaDiag!.exposedTools).toEqual([]);
    expect(betaDiag!.errors.join(" ")).toContain("list_tools_failed");
  });

  it("supports lifecycle start/stop and restarts lazily on reads after stop", async () => {
    const client = {
      connect: jest.fn(async () => undefined),
      disconnect: jest.fn(async () => undefined),
      listTools: jest.fn(async () => [
        { name: "echo", inputSchema: { type: "object", properties: {} } },
      ]),
      callTool: jest.fn(async (_name: string, input: Record<string, unknown>) => input),
    } satisfies McpClient;

    const runtime = new McpRuntime({
      config: { servers: [{ name: "solo", command: "solo-mcp" }] },
      clientFactory: () => client,
    });

    await runtime.start();
    await runtime.start();
    expect(client.connect).toHaveBeenCalledTimes(1);

    await runtime.stop();
    expect(client.disconnect).toHaveBeenCalledTimes(1);

    const toolsAfterRestart = await runtime.getToolDefinitions();
    expect(toolsAfterRestart.map((tool) => tool.name)).toContain(
      buildMcpToolName("solo", "echo")
    );
    expect(client.connect).toHaveBeenCalledTimes(2);
  });

  it("supports injected server.client when clientFactory is omitted", async () => {
    const injectedClient = {
      connect: jest.fn(async () => undefined),
      disconnect: jest.fn(async () => undefined),
      listTools: jest.fn(async () => [
        { name: "inspect", inputSchema: { type: "object", properties: {} } },
      ]),
      callTool: jest.fn(async () => "ok"),
    } satisfies McpClient;

    const runtime = new McpRuntime({
      config: {
        servers: [
          {
            name: "injected",
            command: "ignored",
            client: injectedClient,
          },
        ],
      },
    });

    const tools = await runtime.getToolDefinitions();
    expect(tools.map((tool) => tool.name)).toContain(
      buildMcpToolName("injected", "inspect")
    );
    expect(injectedClient.connect).toHaveBeenCalledTimes(1);
  });
});
