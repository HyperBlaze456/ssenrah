import Anthropic from "@anthropic-ai/sdk";
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

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor(private model: string, apiKey?: string) {
    this.client = new Anthropic({ apiKey });
  }

  async chat(params: ChatRequest): Promise<ChatResponse> {
    const { systemPrompt, messages, tools, maxTokens = 4096, signal } = params;

    const anthropicMessages = messages.map(convertMessage);
    const anthropicTools = tools ? tools.map(convertTool) : undefined;

    const response = await this.client.messages.create(
      {
        model: params.model || this.model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: anthropicMessages,
        tools: anthropicTools,
      },
      { signal }
    );

    return toChatResponse(response);
  }

  async chatStream(
    params: ChatRequest,
    callbacks?: ChatStreamCallbacks
  ): Promise<ChatResponse> {
    const { systemPrompt, messages, tools, maxTokens = 4096, signal } = params;

    const anthropicMessages = messages.map(convertMessage);
    const anthropicTools = tools ? tools.map(convertTool) : undefined;

    const stream = this.client.messages.stream(
      {
        model: params.model || this.model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: anthropicMessages,
        tools: anthropicTools,
      },
      { signal }
    );

    stream.on("text", (delta) => {
      callbacks?.onTextDelta?.(delta);
    });

    const finalMessage = await stream.finalMessage();
    return toChatResponse(finalMessage);
  }
}

function toChatResponse(response: Anthropic.Message): ChatResponse {
  const textBlocks: string[] = [];
  const toolCalls: ToolCall[] = [];

  for (const block of response.content) {
    if (block.type === "text") {
      textBlocks.push(block.text);
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        name: block.name,
        input: block.input as Record<string, unknown>,
      });
    }
  }

  let stopReason: ChatResponse["stopReason"] = "end_turn";
  if (response.stop_reason === "tool_use") stopReason = "tool_use";
  else if (response.stop_reason === "max_tokens") stopReason = "max_tokens";

  return {
    textBlocks,
    toolCalls,
    stopReason,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}

function convertMessage(msg: ChatMessage): Anthropic.MessageParam {
  const role = msg.role === "assistant" ? "assistant" : "user";

  if (typeof msg.content === "string") {
    return { role, content: msg.content };
  }

  const content: Anthropic.ContentBlockParam[] = [];

  for (const block of msg.content) {
    if (block.type === "text" && block.text !== undefined) {
      content.push({ type: "text", text: block.text });
    } else if (block.type === "tool_use" && block.id && block.name) {
      content.push({
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: block.input ?? {},
      });
    } else if (block.type === "tool_result" && block.toolUseId) {
      const resultBlock: Anthropic.ToolResultBlockParam = {
        type: "tool_result",
        tool_use_id: block.toolUseId,
        content: block.content ?? "",
        is_error: block.isError,
      };
      content.push(resultBlock);
    } else if (block.type === "image" && block.base64Data && block.mimeType) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: block.mimeType as
            | "image/jpeg"
            | "image/png"
            | "image/gif"
            | "image/webp",
          data: block.base64Data,
        },
      });
    }
  }

  return { role, content };
}

function convertTool(tool: ToolSchema): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool["input_schema"],
  };
}
