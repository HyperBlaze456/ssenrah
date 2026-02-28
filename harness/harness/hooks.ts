import type {
  AgentRunHook,
  AgentRunHookContext,
  ToolDefinition,
} from "../agent/types";

/**
 * Compose multiple hooks into one hook that runs in sequence.
 */
export function composeHooks(...hooks: AgentRunHook[]): AgentRunHook {
  return async (context: AgentRunHookContext) => {
    for (const hook of hooks) {
      await hook(context);
    }
  };
}

/**
 * Append instructions to the system prompt.
 */
export function appendSystemPrompt(
  context: AgentRunHookContext,
  promptBlock: string
): void {
  const normalized = promptBlock.trim();
  if (!normalized) return;
  context.settings.systemPrompt = `${context.settings.systemPrompt}\n\n${normalized}`;
}

/**
 * Merge tools by name (incoming tools replace same-name existing tools).
 */
export function mergeToolsByName(
  current: ToolDefinition[],
  incoming: ToolDefinition[]
): ToolDefinition[] {
  const byName = new Map<string, ToolDefinition>();
  for (const tool of current) {
    byName.set(tool.name, tool);
  }
  for (const tool of incoming) {
    byName.set(tool.name, tool);
  }
  return Array.from(byName.values());
}
