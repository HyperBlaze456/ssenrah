import { LLMProvider } from "../providers/types";
import { createProvider } from "../providers";
import { OrchestratorAgent } from "./orchestrator";
import { WorkerAgent } from "./worker";
import { TeamConfig, TeamResult, TeamTask } from "./types";
import { TaskGraph } from "./task-graph";
import { TeamMailbox } from "./mailbox";
import { RuntimePolicy } from "./policy";
import { TeamEventBus } from "./events";
import { TeamStateTracker } from "./state";
import { PriorityMailbox } from "./priority-mailbox";
import { ReconcileLoop } from "./reconcile";
import { evaluateMvpRegressionGates } from "./regression-gates";
import { createDefaultToolRegistry, StaticToolRegistry } from "../tools/registry";
import { createSpawnAgentTool } from "../tools/spawn-agent";
import { createTaskTools } from "../tools/task-tools";

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
  return error.includes("killed by Beholder") || error.includes("timed out");
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
  private runtimePolicy: RuntimePolicy;

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
    this.runtimePolicy = new RuntimePolicy(
      config.runtimeFeatureFlags,
      config.runtimeSafetyCaps
    );

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
    const verifyBeforeComplete = this.config.verifyBeforeComplete ?? false;
    const agentTypeRegistry = this.config.agentTypeRegistry;

    const startedAtMs = Date.now();
    const runId = `run-${startedAtMs}-${Math.random().toString(36).slice(2, 8)}`;
    const eventBus = new TeamEventBus();
    const state = new TeamStateTracker({ runId, goal });
    const mailbox = new TeamMailbox();
    const priorityMailbox = new PriorityMailbox();
    const reconcileLoop = new ReconcileLoop({
      policy: this.runtimePolicy,
      mailbox: priorityMailbox,
      state,
    });

    try {
      this.runtimePolicy.transition("planning");
      state.setPhase("planning");
      eventBus.emit("run_started", "team", { goal, runId });

      if (verbose) {
        console.log(`\n[Team: ${this.config.name}] Goal: ${goal}`);
        console.log("─".repeat(60));
      }

      // Phase 1 — Plan
      const plannedTasks = await this.orchestrator.plan(goal);
      const taskGraph = new TaskGraph(plannedTasks);
      state.setTasks(taskGraph.getTasks());
      state.setGraphVersion(taskGraph.getVersion());
      eventBus.emit(
        "plan_created",
        "orchestrator",
        { taskCount: plannedTasks.length },
        { graphVersion: taskGraph.getVersion() }
      );

      if (verbose) {
        console.log(`[Team] Planned ${plannedTasks.length} task(s):`);
        plannedTasks.forEach((task) =>
          console.log(`  • [${task.id}] ${task.description}`)
        );
        console.log("─".repeat(60));
      }

      // Phase 2 — Execute dependency-aware task batches
      this.runtimePolicy.transition("executing");
      state.setPhase("executing");

      let workerSequence = 0;
      while (!taskGraph.isComplete()) {
        this.runtimePolicy.enforceRuntimeBudget(Date.now() - startedAtMs);
        this.runtimePolicy.enforceWorkerCap(maxWorkers);

        const batch = taskGraph.claimReadyTasks(maxWorkers);
        state.setTasks(taskGraph.getTasks());
        state.setGraphVersion(taskGraph.getVersion());
        eventBus.emit(
          "batch_claimed",
          "scheduler",
          { taskIds: batch.map((task) => task.id), size: batch.length },
          { graphVersion: taskGraph.getVersion() }
        );

        if (batch.length === 0) {
          const blocked = taskGraph.markBlockedTasksAsFailed();
          state.setTasks(taskGraph.getTasks());
          state.setGraphVersion(taskGraph.getVersion());

          if (blocked.length === 0) {
            const pendingIds = taskGraph
              .getPendingTasks()
              .map((task) => task.id)
              .join(", ");
            throw new Error(
              `Task graph made no progress and has pending tasks: ${pendingIds || "none"}`
            );
          }

          eventBus.emit(
            "tasks_dependency_failed",
            "scheduler",
            { taskIds: blocked.map((task) => task.id) },
            { graphVersion: taskGraph.getVersion() }
          );
          reconcileLoop.run({
            trigger: "dependency_failure",
            pendingTaskCount: taskGraph.getPendingTasks().length,
          });

          if (verbose) {
            console.log(
              `[Team] Marked ${blocked.length} task(s) failed due to dependency failures: ${blocked
                .map((task) => task.id)
                .join(", ")}`
            );
          }
          continue;
        }

        const settled = await Promise.allSettled(
          batch.map((task) => {
            const workerId = `worker-${++workerSequence}`;
            state.upsertHeartbeat({
              workerId,
              taskId: task.id,
              status: "busy",
              attempt: 1,
              detail: "task attempt started",
            });
            eventBus.emit(
              "worker_attempt_started",
              workerId,
              { taskId: task.id, attempt: 1 },
              { graphVersion: taskGraph.getVersion() }
            );

            return executeWithRestart(
              (attempt) => {
                // Build enriched tool registry if agent types are available
                let workerToolRegistry: StaticToolRegistry | undefined;
                let workerToolPacks: string[] | undefined;
                if (agentTypeRegistry) {
                  workerToolRegistry = createDefaultToolRegistry({
                    spawnDeps: {
                      registry: agentTypeRegistry,
                      provider: this.workerProvider,
                      toolRegistry: createDefaultToolRegistry(),
                      currentDepth: 0,
                      parentPolicyProfile: this.runtimePolicy.flags.trustGatingEnabled
                        ? "strict"
                        : "local-permissive",
                    },
                  });
                  workerToolPacks = ["filesystem", "spawn"];
                }

                return new WorkerAgent(
                  `${workerId}-attempt-${attempt + 1}`,
                  this.workerProvider,
                  workerModel,
                  verbose,
                  this.config.beholder,
                  workerToolRegistry,
                  workerToolPacks
                );
              },
              task,
              this.runtimePolicy.caps.workerTimeoutMs,
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

          if (verifyBeforeComplete && normalizedResult.status === "done") {
            // Submit result without completing — orchestrator will verify
            taskGraph.submitResult(normalizedResult.id, normalizedResult.result ?? "");
          } else {
            // Existing path — resolve directly
            taskGraph.resolveTask(normalizedResult);
          }
          state.setTasks(taskGraph.getTasks());
          state.setGraphVersion(taskGraph.getVersion());
          state.upsertHeartbeat({
            workerId: normalizedResult.assignedTo ?? `worker-${i + 1}`,
            taskId: normalizedResult.id,
            status: normalizedResult.status === "done" ? "done" : "failed",
            attempt: 1,
            detail:
              normalizedResult.status === "done"
                ? "task completed"
                : normalizedResult.error,
          });

          eventBus.emit(
            "worker_attempt_finished",
            normalizedResult.assignedTo ?? "worker",
            {
              taskId: normalizedResult.id,
              status: normalizedResult.status,
              error: normalizedResult.error,
            },
            { graphVersion: taskGraph.getVersion() }
          );
          eventBus.emit(
            "task_resolved",
            "scheduler",
            {
              taskId: normalizedResult.id,
              status: normalizedResult.status,
            },
            { graphVersion: taskGraph.getVersion() }
          );
        }

        // Verification flow — after batch execution, before dependency cascade
        if (verifyBeforeComplete && agentTypeRegistry) {
          const awaitingReview = taskGraph.getAwaitingReview();
          for (const task of awaitingReview) {
            const verdict = await this.orchestrator.verify(
              task,
              agentTypeRegistry,
              this.orchestratorProvider
            );

            if (verdict.approved) {
              taskGraph.completeTask(task.id);
              if (verbose) {
                console.log(`[Team] Task ${task.id} verified and completed: ${verdict.reason}`);
              }
            } else {
              taskGraph.rejectTask(task.id, verdict.reason);
              if (verbose) {
                console.log(`[Team] Task ${task.id} rejected: ${verdict.reason}`);
              }
              // Re-queue for retry (once)
              try {
                taskGraph.requeueTask(task.id);
                if (verbose) {
                  console.log(`[Team] Task ${task.id} re-queued for retry`);
                }
              } catch {
                // Already terminal or other issue — leave as deferred
              }
            }

            state.setTasks(taskGraph.getTasks());
            state.setGraphVersion(taskGraph.getVersion());
            eventBus.emit(
              "task_verified",
              "orchestrator",
              {
                taskId: task.id,
                approved: verdict.approved,
                reason: verdict.reason,
              },
              { graphVersion: taskGraph.getVersion() }
            );
          }
        }

        const blocked = taskGraph.markBlockedTasksAsFailed();
        state.setTasks(taskGraph.getTasks());
        state.setGraphVersion(taskGraph.getVersion());
        if (blocked.length > 0) {
          eventBus.emit(
            "tasks_dependency_failed",
            "scheduler",
            { taskIds: blocked.map((task) => task.id) },
            { graphVersion: taskGraph.getVersion() }
          );
        }

        const needsContextMessages = mailbox
          .list("orchestrator")
          .filter((message) =>
            message.content.toLowerCase().includes("need context")
          );
        const reconcileDecision = reconcileLoop.run({
          trigger: "task_resolved",
          pendingTaskCount: taskGraph.getPendingTasks().length,
          needsContext: needsContextMessages.map((message) => ({
            workerId: message.from,
            taskId: message.taskId,
            detail: message.content,
          })),
        });
        if (reconcileDecision.actions.length > 0) {
          eventBus.emit(
            "reconcile_completed",
            "reconciler",
            { actionCount: reconcileDecision.actions.length },
            { graphVersion: taskGraph.getVersion() }
          );
        }

        if (verbose && blocked.length > 0) {
          console.log(
            `[Team] Dependency-failed task(s): ${blocked
              .map((task) => task.id)
              .join(", ")}`
          );
        }
      }

      const completedTasks = taskGraph.getTasks();

      if (verbose) {
        console.log("─".repeat(60));
        console.log("[Team] All workers done. Synthesizing...");
      }

      // Phase 3 — Synthesize
      this.runtimePolicy.transition("synthesizing");
      state.setPhase("synthesizing");
      const summary = await this.orchestrator.summarize(goal, completedTasks);
      const success = completedTasks.every((task) => task.status === "done");
      const finalPhase = success ? "completed" : "failed";
      this.runtimePolicy.transition(finalPhase);
      state.finalize(finalPhase);
      eventBus.emit(success ? "run_completed" : "run_failed", "team", {
        success,
        taskCount: completedTasks.length,
      });

      let rolloutGates;
      if (this.runtimePolicy.flags.regressionGatesEnabled) {
        let replayEquivalent = true;
        if (this.runtimePolicy.flags.traceReplayEnabled) {
          const replayed = TaskGraph.replay(plannedTasks, taskGraph.getEvents());
          replayEquivalent =
            JSON.stringify(
              replayed.getTasks().map((task) => [task.id, task.status])
            ) ===
            JSON.stringify(
              taskGraph.getTasks().map((task) => [task.id, task.status])
            );
        }

        rolloutGates = evaluateMvpRegressionGates({
          replayEquivalent,
          capEnforcementActive: true,
          heartbeatPolicyActive: this.runtimePolicy.caps.heartbeatStalenessMs > 0,
          trustGatingActive: this.runtimePolicy.flags.trustGatingEnabled,
          mutableGraphEnabled: this.runtimePolicy.flags.mutableGraphEnabled,
          reconcileEnabled: this.runtimePolicy.flags.reconcileEnabled,
        });
        eventBus.emit("regression_gate_evaluated", "team", {
          passed: rolloutGates.passed,
        });
      }

      this.runtimePolicy.transition("idle");

      if (verbose) {
        console.log("\n[Team] Summary:\n" + summary);
      }

      return {
        tasks: completedTasks,
        summary,
        success,
        messages: mailbox.getAll(),
        runtimeState: state.snapshot(),
        runtimeEvents: eventBus.list(),
        rolloutGates,
      };
    } catch (error) {
      eventBus.emit("run_failed", "team", {
        message: (error as Error).message,
      });
      state.finalize("failed");
      if (this.runtimePolicy.canTransition("failed")) {
        this.runtimePolicy.transition("failed");
      }
      if (this.runtimePolicy.canTransition("idle")) {
        this.runtimePolicy.transition("idle");
      }
      throw error;
    }
  }
}
