import { Agent } from "../agent/agent";
import { defaultTools } from "../agent/tools";
import { TeamTask } from "./types";

/**
 * WorkerAgent — a specialized Agent that runs a single assigned task.
 *
 * Workers are spawned by the Orchestrator and are responsible for
 * completing one focused task. They report success or failure back.
 *
 * This models the "agent teams" pattern described in the README:
 * - Orchestrator spawns workers
 * - Workers can be terminated if misbehaving
 * - Workers report results via messages
 */
export class WorkerAgent {
  readonly id: string;
  private agent: Agent;
  private verbose: boolean;
  private model?: string;

  constructor(id: string, model?: string, verbose = false) {
    this.id = id;
    this.verbose = verbose;
    this.model = model;
    this.agent = new Agent({
      model,
      tools: defaultTools,
      systemPrompt: this.buildSystemPrompt(),
    });
  }

  private buildSystemPrompt(): string {
    return `You are a focused worker agent with ID "${this.id}".
You will receive a specific task and must complete it autonomously.
Use your tools to accomplish the task. Be concise and direct.
When you are done, summarize what you accomplished clearly.`;
  }

  /**
   * Execute a task and return the updated task with result/error.
   * Pass an AbortSignal to cancel mid-execution (e.g. on team timeout).
   */
  async execute(task: TeamTask, signal?: AbortSignal): Promise<TeamTask> {
    // Rebuild agent preserving model + wiring in the cancellation signal
    if (signal) {
      this.agent = new Agent({
        model: this.model, // preserve configured workerModel
        tools: defaultTools,
        signal,
        systemPrompt: this.buildSystemPrompt(),
      });
    }
    const started = { ...task, status: "in_progress" as const, assignedTo: this.id, startedAt: new Date() };

    if (this.verbose) {
      console.log(`[Worker ${this.id}] Starting task: ${task.description}`);
    }

    try {
      const result = await this.agent.run(task.description);

      if (this.verbose) {
        console.log(`[Worker ${this.id}] Done. Tools used: ${result.toolsUsed.join(", ") || "none"}`);
      }

      // Propagate incomplete runs (max_tokens, maxTurns) as failed tasks
      if (!result.done) {
        return {
          ...started,
          status: "failed",
          error: `Agent stopped early: ${result.response || "no response"}`,
          completedAt: new Date(),
        };
      }

      return {
        ...started,
        status: "done",
        result: result.response,
        completedAt: new Date(),
      };
    } catch (err) {
      const error = (err as Error).message;
      if (this.verbose) {
        console.error(`[Worker ${this.id}] Failed: ${error}`);
      }
      return {
        ...started,
        status: "failed",
        error,
        completedAt: new Date(),
      };
    }
  }
}
