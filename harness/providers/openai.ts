import type {
  ChatRequest,
  ChatResponse,
  ChatMessage,
  ChatStreamCallbacks,
  ChatContentBlock,
  ToolSchema,
  ToolCall,
  LLMProvider,
} from "./types";

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null | OpenAIContentPart[];
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

type OpenAIContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

interface OpenAIStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: "function";
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string | null;
  }>;
}

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  private baseUrl: string;

  constructor(
    private model: string,
    private apiKey?: string,
    baseUrl?: string
  ) {
    this.baseUrl = baseUrl ?? "https://api.openai.com/v1";
  }

  async chat(params: ChatRequest): Promise<ChatResponse> {
    const { systemPrompt, messages, tools, maxTokens, signal } = params;

    const openaiMessages: OpenAIMessage[] = [];

    if (systemPrompt) {
      openaiMessages.push({ role: "system", content: systemPrompt });
    }

    for (const msg of messages) {
      openaiMessages.push(...convertMessage(msg));
    }

    const openaiTools: OpenAITool[] | undefined =
      tools && tools.length > 0 ? tools.map(convertTool) : undefined;

    const body: Record<string, unknown> = {
      model: params.model || this.model,
      messages: openaiMessages,
    };
    if (openaiTools) body.tools = openaiTools;
    if (maxTokens) body.max_tokens = maxTokens;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI API error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as OpenAIResponse;
    const choice = data.choices[0];
    const message = choice.message;

    const textBlocks: string[] = [];
    if (message.content) textBlocks.push(message.content);

    const toolCalls: ToolCall[] = [];
    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        let parsedInput: Record<string, unknown> = {};
        try {
          parsedInput = tc.function.arguments
            ? (JSON.parse(tc.function.arguments) as Record<string, unknown>)
            : {};
        } catch {
          parsedInput = {};
        }
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          input: parsedInput,
        });
      }
    }

    let stopReason: ChatResponse["stopReason"] = "end_turn";
    if (choice.finish_reason === "tool_calls") stopReason = "tool_use";
    else if (choice.finish_reason === "length") stopReason = "max_tokens";

    const usage = data.usage
      ? {
          inputTokens: data.usage.prompt_tokens,
          outputTokens: data.usage.completion_tokens,
        }
      : undefined;

    return { textBlocks, toolCalls, stopReason, usage };
  }

  async chatStream(
    params: ChatRequest,
    callbacks?: ChatStreamCallbacks
  ): Promise<ChatResponse> {
    const { systemPrompt, messages, tools, maxTokens, signal } = params;

    const openaiMessages: OpenAIMessage[] = [];
    if (systemPrompt) {
      openaiMessages.push({ role: "system", content: systemPrompt });
    }
    for (const msg of messages) {
      openaiMessages.push(...convertMessage(msg));
    }

    const openaiTools: OpenAITool[] | undefined =
      tools && tools.length > 0 ? tools.map(convertTool) : undefined;

    const body: Record<string, unknown> = {
      model: params.model || this.model,
      messages: openaiMessages,
      stream: true,
    };
    if (openaiTools) body.tools = openaiTools;
    if (maxTokens) body.max_tokens = maxTokens;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI API error ${res.status}: ${text}`);
    }
    if (!res.body) {
      throw new Error("OpenAI stream response had no body");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let combinedText = "";
    let stopReason: ChatResponse["stopReason"] = "end_turn";
    const toolCallChunks = new Map<
      number,
      { id: string; name: string; args: string }
    >();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIdx = buffer.indexOf("\n");
      while (newlineIdx !== -1) {
        const rawLine = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        newlineIdx = buffer.indexOf("\n");

        if (!rawLine || !rawLine.startsWith("data:")) continue;
        const payload = rawLine.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        let chunk: OpenAIStreamChunk;
        try {
          chunk = JSON.parse(payload) as OpenAIStreamChunk;
        } catch {
          continue;
        }

        const choice = chunk.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta;
        if (delta?.content) {
          combinedText += delta.content;
          callbacks?.onTextDelta?.(delta.content);
        }

        for (const toolDelta of delta?.tool_calls ?? []) {
          const index = toolDelta.index ?? 0;
          const previous = toolCallChunks.get(index) ?? {
            id: toolDelta.id ?? `call_${index}`,
            name: "",
            args: "",
          };
          const functionName = toolDelta.function?.name;
          if (functionName) previous.name = functionName;
          if (toolDelta.id) previous.id = toolDelta.id;
          if (toolDelta.function?.arguments) {
            previous.args += toolDelta.function.arguments;
          }
          toolCallChunks.set(index, previous);
        }

        if (choice.finish_reason === "tool_calls") {
          stopReason = "tool_use";
        } else if (choice.finish_reason === "length") {
          stopReason = "max_tokens";
        }
      }
    }

    const toolCalls: ToolCall[] = Array.from(toolCallChunks.entries())
      .sort(([a], [b]) => a - b)
      .map(([index, value]) => {
        let parsedInput: Record<string, unknown> = {};
        try {
          parsedInput = value.args
            ? (JSON.parse(value.args) as Record<string, unknown>)
            : {};
        } catch {
          parsedInput = {};
        }
        return {
          id: value.id || `call_${index}`,
          name: value.name,
          input: parsedInput,
        };
      });

    return {
      textBlocks: combinedText ? [combinedText] : [],
      toolCalls,
      stopReason,
      usage: undefined,
    };
  }
}

function convertMessage(msg: ChatMessage): OpenAIMessage[] {
  const role = msg.role === "assistant" ? "assistant" : "user";

  if (typeof msg.content === "string") {
    return [{ role, content: msg.content }];
  }

  // Collect tool_result blocks separately — they become "tool" role messages
  const toolResults: OpenAIMessage[] = [];
  const contentParts: ChatContentBlock[] = [];

  for (const block of msg.content) {
    if (block.type === "tool_result" && block.toolUseId) {
      toolResults.push({
        role: "tool",
        content: block.content ?? "",
        tool_call_id: block.toolUseId,
      });
    } else {
      contentParts.push(block);
    }
  }

  const results: OpenAIMessage[] = [];

    if (contentParts.length > 0) {
      // Check if this is an assistant message with tool_use blocks
      const toolUseParts = contentParts.filter((b) => b.type === "tool_use");
      const textParts = contentParts.filter((b) => b.type === "text");

    if (role === "assistant" && toolUseParts.length > 0) {
      const tool_calls: OpenAIToolCall[] = toolUseParts
        .filter((b) => b.id && b.name)
        .map((b) => ({
          id: b.id!,
          type: "function" as const,
          function: {
            name: b.name!,
            arguments: JSON.stringify(b.input ?? {}),
          },
        }));

      const textContent =
        textParts.map((b) => b.text ?? "").join("") || null;

      results.push({ role: "assistant", content: textContent, tool_calls });
    } else {
      // User message — preserve text + image parts for multimodal models
      const userParts: OpenAIContentPart[] = [];
      for (const part of contentParts) {
        if (part.type === "text") {
          userParts.push({ type: "text", text: part.text ?? "" });
        } else if (
          part.type === "image" &&
          part.base64Data &&
          part.mimeType
        ) {
          userParts.push({
            type: "image_url",
            image_url: {
              url: `data:${part.mimeType};base64,${part.base64Data}`,
            },
          });
        }
      }

      if (userParts.length === 0 && textParts.length > 0) {
        const text = textParts.map((b) => b.text ?? "").join("");
        results.push({ role, content: text || null });
      } else {
        results.push({ role, content: userParts.length > 0 ? userParts : null });
      }
    }
  }

  results.push(...toolResults);
  return results;
}

function convertTool(tool: ToolSchema): OpenAITool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}
