import { GoogleGenAI } from "@google/genai";
import type {
  Content,
  Part,
  FunctionDeclaration,
  FunctionCall,
  GenerateContentConfig,
  GenerateContentResponse,
} from "@google/genai";
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

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";
  private genai: GoogleGenAI;

  constructor(private model: string, apiKey?: string) {
    this.genai = new GoogleGenAI({ apiKey: apiKey ?? "" });
  }

  async chat(params: ChatRequest): Promise<ChatResponse> {
    const { systemPrompt, messages, tools, maxTokens, signal } = params;

    const contents = messages.map(convertMessage);

    const config: GenerateContentConfig = {};
    if (systemPrompt) config.systemInstruction = systemPrompt;
    if (maxTokens) config.maxOutputTokens = maxTokens;
    if (signal) config.abortSignal = signal;
    if (tools && tools.length > 0) {
      const functionDeclarations: FunctionDeclaration[] = tools.map(
        convertTool
      );
      config.tools = [{ functionDeclarations }];
    }

    const response = await this.genai.models.generateContent({
      model: params.model || this.model,
      contents,
      config,
    });

    return toChatResponse(response);
  }

  async chatStream(
    params: ChatRequest,
    callbacks?: ChatStreamCallbacks
  ): Promise<ChatResponse> {
    const { systemPrompt, messages, tools, maxTokens, signal } = params;

    const contents = messages.map(convertMessage);
    const config: GenerateContentConfig = {};
    if (systemPrompt) config.systemInstruction = systemPrompt;
    if (maxTokens) config.maxOutputTokens = maxTokens;
    if (signal) config.abortSignal = signal;
    if (tools && tools.length > 0) {
      const functionDeclarations: FunctionDeclaration[] = tools.map(
        convertTool
      );
      config.tools = [{ functionDeclarations }];
    }

    const responseStream = await this.genai.models.generateContentStream({
      model: params.model || this.model,
      contents,
      config,
    });

    let lastChunk: GenerateContentResponse | null = null;
    let fullText = "";
    const toolCallsById = new Map<string, ToolCall>();

    for await (const chunk of responseStream) {
      lastChunk = chunk;
      fullText = consumeChunkText(chunk.text, fullText, (delta) => {
        callbacks?.onTextDelta?.(delta);
      });
      upsertToolCalls(toolCallsById, chunk.functionCalls ?? []);
    }

    if (!lastChunk) {
      return { textBlocks: [], toolCalls: [], stopReason: "end_turn" };
    }

    const response = toChatResponse(lastChunk);
    if (fullText) response.textBlocks = [fullText];
    if (toolCallsById.size > 0) {
      response.toolCalls = Array.from(toolCallsById.values());
      response.stopReason = "tool_use";
    }
    return response;
  }
}

function consumeChunkText(
  chunkText: string | undefined,
  previousSnapshot: string,
  onDelta: (delta: string) => void
): string {
  if (!chunkText) return previousSnapshot;

  if (chunkText.startsWith(previousSnapshot)) {
    const delta = chunkText.slice(previousSnapshot.length);
    if (delta) onDelta(delta);
    return chunkText;
  }

  onDelta(chunkText);
  return previousSnapshot + chunkText;
}

function upsertToolCalls(
  toolCallsById: Map<string, ToolCall>,
  functionCalls: FunctionCall[]
): void {
  for (const call of functionCalls) {
    const id = call.id ?? `call_${call.name ?? toolCallsById.size + 1}`;
    toolCallsById.set(id, {
      id,
      name: call.name ?? "",
      input: (call.args ?? {}) as Record<string, unknown>,
    });
  }
}

function toChatResponse(response: GenerateContentResponse): ChatResponse {
  const textBlocks: string[] = [];
  const toolCalls: ToolCall[] = [];

  const candidate = response.candidates?.[0];
  if (candidate?.content?.parts) {
    for (const part of candidate.content.parts) {
      if (part.text !== undefined) {
        textBlocks.push(part.text);
      } else if (part.functionCall) {
        toolCalls.push({
          id: part.functionCall.id ?? `call_${part.functionCall.name ?? "fn"}`,
          name: part.functionCall.name ?? "",
          input: (part.functionCall.args ?? {}) as Record<string, unknown>,
        });
      }
    }
  }

  let stopReason: ChatResponse["stopReason"] = "end_turn";
  const finishReason = candidate?.finishReason;
  if (toolCalls.length > 0) {
    stopReason = "tool_use";
  } else if (finishReason === "MAX_TOKENS") {
    stopReason = "max_tokens";
  }

  const usage = response.usageMetadata
    ? {
        inputTokens: response.usageMetadata.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata.candidatesTokenCount ?? 0,
      }
    : undefined;

  return { textBlocks, toolCalls, stopReason, usage };
}

function convertMessage(msg: ChatMessage): Content {
  const role = msg.role === "assistant" ? "model" : "user";

  if (typeof msg.content === "string") {
    return { role, parts: [{ text: msg.content }] };
  }

  const parts: Part[] = [];

  for (const block of msg.content) {
    if (block.type === "text" && block.text !== undefined) {
      parts.push({ text: block.text });
    } else if (block.type === "tool_use" && block.name) {
      parts.push({
        functionCall: {
          id: block.id,
          name: block.name,
          args: block.input ?? {},
        },
      });
    } else if (block.type === "tool_result" && block.toolUseId) {
      parts.push({
        functionResponse: {
          id: block.toolUseId,
          name: block.name ?? "",
          response: { result: block.content ?? "" },
        },
      });
    } else if (block.type === "image" && block.base64Data && block.mimeType) {
      parts.push({
        inlineData: {
          mimeType: block.mimeType,
          data: block.base64Data,
        },
      });
    }
  }

  return { role, parts };
}

function convertTool(tool: ToolSchema): FunctionDeclaration {
  return {
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: tool.inputSchema,
  };
}
