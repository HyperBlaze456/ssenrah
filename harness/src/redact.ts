import type { RedactionPattern } from "./types.js";

/**
 * Default redaction patterns for sensitive data in tool_input.
 * Matches common secret formats: API keys, tokens, passwords, credentials.
 */
const DEFAULT_PATTERNS: RedactionPattern[] = [
  {
    name: "env_secret",
    pattern: /(?:^|\b)(?:AWS_SECRET_ACCESS_KEY|AWS_SECRET|ANTHROPIC_API_KEY|OPENAI_API_KEY|DATABASE_URL|PRIVATE_KEY|GITHUB_TOKEN|SLACK_TOKEN|DISCORD_TOKEN)[=:]\s*\S+/g,
    replacement: "[REDACTED:env]",
  },
  {
    name: "api_key",
    pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"]?([a-zA-Z0-9_\-]{20,})['"]?/gi,
    replacement: "[REDACTED:api_key]",
  },
  {
    name: "bearer_token",
    pattern: /Bearer\s+[a-zA-Z0-9_\-.~+/]+=*/g,
    replacement: "Bearer [REDACTED]",
  },
  {
    name: "password_field",
    pattern: /(?:password|passwd|secret)\s*[:=]\s*['"]?[^\s'"]{4,}['"]?/gi,
    replacement: "[REDACTED:password]",
  },
  {
    name: "private_key_block",
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    replacement: "[REDACTED:private_key]",
  },
  {
    name: "connection_string",
    pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^\s"']+/gi,
    replacement: "[REDACTED:connection_string]",
  },
];

/**
 * Redact sensitive values from a string.
 */
export function redactString(
  value: string,
  patterns: RedactionPattern[] = DEFAULT_PATTERNS
): string {
  let result = value;
  for (const p of patterns) {
    result = result.replace(p.pattern, p.replacement);
  }
  return result;
}

/**
 * Deep-redact an object: walks all string values and applies redaction patterns.
 * Returns a new object — does not mutate the input.
 */
export function redactObject(
  obj: unknown,
  patterns: RedactionPattern[] = DEFAULT_PATTERNS
): unknown {
  if (typeof obj === "string") {
    return redactString(obj, patterns);
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => redactObject(item, patterns));
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = redactObject(value, patterns);
    }
    return result;
  }
  return obj;
}

/**
 * Redact the tool_input field of a hook payload.
 * Only processes tool_input — other fields are left untouched.
 */
export function redactPayload(
  payload: Record<string, unknown>
): Record<string, unknown> {
  if (!payload.tool_input || typeof payload.tool_input !== "object") {
    return payload;
  }
  return {
    ...payload,
    tool_input: redactObject(payload.tool_input),
  };
}
