import { RiskLevel } from "./policy-engine";

const READ_HINTS = [
  "read",
  "list",
  "get",
  "show",
  "find",
  "search",
  "inspect",
  "view",
  "analyze",
  "capture",
  "fetch",
  "query",
  "status",
  "diff",
];

const WRITE_HINTS = [
  "write",
  "edit",
  "update",
  "create",
  "append",
  "insert",
  "set",
  "save",
  "submit",
  "complete",
  "approve",
  "assign",
  "move",
  "rename",
  "copy",
  "mkdir",
  "touch",
  "patch",
];

const EXEC_HINTS = [
  "exec",
  "run",
  "command",
  "shell",
  "spawn",
  "start",
  "restart",
  "build",
  "test",
  "install",
  "deploy",
  "invoke",
  "call",
];

const DESTRUCTIVE_HINTS = [
  "delete",
  "remove",
  "destroy",
  "drop",
  "purge",
  "truncate",
  "wipe",
  "erase",
  "reset",
  "reject",
  "kill",
  "shutdown",
  "terminate",
  "rm",
];

const DESTRUCTIVE_COMMAND_PATTERN =
  /\b(rm|rmdir|del|truncate|mkfs|dd|shutdown|reboot|killall|dropdb|format)\b/i;

function matchesHint(toolName: string, hints: readonly string[]): boolean {
  const normalized = toolName.trim().toLowerCase();
  if (!normalized) return false;

  return hints.some((hint) => {
    return (
      normalized === hint ||
      normalized.startsWith(`${hint}_`) ||
      normalized.endsWith(`_${hint}`) ||
      normalized.includes(`_${hint}_`)
    );
  });
}

function hasDestructiveCommandInput(input: Record<string, unknown>): boolean {
  const commandLikeValues = [
    input["cmd"],
    input["command"],
    input["script"],
  ];

  return commandLikeValues.some(
    (value) =>
      typeof value === "string" &&
      DESTRUCTIVE_COMMAND_PATTERN.test(value)
  );
}

/**
 * Infer a conservative risk level directly from provider-returned tool calls.
 * This keeps governance checks provider-native when intent extraction is off.
 */
export function inferRiskLevel(
  toolName: string,
  input: Record<string, unknown> = {}
): RiskLevel {
  if (matchesHint(toolName, DESTRUCTIVE_HINTS) || hasDestructiveCommandInput(input)) {
    return "destructive";
  }
  if (matchesHint(toolName, EXEC_HINTS)) {
    return "exec";
  }
  if (matchesHint(toolName, WRITE_HINTS)) {
    return "write";
  }
  if (matchesHint(toolName, READ_HINTS)) {
    return "read";
  }

  // Conservative fallback: unknown tools default to exec-risk.
  return "exec";
}
