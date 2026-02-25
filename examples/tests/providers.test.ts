import { AnthropicProvider } from "../providers/anthropic";
import { GeminiProvider } from "../providers/gemini";
import { OpenAIProvider } from "../providers/openai";
import { createProvider } from "../providers/index";
import type { ChatMessage, ToolSchema, ChatRequest } from "../providers/types";

// ---------------------------------------------------------------------------
// Mock @anthropic-ai/sdk
// ---------------------------------------------------------------------------
const mockAnthropicCreate = jest.fn();
const mockAnthropicStream = jest.fn();
jest.mock("@anthropic-ai/sdk", () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: { create: mockAnthropicCreate, stream: mockAnthropicStream },
    })),
  };
});

// ---------------------------------------------------------------------------
// Mock @google/genai
// ---------------------------------------------------------------------------
const mockGeminiGenerateContent = jest.fn();
const mockGeminiGenerateContentStream = jest.fn();
jest.mock("@google/genai", () => {
  return {
    GoogleGenAI: jest.fn().mockImplementation(() => ({
      models: {
        generateContent: mockGeminiGenerateContent,
        generateContentStream: mockGeminiGenerateContentStream,
      },
    })),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeRequest(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    model: "test-model",
    messages: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AnthropicProvider tests
// ---------------------------------------------------------------------------
describe("AnthropicProvider", () => {
  beforeEach(() => {
    mockAnthropicCreate.mockReset();
    mockAnthropicStream.mockReset();
  });

  it("converts ChatMessage with string content to Anthropic format", async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: "Hello" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const provider = new AnthropicProvider("claude-3-5-haiku-latest");
    const messages: ChatMessage[] = [{ role: "user", content: "Hi" }];
    await provider.chat(makeRequest({ messages }));

    const call = mockAnthropicCreate.mock.calls[0][0];
    expect(call.messages[0]).toEqual({ role: "user", content: "Hi" });
  });

  it("converts tool schemas to Anthropic tools format", async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const provider = new AnthropicProvider("claude-3-5-haiku-latest");
    const tools: ToolSchema[] = [
      {
        name: "get_weather",
        description: "Get weather",
        inputSchema: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      },
    ];
    await provider.chat(makeRequest({ tools }));

    const call = mockAnthropicCreate.mock.calls[0][0];
    expect(call.tools[0]).toEqual({
      name: "get_weather",
      description: "Get weather",
      input_schema: {
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
      },
    });
  });

  it("parses text response into ChatResponse", async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: "The answer is 42." }],
      stop_reason: "end_turn",
      usage: { input_tokens: 8, output_tokens: 6 },
    });

    const provider = new AnthropicProvider("claude-3-5-haiku-latest");
    const result = await provider.chat(makeRequest({ messages: [{ role: "user", content: "What?" }] }));

    expect(result.textBlocks).toEqual(["The answer is 42."]);
    expect(result.toolCalls).toEqual([]);
    expect(result.stopReason).toBe("end_turn");
    expect(result.usage).toEqual({ inputTokens: 8, outputTokens: 6 });
  });

  it("parses tool_use response into ChatResponse", async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_01",
          name: "get_weather",
          input: { city: "Paris" },
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 20, output_tokens: 10 },
    });

    const provider = new AnthropicProvider("claude-3-5-haiku-latest");
    const result = await provider.chat(makeRequest({ messages: [{ role: "user", content: "Weather?" }] }));

    expect(result.textBlocks).toEqual([]);
    expect(result.toolCalls).toEqual([
      { id: "toolu_01", name: "get_weather", input: { city: "Paris" } },
    ]);
    expect(result.stopReason).toBe("tool_use");
  });

  it("streams text deltas and returns final parsed response", async () => {
    const onTextDelta = jest.fn();
    const fakeStream = {
      on: jest.fn().mockImplementation((event: string, listener: (delta: string) => void) => {
        if (event === "text") {
          listener("Hello ");
          listener("world");
        }
        return fakeStream;
      }),
      finalMessage: jest.fn().mockResolvedValue({
        content: [{ type: "text", text: "Hello world" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 11, output_tokens: 7 },
      }),
    };
    mockAnthropicStream.mockReturnValue(fakeStream);

    const provider = new AnthropicProvider("claude-3-5-haiku-latest");
    const result = await provider.chatStream(
      makeRequest({ messages: [{ role: "user", content: "stream?" }] }),
      { onTextDelta }
    );

    expect(mockAnthropicStream).toHaveBeenCalledTimes(1);
    expect(onTextDelta.mock.calls.flat()).toEqual(["Hello ", "world"]);
    expect(result.textBlocks).toEqual(["Hello world"]);
    expect(result.stopReason).toBe("end_turn");
    expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 7 });
  });
});

// ---------------------------------------------------------------------------
// GeminiProvider tests
// ---------------------------------------------------------------------------
describe("GeminiProvider", () => {
  beforeEach(() => {
    mockGeminiGenerateContent.mockReset();
    mockGeminiGenerateContentStream.mockReset();
  });

  it("converts ChatMessage to Gemini Content format", async () => {
    mockGeminiGenerateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ text: "Hi" }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
    });

    const provider = new GeminiProvider("gemini-2.0-flash");
    const messages: ChatMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ];
    await provider.chat(makeRequest({ messages }));

    const call = mockGeminiGenerateContent.mock.calls[0][0];
    expect(call.contents[0]).toEqual({ role: "user", parts: [{ text: "Hello" }] });
    expect(call.contents[1]).toEqual({ role: "model", parts: [{ text: "Hi there" }] });
  });

  it("handles image content blocks (vision)", async () => {
    mockGeminiGenerateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ text: "A cat" }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 3 },
    });

    const provider = new GeminiProvider("gemini-2.0-flash");
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "What is this?" },
          { type: "image", mimeType: "image/png", base64Data: "abc123" },
        ],
      },
    ];
    await provider.chat(makeRequest({ messages }));

    const call = mockGeminiGenerateContent.mock.calls[0][0];
    const parts = call.contents[0].parts;
    expect(parts[0]).toEqual({ text: "What is this?" });
    expect(parts[1]).toEqual({ inlineData: { mimeType: "image/png", data: "abc123" } });
  });

  it("parses function call response", async () => {
    mockGeminiGenerateContent.mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: {
                  id: "fc_01",
                  name: "get_weather",
                  args: { city: "Tokyo" },
                },
              },
            ],
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 8 },
    });

    const provider = new GeminiProvider("gemini-2.0-flash");
    const result = await provider.chat(makeRequest({ messages: [{ role: "user", content: "Weather?" }] }));

    expect(result.toolCalls).toEqual([
      { id: "fc_01", name: "get_weather", input: { city: "Tokyo" } },
    ]);
    expect(result.stopReason).toBe("tool_use");
    expect(result.textBlocks).toEqual([]);
  });

  it("maps tool_result blocks to functionResponse with tool name", async () => {
    mockGeminiGenerateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
    });

    const provider = new GeminiProvider("gemini-2.0-flash");
    await provider.chat(
      makeRequest({
        messages: [
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                toolUseId: "fc_01",
                name: "get_weather",
                content: '{"temp":72}',
              },
            ],
          },
        ],
      })
    );

    const call = mockGeminiGenerateContent.mock.calls[0][0];
    expect(call.contents[0].parts[0]).toEqual({
      functionResponse: {
        id: "fc_01",
        name: "get_weather",
        response: { result: '{"temp":72}' },
      },
    });
  });

  it("streams Gemini text deltas and aggregates function calls", async () => {
    const onTextDelta = jest.fn();
    async function* chunks() {
      yield {
        text: "Hello ",
        functionCalls: undefined,
        candidates: [{ finishReason: "STOP" }],
      };
      yield {
        text: "Hello world",
        functionCalls: [{ id: "fc_01", name: "search", args: { query: "cats" } }],
        candidates: [{ finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 6 },
      };
    }
    mockGeminiGenerateContentStream.mockResolvedValue(chunks());

    const provider = new GeminiProvider("gemini-2.0-flash");
    const result = await provider.chatStream(
      makeRequest({ messages: [{ role: "user", content: "stream?" }] }),
      { onTextDelta }
    );

    expect(mockGeminiGenerateContentStream).toHaveBeenCalledTimes(1);
    expect(onTextDelta.mock.calls.flat()).toEqual(["Hello ", "world"]);
    expect(result.textBlocks).toEqual(["Hello world"]);
    expect(result.toolCalls).toEqual([
      { id: "fc_01", name: "search", input: { query: "cats" } },
    ]);
    expect(result.stopReason).toBe("tool_use");
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 6 });
  });
});

// ---------------------------------------------------------------------------
// OpenAIProvider tests
// ---------------------------------------------------------------------------
describe("OpenAIProvider", () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  function mockFetchResponse(data: unknown, ok = true, status = 200) {
    fetchSpy.mockResolvedValue({
      ok,
      status,
      json: () => Promise.resolve(data),
      text: () => Promise.resolve(JSON.stringify(data)),
    } as Response);
  }

  it("converts ChatMessage to OpenAI messages format", async () => {
    mockFetchResponse({
      choices: [{ message: { content: "Hello", tool_calls: undefined }, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    });

    const provider = new OpenAIProvider("gpt-4o", "test-key");
    const messages: ChatMessage[] = [
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello!" },
    ];
    await provider.chat(makeRequest({ messages }));

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.messages[0]).toEqual({ role: "user", content: "Hi" });
    expect(body.messages[1]).toEqual({ role: "assistant", content: "Hello!" });
  });

  it("converts tool schemas to OpenAI function format", async () => {
    mockFetchResponse({
      choices: [{ message: { content: null, tool_calls: undefined }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const provider = new OpenAIProvider("gpt-4o", "test-key");
    const tools: ToolSchema[] = [
      {
        name: "search",
        description: "Search the web",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      },
    ];
    await provider.chat(makeRequest({ tools }));

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.tools[0]).toEqual({
      type: "function",
      function: {
        name: "search",
        description: "Search the web",
        parameters: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      },
    });
  });

  it("parses tool_calls response", async () => {
    mockFetchResponse({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "call_abc",
                type: "function",
                function: { name: "search", arguments: '{"query":"cats"}' },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 10 },
    });

    const provider = new OpenAIProvider("gpt-4o", "test-key");
    const result = await provider.chat(makeRequest({ messages: [{ role: "user", content: "Find cats" }] }));

    expect(result.toolCalls).toEqual([
      { id: "call_abc", name: "search", input: { query: "cats" } },
    ]);
    expect(result.stopReason).toBe("tool_use");
    expect(result.textBlocks).toEqual([]);
  });

  it("handles invalid tool_call JSON arguments gracefully", async () => {
    mockFetchResponse({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "call_bad",
                type: "function",
                function: { name: "search", arguments: "{" },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 4 },
    });

    const provider = new OpenAIProvider("gpt-4o", "test-key");
    const result = await provider.chat(makeRequest({ messages: [{ role: "user", content: "hi" }] }));
    expect(result.toolCalls).toEqual([
      { id: "call_bad", name: "search", input: {} },
    ]);
  });

  it("maps image content blocks to OpenAI image_url parts", async () => {
    mockFetchResponse({
      choices: [{ message: { content: "ok", tool_calls: undefined }, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    });

    const provider = new OpenAIProvider("gpt-4o", "test-key");
    await provider.chat(
      makeRequest({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Analyze this image" },
              {
                type: "image",
                mimeType: "image/png",
                base64Data: "abc123",
              },
            ],
          },
        ],
      })
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.messages[0].role).toBe("user");
    expect(body.messages[0].content).toEqual([
      { type: "text", text: "Analyze this image" },
      {
        type: "image_url",
        image_url: { url: "data:image/png;base64,abc123" },
      },
    ]);
  });

  it("parses streaming SSE responses via chatStream", async () => {
    const encoder = new TextEncoder();
    const ssePayload =
      'data: {"choices":[{"delta":{"content":"Hello "},"finish_reason":null}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"world","tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"search","arguments":"{\\"query\\":\\"cats\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n' +
      "data: [DONE]\n\n";

    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(ssePayload));
          controller.close();
        },
      }),
      text: () => Promise.resolve(""),
    } as Response);

    const provider = new OpenAIProvider("gpt-4o", "test-key");
    const onTextDelta = jest.fn();
    const result = await provider.chatStream(
      makeRequest({ messages: [{ role: "user", content: "stream?" }] }),
      { onTextDelta }
    );

    expect(onTextDelta.mock.calls.flat()).toEqual(["Hello ", "world"]);
    expect(result.textBlocks).toEqual(["Hello world"]);
    expect(result.toolCalls).toEqual([
      { id: "call_1", name: "search", input: { query: "cats" } },
    ]);
    expect(result.stopReason).toBe("tool_use");

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.stream).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createProvider factory tests
// ---------------------------------------------------------------------------
describe("createProvider factory", () => {
  it("creates an AnthropicProvider for type 'anthropic'", () => {
    const provider = createProvider({
      type: "anthropic",
      model: "claude-3-5-haiku-latest",
      apiKey: "test",
    });
    expect(provider.name).toBe("anthropic");
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it("creates a GeminiProvider for type 'gemini'", () => {
    const provider = createProvider({
      type: "gemini",
      model: "gemini-2.0-flash",
      apiKey: "test",
    });
    expect(provider.name).toBe("gemini");
    expect(provider).toBeInstanceOf(GeminiProvider);
  });

  it("creates an OpenAIProvider for type 'openai'", () => {
    const provider = createProvider({
      type: "openai",
      model: "gpt-4o",
      apiKey: "test",
    });
    expect(provider.name).toBe("openai");
    expect(provider).toBeInstanceOf(OpenAIProvider);
  });

  it("throws on unknown provider type", () => {
    expect(() =>
      createProvider({ type: "unknown" as never, model: "x" })
    ).toThrow("Unknown provider type: unknown");
  });

  it("defaults OpenAI baseUrl to OpenRouter when API key looks like sk-or-*", async () => {
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        }),
      text: () => Promise.resolve(""),
    } as Response);

    try {
      const provider = createProvider({
        type: "openai",
        model: "openai/gpt-4o-mini",
        apiKey: "sk-or-test",
      });
      await provider.chat({
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
      });
      expect(fetchSpy).toHaveBeenCalled();
      const calledUrl = fetchSpy.mock.calls[0][0] as string;
      expect(calledUrl).toContain("https://openrouter.ai/api/v1/chat/completions");
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
