import Anthropic from "@anthropic-ai/sdk";
import { TeamTask } from "./types";

const MAX_TASKS = 5;

const ORCHESTRATOR_SYSTEM = `You are an orchestrator agent that breaks complex goals into discrete tasks.
Given a high-level goal, produce a JSON array of tasks. Each task must have:
  - id: a short unique identifier (e.g. "t1", "t2")
  - description: a self-contained task description a worker agent can act on independently

Rules:
- Limit to at most ${MAX_TASKS} tasks
- Each task must be independently executable (no inter-task dependencies)
- Be specific: include file paths, expected content, or exact operations
- Return ONLY the JSON array, no prose, no markdown fences`;

/**
 * OrchestratorAgent — decomposes a goal into a list of TeamTasks.
 *
 * This models the orchestrator in the agent teams pattern:
 * - Receives high-level goal
 * - Plans and decomposes into atomic tasks
 * - Delegates to WorkerAgents
 * - Synthesizes results into a final summary
 */
export class OrchestratorAgent {
  private client: Anthropic;
  private model: string;
  private verbose: boolean;

  constructor(model = "claude-haiku-4-5-20251001", verbose = false) {
    this.client = new Anthropic();
    this.model = model;
    this.verbose = verbose;
  }

  /**
   * Decompose a high-level goal into worker tasks.
   * Validates the parsed JSON before returning.
   */
  async plan(goal: string): Promise<TeamTask[]> {
    if (this.verbose) {
      console.log(`[Orchestrator] Planning goal: ${goal}`);
    }

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: ORCHESTRATOR_SYSTEM,
      messages: [{ role: "user", content: goal }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    // Strip markdown fences if the model added them anyway
    const jsonText = text
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();

    let raw: unknown;
    try {
      raw = JSON.parse(jsonText);
    } catch {
      throw new Error(`Orchestrator returned invalid JSON:\n${text}`);
    }

    return this.validateAndNormalizeTasks(raw);
  }

  /**
   * Synthesize completed tasks into a final summary.
   */
  async summarize(goal: string, tasks: TeamTask[]): Promise<string> {
    if (this.verbose) {
      console.log(
        `[Orchestrator] Synthesizing results for ${tasks.length} tasks`
      );
    }

    const taskReport = tasks
      .map(
        (t) =>
          `Task ${t.id} (${t.status}): ${t.description}\n  Result: ${t.result ?? t.error ?? "no output"}`
      )
      .join("\n\n");

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `Goal: ${goal}\n\nTask results:\n${taskReport}\n\nWrite a concise summary of what was accomplished.`,
        },
      ],
    });

    return response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
  }

  /**
   * Validate that the parsed value is a well-formed task array.
   * Throws descriptively on any violation.
   */
  private validateAndNormalizeTasks(raw: unknown): TeamTask[] {
    if (!Array.isArray(raw)) {
      throw new Error("Orchestrator plan must be a JSON array");
    }
    if (raw.length === 0) {
      throw new Error("Orchestrator returned an empty task list");
    }
    if (raw.length > MAX_TASKS) {
      throw new Error(
        `Orchestrator returned ${raw.length} tasks; max is ${MAX_TASKS}`
      );
    }

    const seenIds = new Set<string>();
    return raw.map((item, idx) => {
      if (typeof item !== "object" || item === null) {
        throw new Error(`Task at index ${idx} is not an object`);
      }
      const t = item as Record<string, unknown>;

      if (typeof t["id"] !== "string" || t["id"].trim() === "") {
        throw new Error(`Task at index ${idx} has missing or invalid "id"`);
      }
      if (typeof t["description"] !== "string" || t["description"].trim() === "") {
        throw new Error(
          `Task at index ${idx} has missing or invalid "description"`
        );
      }
      // Normalise before duplicate check to catch whitespace variants ("t1" vs " t1 ")
      const normalId = t["id"].trim();
      const normalDesc = t["description"].trim();
      if (seenIds.has(normalId)) {
        throw new Error(`Duplicate task id "${normalId}" at index ${idx}`);
      }
      seenIds.add(normalId);

      return {
        id: normalId,
        description: normalDesc,
        status: "pending" as const,
      };
    });
  }
}
