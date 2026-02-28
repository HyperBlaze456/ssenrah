import fs from "fs";
import path from "path";
import { BASELINE_TASK_SET } from "./baseline-task-set";
import { scoreBaselineResponses } from "./scoring";

interface CliArgs {
  responsesPath?: string;
  outPath?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--responses" && argv[i + 1]) {
      args.responsesPath = argv[++i];
    } else if (token === "--out" && argv[i + 1]) {
      args.outPath = argv[++i];
    }
  }
  return args;
}

function readResponses(filePath?: string): Record<string, string> {
  if (!filePath) return {};
  const resolved = path.resolve(filePath);
  const raw = fs.readFileSync(resolved, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object") return {};
  return parsed as Record<string, string>;
}

function defaultOutPath(): string {
  return path.resolve(".omc/evals/baseline-report.json");
}

function main(): void {
  const cli = parseArgs(process.argv.slice(2));
  const responses = readResponses(cli.responsesPath);
  const report = scoreBaselineResponses(BASELINE_TASK_SET, responses);
  const outPath = path.resolve(cli.outPath ?? defaultOutPath());

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  console.log(
    `[eval:baseline] score=${report.totalScore.toFixed(2)}/${report.maxScore.toFixed(
      2
    )} normalized=${(report.normalizedScore * 100).toFixed(1)}%`
  );
  console.log(`[eval:baseline] report written: ${outPath}`);
}

main();

