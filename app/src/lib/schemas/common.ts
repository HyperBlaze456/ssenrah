import { z } from "zod";

export const HookEventSchema = z.enum([
  "PreToolUse", "PostToolUse", "PostToolUseFailure",
  "PermissionRequest", "UserPromptSubmit", "Notification",
  "Stop", "StopFailure", "SubagentStart", "SubagentStop",
  "SessionStart", "SessionEnd", "TeammateIdle",
  "TaskCreated", "TaskCompleted", "PreCompact", "PostCompact",
  "InstructionsLoaded", "ConfigChange", "CwdChanged", "FileChanged",
  "WorktreeCreate", "WorktreeRemove",
  "Elicitation", "ElicitationResult",
]);

export const ConfigScopeSchema = z.enum(["user", "project", "local", "managed"]);
export const WritableScopeSchema = z.enum(["user", "project", "local"]);
