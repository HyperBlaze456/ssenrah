#!/usr/bin/env ts-node
/**
 * Vision QA Demo — hook-activated harness component + markdown skill injection.
 *
 * Usage:
 *   npx ts-node demo-vision-qa.ts <image-path> [context]
 *   npm run demo:vision-qa -- <image-path>
 *
 * Env overrides:
 *   SSENRAH_PROVIDER=gemini|openai|anthropic
 *   SSENRAH_MODEL=<model-id>
 */
import "dotenv/config";
import { Agent } from "./agent/agent";
import { createProvider } from "./providers";
import { createVisionQAHook } from "./harness/components/vision-qa";
import { createDefaultToolRegistry } from "./tools/registry";

// ANSI color helpers
const colors = {
  critical: "\x1b[31m",   // red
  major: "\x1b[33m",      // yellow
  minor: "\x1b[36m",      // cyan
  suggestion: "\x1b[90m", // gray
  reset: "\x1b[0m",
  bold: "\x1b[1m",
} as const;

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error(
      "Usage: npx ts-node demo-vision-qa.ts <image-path> [context]"
    );
    console.error(
      "Example: npx ts-node demo-vision-qa.ts ./screenshot.png 'login page'"
    );
    process.exit(1);
  }

  const imagePath = args[0];
  const context = args.slice(1).join(" ") || undefined;

  const providerType =
    (process.env["SSENRAH_PROVIDER"] as "gemini" | "openai" | "anthropic") ??
    "gemini";
  const model =
    process.env["SSENRAH_MODEL"] ??
    (providerType === "gemini"
      ? "gemini-2.0-flash"
      : providerType === "openai"
      ? "openai/gpt-4o-mini"
      : "claude-sonnet-4-20250514");

  const provider = createProvider({ type: providerType, model });
  const toolRegistry = createDefaultToolRegistry({
    visionProvider: provider,
    visionModel: model,
    screenshotOutputDir: "./screenshots",
  });

  const agent = new Agent({
    provider,
    model,
    toolRegistry,
    // Base tools are intentionally minimal; Vision QA tools are hook-injected.
    toolPacks: ["filesystem"],
    hooks: [
      createVisionQAHook({
        model,
        activateWhen: () => true,
      }),
    ],
    intentRequired: false,
    systemPrompt:
      "You are a QA assistant. Use injected tools and skills to review UI screenshots.",
  });

  console.log(`${colors.bold}Vision QA Analysis${colors.reset}`);
  console.log("─".repeat(60));
  console.log(`Image: ${imagePath}`);
  if (context) console.log(`Context: ${context}`);
  console.log("─".repeat(60));
  console.log("Analyzing...\n");

  try {
    const task = `Run UI/UX QA for imagePath="${imagePath}"${
      context ? ` with context="${context}"` : ""
    }.
Use tool analyze_image_ui_qa and return concise findings + summary.`;

    const result = await agent.run(task);
    console.log(`${colors.bold}Agent Output:${colors.reset}\n${result.response}`);
    console.log("─".repeat(60));
    console.log(`Tools used: ${result.toolsUsed.join(", ") || "none"}`);
  } catch (err) {
    console.error(`\nError: ${(err as Error).message}`);
    process.exit(1);
  }
}

main();
