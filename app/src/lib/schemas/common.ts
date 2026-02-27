import { z } from "zod";

export const HookEventSchema = z.enum([
  "PreToolUse", "PostToolUse", "PostToolUseFailure",
  "PermissionRequest", "UserPromptSubmit", "Notification",
  "Stop", "SubagentStart", "SubagentStop",
  "SessionStart", "SessionEnd", "TeammateIdle",
  "TaskCompleted", "PreCompact",
]);

export const ConfigScopeSchema = z.enum(["user", "project", "local", "managed"]);
export const WritableScopeSchema = z.enum(["user", "project", "local"]);
