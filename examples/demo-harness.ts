#!/usr/bin/env ts-node
/**
 * demo-harness — demonstrates the full ssenrah harness:
 *   1. Provider-agnostic agent
 *   2. Intent gate (declares purpose before every tool call)
 *   3. Beholder overseer (monitors for drift/loops/budget)
 *   4. Fallback agent (retries failed tool calls)
 *   5. Event logging
 *
 * Usage:
 *   npx ts-node demo-harness.ts
 *   npm run demo:harness
 */
import "dotenv/config";
import { Agent } from "./agent/agent";
import { defaultTools } from "./agent/tools";
import { createProvider } from "./providers";
import { Beholder } from "./harness/beholder";

const colors = {
  dim: "\x1b[90m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
};

async function main() {
  console.log(`${colors.bold}ssenrah Harness Demo${colors.reset}`);
  console.log("─".repeat(60));

  // Use env vars or default to gemini
  const providerType = (process.env["SSENRAH_PROVIDER"] as "anthropic" | "gemini" | "openai") ?? "gemini";
  const model =
    process.env["SSENRAH_MODEL"] ??
    (providerType === "gemini"
      ? "gemini-2.0-flash"
      : providerType === "openai"
      ? "gpt-4o"
      : "claude-sonnet-4-20250514");
  const fallbackModel =
    process.env["SSENRAH_FALLBACK_MODEL"] ??
    (providerType === "gemini"
      ? "gemini-2.0-flash"
      : providerType === "openai"
      ? "gpt-4o-mini"
      : "claude-3-5-haiku-latest");

  const provider = createProvider({ type: providerType, model });
  const fallbackProvider = createProvider({ type: providerType, model: fallbackModel });

  console.log(`Provider: ${provider.name} / ${model}`);
  console.log(`Fallback: ${fallbackProvider.name} / ${fallbackModel}`);
  console.log(`Intent gate: enabled`);
  console.log(`Beholder: enabled`);
  console.log("─".repeat(60));

  // Create agent with full harness
  const agent = new Agent({
    provider,
    model,
    tools: defaultTools,
    intentRequired: true,
    fallbackProvider,
    fallbackModel,
    systemPrompt: `You are a helpful agent with access to filesystem tools.
You can read files, list directories, and edit files.
Work step by step and explain what you are doing.`,
  });

  // Attach Beholder overseer
  const beholder = new Beholder({
    maxToolCallsPerMinute: 30,
    maxConsecutiveDrift: 3,
    maxTokenBudget: 100_000,
    provider: fallbackProvider,
    model: fallbackModel,
  });
  agent.setBeholder(beholder);

  console.log("\nRunning agent with task: 'List the files in the current directory and summarize what you find.'\n");

  try {
    const result = await agent.run(
      "List the files in the current directory and summarize what you find."
    );

    console.log(`\n${colors.bold}Agent Response:${colors.reset}`);
    console.log(result.response);
    console.log(`\n${colors.dim}Tools used: ${result.toolsUsed.join(", ") || "none"}${colors.reset}`);

    // Show Beholder stats
    const stats = beholder.getStats();
    console.log(`\n${colors.bold}Beholder Stats:${colors.reset}`);
    console.log(`  Total tool calls monitored: ${stats.totalToolCalls}`);
    console.log(`  Total tokens tracked: ${stats.totalTokens}`);
    console.log(`  Drift warnings: ${stats.driftCount}`);

    // Show event log
    const events = agent.getEventLogger().getEvents();
    console.log(`\n${colors.bold}Event Log (${events.length} events):${colors.reset}`);
    for (const event of events.slice(0, 20)) {
      const typeColor = event.type === "error" ? colors.red
        : event.type === "beholder_action" ? colors.yellow
        : event.type === "intent" ? colors.green
        : colors.dim;
      console.log(`  ${colors.dim}${event.timestamp}${colors.reset} ${typeColor}[${event.type}]${colors.reset} ${JSON.stringify(event.data)}`);
    }
    if (events.length > 20) {
      console.log(`  ... and ${events.length - 20} more events`);
    }
  } catch (err) {
    console.error(`\n${colors.red}Error: ${(err as Error).message}${colors.reset}`);
    process.exit(1);
  }
}

main();
