import Anthropic from "@anthropic-ai/sdk";

/**
 * Defines a tool that the agent can invoke.
 * Each tool has a name, description, JSON schema for its input,
 * and an implementation function.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Anthropic.Tool["input_schema"];
  run: (input: Record<string, unknown>) => Promise<string> | string;
}

/**
 * Message in the agent conversation history.
 */
export type Message = Anthropic.MessageParam;

/**
 * Configuration for creating an agent.
 */
export interface AgentConfig {
  model?: string;
  maxTokens?: number;
  /** Hard limit on tool-use turns to prevent runaway loops. Default: 20. */
  maxTurns?: number;
  systemPrompt?: string;
  tools?: ToolDefinition[];
  /** AbortSignal that cancels the agent loop mid-execution (e.g. team timeouts). */
  signal?: AbortSignal;
}

/**
 * Result of a single agent turn.
 */
export interface TurnResult {
  response: string;
  toolsUsed: string[];
  /** true if agent completed normally; false if stopped by max_tokens or maxTurns */
  done: boolean;
}
