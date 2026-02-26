#!/usr/bin/env ts-node
/**
 * agent-cli — interactive REPL for the ssenrah Agent.
 *
 * Usage:
 *   npx ts-node agent-cli.ts
 *   npx ts-node agent-cli.ts --provider gemini --model gemini-2.0-flash
 *   npx ts-node agent-cli.ts --provider anthropic --model claude-sonnet-4-20250514
 *   npx ts-node agent-cli.ts --provider openai --model gpt-4o
 *   npx ts-node agent-cli.ts --overseer
 *   npx ts-node agent-cli.ts --no-layout
 *   npx ts-node agent-cli.ts --no-stream
 *   npx ts-node agent-cli.ts --reset-prefs
 *   npm run agent
 */
import "dotenv/config";
import * as readline from "readline";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Agent } from "./agent/agent";
import { createProvider } from "./providers";
import { LLMProvider } from "./providers/types";
import { Beholder } from "./harness/beholder";
import { HarnessEvent, summarizeHarnessEventTypes } from "./harness/events";
import { buildRiskStatusLines } from "./harness/risk-status";
import { createDefaultToolRegistry } from "./tools/registry";

type PaneName = "status" | "prompt" | "assistant" | "tasks" | "tools" | "events";

type PaneWeights = Record<PaneName, number>;

const DEFAULT_PANE_WEIGHTS: PaneWeights = {
  status: 2,
  prompt: 2,
  assistant: 7,
  tasks: 3,
  tools: 3,
  events: 3,
};

const CLI_PREFS_VERSION = 1;
const CLI_PREFS_PATH = path.join(
  os.homedir(),
  ".ssenrah",
  "agent-cli-preferences.json"
);

interface CliPreferences {
  version: number;
  streamEnabled: boolean;
  layoutEnabled: boolean;
  panelsEnabled: boolean;
  paneWeights: PaneWeights;
}

const color = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
};

function paint(text: string, tone: keyof typeof color): string {
  return `${color[tone]}${text}${color.reset}`;
}

function printBanner(
  providerType: "anthropic" | "gemini" | "openai",
  model: string,
  streamEnabled: boolean,
  overseer: boolean,
  layoutEnabled: boolean
): void {
  const title = `${paint("ssenrah", "bold")} ${paint("interactive agent", "dim")}`;
  const status = [
    `provider=${paint(providerType, "cyan")}`,
    `model=${paint(model, "cyan")}`,
    `stream=${streamEnabled ? paint("on", "green") : paint("off", "yellow")}`,
    `overseer=${overseer ? paint("on", "green") : paint("off", "yellow")}`,
    `layout=${layoutEnabled ? paint("on", "green") : paint("off", "yellow")}`,
  ].join("  ");

  console.log("\n" + paint("═".repeat(78), "dim"));
  console.log(`  ${title}`);
  console.log(`  ${status}`);
  console.log(
    `  ${paint("Commands:", "magenta")} /help  /stream on|off  /layout on|off  /panels on|off  /pane ...  /prefs ...  /clear  /exit`
  );
  console.log(
    `  ${paint("Shortcuts:", "magenta")} Ctrl+L clear  Ctrl+G stream  Ctrl+O layout  Ctrl+B panels`
  );
  console.log(paint("═".repeat(78), "dim") + "\n");
}

function printHelp(): void {
  console.log(paint("Available commands:", "magenta"));
  console.log("  /help           Show this help");
  console.log("  /stream on|off  Toggle streaming output");
  console.log("  /layout on|off  Toggle split-pane live layout");
  console.log("  /panels on|off  Toggle dashboard panels");
  console.log("  /pane list      Show pane weights and computed heights");
  console.log("  /pane reset     Reset pane weights");
  console.log("  /pane <name> <+N|-N|N>  Adjust pane weight");
  console.log("  /prefs show     Show persisted preference state");
  console.log("  /prefs save     Save current preferences");
  console.log("  /prefs load     Reload preferences from disk");
  console.log("  /prefs reset    Reset + save default preferences");
  console.log("  /prefs autosave on|off  Toggle auto-save on setting changes");
  console.log("  /clear          Clear screen");
  console.log("  /exit           Exit CLI");
  console.log("");
  console.log("Keyboard shortcuts:");
  console.log("  Ctrl+L clear screen");
  console.log("  Ctrl+G toggle streaming");
  console.log("  Ctrl+O toggle live layout");
  console.log("  Ctrl+B toggle dashboard panels");
}

function terminalWidth(): number {
  const raw = process.stdout.columns ?? 90;
  return Math.max(60, Math.min(raw, 120));
}

function truncateLine(text: string, width: number): string {
  if (text.length <= width) return text;
  if (width <= 1) return "…";
  return text.slice(0, width - 1) + "…";
}

function renderPanel(
  title: string,
  lines: string[],
  accent: keyof typeof color = "dim"
): string {
  const width = terminalWidth();
  const innerWidth = width - 4;
  const titleText = ` ${title} `;
  const barSize = Math.max(0, innerWidth - titleText.length);
  const top = `┌${"─".repeat(Math.floor(barSize / 2))}${titleText}${"─".repeat(
    Math.ceil(barSize / 2)
  )}┐`;
  const body = (lines.length > 0 ? lines : ["(none)"])
    .map((line) => {
      const trimmed = truncateLine(line, innerWidth);
      return `│ ${trimmed}${" ".repeat(Math.max(0, innerWidth - trimmed.length))} │`;
    })
    .join("\n");
  const bottom = `└${"─".repeat(innerWidth + 2)}┘`;
  return `${paint(top, accent)}\n${body}\n${paint(bottom, accent)}`;
}

function toSafeString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function summarizeToolLines(events: HarnessEvent[]): string[] {
  const calls = events.filter((event) => event.type === "tool_call");
  const results = events.filter((event) => event.type === "tool_result");
  if (calls.length === 0) return ["No tool calls in this turn."];

  return calls.map((call, idx) => {
    const toolName = toSafeString(call.data["tool"]) || "unknown_tool";
    const matchingResult = results[idx];
    const isError = Boolean(matchingResult?.data["isError"]);
    const status = isError ? "ERROR" : "OK";
    const contentLength = Number(matchingResult?.data["contentLength"] ?? 0);
    return `${idx + 1}. ${toolName}  ${status}  output=${Number.isFinite(contentLength) ? contentLength : 0} chars`;
  });
}

function summarizeEventLines(events: HarnessEvent[]): string[] {
  if (events.length === 0) return ["No harness events captured for this turn."];

  const counts = summarizeHarnessEventTypes(events);
  const known = counts.knownCounts;

  const summary = [
    `intent=${known.intent}`,
    `policy=${known.policy}`,
    `tool_call=${known.tool_call}`,
    `tool_result=${known.tool_result}`,
    `beholder=${known.beholder_action}`,
    `fallback=${known.fallback}`,
    `turn_result=${known.turn_result}`,
    `error=${known.error}`,
    `unknown=${counts.unknownCount}`,
  ].join("  ");

  const lastError = [...events].reverse().find((event) => event.type === "error");
  const lastBeholder = [...events]
    .reverse()
    .find((event) => event.type === "beholder_action");
  const lines = [summary];

  if (lastBeholder) {
    const action = toSafeString(lastBeholder.data["action"]) || "unknown";
    const reason = toSafeString(lastBeholder.data["reason"]);
    lines.push(`Last Beholder action: ${action}${reason ? ` — ${reason}` : ""}`);
  }
  if (lastError) {
    const reason = toSafeString(lastError.data["reason"]) || "unknown";
    lines.push(`Last error: ${reason}`);
  }
  if (counts.unknownCount > 0) {
    lines.push(`Unknown event types grouped: ${counts.unknownTypes.join(", ")}`);
  }

  return lines;
}

function summarizeTaskLines(events: HarnessEvent[]): string[] {
  const intents = events.filter((event) => event.type === "intent");
  if (intents.length === 0) return ["No declared intent blocks in this turn."];

  return intents.map((intent, idx) => {
    const toolName = toSafeString(intent.data["toolName"]) || "unknown_tool";
    const purpose = toSafeString(intent.data["purpose"]) || "no purpose provided";
    const risk = (toSafeString(intent.data["riskLevel"]) || "read").toUpperCase();
    return `${idx + 1}. [${risk}] ${toolName} → ${purpose}`;
  });
}

function printTurnDashboard(
  events: HarnessEvent[],
  elapsedMs: number,
  tokens: { input: number; output: number },
  streamEnabled: boolean
): void {
  const summaryPanel = renderPanel(
    "Turn Summary",
    [
      `elapsed=${elapsedMs}ms  stream=${streamEnabled ? "on" : "off"}`,
      `tokens in/out=${tokens.input}/${tokens.output}`,
      ...buildRiskStatusLines(events),
    ],
    "dim"
  );
  const taskPanel = renderPanel("Tasks / Intents", summarizeTaskLines(events), "magenta");
  const toolsPanel = renderPanel("Tool Execution", summarizeToolLines(events), "cyan");
  const eventsPanel = renderPanel("Event Log", summarizeEventLines(events), "yellow");

  console.log("\n" + summaryPanel);
  console.log(taskPanel);
  console.log(toolsPanel);
  console.log(eventsPanel + "\n");
}

function clearScreen(): void {
  process.stdout.write("\x1b[2J\x1b[H");
}

function wrapText(text: string, width: number, maxLines: number): string[] {
  const lines: string[] = [];
  const segments = text.split("\n");

  for (const segment of segments) {
    let remaining = segment;
    if (remaining.length === 0) {
      lines.push("");
      if (lines.length >= maxLines) return lines.slice(0, maxLines);
      continue;
    }

    while (remaining.length > 0) {
      if (remaining.length <= width) {
        lines.push(remaining);
        break;
      }

      let splitAt = remaining.lastIndexOf(" ", width);
      if (splitAt < Math.floor(width * 0.5)) {
        splitAt = width;
      }
      lines.push(remaining.slice(0, splitAt).trimEnd());
      remaining = remaining.slice(splitAt).trimStart();

      if (lines.length >= maxLines) {
        return lines.slice(0, maxLines);
      }
    }
    if (lines.length >= maxLines) {
      return lines.slice(0, maxLines);
    }
  }

  return lines.slice(0, maxLines);
}

function cloneDefaultPaneWeights(): PaneWeights {
  return { ...DEFAULT_PANE_WEIGHTS };
}

function computePaneLineBudgets(weights: PaneWeights): Record<PaneName, number> {
  const terminalRows = process.stdout.rows ?? 44;
  const reservedRows = 12; // header + spacing + prompt room
  const available = Math.max(20, terminalRows - reservedRows);

  const mins: Record<PaneName, number> = {
    status: 2,
    prompt: 2,
    assistant: 4,
    tasks: 3,
    tools: 3,
    events: 3,
  };

  const minTotal = (Object.keys(mins) as PaneName[]).reduce(
    (sum, name) => sum + mins[name],
    0
  );
  const extra = Math.max(0, available - minTotal);
  const weightTotal = Math.max(
    1,
    (Object.keys(weights) as PaneName[]).reduce(
      (sum, name) => sum + Math.max(1, weights[name]),
      0
    )
  );

  const allocated: Record<PaneName, number> = { ...mins };
  let usedExtra = 0;
  for (const name of Object.keys(weights) as PaneName[]) {
    const share = Math.floor((extra * Math.max(1, weights[name])) / weightTotal);
    allocated[name] += share;
    usedExtra += share;
  }

  let remainder = extra - usedExtra;
  const order: PaneName[] = ["assistant", "events", "tools", "tasks", "prompt", "status"];
  let idx = 0;
  while (remainder > 0) {
    const name = order[idx % order.length];
    allocated[name] += 1;
    remainder--;
    idx++;
  }

  return allocated;
}

function fitPanelLines(lines: string[], width: number, maxLines: number): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const remaining = maxLines - out.length;
    if (remaining <= 0) break;
    const wrapped = wrapText(line, width, remaining);
    out.push(...wrapped);
  }
  return out.slice(0, maxLines);
}

function formatPaneSummary(weights: PaneWeights): string {
  const budgets = computePaneLineBudgets(weights);
  return (Object.keys(weights) as PaneName[])
    .map((name) => `${name}:w${weights[name]}/h${budgets[name]}`)
    .join("  ");
}

function parsePaneWeightInput(raw: string, current: number): number | null {
  const trimmed = raw.trim();
  if (/^[+-]\d+$/.test(trimmed)) {
    const delta = Number(trimmed);
    return Number.isFinite(delta) ? Math.max(1, current + delta) : null;
  }
  if (/^\d+$/.test(trimmed)) {
    const absolute = Number(trimmed);
    return Number.isFinite(absolute) ? Math.max(1, absolute) : null;
  }
  return null;
}

function isPaneName(value: string): value is PaneName {
  return (
    value === "status" ||
    value === "prompt" ||
    value === "assistant" ||
    value === "tasks" ||
    value === "tools" ||
    value === "events"
  );
}

function sanitizePaneWeights(input: unknown): PaneWeights | null {
  if (typeof input !== "object" || input === null) return null;
  const candidate = input as Record<string, unknown>;
  const next = cloneDefaultPaneWeights();
  for (const key of Object.keys(next) as PaneName[]) {
    const raw = candidate[key];
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      return null;
    }
    next[key] = Math.max(1, Math.floor(raw));
  }
  return next;
}

function loadCliPreferences(): CliPreferences | null {
  try {
    if (!fs.existsSync(CLI_PREFS_PATH)) return null;
    const raw = fs.readFileSync(CLI_PREFS_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<CliPreferences>;
    const paneWeights = sanitizePaneWeights(parsed.paneWeights);
    if (!paneWeights) return null;
    if (
      typeof parsed.streamEnabled !== "boolean" ||
      typeof parsed.layoutEnabled !== "boolean" ||
      typeof parsed.panelsEnabled !== "boolean"
    ) {
      return null;
    }
    return {
      version:
        typeof parsed.version === "number" ? parsed.version : CLI_PREFS_VERSION,
      streamEnabled: parsed.streamEnabled,
      layoutEnabled: parsed.layoutEnabled,
      panelsEnabled: parsed.panelsEnabled,
      paneWeights,
    };
  } catch {
    return null;
  }
}

function saveCliPreferences(prefs: CliPreferences): boolean {
  try {
    fs.mkdirSync(path.dirname(CLI_PREFS_PATH), { recursive: true });
    fs.writeFileSync(CLI_PREFS_PATH, JSON.stringify(prefs, null, 2) + "\n", "utf8");
    return true;
  } catch {
    return false;
  }
}

function buildCliPreferences(state: {
  streamEnabled: boolean;
  layoutEnabled: boolean;
  panelsEnabled: boolean;
  paneWeights: PaneWeights;
}): CliPreferences {
  return {
    version: CLI_PREFS_VERSION,
    streamEnabled: state.streamEnabled,
    layoutEnabled: state.layoutEnabled,
    panelsEnabled: state.panelsEnabled,
    paneWeights: { ...state.paneWeights },
  };
}

type LivePhase = "thinking" | "responding" | "complete" | "error";

interface LiveTurnSnapshot {
  providerType: "anthropic" | "gemini" | "openai";
  model: string;
  streamEnabled: boolean;
  overseer: boolean;
  phase: LivePhase;
  elapsedMs: number;
  tokensIn: number;
  tokensOut: number;
  userPrompt: string;
  assistantText: string;
  events: HarnessEvent[];
  toolsUsed: string[];
  paneWeights: PaneWeights;
}

const LIVE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function renderLiveTurn(snapshot: LiveTurnSnapshot): void {
  const width = terminalWidth();
  const budgets = computePaneLineBudgets(snapshot.paneWeights);
  const contentWidth = Math.max(10, width - 4);
  const frame =
    snapshot.phase === "complete"
      ? "✓"
      : snapshot.phase === "error"
      ? "!"
      : LIVE_FRAMES[Math.floor(snapshot.elapsedMs / 120) % LIVE_FRAMES.length];
  const phaseLabel =
    snapshot.phase === "complete"
      ? paint("complete", "green")
      : snapshot.phase === "error"
      ? paint("error", "red")
      : snapshot.phase === "responding"
      ? paint("responding", "cyan")
      : paint("thinking", "yellow");

  const statusLines = [
    `${frame} phase=${phaseLabel}  elapsed=${snapshot.elapsedMs}ms`,
    `provider=${snapshot.providerType}  model=${snapshot.model}`,
    `stream=${snapshot.streamEnabled ? "on" : "off"}  overseer=${
      snapshot.overseer ? "on" : "off"
    }  tokens=${snapshot.tokensIn}/${snapshot.tokensOut}`,
    `tools used=${snapshot.toolsUsed.length > 0 ? snapshot.toolsUsed.join(", ") : "none"}`,
    ...buildRiskStatusLines(snapshot.events),
  ];

  const assistantSource =
    snapshot.assistantText.trim() === ""
      ? "(waiting for model output...)"
      : snapshot.assistantText;
  const assistantLines = fitPanelLines(
    assistantSource.split("\n"),
    contentWidth,
    budgets.assistant
  );
  const promptLines = fitPanelLines(
    snapshot.userPrompt.split("\n"),
    contentWidth,
    budgets.prompt
  );
  const statusPanelLines = fitPanelLines(statusLines, contentWidth, budgets.status);
  const taskLines = fitPanelLines(
    summarizeTaskLines(snapshot.events),
    contentWidth,
    budgets.tasks
  );
  const toolLines = fitPanelLines(
    summarizeToolLines(snapshot.events),
    contentWidth,
    budgets.tools
  );
  const eventLines = fitPanelLines(
    summarizeEventLines(snapshot.events),
    contentWidth,
    budgets.events
  );

  clearScreen();
  console.log(paint("ssenrah live layout", "bold"));
  console.log(
    paint(
      "Type /layout off to disable live split-pane rendering (applies next turn).",
      "dim"
    )
  );
  console.log(renderPanel("Status", statusPanelLines, "dim"));
  console.log(renderPanel("User Prompt", promptLines, "magenta"));
  console.log(renderPanel("Assistant Stream", assistantLines, "cyan"));
  console.log(renderPanel("Intents / Tasks", taskLines, "magenta"));
  console.log(renderPanel("Tool Execution", toolLines, "yellow"));
  console.log(renderPanel("Event Log", eventLines, "dim"));
}

function startLiveRenderer(render: () => void): () => void {
  if (!process.stdout.isTTY) return () => undefined;
  render();
  const timer = setInterval(render, 120);
  return () => clearInterval(timer);
}

function startSpinner(label: string): () => void {
  if (!process.stdout.isTTY) return () => undefined;
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let frame = 0;
  const paintLine = () => {
    const message = `${frames[frame % frames.length]} ${label}`;
    process.stdout.write(`\r${paint(message, "dim")}`);
    frame++;
  };

  paintLine();
  const interval = setInterval(paintLine, 90);
  return () => {
    clearInterval(interval);
    process.stdout.write(`\r${" ".repeat(label.length + 4)}\r`);
  };
}

function parseArgs(): {
  providerType: "anthropic" | "gemini" | "openai";
  model: string;
  overseer: boolean;
  stream?: boolean;
  layout?: boolean;
  resetPrefs: boolean;
} {
  const args = process.argv.slice(2);
  let providerType: "anthropic" | "gemini" | "openai" = "anthropic";
  let model = "claude-sonnet-4-20250514";
  let overseer = false;
  let stream: boolean | undefined;
  let layout: boolean | undefined;
  let resetPrefs = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--provider" && args[i + 1]) {
      const p = args[i + 1];
      if (p === "anthropic" || p === "gemini" || p === "openai") {
        providerType = p;
      } else {
        console.error(`Unknown provider: ${p}. Use anthropic, gemini, or openai.`);
        process.exit(1);
      }
      i++;
    } else if (args[i] === "--model" && args[i + 1]) {
      model = args[i + 1];
      i++;
    } else if (args[i] === "--overseer") {
      overseer = true;
    } else if (args[i] === "--stream") {
      stream = true;
    } else if (args[i] === "--no-stream") {
      stream = false;
    } else if (args[i] === "--layout") {
      layout = true;
    } else if (args[i] === "--no-layout") {
      layout = false;
    } else if (args[i] === "--reset-prefs") {
      resetPrefs = true;
    }
  }

  // Set default models per provider if user didn't specify
  if (!args.includes("--model")) {
    if (providerType === "gemini") model = "gemini-2.0-flash";
    else if (providerType === "openai") model = "gpt-4o";
    else model = "claude-sonnet-4-20250514";
  }

  return { providerType, model, overseer, stream, layout, resetPrefs };
}

async function main() {
  const { providerType, model, overseer, stream, layout, resetPrefs } = parseArgs();
  const loadedPrefs = resetPrefs ? null : loadCliPreferences();
  let streamEnabled = stream ?? loadedPrefs?.streamEnabled ?? true;
  let layoutEnabled = layout ?? loadedPrefs?.layoutEnabled ?? true;
  let panelsEnabled = loadedPrefs?.panelsEnabled ?? true;
  let paneWeights = loadedPrefs?.paneWeights ?? cloneDefaultPaneWeights();
  let autoSavePrefs = true;

  const provider: LLMProvider = createProvider({ type: providerType, model });
  const toolRegistry = createDefaultToolRegistry();

  const agent = new Agent({
    provider,
    model,
    toolRegistry,
    toolPacks: ["filesystem"],
    intentRequired: true,
    systemPrompt: `You are a helpful agent with access to filesystem tools.
You can read files, list directories, and edit files.
Work step by step and explain what you are doing.`,
  });

  if (overseer) {
    const beholder = new Beholder({
      maxTokenBudget: 200_000,
      provider,
      model,
    });
    agent.setBeholder(beholder);
    console.log("[Beholder overseer enabled]");
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const persistCliPrefs = (reason: string): void => {
    if (!autoSavePrefs) return;
    const ok = saveCliPreferences(
      buildCliPreferences({
        streamEnabled,
        layoutEnabled,
        panelsEnabled,
        paneWeights,
      })
    );
    if (!ok) {
      console.log(
        paint(
          `Could not save preferences (${reason}) to ${CLI_PREFS_PATH}.`,
          "yellow"
        )
      );
    }
  };

  const redrawShell = (): void => {
    clearScreen();
    printBanner(providerType, model, streamEnabled, overseer, layoutEnabled);
    rl.prompt();
  };

  const logToggle = (message: string, enabled: boolean): void => {
    console.log(paint(message, enabled ? "green" : "yellow"));
  };

  const handlePaneCommand = (command: string): boolean => {
    if (!command.startsWith("/pane")) return false;
    const parts = command.split(/\s+/);
    const paneNames: PaneName[] = [
      "status",
      "prompt",
      "assistant",
      "tasks",
      "tools",
      "events",
    ];

    if (parts.length === 1 || parts[1] === "list") {
      console.log(paint(formatPaneSummary(paneWeights), "dim"));
      return true;
    }
    if (parts[1] === "reset") {
      paneWeights = cloneDefaultPaneWeights();
      console.log(paint(`Pane weights reset. ${formatPaneSummary(paneWeights)}`, "green"));
      persistCliPrefs("pane reset");
      return true;
    }
    if (parts.length >= 3) {
      const pane = parts[1] as PaneName;
      if (!paneNames.includes(pane)) {
        console.log(
          paint(
            `Unknown pane "${parts[1]}". Use: ${paneNames.join(", ")}`,
            "yellow"
          )
        );
        return true;
      }
      const parsed = parsePaneWeightInput(parts[2], paneWeights[pane]);
      if (parsed === null) {
        console.log(
          paint(
            `Invalid pane weight "${parts[2]}". Use +N, -N, or absolute N.`,
            "yellow"
          )
        );
        return true;
      }
      paneWeights = { ...paneWeights, [pane]: parsed };
      console.log(
        paint(
          `Updated pane "${pane}" to weight ${parsed}. ${formatPaneSummary(
            paneWeights
          )}`,
          "green"
        )
      );
      persistCliPrefs("pane update");
      return true;
    }

    console.log(paint("Usage: /pane list | /pane reset | /pane <name> <+N|-N|N>", "yellow"));
    return true;
  };

  const handlePrefsCommand = (command: string): boolean => {
    if (!command.startsWith("/prefs")) return false;
    const parts = command.split(/\s+/);
    const action = (parts[1] ?? "show").toLowerCase();

    if (action === "show") {
      console.log(
        paint(
          `prefs path=${CLI_PREFS_PATH}\nstream=${streamEnabled} layout=${layoutEnabled} panels=${panelsEnabled} autosave=${autoSavePrefs}\n${formatPaneSummary(
            paneWeights
          )}`,
          "dim"
        )
      );
      return true;
    }

    if (action === "save") {
      const ok = saveCliPreferences(
        buildCliPreferences({
          streamEnabled,
          layoutEnabled,
          panelsEnabled,
          paneWeights,
        })
      );
      console.log(
        paint(
          ok
            ? `Preferences saved to ${CLI_PREFS_PATH}.`
            : `Failed to save preferences to ${CLI_PREFS_PATH}.`,
          ok ? "green" : "yellow"
        )
      );
      return true;
    }

    if (action === "load") {
      const loaded = loadCliPreferences();
      if (!loaded) {
        console.log(
          paint(
            `No valid preferences found at ${CLI_PREFS_PATH}; keeping current settings.`,
            "yellow"
          )
        );
        return true;
      }
      streamEnabled = loaded.streamEnabled;
      layoutEnabled = loaded.layoutEnabled;
      panelsEnabled = loaded.panelsEnabled;
      paneWeights = loaded.paneWeights;
      console.log(
        paint(
          `Preferences loaded. stream=${streamEnabled} layout=${layoutEnabled} panels=${panelsEnabled}`,
          "green"
        )
      );
      return true;
    }

    if (action === "reset") {
      streamEnabled = true;
      layoutEnabled = true;
      panelsEnabled = true;
      paneWeights = cloneDefaultPaneWeights();
      const ok = saveCliPreferences(
        buildCliPreferences({
          streamEnabled,
          layoutEnabled,
          panelsEnabled,
          paneWeights,
        })
      );
      console.log(
        paint(
          ok
            ? `Preferences reset + saved to ${CLI_PREFS_PATH}.`
            : `Preferences reset in memory but could not save to ${CLI_PREFS_PATH}.`,
          ok ? "green" : "yellow"
        )
      );
      return true;
    }

    if (action === "autosave") {
      const raw = (parts[2] ?? "").toLowerCase();
      if (raw !== "on" && raw !== "off") {
        console.log(paint("Usage: /prefs autosave on|off", "yellow"));
        return true;
      }
      autoSavePrefs = raw === "on";
      console.log(
        paint(
          `Preference auto-save ${autoSavePrefs ? "enabled" : "disabled"}.`,
          autoSavePrefs ? "green" : "yellow"
        )
      );
      return true;
    }

    console.log(
      paint(
        "Usage: /prefs show|save|load|reset|autosave on|off",
        "yellow"
      )
    );
    return true;
  };

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.on("keypress", (_str, key: readline.Key) => {
      if (!key?.ctrl) return;
      if (key.name === "l") {
        redrawShell();
      } else if (key.name === "g") {
        streamEnabled = !streamEnabled;
        logToggle(
          `Streaming ${streamEnabled ? "enabled" : "disabled"} (Ctrl+G).`,
          streamEnabled
        );
        persistCliPrefs("shortcut stream toggle");
        rl.prompt();
      } else if (key.name === "o") {
        layoutEnabled = !layoutEnabled;
        logToggle(
          `Split-pane live layout ${
            layoutEnabled ? "enabled" : "disabled"
          } (Ctrl+O).`,
          layoutEnabled
        );
        persistCliPrefs("shortcut layout toggle");
        rl.prompt();
      } else if (key.name === "b") {
        panelsEnabled = !panelsEnabled;
        logToggle(
          `Dashboard panels ${
            panelsEnabled ? "enabled" : "disabled"
          } (Ctrl+B).`,
          panelsEnabled
        );
        persistCliPrefs("shortcut panels toggle");
        rl.prompt();
      }
    });
  }

  if (resetPrefs) {
    const defaults = buildCliPreferences({
      streamEnabled,
      layoutEnabled,
      panelsEnabled,
      paneWeights,
    });
    const ok = saveCliPreferences(defaults);
    console.log(
      paint(
        ok
          ? `Preferences reset from --reset-prefs and saved to ${CLI_PREFS_PATH}.`
          : `Could not save reset preferences to ${CLI_PREFS_PATH}.`,
        ok ? "green" : "yellow"
      )
    );
  } else if (loadedPrefs) {
    console.log(
      paint(
        `Loaded preferences from ${CLI_PREFS_PATH}: stream=${streamEnabled}, layout=${layoutEnabled}, panels=${panelsEnabled}.`,
        "dim"
      )
    );
  }

  let busy = false;
  rl.setPrompt(paint("you> ", "green"));
  printBanner(providerType, model, streamEnabled, overseer, layoutEnabled);
  rl.prompt();

  rl.on("close", () => {
    persistCliPrefs("readline close");
  });

  rl.on("line", async (input) => {
    const trimmed = input.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }
    if (busy) {
      console.log(paint("Agent is still processing the previous request.", "yellow"));
      rl.prompt();
      return;
    }

    if (trimmed === "/exit" || trimmed.toLowerCase() === "exit") {
      persistCliPrefs("exit command");
      console.log(paint("Goodbye.", "dim"));
      rl.close();
      return;
    }
    if (trimmed === "/help") {
      printHelp();
      rl.prompt();
      return;
    }
    if (trimmed === "/clear") {
      redrawShell();
      return;
    }
    if (trimmed === "/stream on" || trimmed === "/stream off") {
      streamEnabled = trimmed.endsWith("on");
      logToggle(`Streaming ${streamEnabled ? "enabled" : "disabled"}.`, streamEnabled);
      persistCliPrefs("stream command");
      rl.prompt();
      return;
    }
    if (trimmed === "/layout on" || trimmed === "/layout off") {
      layoutEnabled = trimmed.endsWith("on");
      logToggle(
        `Split-pane live layout ${layoutEnabled ? "enabled" : "disabled"} (applies to next turn).`,
        layoutEnabled
      );
      persistCliPrefs("layout command");
      rl.prompt();
      return;
    }
    if (trimmed === "/panels on" || trimmed === "/panels off") {
      panelsEnabled = trimmed.endsWith("on");
      logToggle(`Panels ${panelsEnabled ? "enabled" : "disabled"}.`, panelsEnabled);
      persistCliPrefs("panels command");
      rl.prompt();
      return;
    }
    if (handlePaneCommand(trimmed)) {
      rl.prompt();
      return;
    }
    if (handlePrefsCommand(trimmed)) {
      rl.prompt();
      return;
    }

    busy = true;
    let stopSpinner: (() => void) | undefined;
    let stopLiveRenderer: (() => void) | undefined;
    try {
      const startedAt = Date.now();
      let streamedStarted = false;
      let assistantStreamText = "";
      let phase: LivePhase = "thinking";
      const eventsBefore = agent.getEventLogger().getEvents().length;
      const liveLayoutActive = layoutEnabled && Boolean(process.stdout.isTTY);
      if (liveLayoutActive) {
        stopLiveRenderer = startLiveRenderer(() => {
          const currentEvents = agent
            .getEventLogger()
            .getEvents()
            .slice(eventsBefore);
          renderLiveTurn({
            providerType,
            model,
            streamEnabled,
            overseer,
            phase,
            elapsedMs: Date.now() - startedAt,
            tokensIn: 0,
            tokensOut: 0,
            userPrompt: trimmed,
            assistantText: assistantStreamText,
            events: currentEvents,
            toolsUsed: [],
            paneWeights,
          });
        });
      } else {
        stopSpinner = startSpinner("thinking…");
      }
      const result = await agent.run(trimmed, {
        stream: streamEnabled,
        onTextDelta: (delta) => {
          if (!streamEnabled) return;
          assistantStreamText += delta;
          phase = "responding";
          if (liveLayoutActive) {
            return;
          }
          stopSpinner?.();
          stopSpinner = undefined;
          if (!streamedStarted) {
            process.stdout.write(paint("\nassistant> ", "cyan"));
            streamedStarted = true;
          }
          process.stdout.write(delta);
        },
      });
      stopSpinner?.();
      stopSpinner = undefined;
      const elapsedMs = Date.now() - startedAt;
      const turnEvents = agent.getEventLogger().getEvents().slice(eventsBefore);
      phase = "complete";
      if (!assistantStreamText.trim()) {
        assistantStreamText = result.response;
      }

      if (liveLayoutActive) {
        stopLiveRenderer?.();
        stopLiveRenderer = undefined;
        renderLiveTurn({
          providerType,
          model,
          streamEnabled,
          overseer,
          phase,
          elapsedMs,
          tokensIn: result.usage.inputTokens,
          tokensOut: result.usage.outputTokens,
          userPrompt: trimmed,
          assistantText: assistantStreamText,
          events: turnEvents,
          toolsUsed: result.toolsUsed,
          paneWeights,
        });
        console.log(
          paint("Turn complete. You can enter the next prompt below.", "dim")
        );
      } else {
        if (streamedStarted) {
          process.stdout.write("\n");
        } else {
          console.log(`\n${paint("assistant> ", "cyan")}${result.response}\n`);
        }
        if (result.toolsUsed.length > 0) {
          console.log(
            paint(`[tools used: ${result.toolsUsed.join(", ")}]`, "dim")
          );
        }
        console.log(
          paint(
            `[tokens in/out: ${result.usage.inputTokens}/${result.usage.outputTokens}] [${elapsedMs}ms]`,
            "dim"
          )
        );
        if (panelsEnabled) {
          printTurnDashboard(
            turnEvents,
            elapsedMs,
            { input: result.usage.inputTokens, output: result.usage.outputTokens },
            streamEnabled
          );
        } else {
          console.log("");
        }
      }
    } catch (err) {
      stopSpinner?.();
      stopLiveRenderer?.();
      console.error(`\n${paint("Error:", "yellow")} ${(err as Error).message}\n`);
    } finally {
      busy = false;
      rl.prompt();
    }
  });
}

main();
