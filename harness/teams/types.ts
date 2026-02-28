import { LLMProvider } from "../providers/types";
import { Beholder } from "../harness/beholder";
import type { FeatureFlags, SafetyCaps } from "./policy";
import type { TeamRuntimeEvent } from "./events";
import type { TeamRunState } from "./state";
import type { RolloutGateReport } from "./regression-gates";
import type { AgentTypeRegistry } from "../agents/registry";

/**
 * A task assigned to a worker agent in the team.
 */
export interface TeamTask {
  id: string;
  description: string;
  assignedTo?: string;
  blockedBy?: string[];
  priority?: number;
  metadata?: Record<string, unknown>;
  status: "pending" | "in_progress" | "done" | "failed" | "deferred";
  result?: string;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export type TrustLevel = "untrusted" | "workspace" | "user" | "managed";

/**
 * A message passed between agents in the team.
 */
export interface TeamMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  taskId?: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
  delivered?: boolean;
  deliveredAt?: Date;
}

/**
 * Configuration for a team of agents.
 * Now provider-agnostic — accepts LLMProvider instances.
 */
export interface TeamConfig {
  name: string;
  /** Provider for the orchestrator (cheap model recommended). */
  orchestratorProvider?: LLMProvider;
  /** Model for the orchestrator. */
  orchestratorModel?: string;
  /** Provider for workers (capable model recommended). */
  workerProvider?: LLMProvider;
  /** Model for workers. */
  workerModel?: string;
  /** Optional shared Beholder to monitor all workers. */
  beholder?: Beholder;
  /** Number of restart attempts when a worker is killed or times out. */
  workerRestartLimit?: number;
  maxWorkers?: number;
  verbose?: boolean;
  /**
   * Runtime feature flags/caps for phased MVP migration.
   * Defaults preserve current baseline behavior (Claude/Codex-like local permissive).
   */
  runtimeFeatureFlags?: Partial<FeatureFlags>;
  runtimeSafetyCaps?: Partial<SafetyCaps>;
  /** Trust tier used for extension loading checks when trust-gating is enabled. */
  trustLevel?: TrustLevel;
  /** Registry of predefined agent types for subagent spawning. */
  agentTypeRegistry?: AgentTypeRegistry;
  /**
   * When true, workers submit results but don't mark tasks complete.
   * The orchestrator verifies work before completing. Default: false.
   */
  verifyBeforeComplete?: boolean;
}

/**
 * Result returned by the orchestrator after the team completes work.
 */
export interface TeamResult {
  tasks: TeamTask[];
  summary: string;
  success: boolean;
  messages?: TeamMessage[];
  runtimeState?: TeamRunState;
  runtimeEvents?: TeamRuntimeEvent[];
  rolloutGates?: RolloutGateReport;
}
