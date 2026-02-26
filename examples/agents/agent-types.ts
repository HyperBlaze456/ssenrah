import type { PolicyProfile } from "../harness/policy-engine";

/**
 * Isolation configuration for a spawned agent type.
 */
export interface AgentTypeIsolation {
  /** Restrict to read-only tool packs. */
  readOnly?: boolean;
  /** Override the default tool packs for this agent type. */
  toolPacks?: string[];
  /** Override the default max turns for this agent type. */
  maxTurns?: number;
  /** Max recursive spawn depth (default 1, prevents infinite nesting). */
  maxDepth?: number;
  /** Restrict filesystem access to this root (future enforcement). */
  workspaceRoot?: string;
}

/**
 * Predefined agent type schema.
 *
 * Users register these with the AgentTypeRegistry. The orchestrator
 * or any agent with the "spawn" tool pack selects a type by name.
 */
export interface AgentType {
  /** Unique identifier, e.g. "explorer", "coder", "verifier". */
  name: string;
  /** Human-readable description of what this agent type does. */
  description: string;
  /** LLM model identifier. */
  model: string;
  /** Custom system prompt for this agent type. */
  systemPrompt?: string;
  /** Which tool packs to give this agent. */
  toolPacks?: string[];
  /** Isolation configuration. */
  isolation?: AgentTypeIsolation;
  /** Safety cap on turns (default 10). */
  maxTurns?: number;
  /** Whether to require intent declarations. Default true. */
  intentRequired?: boolean;
  /** Policy profile for this agent type. */
  policyProfile?: PolicyProfile;
}
