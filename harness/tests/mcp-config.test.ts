import fs from "fs";
import os from "os";
import path from "path";
import {
  DEFAULT_MCP_CONFIG_PATH,
  loadMcpHarnessConfig,
  parseMcpHarnessConfig,
  resolveMcpHarnessConfigEnv,
} from "../harness/mcp-config";

describe("mcp-config parsing and resolution", () => {
  it("exports the default config path constant", () => {
    expect(DEFAULT_MCP_CONFIG_PATH).toBe(".ssenrah/mcp.servers.json");
  });

  it("parses stdio-first config from mcpServers", () => {
    const parsed = parseMcpHarnessConfig({
      mcpServers: {
        local: {
          command: "${MCP_BIN}",
          args: ["--stdio", "--token=${TOKEN}"],
          env: {
            API_TOKEN: "${TOKEN}",
          },
          allowlist: {
            tools: ["tools/list", "tools/call"],
            toolRisks: {
              "tools/list": "read",
              "tools/call": "exec",
            },
          },
        },
      },
    });

    expect(Object.keys(parsed.servers)).toEqual(["local"]);
    expect(parsed.servers.local.command).toBe("${MCP_BIN}");
    expect(parsed.servers.local.args).toEqual(["--stdio", "--token=${TOKEN}"]);
    expect(parsed.servers.local.env).toEqual({
      API_TOKEN: "${TOKEN}",
    });
    expect(parsed.servers.local.allowlist).toEqual({
      tools: ["tools/list", "tools/call"],
      toolRisks: {
        "tools/list": "read",
        "tools/call": "exec",
      },
    });
  });

  it("resolves ${VAR} templates in command, args, env, and cwd", () => {
    const parsed = parseMcpHarnessConfig({
      servers: {
        local: {
          command: "${MCP_BIN}",
          args: ["--port", "${PORT}"],
          env: {
            HOME_DIR: "${HOME}",
            STATIC_VALUE: "literal",
          },
          cwd: "${HOME}/.mcp",
        },
      },
    });

    const resolved = resolveMcpHarnessConfigEnv(parsed, {
      env: {
        MCP_BIN: "node",
        PORT: "4444",
        HOME: "/tmp/user",
      },
    });

    expect(resolved.servers.local).toEqual({
      transport: "stdio",
      command: "node",
      args: ["--port", "4444"],
      env: {
        HOME_DIR: "/tmp/user",
        STATIC_VALUE: "literal",
      },
      cwd: "/tmp/user/.mcp",
    });
  });

  it("rejects non-stdio transports", () => {
    expect(() =>
      parseMcpHarnessConfig({
        servers: {
          bad: {
            transport: "sse",
            command: "node",
          },
        },
      })
    ).toThrow("must be 'stdio'");
  });

  it("rejects missing environment variables during resolution", () => {
    const parsed = parseMcpHarnessConfig({
      servers: {
        local: {
          command: "${MISSING_BIN}",
        },
      },
    });

    expect(() => resolveMcpHarnessConfigEnv(parsed, { env: {} })).toThrow("MISSING_BIN");
  });

  it("rejects invalid placeholder syntax", () => {
    const parsed = parseMcpHarnessConfig({
      servers: {
        local: {
          command: "${}",
        },
      },
    });

    expect(() =>
      resolveMcpHarnessConfigEnv(parsed, {
        env: {
          ANY: "value",
        },
      })
    ).toThrow("Empty environment placeholder");
  });

  it("requires risk mapping entries for allowlisted endpoints", () => {
    expect(() =>
      parseMcpHarnessConfig({
        servers: {
          local: {
            command: "node",
            allowlist: {
              tools: ["call_anything"],
            },
          },
        },
      })
    ).toThrow("toolRisks");
  });

  it("loads config from disk and resolves environment values", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-config-test-"));
    const configPath = path.join(tempDir, "servers.json");

    fs.writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          testServer: {
            command: "${BIN}",
            args: ["--stdio"],
          },
        },
      }),
      "utf8"
    );

    const loaded = loadMcpHarnessConfig(configPath, {
      env: {
        BIN: "node",
      },
    });

    expect(loaded.servers.testServer.command).toBe("node");
    expect(loaded.servers.testServer.args).toEqual(["--stdio"]);
  });

  it("supports optional missing files", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-config-missing-"));
    const missingPath = path.join(tempDir, "missing.json");

    const loaded = loadMcpHarnessConfig(missingPath, {
      optional: true,
    });

    expect(loaded).toEqual({ servers: {} });
  });
});
