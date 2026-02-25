import { LLMProvider } from "../providers/types";
import { createProvider } from "../providers";
import { OrchestratorAgent } from "./orchestrator";
import { WorkerAgent } from "./worker";
import { TeamConfig, TeamResult, TeamTask } from "./types";
import { TaskGraph } from "./task-graph";
import { TeamMailbox } from "./mailbox";

const WORKER_TIMEOUT_MS = 120_000; // 2 minutes per worker
const DEFAULT_ORCHESTRATOR_MODEL = "gemini-2.0-flash";
const DEFAULT_WORKER_MODEL = "gemini-2.0-flash";
const DEFAULT_WORKER_RESTART_LIMIT = 1;

/**
 * Execute a worker task with a hard timeout backed by AbortController.
 */
function executeWithTimeout(
  worker: WorkerAgent,
  task: TeamTask,
  ms: number,
  mailbox?: TeamMailbox
): Promise<TeamTask> {
  const controller = new AbortController();

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      controller.abort();
      resolve({
        ...task,
        status: "failed",
        error: `Worker timed out after ${ms}ms`,
        completedAt: new Date(),
      });
    }, ms);

    worker
      .execute(task, controller.signal, mailbox)
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err: unknown) => {
        clearTimeout(timer);
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

function shouldRestartWorker(task: TeamTask): boolean {
  const error = task.error ?? "";
  return (
    error.includes("killed by Beholder") ||
    error.includes("timed out")
  );
}

async function executeWithRestart(
  createWorker: (attempt: number) => WorkerAgent,
  task: TeamTask,
  timeoutMs: number,
  restartLimit: number,
  mailbox?: TeamMailbox,
  verbose = false
): Promise<TeamTask> {
  let lastResult: TeamTask | null = null;

  for (let attempt = 0; attempt <= restartLimit; attempt++) {
    const worker = createWorker(attempt);
    mailbox?.send({
      from: "orchestrator",
      to: worker.id,
      taskId: task.id,
      content: `Attempt ${attempt + 1}: ${task.description}`,
      metadata: { attempt: attempt + 1, taskId: task.id },
    });
    const result = await executeWithTimeout(worker, task, timeoutMs, mailbox);
    lastResult = result;

    if (result.status === "done") {
      return result;
    }

    if (attempt < restartLimit && shouldRestartWorker(result)) {
      if (verbose) {
        console.log(
          `[Team] Restarting ${worker.id} for task ${task.id} after failure: ${result.error}`
        );
      }
      continue;
    }
    return result;
  }

  return (
    lastResult ?? {
      ...task,
      status: "failed",
      error: "Worker failed before producing a result",
      completedAt: new Date(),
    }
  );
}

/**
 * Team — coordinates an OrchestratorAgent and a pool of WorkerAgents.
 *
 * Now provider-agnostic — orchestrator and workers can use different providers.
 */
export class Team {
  private config: TeamConfig;
  private orchestrator: OrchestratorAgent;
  private orchestratorProvider: LLMProvider;
  private workerProvider: LLMProvider;

  constructor(config: TeamConfig) {
    const maxWorkers = config.maxWorkers ?? 3;
    if (!Number.isInteger(maxWorkers) || maxWorkers < 1) {
      throw new Error(`maxWorkers must be a positive integer, got: ${maxWorkers}`);
    }
    const workerRestartLimit =
      config.workerRestartLimit ?? DEFAULT_WORKER_RESTART_LIMIT;
    if (!Number.isInteger(workerRestartLimit) || workerRestartLimit < 0) {
      throw new Error(
        `workerRestartLimit must be a non-negative integer, got: ${workerRestartLimit}`
      );
    }
    this.config = { ...config, maxWorkers, workerRestartLimit };

    // Create default providers if not provided
    this.orchestratorProvider = config.orchestratorProvider ?? createProvider({
      type: "gemini",
      model: config.orchestratorModel ?? DEFAULT_ORCHESTRATOR_MODEL,
    });
    this.workerProvider = config.workerProvider ?? createProvider({
      type: "gemini",
      model: config.workerModel ?? DEFAULT_WORKER_MODEL,
    });

    this.orchestrator = new OrchestratorAgent(
      this.orchestratorProvider,
      config.orchestratorModel ?? DEFAULT_ORCHESTRATOR_MODEL,
      config.verbose
    );
  }

  /**
   * Execute a high-level goal using the full team workflow.
   */
  async run(goal: string): Promise<TeamResult> {
    const { maxWorkers = 3, verbose = false } = this.config;
    const workerModel = this.config.workerModel ?? DEFAULT_WORKER_MODEL;
    const workerRestartLimit =
      this.config.workerRestartLimit ?? DEFAULT_WORKER_RESTART_LIMIT;

    if (verbose) {
      console.log(`\n[Team: ${this.config.name}] Goal: ${goal}`);
      console.log("─".repeat(60));
    }

    // Phase 1 — Plan
    const tasks = await this.orchestrator.plan(goal);
    const taskGraph = new TaskGraph(tasks);
    const mailbox = new TeamMailbox();

    if (verbose) {
      console.log(`[Team] Planned ${tasks.length} task(s):`);
      tasks.forEach((t) => console.log(`  • [${t.id}] ${t.description}`));
      console.log("─".repeat(60));
    }

    // Phase 2 — Execute dependency-aware task batches
    let workerSequence = 0;
    while (!taskGraph.isComplete()) {
      const batch = taskGraph.claimReadyTasks(maxWorkers);
      if (batch.length === 0) {
        const blocked = taskGraph.markBlockedTasksAsFailed();
        if (blocked.length === 0) {
          const pendingIds = taskGraph.getPendingTasks().map((t) => t.id).join(", ");
          throw new Error(
            `Task graph made no progress and has pending tasks: ${pendingIds || "none"}`
          );
        }
        if (verbose) {
          console.log(
            `[Team] Marked ${blocked.length} task(s) failed due to dependency failures: ${blocked
              .map((t) => t.id)
              .join(", ")}`
          );
        }
        continue;
      }

      const settled = await Promise.allSettled(
        batch.map((task) => {
          const baseWorkerId = `worker-${++workerSequence}`;
          return executeWithRestart(
            (attempt) =>
              new WorkerAgent(
                `${baseWorkerId}-attempt-${attempt + 1}`,
                this.workerProvider,
                workerModel,
                verbose,
                this.config.beholder
              ),
            task,
            WORKER_TIMEOUT_MS,
            workerRestartLimit,
            mailbox,
            verbose
          );
        })
      );

      for (let i = 0; i < settled.length; i++) {
        const outcome = settled[i];
        const task = batch[i];
        let normalizedResult: TeamTask;

        if (outcome.status === "fulfilled") {
          normalizedResult = outcome.value;
        } else {
          normalizedResult = {
            ...task,
            status: "failed",
            error: String(outcome.reason),
            completedAt: new Date(),
          };
        }

        taskGraph.resolveTask(normalizedResult);
      }

      const blocked = taskGraph.markBlockedTasksAsFailed();
      if (verbose && blocked.length > 0) {
        console.log(
          `[Team] Dependency-failed task(s): ${blocked.map((t) => t.id).join(", ")}`
        );
      }
    }

    const completedTasks = taskGraph.getTasks();

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

    return { tasks: completedTasks, summary, success, messages: mailbox.getAll() };
  }
}
