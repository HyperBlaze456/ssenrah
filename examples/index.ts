/**
 * ssenrah — Agent harness entry point.
 *
 * Demonstrates:
 *  1. Single agent usage (Agent class with provider-agnostic tool loop)
 *  2. Agent teams usage (Team orchestrating multiple workers)
 *
 * Run:
 *   npm run dev             — runs this demo
 *   npm run agent           — interactive REPL
 */
import "dotenv/config";
import { Agent } from "./agent/agent";
import { defaultTools } from "./agent/tools";
import { createProvider } from "./providers";
import { Team } from "./teams/team";

async function runSingleAgentDemo() {
  console.log("=".repeat(60));
  console.log("DEMO 1: Single Agent (provider-agnostic)");
  console.log("=".repeat(60));

  // Use Anthropic by default, override with SSENRAH_PROVIDER env var
  const providerType = (process.env["SSENRAH_PROVIDER"] as "anthropic" | "gemini" | "openai") ?? "anthropic";
  const model =
    process.env["SSENRAH_MODEL"] ??
    (providerType === "gemini"
      ? "gemini-2.0-flash"
      : providerType === "openai"
      ? "gpt-4o"
      : "claude-sonnet-4-20250514");

  const provider = createProvider({ type: providerType, model });
  console.log(`Using provider: ${provider.name} / ${model}\n`);

  const agent = new Agent({
    provider,
    model,
    tools: defaultTools,
    systemPrompt: "You are a helpful agent. Complete tasks using your tools.",
  });

  const result = await agent.run(
    "List the files in the current directory, then read the README.md file and give me a one-sentence summary of the project."
  );

  console.log("\nAgent response:");
  console.log(result.response);
  console.log(`\nTools used: ${result.toolsUsed.join(", ") || "none"}`);
}

async function runTeamDemo() {
  console.log("\n" + "=".repeat(60));
  console.log("DEMO 2: Agent Teams (provider-agnostic)");
  console.log("=".repeat(60));

  const providerType = (process.env["SSENRAH_PROVIDER"] as "anthropic" | "gemini" | "openai") ?? "anthropic";
  const workerModel =
    process.env["SSENRAH_WORKER_MODEL"] ??
    (providerType === "gemini"
      ? "gemini-2.0-flash"
      : providerType === "openai"
      ? "gpt-4o"
      : "claude-sonnet-4-20250514");
  const orchestratorModel =
    process.env["SSENRAH_ORCHESTRATOR_MODEL"] ??
    (providerType === "gemini"
      ? "gemini-2.0-flash"
      : providerType === "openai"
      ? "gpt-4o-mini"
      : "claude-3-5-haiku-latest");

  const team = new Team({
    name: "ssenrah-demo",
    verbose: true,
    maxWorkers: 2,
    workerModel,
    orchestratorModel,
    workerProvider: createProvider({ type: providerType, model: workerModel }),
    orchestratorProvider: createProvider({
      type: providerType,
      model: orchestratorModel,
    }),
  });

  const result = await team.run(
    "Explore the project structure: list all source files, read the README.md, and produce a brief summary of what the project does and how it is organized."
  );

  console.log("\n" + "=".repeat(60));
  console.log("Team result:", result.success ? "SUCCESS" : "PARTIAL");
  console.log("=".repeat(60));
  console.log(result.summary);
}

async function main() {
  try {
    await runSingleAgentDemo();
    await runTeamDemo();
  } catch (err) {
    console.error("Fatal error:", (err as Error).message);
    process.exit(1);
  }
}

main();
