import { z } from "zod";

export const PermissionRuleSchema = z.string().regex(
  /^[A-Za-z_]+(\(.*\))?$/,
  "Permission rule must be ToolName or ToolName(specifier)"
);

export const KNOWN_TOOLS = [
  "Bash", "Read", "Edit", "Write", "Glob", "Grep",
  "WebFetch", "WebSearch", "Skill", "Task", "NotebookEdit", "MCPSearch",
] as const;
