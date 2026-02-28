import type { ToolDefinition } from "../agent/types";
import type { TaskGraph } from "../teams/task-graph";

export interface TaskToolsDeps {
  /** The shared task graph instance. */
  taskGraph: TaskGraph;
  /** ID of the calling agent (worker ID or "orchestrator"). */
  actorId: string;
  /** Gates access to complete/reject/create operations. */
  isOrchestrator?: boolean;
}

/**
 * Create tool definitions for interacting with a shared task list.
 *
 * Role gating:
 * - Any agent: list_tasks, get_task
 * - Workers only: submit_result
 * - Orchestrator only: create_task, complete_task, reject_task
 */
export function createTaskTools(deps: TaskToolsDeps): ToolDefinition[] {
  const { taskGraph, actorId, isOrchestrator = false } = deps;

  const listTasks: ToolDefinition = {
    name: "list_tasks",
    description: "List all tasks in the shared task graph with their status.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    run: (): string => {
      const tasks = taskGraph.getTasks();
      if (tasks.length === 0) return "No tasks in the task graph.";
      return tasks
        .map(
          (t) =>
            `[${t.id}] status=${t.status} | ${t.description}${t.assignedTo ? ` (assigned: ${t.assignedTo})` : ""}${t.result ? ` | result: ${t.result.slice(0, 100)}` : ""}${t.error ? ` | error: ${t.error}` : ""}`
        )
        .join("\n");
    },
  };

  const getTask: ToolDefinition = {
    name: "get_task",
    description: "Get detailed information about a specific task by ID.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "The task ID to look up." },
      },
      required: ["taskId"],
    },
    run: (input: Record<string, unknown>): string => {
      const taskId = String(input["taskId"] ?? "").trim();
      if (!taskId) return "Error: taskId is required.";

      const tasks = taskGraph.getTasks();
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return `Error: task "${taskId}" not found.`;

      return JSON.stringify(task, null, 2);
    },
  };

  const submitResult: ToolDefinition = {
    name: "submit_result",
    description:
      "Submit a result for a task you worked on. Does NOT mark the task complete — the orchestrator will review and complete it.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "The task ID to submit result for." },
        result: { type: "string", description: "The result of your work." },
      },
      required: ["taskId", "result"],
    },
    run: (input: Record<string, unknown>): string => {
      if (isOrchestrator) {
        return "Error: orchestrator should use complete_task or reject_task, not submit_result.";
      }
      const taskId = String(input["taskId"] ?? "").trim();
      const result = String(input["result"] ?? "").trim();
      if (!taskId) return "Error: taskId is required.";
      if (!result) return "Error: result is required.";

      try {
        const updated = taskGraph.submitResult(taskId, result);
        return `Result submitted for task "${taskId}". Status: ${updated.status}. Awaiting orchestrator review.`;
      } catch (err) {
        return `Error: ${(err as Error).message}`;
      }
    },
  };

  const createTask: ToolDefinition = {
    name: "create_task",
    description: "Create a new task in the task graph (orchestrator only).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Unique task ID." },
        description: { type: "string", description: "Task description." },
        blockedBy: {
          type: "array",
          items: { type: "string" },
          description: "IDs of tasks this depends on.",
        },
        priority: { type: "number", description: "Priority (higher = first)." },
      },
      required: ["id", "description"],
    },
    run: (input: Record<string, unknown>): string => {
      if (!isOrchestrator) {
        return "Error: only the orchestrator can create tasks.";
      }
      const id = String(input["id"] ?? "").trim();
      const description = String(input["description"] ?? "").trim();
      if (!id) return "Error: id is required.";
      if (!description) return "Error: description is required.";

      const blockedBy = Array.isArray(input["blockedBy"])
        ? (input["blockedBy"] as string[]).map(String)
        : undefined;
      const priority =
        typeof input["priority"] === "number" ? input["priority"] : undefined;

      try {
        const result = taskGraph.applyPatch(
          {
            actor: actorId,
            reason: "create_task_tool",
            operations: [
              {
                op: "add_task",
                task: {
                  id,
                  description,
                  blockedBy,
                  priority,
                  status: "pending",
                },
              },
            ],
          },
          taskGraph.getVersion()
        );
        if (!result.applied) {
          return `Error: ${result.error ?? "failed to create task"}`;
        }
        return `Task "${id}" created successfully.`;
      } catch (err) {
        return `Error: ${(err as Error).message}`;
      }
    },
  };

  const completeTask: ToolDefinition = {
    name: "complete_task",
    description:
      "Mark a task as done after verifying its submitted result (orchestrator only).",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "The task ID to complete." },
      },
      required: ["taskId"],
    },
    run: (input: Record<string, unknown>): string => {
      if (!isOrchestrator) {
        return "Error: only the orchestrator can complete tasks.";
      }
      const taskId = String(input["taskId"] ?? "").trim();
      if (!taskId) return "Error: taskId is required.";

      try {
        const updated = taskGraph.completeTask(taskId);
        return `Task "${taskId}" marked as done. Result: ${updated.result?.slice(0, 200) ?? "none"}`;
      } catch (err) {
        return `Error: ${(err as Error).message}`;
      }
    },
  };

  const rejectTask: ToolDefinition = {
    name: "reject_task",
    description:
      "Reject a task's submitted result (orchestrator only). Sets status to 'deferred' — can be re-queued.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "The task ID to reject." },
        reason: { type: "string", description: "Why the result was rejected." },
      },
      required: ["taskId", "reason"],
    },
    run: (input: Record<string, unknown>): string => {
      if (!isOrchestrator) {
        return "Error: only the orchestrator can reject tasks.";
      }
      const taskId = String(input["taskId"] ?? "").trim();
      const reason = String(input["reason"] ?? "").trim();
      if (!taskId) return "Error: taskId is required.";
      if (!reason) return "Error: reason is required.";

      try {
        const updated = taskGraph.rejectTask(taskId, reason);
        return `Task "${taskId}" rejected (status: ${updated.status}). Reason: ${reason}`;
      } catch (err) {
        return `Error: ${(err as Error).message}`;
      }
    },
  };

  // Return tools based on role
  const tools: ToolDefinition[] = [listTasks, getTask];
  if (isOrchestrator) {
    tools.push(createTask, completeTask, rejectTask);
  } else {
    tools.push(submitResult);
  }
  return tools;
}
