/** Unified chat message across all providers */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string | ChatContentBlock[];
}

export interface ChatContentBlock {
  type: "text" | "tool_use" | "tool_result" | "image";
  // text
  text?: string;
  // tool_use
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  // tool_result
  toolUseId?: string;
  content?: string;
  isError?: boolean;
  // image (for vision)
  mimeType?: string;
  base64Data?: string;
}

/** Tool schema in provider-agnostic format */
export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** A single tool call extracted from a response */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Unified request to any LLM */
export interface ChatRequest {
  model: string;
  systemPrompt?: string;
  messages: ChatMessage[];
  tools?: ToolSchema[];
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ChatStreamCallbacks {
  onTextDelta?: (delta: string) => void;
}

/** Unified response from any LLM */
export interface ChatResponse {
  textBlocks: string[];
  toolCalls: ToolCall[];
  stopReason: "end_turn" | "tool_use" | "max_tokens";
  usage?: { inputTokens: number; outputTokens: number };
}

/** The provider interface — all LLM backends implement this */
export interface LLMProvider {
  name: string;
  chat(params: ChatRequest): Promise<ChatResponse>;
  chatStream?(
    params: ChatRequest,
    callbacks?: ChatStreamCallbacks
  ): Promise<ChatResponse>;
}

/** Config for creating a provider via factory */
export interface ProviderConfig {
  type: "anthropic" | "gemini" | "openai";
  model: string;
  apiKey?: string;
  baseUrl?: string;
}
