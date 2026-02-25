import { createProvider } from "../providers/index";
import type { LLMProvider } from "../providers/types";
import { createVisionQATool, QAReport } from "../tools/vision-qa";

/**
 * Run a vision QA analysis on an image.
 *
 * Creates a Gemini provider (defaulting to gemini-2.0-flash for vision),
 * uses the screenshot_qa tool to analyze the image,
 * and returns structured findings.
 */
export async function runVisionQA(
  imagePath: string,
  options?: {
    context?: string;
    provider?: LLMProvider;
    providerType?: "gemini" | "anthropic" | "openai";
    model?: string;
    baseUrl?: string;
  }
): Promise<QAReport> {
  const providerType =
    options?.providerType ??
    ((process.env["SSENRAH_PROVIDER"] as
      | "gemini"
      | "anthropic"
      | "openai"
      | undefined) ?? "gemini");
  const model =
    options?.model ??
    process.env["SSENRAH_MODEL"] ??
    (providerType === "gemini"
      ? "gemini-2.0-flash"
      : providerType === "openai"
      ? "openai/gpt-4o-mini"
      : "claude-sonnet-4-20250514");
  const provider =
    options?.provider ??
    createProvider({
      type: providerType,
      model,
      baseUrl: options?.baseUrl ?? process.env["OPENAI_BASE_URL"] ?? process.env["OPENROUTER_BASE_URL"],
    });

  const tool = createVisionQATool(provider, model);

  const resultJson = await tool.run({
    imagePath,
    context: options?.context,
  });

  return JSON.parse(resultJson) as QAReport;
}
