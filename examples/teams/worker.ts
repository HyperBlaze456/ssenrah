import { LLMProvider } from "../providers/types";
import { Agent } from "../agent/agent";
import { defaultTools } from "../agent/tools";
import { TeamMessage, TeamTask } from "./types";
import { Beholder } from "../harness/beholder";
import { TeamMailbox } from "./mailbox";

/**
 * WorkerAgent — a specialized Agent that runs a single assigned task.
 *
 * Now provider-agnostic — accepts an LLMProvider instead of model string.
 */
export class WorkerAgent {
  readonly id: string;
  private agent: Agent;
  private verbose: boolean;
  private provider: LLMProvider;
  private model: string;
  private beholder?: Beholder;

  constructor(
    id: string,
    provider: LLMProvider,
    model: string,
    verbose = false,
    beholder?: Beholder
  ) {
    this.id = id;
    this.verbose = verbose;
    this.provider = provider;
    this.model = model;
    this.beholder = beholder;
    this.agent = new Agent({
      provider,
      model,
      tools: defaultTools,
      intentRequired: true,
      systemPrompt: this.buildSystemPrompt(),
    });
    if (this.beholder) {
      this.agent.setBeholder(this.beholder);
    }
  }

  private buildSystemPrompt(): string {
    return `You are a focused worker agent with ID "${this.id}".
You will receive a specific task and must complete it autonomously.
Use your tools to accomplish the task. Be concise and direct.
When you are done, summarize what you accomplished clearly.`;
  }

  private buildExecutionPrompt(
    taskDescription: string,
    inboxMessages: TeamMessage[]
  ): string {
    if (inboxMessages.length === 0) return taskDescription;

    const renderedInbox = inboxMessages
      .map((message, idx) => `${idx + 1}. [from: ${message.from}] ${message.content}`)
      .join("\n");
    return `${taskDescription}

Coordination inbox:
${renderedInbox}

Use any relevant coordination context above while executing the task.`;
  }

  /**
   * Execute a task and return the updated task with result/error.
   * Pass an AbortSignal to cancel mid-execution (e.g. on team timeout).
   */
  async execute(
    task: TeamTask,
    signal?: AbortSignal,
    mailbox?: TeamMailbox
  ): Promise<TeamTask> {
    // Rebuild agent preserving provider + wiring in the cancellation signal
    if (signal) {
      this.agent = new Agent({
        provider: this.provider,
        model: this.model,
        tools: defaultTools,
        signal,
        intentRequired: true,
        systemPrompt: this.buildSystemPrompt(),
      });
      if (this.beholder) {
        this.agent.setBeholder(this.beholder);
      }
    }

    const inboxMessages = mailbox?.list(this.id) ?? [];
    for (const message of inboxMessages) {
      mailbox?.markDelivered(message.id);
    }

    const started = { ...task, status: "in_progress" as const, assignedTo: this.id, startedAt: new Date() };

    if (this.verbose) {
      console.log(`[Worker ${this.id}] Starting task: ${task.description}`);
    }

    try {
      const result = await this.agent.run(
        this.buildExecutionPrompt(task.description, inboxMessages)
      );

      if (this.verbose) {
        console.log(`[Worker ${this.id}] Done. Tools used: ${result.toolsUsed.join(", ") || "none"}`);
      }

      if (!result.done) {
        mailbox?.send({
          from: this.id,
          to: "orchestrator",
          taskId: task.id,
          content: `Task ${task.id} failed (agent stopped early): ${result.response || "no response"}`,
          metadata: { status: "failed" },
        });
        return {
          ...started,
          status: "failed",
          error: `Agent stopped early: ${result.response || "no response"}`,
          completedAt: new Date(),
        };
      }

      mailbox?.send({
        from: this.id,
        to: "orchestrator",
        taskId: task.id,
        content: `Task ${task.id} completed.`,
        metadata: { status: "done", toolsUsed: result.toolsUsed },
      });
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
      mailbox?.send({
        from: this.id,
        to: "orchestrator",
        taskId: task.id,
        content: `Task ${task.id} failed: ${error}`,
        metadata: { status: "failed" },
      });
      return {
        ...started,
        status: "failed",
        error,
        completedAt: new Date(),
      };
    }
  }
}
