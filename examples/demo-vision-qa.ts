#!/usr/bin/env ts-node
/**
 * Vision QA Demo — analyze a screenshot using a vision-capable provider.
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
import { runVisionQA } from "./skills/vision-qa-agent";

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

  console.log(`${colors.bold}Vision QA Analysis${colors.reset}`);
  console.log("─".repeat(60));
  console.log(`Image: ${imagePath}`);
  if (context) console.log(`Context: ${context}`);
  console.log("─".repeat(60));
  console.log("Analyzing...\n");

  try {
    const report = await runVisionQA(imagePath, { context });

    console.log(
      `${colors.bold}Findings (${report.findings.length}):${colors.reset}\n`
    );

    for (const finding of report.findings) {
      const color =
        colors[finding.severity as keyof typeof colors] ?? colors.reset;
      console.log(
        `  ${color}[${finding.severity.toUpperCase()}]${colors.reset} ${finding.category}`
      );
      console.log(`    ${finding.description}`);
      if (finding.location) console.log(`    Location: ${finding.location}`);
      console.log(`    Suggestion: ${finding.suggestion}`);
      console.log();
    }

    console.log("─".repeat(60));
    console.log(`${colors.bold}Summary:${colors.reset} ${report.summary}`);
    console.log(`Analyzed at: ${report.analyzedAt}`);
  } catch (err) {
    console.error(`\nError: ${(err as Error).message}`);
    process.exit(1);
  }
}

main();
