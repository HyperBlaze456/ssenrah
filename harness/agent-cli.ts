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
 *   npx ts-node agent-cli.ts --layout
 *   npx ts-node agent-cli.ts --no-layout
 *   npx ts-node agent-cli.ts --layout-style diff
 *   npx ts-node agent-cli.ts --panels
 *   npx ts-node agent-cli.ts --no-panels
 *   npx ts-node agent-cli.ts --no-stream
 *   npx ts-node agent-cli.ts --reset-prefs
 *   npx ts-node agent-cli.ts --mcp --mcp-config ./.ssenrah/mcp.servers.json
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
import {
  DEFAULT_MCP_CONFIG_PATH,
  loadMcpHarnessConfig,
} from "./harness/mcp-config";
import { McpRuntime } from "./harness/mcp-runtime";
import {
  createStdioMcpClientFactory,
  toMcpRuntimeConfig,
} from "./harness/mcp-adapter";
import { createDefaultToolRegistry } from "./tools/registry";

type PaneName = "status" | "prompt" | "assistant" | "tasks" | "tools" | "events";

type PaneWeights = Record<PaneName, number>;
type LayoutRenderStyle = "full" | "diff";

const DEFAULT_PANE_WEIGHTS: PaneWeights = {
  status: 2,
  prompt: 2,
  assistant: 7,
  tasks: 3,
  tools: 3,
  events: 3,
};

const CLI_PREFS_VERSION = 2;
const CLI_PREFS_PATH = path.join(
  os.homedir(),
  ".ssenrah",
  "agent-cli-preferences.json"
);

interface CliPreferences {
  version: number;
  streamEnabled: boolean;
  layoutEnabled: boolean;
  layoutStyle: LayoutRenderStyle;
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
  layoutEnabled: boolean,
  layoutStyle: LayoutRenderStyle,
  panelsEnabled: boolean,
  mcpEnabled: boolean
): void {
  const title = `${paint("ssenrah", "bold")} ${paint("interactive agent", "dim")}`;
  const status = [
    `provider=${paint(providerType, "cyan")}`,
    `model=${paint(model, "cyan")}`,
    `stream=${streamEnabled ? paint("on", "green") : paint("off", "yellow")}`,
    `overseer=${overseer ? paint("on", "green") : paint("off", "yellow")}`,
    `mcp=${mcpEnabled ? paint("on", "green") : paint("off", "yellow")}`,
    `layout=${layoutEnabled ? paint("on", "green") : paint("off", "yellow")}(${paint(
      layoutStyle,
      layoutStyle === "diff" ? "green" : "yellow"
    )})`,
    `panels=${panelsEnabled ? paint("on", "green") : paint("off", "yellow")}`,
  ].join("  ");

  console.log("\n" + paint("═".repeat(78), "dim"));
  console.log(`  ${title}`);
  console.log(`  ${status}`);
  console.log(
    `  ${paint("Commands:", "magenta")} /help  /stream on|off  /layout on|off  /layout style full|diff  /panels on|off  /pane ...  /prefs ...  /send  /cancel  /clear  /exit`
  );
  console.log(
    `  ${paint("Shortcuts:", "magenta")} Ctrl+L clear  Ctrl+G stream  Ctrl+O layout  Ctrl+B panels  Ctrl+J newline`
  );
  console.log(paint("═".repeat(78), "dim") + "\n");
}

function printHelp(): void {
  console.log(paint("Available commands:", "magenta"));
  console.log("  /help           Show this help");
  console.log("  /stream on|off  Toggle streaming output");
  console.log("  /layout on|off  Toggle split-pane live layout");
  console.log("  /layout style full|diff  Set live layout render style");
  console.log("  /panels on|off  Toggle dashboard panels");
  console.log("  /pane list      Show pane weights and computed heights");
  console.log("  /pane reset     Reset pane weights");
  console.log("  /pane <name> <+N|-N|N>  Adjust pane weight");
  console.log("  /prefs show     Show persisted preference state");
  console.log("  /prefs save     Save current preferences");
  console.log("  /prefs load     Reload preferences from disk");
  console.log("  /prefs reset    Reset + save default preferences");
  console.log("  /prefs autosave on|off  Toggle auto-save on setting changes");
  console.log("  /send           Submit current multiline draft");
  console.log("  /cancel         Discard current multiline draft");
  console.log("  /clear          Clear screen");
  console.log("  /exit           Exit CLI");
  console.log("");
  console.log("Multiline input:");
  console.log("  End a line with \\ then press Enter to continue composing");
  console.log("  Press Ctrl+J to force a newline while composing");
  console.log("  Submit with Enter on a normal line (or /send), cancel with /cancel");
  console.log("");
  console.log("Keyboard shortcuts:");
  console.log("  Ctrl+L clear screen");
  console.log("  Ctrl+G toggle streaming");
  console.log("  Ctrl+O toggle live layout");
  console.log("  Ctrl+B toggle dashboard panels");
  console.log("  Ctrl+J insert newline");
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
  if (intents.length > 0) {
    return intents.map((intent, idx) => {
      const toolName = toSafeString(intent.data["toolName"]) || "unknown_tool";
      const purpose = toSafeString(intent.data["purpose"]) || "no purpose provided";
      const risk = (toSafeString(intent.data["riskLevel"]) || "read").toUpperCase();
      return `${idx + 1}. [${risk}] ${toolName} -> ${purpose}`;
    });
  }

  const policies = events.filter((event) => event.type === "policy");
  if (policies.length === 0) return ["No planning/policy signals in this turn."];

  return policies.map((policy, idx) => {
    const toolName = toSafeString(policy.data["tool"]) || "unknown_tool";
    const risk = (toSafeString(policy.data["riskLevel"]) || "unknown").toUpperCase();
    const action = toSafeString(policy.data["action"]) || "unknown";
    const reason = toSafeString(policy.data["reason"]);
    return `${idx + 1}. [${risk}] ${toolName} -> ${action}${reason ? ` (${reason})` : ""}`;
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
  const taskPanel = renderPanel("Tasks / Planning", summarizeTaskLines(events), "magenta");
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

function hasContinuationMarker(input: string): boolean {
  return input.replace(/\s+$/, "").endsWith("\\");
}

function stripContinuationMarker(input: string): string {
  const rightTrimmed = input.replace(/\s+$/, "");
  if (!rightTrimmed.endsWith("\\")) return input;
  return rightTrimmed.slice(0, -1);
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
  // 2 rows for heading text + 6 panels x 2 border rows + prompt room.
  const reservedRows = 14;
  const available = Math.max(6, terminalRows - reservedRows);

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

  if (minTotal > available) {
    const shrunk: Record<PaneName, number> = { ...mins };
    let overflow = minTotal - available;
    const shrinkOrder: PaneName[] = [
      "assistant",
      "events",
      "tools",
      "tasks",
      "prompt",
      "status",
    ];
    while (overflow > 0) {
      let reducedThisPass = false;
      for (const name of shrinkOrder) {
        if (overflow <= 0) break;
        if (shrunk[name] > 1) {
          shrunk[name] -= 1;
          overflow -= 1;
          reducedThisPass = true;
        }
      }
      if (!reducedThisPass) break;
    }
    return shrunk;
  }

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

function sanitizeLayoutStyle(input: unknown): LayoutRenderStyle | null {
  if (input === "full" || input === "diff") return input;
  return null;
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
    const paneWeights = sanitizePaneWeights(parsed.paneWeights) ?? cloneDefaultPaneWeights();
    const layoutStyle = sanitizeLayoutStyle(parsed.layoutStyle ?? "full") ?? "full";
    const parsedVersion = Math.max(
      1,
      Math.floor(typeof parsed.version === "number" ? parsed.version : 1)
    );
    const streamEnabled =
      typeof parsed.streamEnabled === "boolean" ? parsed.streamEnabled : true;
    const layoutEnabled =
      parsedVersion < CLI_PREFS_VERSION
        ? false
        : typeof parsed.layoutEnabled === "boolean"
        ? parsed.layoutEnabled
        : false;
    const panelsEnabled =
      parsedVersion < CLI_PREFS_VERSION
        ? false
        : typeof parsed.panelsEnabled === "boolean"
        ? parsed.panelsEnabled
        : false;

    return {
      version: CLI_PREFS_VERSION,
      streamEnabled,
      layoutEnabled,
      layoutStyle,
      panelsEnabled,
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
  layoutStyle: LayoutRenderStyle;
  panelsEnabled: boolean;
  paneWeights: PaneWeights;
}): CliPreferences {
  return {
    version: CLI_PREFS_VERSION,
    streamEnabled: state.streamEnabled,
    layoutEnabled: state.layoutEnabled,
    layoutStyle: state.layoutStyle,
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

function buildLiveTurnLines(snapshot: LiveTurnSnapshot): string[] {
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

  return [
    paint("ssenrah live layout", "bold"),
    paint(
      "Type /layout off to disable live split-pane rendering. Use /layout style full|diff to switch render mode.",
      "dim"
    ),
    ...renderPanel("Status", statusPanelLines, "dim").split("\n"),
    ...renderPanel("User Prompt", promptLines, "magenta").split("\n"),
    ...renderPanel("Assistant Stream", assistantLines, "cyan").split("\n"),
    ...renderPanel("Intents / Tasks", taskLines, "magenta").split("\n"),
    ...renderPanel("Tool Execution", toolLines, "yellow").split("\n"),
    ...renderPanel("Event Log", eventLines, "dim").split("\n"),
  ];
}

function renderLiveFrameFull(lines: string[]): void {
  clearScreen();
  process.stdout.write(lines.join("\n") + "\n");
}

function renderLiveTurn(snapshot: LiveTurnSnapshot): void {
  renderLiveFrameFull(buildLiveTurnLines(snapshot));
}

function moveCursor(row: number, col: number): void {
  process.stdout.write(`\x1b[${row};${col}H`);
}

function rewriteLine(row: number, text: string): void {
  moveCursor(row, 1);
  process.stdout.write("\x1b[2K");
  if (text.length > 0) {
    process.stdout.write(text);
  }
}

function startLiveRenderer(renderLines: () => string[], style: LayoutRenderStyle): () => void {
  if (!process.stdout.isTTY) return () => undefined;
  if (style === "full") {
    const render = () => renderLiveFrameFull(renderLines());
    render();
    const timer = setInterval(render, 120);
    return () => clearInterval(timer);
  }

  let previousLines: string[] = [];
  process.stdout.write("\x1b[?25l");

  const paintDiff = () => {
    const nextLines = renderLines();
    const maxLines = Math.max(previousLines.length, nextLines.length);
    for (let i = 0; i < maxLines; i++) {
      const prev = previousLines[i] ?? "";
      const next = nextLines[i] ?? "";
      if (prev === next) continue;
      rewriteLine(i + 1, next);
    }
    rewriteLine(nextLines.length + 1, "");
    previousLines = nextLines;
  };

  clearScreen();
  paintDiff();
  const timer = setInterval(paintDiff, 120);
  return () => {
    clearInterval(timer);
    process.stdout.write("\x1b[?25h");
    rewriteLine(previousLines.length + 1, "");
  };
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
  panels?: boolean;
  layoutStyle?: LayoutRenderStyle;
  mcpEnabled: boolean;
  mcpConfigPath?: string;
  resetPrefs: boolean;
} {
  const args = process.argv.slice(2);
  let providerType: "anthropic" | "gemini" | "openai" = "anthropic";
  let model = "claude-sonnet-4-20250514";
  let overseer = false;
  let stream: boolean | undefined;
  let layout: boolean | undefined;
  let panels: boolean | undefined;
  let layoutStyle: LayoutRenderStyle | undefined;
  let mcpEnabled = false;
  let mcpConfigPath: string | undefined;
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
    } else if (args[i] === "--panels") {
      panels = true;
    } else if (args[i] === "--no-panels") {
      panels = false;
    } else if (args[i] === "--layout-style" && args[i + 1]) {
      const style = sanitizeLayoutStyle(args[i + 1]);
      if (!style) {
        console.error(`Unknown layout style: ${args[i + 1]}. Use full or diff.`);
        process.exit(1);
      }
      layoutStyle = style;
      i++;
    } else if (args[i] === "--mcp") {
      mcpEnabled = true;
    } else if (args[i] === "--mcp-config" && args[i + 1]) {
      mcpConfigPath = args[i + 1];
      i++;
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

  return {
    providerType,
    model,
    overseer,
    stream,
    layout,
    panels,
    layoutStyle,
    mcpEnabled,
    mcpConfigPath,
    resetPrefs,
  };
}

async function main() {
  const {
    providerType,
    model,
    overseer,
    stream,
    layout,
    panels,
    layoutStyle,
    mcpEnabled,
    mcpConfigPath,
    resetPrefs,
  } = parseArgs();
  const loadedPrefs = resetPrefs ? null : loadCliPreferences();
  let streamEnabled = stream ?? loadedPrefs?.streamEnabled ?? true;
  let layoutEnabled = layout ?? loadedPrefs?.layoutEnabled ?? false;
  let liveLayoutStyle = layoutStyle ?? loadedPrefs?.layoutStyle ?? "full";
  let panelsEnabled = panels ?? loadedPrefs?.panelsEnabled ?? false;
  let paneWeights = loadedPrefs?.paneWeights ?? cloneDefaultPaneWeights();
  let autoSavePrefs = true;

  const provider: LLMProvider = createProvider({ type: providerType, model });
  const toolRegistry = createDefaultToolRegistry();
  let toolPacks: string[] = ["filesystem"];
  let mcpRiskOverrides: Record<string, "read" | "write" | "exec" | "destructive"> = {};
  let mcpRuntime: McpRuntime | undefined;

  if (mcpEnabled) {
    const configPath = mcpConfigPath ?? DEFAULT_MCP_CONFIG_PATH;
    const resolvedConfig = loadMcpHarnessConfig(configPath);
    mcpRuntime = new McpRuntime({
      config: toMcpRuntimeConfig(resolvedConfig),
      clientFactory: createStdioMcpClientFactory(),
    });
    await mcpRuntime.start();

    const packDefinitions = await mcpRuntime.getPackDefinitions();
    for (const [packName, tools] of Object.entries(packDefinitions)) {
      if (tools && tools.length > 0) {
        toolRegistry.registerPack(packName, tools);
      }
    }

    if (packDefinitions["mcp"] && packDefinitions["mcp"]!.length > 0) {
      toolPacks = [...toolPacks, "mcp"];
    }
    mcpRiskOverrides = await mcpRuntime.getRiskOverrides();
    const diagnostics = await mcpRuntime.getDiagnostics();
    console.log(
      `[MCP enabled] servers=${diagnostics.length} config=${path.resolve(configPath)}`
    );
  }

  const agent = new Agent({
    provider,
    model,
    toolRegistry,
    toolPacks,
    intentRequired: false,
    toolRiskOverrides: mcpRiskOverrides,
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
  let busy = false;
  const draftLines: string[] = [];
  let forceContinuationLine = false;

  const refreshPrompt = (): void => {
    rl.setPrompt(
      draftLines.length > 0 ? paint("...> ", "magenta") : paint("you> ", "green")
    );
  };

  const persistCliPrefs = (reason: string): void => {
    if (!autoSavePrefs) return;
    const ok = saveCliPreferences(
      buildCliPreferences({
        streamEnabled,
        layoutEnabled,
        layoutStyle: liveLayoutStyle,
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
    printBanner(
      providerType,
      model,
      streamEnabled,
      overseer,
      layoutEnabled,
      liveLayoutStyle,
      panelsEnabled,
      mcpEnabled
    );
    refreshPrompt();
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
          `prefs path=${CLI_PREFS_PATH}\nstream=${streamEnabled} layout=${layoutEnabled} layoutStyle=${liveLayoutStyle} panels=${panelsEnabled} autosave=${autoSavePrefs}\n${formatPaneSummary(
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
          layoutStyle: liveLayoutStyle,
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
      liveLayoutStyle = loaded.layoutStyle;
      panelsEnabled = loaded.panelsEnabled;
      paneWeights = loaded.paneWeights;
      console.log(
        paint(
          `Preferences loaded. stream=${streamEnabled} layout=${layoutEnabled} layoutStyle=${liveLayoutStyle} panels=${panelsEnabled}`,
          "green"
        )
      );
      return true;
    }

    if (action === "reset") {
      streamEnabled = true;
      layoutEnabled = false;
      liveLayoutStyle = "full";
      panelsEnabled = false;
      paneWeights = cloneDefaultPaneWeights();
      const ok = saveCliPreferences(
        buildCliPreferences({
          streamEnabled,
          layoutEnabled,
          layoutStyle: liveLayoutStyle,
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
      if (key.name === "j") {
        forceContinuationLine = true;
        return;
      }
      if (key.name === "l") {
        redrawShell();
      } else if (key.name === "g") {
        streamEnabled = !streamEnabled;
        logToggle(
          `Streaming ${streamEnabled ? "enabled" : "disabled"} (Ctrl+G).`,
          streamEnabled
        );
        persistCliPrefs("shortcut stream toggle");
        refreshPrompt();
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
        refreshPrompt();
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
        refreshPrompt();
        rl.prompt();
      }
    });
  }

  if (resetPrefs) {
    const defaults = buildCliPreferences({
      streamEnabled,
      layoutEnabled,
      layoutStyle: liveLayoutStyle,
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
        `Loaded preferences from ${CLI_PREFS_PATH}: stream=${streamEnabled}, layout=${layoutEnabled}, layoutStyle=${liveLayoutStyle}, panels=${panelsEnabled}.`,
        "dim"
      )
    );
  }

  refreshPrompt();
  printBanner(
    providerType,
    model,
    streamEnabled,
    overseer,
    layoutEnabled,
    liveLayoutStyle,
    panelsEnabled,
    mcpEnabled
  );
  rl.prompt();

  rl.on("close", () => {
    persistCliPrefs("readline close");
    if (mcpRuntime) {
      void mcpRuntime.stop().catch(() => undefined);
    }
  });

  const runPrompt = async (userPrompt: string): Promise<void> => {
    const trimmed = userPrompt.trim();
    if (!trimmed) {
      refreshPrompt();
      rl.prompt();
      return;
    }
    if (trimmed === "/send" || trimmed === "/cancel") {
      console.log(paint("No active multiline draft.", "yellow"));
      refreshPrompt();
      rl.prompt();
      return;
    }
    if (trimmed === "/exit" || trimmed.toLowerCase() === "exit") {
      persistCliPrefs("exit command");
      if (mcpRuntime) {
        try {
          await mcpRuntime.stop();
        } catch {
          // Ignore shutdown errors during interactive exit.
        }
      }
      console.log(paint("Goodbye.", "dim"));
      rl.close();
      return;
    }
    if (trimmed === "/help") {
      printHelp();
      refreshPrompt();
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
      refreshPrompt();
      rl.prompt();
      return;
    }
    if (trimmed === "/layout style full" || trimmed === "/layout style diff") {
      liveLayoutStyle = trimmed.endsWith("diff") ? "diff" : "full";
      logToggle(
        `Live layout render style set to ${liveLayoutStyle} (applies to next turn).`,
        liveLayoutStyle === "diff"
      );
      persistCliPrefs("layout style command");
      refreshPrompt();
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
      refreshPrompt();
      rl.prompt();
      return;
    }
    if (trimmed === "/panels on" || trimmed === "/panels off") {
      panelsEnabled = trimmed.endsWith("on");
      logToggle(`Panels ${panelsEnabled ? "enabled" : "disabled"}.`, panelsEnabled);
      persistCliPrefs("panels command");
      refreshPrompt();
      rl.prompt();
      return;
    }
    if (handlePaneCommand(trimmed)) {
      refreshPrompt();
      rl.prompt();
      return;
    }
    if (handlePrefsCommand(trimmed)) {
      refreshPrompt();
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
          return buildLiveTurnLines({
            providerType,
            model,
            streamEnabled,
            overseer,
            phase,
            elapsedMs: Date.now() - startedAt,
            tokensIn: 0,
            tokensOut: 0,
            userPrompt,
            assistantText: assistantStreamText,
            events: currentEvents,
            toolsUsed: [],
            paneWeights,
          });
        }, liveLayoutStyle);
      } else {
        stopSpinner = startSpinner("thinking…");
      }
      const result = await agent.run(userPrompt, {
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
          userPrompt,
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
      refreshPrompt();
      rl.prompt();
    }
  };

  rl.on("line", async (input) => {
    const forcedContinuation = forceContinuationLine;
    forceContinuationLine = false;

    if (busy) {
      console.log(paint("Agent is still processing the previous request.", "yellow"));
      refreshPrompt();
      rl.prompt();
      return;
    }

    if (draftLines.length > 0) {
      const trimmed = input.trim();
      if (trimmed === "/cancel") {
        draftLines.length = 0;
        console.log(paint("Multiline draft discarded.", "yellow"));
        refreshPrompt();
        rl.prompt();
        return;
      }
      if (trimmed === "/send") {
        const composed = draftLines.join("\n");
        draftLines.length = 0;
        refreshPrompt();
        await runPrompt(composed);
        return;
      }

      const continued = forcedContinuation || hasContinuationMarker(input);
      draftLines.push(continued ? stripContinuationMarker(input) : input);
      if (continued) {
        refreshPrompt();
        rl.prompt();
        return;
      }

      const composed = draftLines.join("\n");
      draftLines.length = 0;
      refreshPrompt();
      await runPrompt(composed);
      return;
    }

    if (forcedContinuation || hasContinuationMarker(input)) {
      draftLines.push(stripContinuationMarker(input));
      console.log(
        paint(
          "Multiline compose enabled. Continue with \\ + Enter or Ctrl+J. Submit with Enter or /send. Cancel with /cancel.",
          "dim"
        )
      );
      refreshPrompt();
      rl.prompt();
      return;
    }

    if (!input.trim()) {
      refreshPrompt();
      rl.prompt();
      return;
    }

    await runPrompt(input);
  });
}

main();
