/**
 * ssenrah — Agent harness entry point.
 *
 * Demonstrates both:
 *  1. Single agent usage (Agent class with tool loop)
 *  2. Agent teams usage (Team orchestrating multiple workers)
 *
 * Run:
 *   npm run dev             — runs this demo
 *   npm run agent           — interactive REPL
 */
import { Agent } from "./agent/agent";
import { defaultTools } from "./agent/tools";
import { Team } from "./teams/team";

async function runSingleAgentDemo() {
  console.log("=".repeat(60));
  console.log("DEMO 1: Single Agent");
  console.log("=".repeat(60));

  const agent = new Agent({
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
  console.log("DEMO 2: Agent Teams");
  console.log("=".repeat(60));

  const team = new Team({
    name: "ssenrah-demo",
    verbose: true,
    maxWorkers: 2,
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
