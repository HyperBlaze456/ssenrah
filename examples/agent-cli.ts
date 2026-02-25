#!/usr/bin/env ts-node
/**
 * agent-cli — interactive REPL for the ssenrah Agent.
 *
 * Usage:
 *   npx ts-node src/agent-cli.ts
 *   npm run agent
 *
 * This is the interactive loop described in
 * https://ampcode.com/notes/how-to-build-an-agent
 *
 * Type a message, press Enter, and the agent will respond,
 * calling tools as needed. Type "exit" or Ctrl-C to quit.
 */
import * as readline from "readline";
import { Agent } from "./agent/agent";
import { defaultTools } from "./agent/tools";

async function main() {
  const agent = new Agent({
    tools: defaultTools,
    systemPrompt: `You are a helpful agent with access to filesystem tools.
You can read files, list directories, and edit files.
Work step by step and explain what you are doing.`,
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("ssenrah agent — type your request, or 'exit' to quit.\n");

  const askQuestion = (): void => {
    rl.question("you> ", async (input) => {
      const trimmed = input.trim();
      if (!trimmed || trimmed.toLowerCase() === "exit") {
        console.log("Goodbye.");
        rl.close();
        return;
      }

      try {
        const result = await agent.run(trimmed);
        if (result.toolsUsed.length > 0) {
          console.log(`\n[tools used: ${result.toolsUsed.join(", ")}]`);
        }
        console.log(`\nagent> ${result.response}\n`);
      } catch (err) {
        console.error(`\nError: ${(err as Error).message}\n`);
      }

      askQuestion();
    });
  };

  askQuestion();
}

main();
