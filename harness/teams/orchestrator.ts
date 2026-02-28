import { LLMProvider, ChatResponse } from "../providers/types";
import { TeamTask } from "./types";
import type { AgentTypeRegistry } from "../agents/registry";
import { Agent } from "../agent/agent";

const MAX_TASKS = 5;

const ORCHESTRATOR_SYSTEM = `You are an orchestrator agent that breaks complex goals into discrete tasks.
Given a high-level goal, produce a JSON array of tasks. Each task must have:
  - id: a short unique identifier (e.g. "t1", "t2")
  - description: a self-contained task description a worker agent can act on independently
Optional fields:
  - blockedBy: array of prerequisite task ids this task depends on
  - priority: higher numbers run first when multiple tasks are ready

Rules:
- Limit to at most ${MAX_TASKS} tasks
- Prefer independent tasks. Only use blockedBy when ordering constraints are truly needed
- Be specific: include file paths, expected content, or exact operations
- Return ONLY the JSON array, no prose, no markdown fences`;

/**
 * OrchestratorAgent — decomposes a goal into a list of TeamTasks.
 *
 * Now provider-agnostic — works with any LLMProvider.
 */
export class OrchestratorAgent {
  private provider: LLMProvider;
  private model: string;
  private verbose: boolean;

  constructor(provider: LLMProvider, model: string, verbose = false) {
    this.provider = provider;
    this.model = model;
    this.verbose = verbose;
  }

  /**
   * Decompose a high-level goal into worker tasks.
   */
  async plan(goal: string): Promise<TeamTask[]> {
    if (this.verbose) {
      console.log(`[Orchestrator] Planning goal: ${goal}`);
    }

    const response: ChatResponse = await this.provider.chat({
      model: this.model,
      systemPrompt: ORCHESTRATOR_SYSTEM,
      messages: [{ role: "user", content: goal }],
      maxTokens: 1024,
    });

    const text = response.textBlocks.join("");

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

    const response: ChatResponse = await this.provider.chat({
      model: this.model,
      messages: [
        {
          role: "user",
          content: `Goal: ${goal}\n\nTask results:\n${taskReport}\n\nWrite a concise summary of what was accomplished.`,
        },
      ],
      maxTokens: 1024,
    });

    return response.textBlocks.join("");
  }

  /**
   * Verify a worker's submitted result before completing the task.
   *
   * If a "verifier" agent type is registered, spawns a verifier agent.
   * Otherwise, uses the orchestrator's own LLM for inline verification.
   */
  async verify(
    task: TeamTask,
    registry: AgentTypeRegistry,
    provider: LLMProvider
  ): Promise<{ approved: boolean; reason: string }> {
    const verifierType = registry.get("verifier");

    const verificationPrompt = `Verify this task result:

Task: ${task.description}
Submitted result: ${task.result ?? "(no result)"}

Does the result adequately address the task? Respond with a JSON object:
{"approved": true/false, "reason": "explanation"}`;

    if (verifierType) {
      // Spawn a dedicated verifier agent
      const agent = new Agent({
        provider,
        model: verifierType.model,
        maxTurns: verifierType.maxTurns ?? 5,
        systemPrompt:
          verifierType.systemPrompt ??
          "You are a verification agent. Review task results and approve or reject them. Always respond with JSON: {\"approved\": boolean, \"reason\": string}.",
        intentRequired: false,
      });

      try {
        const result = await agent.run(verificationPrompt);
        return this.parseVerificationResponse(result.response);
      } catch {
        return { approved: false, reason: "Verifier agent failed" };
      }
    }

    // Inline verification via orchestrator's own LLM
    try {
      const response: ChatResponse = await this.provider.chat({
        model: this.model,
        messages: [{ role: "user", content: verificationPrompt }],
        maxTokens: 512,
      });
      return this.parseVerificationResponse(response.textBlocks.join(""));
    } catch {
      return { approved: false, reason: "Inline verification failed" };
    }
  }

  private parseVerificationResponse(text: string): {
    approved: boolean;
    reason: string;
  } {
    try {
      const jsonText = text
        .replace(/```json\s*/g, "")
        .replace(/```\s*/g, "")
        .trim();
      const parsed = JSON.parse(jsonText);
      if (typeof parsed.approved === "boolean" && typeof parsed.reason === "string") {
        return { approved: parsed.approved, reason: parsed.reason };
      }
    } catch {
      // fall through
    }
    // Default: approve if the response doesn't look like a rejection
    const lowerText = text.toLowerCase();
    if (lowerText.includes("reject") || lowerText.includes("fail") || lowerText.includes('"approved": false') || lowerText.includes('"approved":false')) {
      return { approved: false, reason: text.slice(0, 200) };
    }
    return { approved: true, reason: "Verification passed (implicit)" };
  }

  /**
   * Validate that the parsed value is a well-formed task array.
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
    const normalized = raw.map((item, idx) => {
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
      const normalId = t["id"].trim();
      const normalDesc = t["description"].trim();
      const blockedByRaw = t["blockedBy"];
      const priorityRaw = t["priority"];

      let blockedBy: string[] | undefined;
      if (blockedByRaw !== undefined) {
        if (
          !Array.isArray(blockedByRaw) ||
          blockedByRaw.some((dep) => typeof dep !== "string" || dep.trim() === "")
        ) {
          throw new Error(
            `Task "${normalId}" has invalid "blockedBy"; expected string[]`
          );
        }
        blockedBy = Array.from(new Set(blockedByRaw.map((dep) => dep.trim())));
      }

      let priority: number | undefined;
      if (priorityRaw !== undefined) {
        if (typeof priorityRaw !== "number" || !Number.isFinite(priorityRaw)) {
          throw new Error(
            `Task "${normalId}" has invalid "priority"; expected finite number`
          );
        }
        priority = priorityRaw;
      }

      if (seenIds.has(normalId)) {
        throw new Error(`Duplicate task id "${normalId}" at index ${idx}`);
      }
      seenIds.add(normalId);

      return {
        id: normalId,
        description: normalDesc,
        blockedBy,
        priority,
        status: "pending" as const,
      };
    });

    for (const task of normalized) {
      for (const depId of task.blockedBy ?? []) {
        if (!seenIds.has(depId)) {
          throw new Error(
            `Task "${task.id}" depends on unknown task "${depId}" in orchestrator output`
          );
        }
      }
    }

    return normalized;
  }
}
