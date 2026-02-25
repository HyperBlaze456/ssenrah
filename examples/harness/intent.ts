import { ToolCall } from "../providers/types";

export interface IntentDeclaration {
  toolName: string;
  purpose: string;
  expectedOutcome: string;
  riskLevel: "read" | "write" | "exec" | "destructive";
  timestamp: string;
}

/**
 * Parse intent declarations from an LLM's text output.
 * The agent is instructed to emit JSON blocks like:
 * <intent>{"toolName":"read_file","purpose":"...","expectedOutcome":"...","riskLevel":"read"}</intent>
 *
 * Returns all found intent declarations.
 */
export function parseIntents(text: string): IntentDeclaration[] {
  const results: IntentDeclaration[] = [];
  const intentRegex = /<intent>([\s\S]*?)<\/intent>/g;
  let match: RegExpExecArray | null;

  while ((match = intentRegex.exec(text)) !== null) {
    const raw = match[1].trim();
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (
        typeof parsed.toolName === "string" &&
        typeof parsed.purpose === "string" &&
        typeof parsed.expectedOutcome === "string" &&
        (parsed.riskLevel === "read" ||
          parsed.riskLevel === "write" ||
          parsed.riskLevel === "exec" ||
          parsed.riskLevel === "destructive")
      ) {
        results.push({
          toolName: parsed.toolName,
          purpose: parsed.purpose,
          expectedOutcome: parsed.expectedOutcome,
          riskLevel: parsed.riskLevel as IntentDeclaration["riskLevel"],
          timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : new Date().toISOString(),
        });
      }
    } catch {
      // Malformed JSON — skip silently
    }
  }

  return results;
}

/**
 * Validate that every tool call has a matching intent declaration.
 * Returns { valid: true } if all calls are covered, or
 * { valid: false, unmatched: ToolCall[] } for calls without intents.
 */
export function validateIntents(
  intents: IntentDeclaration[],
  toolCalls: ToolCall[]
): { valid: boolean; unmatched: ToolCall[] } {
  const availableByTool = new Map<string, number>();
  for (const intent of intents) {
    availableByTool.set(
      intent.toolName,
      (availableByTool.get(intent.toolName) ?? 0) + 1
    );
  }

  const unmatched: ToolCall[] = [];
  for (const tc of toolCalls) {
    const available = availableByTool.get(tc.name) ?? 0;
    if (available > 0) {
      availableByTool.set(tc.name, available - 1);
    } else {
      unmatched.push(tc);
    }
  }

  return { valid: unmatched.length === 0, unmatched };
}

/**
 * Generate the system prompt addition that instructs the LLM to emit intent declarations.
 */
export function getIntentSystemPrompt(): string {
  return `Before invoking any tool, you MUST declare your intent using the following XML block format:

<intent>{"toolName":"<tool_name>","purpose":"<what you intend to achieve>","expectedOutcome":"<what success looks like>","riskLevel":"<read|write|exec|destructive>"}</intent>

Rules:
- The <intent> block must appear in the same message that contains the tool call.
- "riskLevel" must be one of: "read", "write", "exec", "destructive".
- Do not skip the intent declaration — undeclared tool calls will be rejected.
- Be concise but specific in "purpose" and "expectedOutcome".`;
}
