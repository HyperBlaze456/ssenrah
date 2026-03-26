import { describe, it, expect } from "vitest";
import { redactString, redactObject, redactPayload } from "../src/redact.js";

describe("redactString", () => {
  it("redacts Bearer tokens", () => {
    const input = "Authorization: Bearer sk-ant-api03-VERY_SECRET_KEY_HERE";
    const result = redactString(input);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("VERY_SECRET_KEY_HERE");
  });

  it("redacts API key patterns", () => {
    const input = 'api_key: "sk_live_abc123def456ghi789jkl012"';
    const result = redactString(input);
    expect(result).toContain("[REDACTED:api_key]");
    expect(result).not.toContain("sk_live_abc123def456ghi789jkl012");
  });

  it("redacts password fields", () => {
    const input = 'password=SuperSecret123!';
    const result = redactString(input);
    expect(result).toContain("[REDACTED:password]");
    expect(result).not.toContain("SuperSecret123!");
  });

  it("redacts environment variable secrets", () => {
    const input = "ANTHROPIC_API_KEY=sk-ant-very-long-key-here";
    const result = redactString(input);
    expect(result).toContain("[REDACTED:env]");
    expect(result).not.toContain("sk-ant-very-long-key-here");
  });

  it("redacts private key blocks", () => {
    const input = "-----BEGIN PRIVATE KEY-----\nMIIEvg...\n-----END PRIVATE KEY-----";
    const result = redactString(input);
    expect(result).toContain("[REDACTED:private_key]");
    expect(result).not.toContain("MIIEvg");
  });

  it("redacts connection strings", () => {
    const input = "DATABASE_URL=postgres://user:pass@host:5432/db";
    const result = redactString(input);
    expect(result).toContain("[REDACTED");
  });

  it("leaves non-sensitive strings untouched", () => {
    const input = "npm test --coverage";
    const result = redactString(input);
    expect(result).toBe(input);
  });
});

describe("redactObject", () => {
  it("deep-redacts string values in nested objects", () => {
    const input = {
      command: "curl -H 'Authorization: Bearer sk-secret-token' https://api.com",
      nested: {
        config: "password=hunter2",
      },
    };
    const result = redactObject(input) as Record<string, unknown>;
    expect(result.command).toContain("[REDACTED]");
    expect((result.nested as Record<string, unknown>).config).toContain("[REDACTED:password]");
  });

  it("handles arrays", () => {
    const input = ["Bearer sk-secret-123", "safe-string"];
    const result = redactObject(input) as string[];
    expect(result[0]).toContain("[REDACTED]");
    expect(result[1]).toBe("safe-string");
  });

  it("passes through non-string values", () => {
    const input = { count: 42, flag: true, nothing: null };
    const result = redactObject(input);
    expect(result).toEqual(input);
  });
});

describe("redactPayload", () => {
  it("only redacts the tool_input field", () => {
    const payload = {
      session_id: "abc-123",
      tool_name: "Bash",
      tool_input: {
        command: "export ANTHROPIC_API_KEY=sk-ant-secret-key-value",
      },
    };
    const result = redactPayload(payload);
    expect(result.session_id).toBe("abc-123");
    expect(result.tool_name).toBe("Bash");
    expect((result.tool_input as Record<string, string>).command).toContain("[REDACTED");
  });

  it("returns payload unchanged if no tool_input", () => {
    const payload = { session_id: "abc-123", hook_event_name: "SessionStart" };
    const result = redactPayload(payload);
    expect(result).toEqual(payload);
  });
});
