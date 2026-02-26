import {
  LLMProvider,
  ChatMessage,
  ChatResponse,
  ToolCall,
  ToolSchema,
} from "../providers/types";

/**
 * Defines a tool that the agent can invoke.
 * Each tool has a name, description, JSON schema for its input,
 * and an implementation function.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (input: Record<string, unknown>) => Promise<string> | string;
}

/**
 * Registry for resolving tool packs into concrete tool definitions.
 * Lets runtimes inject only the tools required for the current task.
 */
export interface ToolRegistry {
  resolvePacks(packNames: string[]): ToolDefinition[];
}

/**
 * Mutable per-run settings that hooks can adjust before the tool loop starts.
 */
export interface AgentRunSettings {
  model: string;
  systemPrompt: string;
  tools: ToolDefinition[];
}

/**
 * Hook context passed before each run.
 */
export interface AgentRunHookContext {
  userMessage: string;
  settings: AgentRunSettings;
  history: Message[];
  toolRegistry?: ToolRegistry;
}

/**
 * Hook function invoked before each run.
 */
export type AgentRunHook =
  (context: AgentRunHookContext) => Promise<void> | void;

/**
 * Message in the agent conversation history.
 * Provider-agnostic — uses the unified ChatMessage type.
 */
export type Message = ChatMessage;

/**
 * Configuration for creating an agent.
 */
export interface AgentConfig {
  /** LLM provider to use (required). */
  provider: LLMProvider;
  /** Model identifier (passed to provider). */
  model: string;
  maxTokens?: number;
  /** Hard limit on tool-use turns to prevent runaway loops. Default: 20. */
  maxTurns?: number;
  systemPrompt?: string;
  tools?: ToolDefinition[];
  /** AbortSignal that cancels the agent loop mid-execution. */
  signal?: AbortSignal;
  /** Require intent declarations before tool execution. Default: true. */
  intentRequired?: boolean;
  /** Cheap provider for fallback agent on tool failures. */
  fallbackProvider?: LLMProvider;
  /** Model used by fallback provider. Defaults to the main model. */
  fallbackModel?: string;
  /** Optional explicit event log path. */
  eventLogPath?: string;
  /** Optional session id for default event log path generation. */
  sessionId?: string;
  /** Optional registry for resolving named tool packs. */
  toolRegistry?: ToolRegistry;
  /** Initial tool packs to resolve at construction time. */
  toolPacks?: string[];
  /** Optional pre-run hooks (for skill/tool/model injection). */
  hooks?: AgentRunHook[];
}

/**
 * Result of a single agent turn.
 */
export interface TurnResult {
  response: string;
  toolsUsed: string[];
  usage: { inputTokens: number; outputTokens: number };
  /** true if agent completed normally; false if stopped by max_tokens or maxTurns */
  done: boolean;
}

export interface RunOptions {
  /** Stream assistant text deltas when provider supports it. */
  stream?: boolean;
  /** Called for each streamed text delta. */
  onTextDelta?: (delta: string) => void;
}
