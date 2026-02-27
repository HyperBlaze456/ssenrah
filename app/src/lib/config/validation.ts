import type { Settings } from "@/types";

export interface CrossFieldWarning {
  code: string;
  message: string;
  fields: string[];
}

export function validateCrossFields(settings: Settings): CrossFieldWarning[] {
  const warnings: CrossFieldWarning[] = [];

  // Check unreachable permission rules
  const allow = settings.permissions?.allow ?? [];
  const deny = settings.permissions?.deny ?? [];

  for (const allowRule of allow) {
    for (const denyRule of deny) {
      if (ruleCovers(denyRule, allowRule)) {
        warnings.push({
          code: "unreachable_rule",
          message: `Allow rule '${allowRule}' is unreachable — blocked by deny rule '${denyRule}'`,
          fields: ["permissions.allow", "permissions.deny"],
        });
      }
    }
  }

  // Check MCP server conflicts
  const enabled = new Set(settings.enabledMcpjsonServers ?? []);
  const disabled = new Set(settings.disabledMcpjsonServers ?? []);
  const overlap = [...enabled].filter((s) => disabled.has(s));
  if (overlap.length > 0) {
    warnings.push({
      code: "mcp_conflict",
      message: `Server(s) in both enabled and disabled lists: ${overlap.join(", ")}`,
      fields: ["enabledMcpjsonServers", "disabledMcpjsonServers"],
    });
  }

  return warnings;
}

function ruleCovers(broader: string, narrower: string): boolean {
  // Simple: exact match or broader is just a tool name that matches narrower's tool
  const broaderTool = broader.replace(/\(.*\)$/, "");
  const narrowerTool = narrower.replace(/\(.*\)$/, "");
  if (broaderTool !== narrowerTool) return false;
  // If broader has no specifier, it covers everything
  if (!broader.includes("(")) return true;
  // If both have specifiers, check if broader's glob covers narrower's
  return broader === narrower;
}
