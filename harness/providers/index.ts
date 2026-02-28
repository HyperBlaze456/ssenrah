export { AnthropicProvider } from "./anthropic";
export { GeminiProvider } from "./gemini";
export { OpenAIProvider } from "./openai";
export * from "./types";

import { AnthropicProvider } from "./anthropic";
import { GeminiProvider } from "./gemini";
import { OpenAIProvider } from "./openai";
import type { ProviderConfig, LLMProvider } from "./types";

export function createProvider(config: ProviderConfig): LLMProvider {
  const apiKey = config.apiKey;
  const openaiApiKey = apiKey ?? process.env.OPENAI_API_KEY;
  const openaiBaseUrl =
    config.baseUrl ??
    process.env.OPENAI_BASE_URL ??
    process.env.OPENROUTER_BASE_URL ??
    (openaiApiKey?.startsWith("sk-or-")
      ? "https://openrouter.ai/api/v1"
      : undefined);

  switch (config.type) {
    case "anthropic":
      return new AnthropicProvider(
        config.model,
        apiKey ?? process.env.ANTHROPIC_API_KEY
      );
    case "gemini":
      return new GeminiProvider(
        config.model,
        apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY
      );
    case "openai":
      return new OpenAIProvider(
        config.model,
        openaiApiKey,
        openaiBaseUrl
      );
    default: {
      const exhaustive: never = config.type;
      throw new Error(`Unknown provider type: ${exhaustive}`);
    }
  }
}
