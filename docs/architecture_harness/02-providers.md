# Provider Layer

> `examples/providers/` — Unified LLM abstraction over Anthropic, Gemini, and OpenAI.

## Files

| File | Purpose |
|------|---------|
| `types.ts` | Unified interfaces: `LLMProvider`, `ChatRequest`, `ChatResponse` |
| `anthropic.ts` | Anthropic Claude adapter |
| `gemini.ts` | Google Gemini adapter |
| `openai.ts` | OpenAI / OpenAI-compatible adapter |
| `index.ts` | `createProvider()` factory |

---

## Unified Interface (`types.ts`)

All providers implement a single interface:

```typescript
interface LLMProvider {
  name: string;
  chat(params: ChatRequest): Promise<ChatResponse>;
  chatStream?(params: ChatRequest, callbacks?: ChatStreamCallbacks): Promise<ChatResponse>;
}
```

### ChatRequest

```typescript
interface ChatRequest {
  model: string;
  systemPrompt?: string;
  messages: ChatMessage[];
  tools?: ToolSchema[];
  maxTokens?: number;
  signal?: AbortSignal;
}
```

### ChatResponse

```typescript
interface ChatResponse {
  textBlocks: string[];
  toolCalls: ToolCall[];
  stopReason: "end_turn" | "tool_use" | "max_tokens";
  usage?: { inputTokens: number; outputTokens: number };
}
```

### ChatMessage

A flat interface with optional fields, discriminated by `type`:

```typescript
interface ChatContentBlock {
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
```

### ChatStreamCallbacks

```typescript
interface ChatStreamCallbacks {
  onTextDelta?: (delta: string) => void;
}
```

---

## Provider Implementations

### Anthropic (`anthropic.ts`)

- Uses `@anthropic-ai/sdk`
- Maps unified messages to Anthropic content block format
- Supports image blocks via base64 source
- Streaming via `.stream()` with `onTextDelta` callbacks
- Returns aggregated response from `finalMessage()`

### Gemini (`gemini.ts`)

- Uses `@google/genai`
- Maps roles: `user` → `"user"`, `assistant` → `"model"`
- Tool calls mapped from `functionCall` format
- Images sent as `inlineData` with MIME type
- Streaming via `generateContentStream()` with stateful tool call aggregation

### OpenAI (`openai.ts`)

- **Manual `fetch`-based** implementation (no official SDK dependency)
- Maps `tool_result` blocks to separate messages with `role: "tool"`
- Images sent as `image_url` content parts
- Streaming via SSE (Server-Sent Events) with line-by-line parsing
- Reconstructs partial JSON tool arguments across stream chunks
- **OpenRouter support**: Detects `sk-or-*` API keys and auto-routes to `openrouter.ai`
- **Custom base URL**: Supports any OpenAI-compatible endpoint

---

## Factory Function (`index.ts`)

```typescript
function createProvider(config: {
  type: "anthropic" | "gemini" | "openai";
  apiKey?: string;
  baseUrl?: string;
}): LLMProvider
```

- Resolves API keys from environment variables:
  - `ANTHROPIC_API_KEY`
  - `GEMINI_API_KEY` / `GOOGLE_API_KEY`
  - `OPENAI_API_KEY`
- Detects OpenRouter via key prefix
- Returns instantiated provider

---

## Design Rationale

### Why a unified interface?

The `LLMProvider` abstraction allows the entire agent system — core loop, teams, fallback, drift detection — to work identically regardless of which LLM backend is used. Swapping from Claude to Gemini requires changing one config field.

### Why manual fetch for OpenAI?

The OpenAI provider uses raw `fetch` instead of the official SDK to:
1. Support OpenAI-compatible endpoints (OpenRouter, local models, etc.)
2. Avoid SDK version coupling
3. Handle SSE streaming with precise control over chunk reconstruction

### Content block normalization

Each provider must normalize its native response format into the unified `ChatContentBlock` type. This includes:
- Mapping function calls → `tool_use` blocks with consistent `id` fields
- Mapping function results → `tool_result` blocks with `tool_use_id` references
- Normalizing image payloads to base64 source objects
