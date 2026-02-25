/**
 * A task assigned to a worker agent in the team.
 */
export interface TeamTask {
  id: string;
  description: string;
  assignedTo?: string;
  status: "pending" | "in_progress" | "done" | "failed";
  result?: string;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

/**
 * A message passed between agents in the team.
 */
export interface TeamMessage {
  from: string;
  to: string;
  content: string;
  timestamp: Date;
}

/**
 * Configuration for a team of agents.
 */
export interface TeamConfig {
  name: string;
  orchestratorModel?: string;
  workerModel?: string;
  maxWorkers?: number;
  verbose?: boolean;
}

/**
 * Result returned by the orchestrator after the team completes work.
 */
export interface TeamResult {
  tasks: TeamTask[];
  summary: string;
  success: boolean;
}
