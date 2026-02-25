import { OrchestratorAgent } from "./orchestrator";
import { WorkerAgent } from "./worker";
import { TeamConfig, TeamResult, TeamTask } from "./types";

const WORKER_TIMEOUT_MS = 120_000; // 2 minutes per worker

/**
 * Execute a worker task with a hard timeout backed by AbortController.
 *
 * When the timeout fires:
 *   1. The AbortController is aborted — this cancels in-flight Anthropic API
 *      requests and prevents the agent loop from starting the next turn.
 *   2. A failed TeamTask is resolved immediately.
 *
 * This closes the soft-timeout gap where timed-out workers could continue
 * running tools and making API calls after the timeout resolved.
 */
function executeWithTimeout(
  worker: WorkerAgent,
  task: TeamTask,
  ms: number
): Promise<TeamTask> {
  const controller = new AbortController();

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      controller.abort(); // hard-cancel the agent loop
      resolve({
        ...task,
        status: "failed",
        error: `Worker timed out after ${ms}ms`,
        completedAt: new Date(),
      });
    }, ms);

    worker
      .execute(task, controller.signal)
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err: unknown) => {
        clearTimeout(timer);
        // Ignore AbortError — the timeout already resolved
        if ((err as Error).name === "AbortError") return;
        resolve({
          ...task,
          status: "failed",
          error: `Worker rejected: ${(err as Error).message ?? String(err)}`,
          completedAt: new Date(),
        });
      });
  });
}

/**
 * Team — coordinates an OrchestratorAgent and a pool of WorkerAgents.
 *
 * Workflow:
 *   1. Orchestrator plans: decomposes goal → tasks
 *   2. Workers execute tasks in parallel (up to maxWorkers at a time)
 *   3. Orchestrator synthesizes: summarizes all results
 *
 * This implements the "agent teams" pattern from the ssenrah README:
 * - Orchestrator spawns the right number of workers
 * - Workers run independently and report back
 * - Failed/timed-out workers are recorded but do not block the team
 */
export class Team {
  private config: TeamConfig;
  private orchestrator: OrchestratorAgent;

  constructor(config: TeamConfig) {
    // Validate maxWorkers before storing — prevents non-advancing batch loop
    const maxWorkers = config.maxWorkers ?? 3;
    if (!Number.isInteger(maxWorkers) || maxWorkers < 1) {
      throw new Error(`maxWorkers must be a positive integer, got: ${maxWorkers}`);
    }
    this.config = { ...config, maxWorkers };
    this.orchestrator = new OrchestratorAgent(
      config.orchestratorModel,
      config.verbose
    );
  }

  /**
   * Execute a high-level goal using the full team workflow.
   */
  async run(goal: string): Promise<TeamResult> {
    const { maxWorkers = 3, workerModel, verbose = false } = this.config;

    if (verbose) {
      console.log(`\n[Team: ${this.config.name}] Goal: ${goal}`);
      console.log("─".repeat(60));
    }

    // Phase 1 — Plan
    const tasks = await this.orchestrator.plan(goal);

    if (verbose) {
      console.log(`[Team] Planned ${tasks.length} task(s):`);
      tasks.forEach((t) => console.log(`  • [${t.id}] ${t.description}`));
      console.log("─".repeat(60));
    }

    // Phase 2 — Execute tasks in parallel batches
    // Use Promise.allSettled so one stuck worker never blocks the others.
    const completedTasks: TeamTask[] = [];
    for (let i = 0; i < tasks.length; i += maxWorkers) {
      const batch = tasks.slice(i, i + maxWorkers);
      const settled = await Promise.allSettled(
        batch.map((task, idx) => {
          const workerId = `worker-${i + idx + 1}`;
          const worker = new WorkerAgent(workerId, workerModel, verbose);
          return executeWithTimeout(worker, task, WORKER_TIMEOUT_MS);
        })
      );

      for (const outcome of settled) {
        if (outcome.status === "fulfilled") {
          completedTasks.push(outcome.value);
        } else {
          // Promise itself rejected (shouldn't happen after withTimeout, but guard anyway)
          completedTasks.push({
            id: "unknown",
            description: "unknown",
            status: "failed",
            error: String(outcome.reason),
            completedAt: new Date(),
          });
        }
      }
    }

    if (verbose) {
      console.log("─".repeat(60));
      console.log("[Team] All workers done. Synthesizing...");
    }

    // Phase 3 — Synthesize
    const summary = await this.orchestrator.summarize(goal, completedTasks);
    const success = completedTasks.every((t) => t.status === "done");

    if (verbose) {
      console.log("\n[Team] Summary:\n" + summary);
    }

    return { tasks: completedTasks, summary, success };
  }
}
