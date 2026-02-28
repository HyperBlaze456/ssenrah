import type { ToolDefinition } from "../agent/types";
import type { LLMProvider } from "../providers/types";
import type { PolicyProfile } from "../harness/policy-engine";
import type { AgentTypeRegistry } from "../agents/registry";
import type { StaticToolRegistry } from "./registry";
import { Agent } from "../agent/agent";

/**
 * Policy restrictiveness order: higher index = more restrictive.
 */
const POLICY_RESTRICTIVENESS: Record<string, number> = {
  "local-permissive": 0,
  strict: 1,
  managed: 2,
};

/**
 * Resolve the more restrictive of two policy profiles.
 */
function resolveEffectivePolicy(
  parentPolicy?: PolicyProfile,
  childPolicy?: PolicyProfile
): PolicyProfile | undefined {
  if (!parentPolicy && !childPolicy) return undefined;
  if (!parentPolicy) return childPolicy;
  if (!childPolicy) return parentPolicy;

  const parentLevel = POLICY_RESTRICTIVENESS[parentPolicy] ?? 0;
  const childLevel = POLICY_RESTRICTIVENESS[childPolicy] ?? 0;
  return parentLevel >= childLevel ? parentPolicy : childPolicy;
}

export interface SpawnAgentToolDeps {
  /** Registry of predefined agent types. */
  registry: AgentTypeRegistry;
  /** Default LLM provider for spawned agents. */
  provider: LLMProvider;
  /** Tool registry for resolving tool packs. */
  toolRegistry: StaticToolRegistry;
  /** Parent session ID for child session linkage. */
  parentSessionId?: string;
  /** Current spawn depth (default 0). Incremented for each nesting level. */
  currentDepth?: number;
  /** Parent's policy profile — child policy will be at least this restrictive. */
  parentPolicyProfile?: PolicyProfile;
  /** AbortSignal from parent — inherited by child for cancellation. */
  parentSignal?: AbortSignal;
}

/**
 * Create the spawn_agent tool definition.
 *
 * This tool allows any agent to spawn a subagent of a predefined type.
 * The parent blocks until the child completes and receives the result.
 */
export function createSpawnAgentTool(deps: SpawnAgentToolDeps): ToolDefinition {
  const {
    registry,
    provider,
    toolRegistry,
    parentSessionId,
    currentDepth = 0,
    parentPolicyProfile,
    parentSignal,
  } = deps;

  return {
    name: "spawn_agent",
    description:
      "Spawn a subagent of a predefined type to perform a task. " +
      "The subagent runs autonomously and returns its result. " +
      `Available types: ${registry.list().map((t) => t.name).join(", ") || "none registered"}.`,
    inputSchema: {
      type: "object",
      properties: {
        agentType: {
          type: "string",
          description: "Name of the registered agent type to spawn.",
        },
        prompt: {
          type: "string",
          description: "The task/goal for the subagent.",
        },
        context: {
          type: "string",
          description: "Optional additional context to prepend to the prompt.",
        },
      },
      required: ["agentType", "prompt"],
    },
    run: async (input: Record<string, unknown>): Promise<string> => {
      const typeName = String(input["agentType"] ?? "").trim();
      const prompt = String(input["prompt"] ?? "").trim();
      const context = input["context"] ? String(input["context"]).trim() : "";

      if (!typeName) {
        return "Error: agentType is required.";
      }
      if (!prompt) {
        return "Error: prompt is required.";
      }

      // 1. Look up agent type
      const agentType = registry.get(typeName);
      if (!agentType) {
        return `Error: unknown agent type "${typeName}". Available: ${registry.list().map((t) => t.name).join(", ") || "none"}.`;
      }

      // 2. Check depth limit
      const maxDepth = agentType.isolation?.maxDepth ?? 1;
      if (currentDepth >= maxDepth) {
        return `Error: spawn depth limit exceeded (current=${currentDepth}, max=${maxDepth}). Cannot spawn "${typeName}".`;
      }

      // 3. Resolve effective policy (more restrictive wins)
      const effectivePolicy = resolveEffectivePolicy(
        parentPolicyProfile,
        agentType.policyProfile
      );

      // 4. Resolve tool packs for child
      const childToolPacks = agentType.toolPacks ?? ["filesystem"];
      let childTools: ToolDefinition[];
      try {
        // Filter out "spawn" pack — we'll add it manually if needed with incremented depth
        const nonSpawnPacks = childToolPacks.filter((p) => p !== "spawn");
        childTools = nonSpawnPacks.length > 0
          ? toolRegistry.resolvePacks(nonSpawnPacks)
          : [];
      } catch (err) {
        return `Error: failed to resolve tool packs for "${typeName}": ${(err as Error).message}`;
      }

      // 5. If child type includes "spawn" in toolPacks, wire child spawn tool with depth + 1
      if (childToolPacks.includes("spawn")) {
        const childSpawnTool = createSpawnAgentTool({
          registry,
          provider,
          toolRegistry,
          parentSessionId,
          currentDepth: currentDepth + 1,
          parentPolicyProfile: effectivePolicy,
          parentSignal,
        });
        childTools.push(childSpawnTool);
      }

      // 6. Create child agent
      const fullPrompt = context ? `${context}\n\n${prompt}` : prompt;
      const agent = new Agent({
        provider,
        model: agentType.model,
        maxTokens: 4096,
        maxTurns: agentType.maxTurns ?? 10,
        systemPrompt: agentType.systemPrompt,
        tools: childTools,
        intentRequired: agentType.intentRequired ?? true,
        policyProfile: effectivePolicy,
        signal: parentSignal,
        sessionId: parentSessionId
          ? `${parentSessionId}-child-${Date.now()}`
          : undefined,
      });

      // 7. Run child agent
      try {
        const result = await agent.run(fullPrompt);
        return result.response || "(subagent returned no response)";
      } catch (err) {
        return `Error: subagent "${typeName}" failed: ${(err as Error).message}`;
      }
    },
  };
}
