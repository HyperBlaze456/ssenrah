import { TeamTask } from "./types";

export type TaskGraphPatchOperation =
  | { op: "add_task"; task: TeamTask; index?: number }
  | { op: "update_task"; taskId: string; patch: Partial<TeamTask> }
  | { op: "remove_task"; taskId: string };

export interface TaskGraphPatch {
  id?: string;
  actor?: string;
  reason?: string;
  operations: TaskGraphPatchOperation[];
}

export interface TaskGraphMutationEvent {
  id: string;
  schemaVersion: 1;
  actor: string;
  expectedVersion: number;
  graphVersion: number;
  timestamp: string;
  reason?: string;
  patch: TaskGraphPatch;
}

export interface TaskGraphPatchResult {
  applied: boolean;
  graphVersion: number;
  tasks: TeamTask[];
  conflict?: { expectedVersion: number; actualVersion: number };
  error?: string;
  event?: TaskGraphMutationEvent;
}

export class TaskGraphPatchConflictError extends Error {
  readonly expectedVersion: number;
  readonly actualVersion: number;

  constructor(expectedVersion: number, actualVersion: number) {
    super(
      `TaskGraph version conflict: expected=${expectedVersion}, actual=${actualVersion}`
    );
    this.name = "TaskGraphPatchConflictError";
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

type TaskMap = Map<string, TeamTask>;

const TERMINAL_STATUSES = new Set<TeamTask["status"]>(["done", "failed"]);

/**
 * TaskGraph manages dependency-aware task scheduling for Team execution.
 * Also supports versioned mutable patches with deterministic invariants.
 */
export class TaskGraph {
  private tasks: TaskMap = new Map<string, TeamTask>();
  private order: string[] = [];
  private orderIndex = new Map<string, number>();
  private graphVersion = 0;
  private eventSeq = 0;
  private mutationEvents: TaskGraphMutationEvent[] = [];

  constructor(tasks: TeamTask[]) {
    if (!Array.isArray(tasks) || tasks.length === 0) {
      throw new Error("Task graph requires at least one task");
    }

    for (const rawTask of tasks) {
      const normalizedTask = normalizeTask(rawTask);
      if (this.tasks.has(normalizedTask.id)) {
        throw new Error(`Duplicate task id "${normalizedTask.id}" in task graph`);
      }
      this.tasks.set(normalizedTask.id, normalizedTask);
      this.order.push(normalizedTask.id);
    }
    this.reindexOrder();
    this.validateInvariants(this.tasks, this.order);
  }

  /**
   * Claim ready tasks up to `limit` and mark them in_progress.
   */
  claimReadyTasks(limit: number): TeamTask[] {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`claimReadyTasks limit must be >= 1, got ${limit}`);
    }

    const ready = this.order
      .map((id) => this.tasks.get(id)!)
      .filter(
        (task) => task.status === "pending" && this.dependenciesDone(task, this.tasks)
      )
      .sort((a, b) => {
        const priorityDelta = (b.priority ?? 0) - (a.priority ?? 0);
        if (priorityDelta !== 0) return priorityDelta;
        return (
          (this.orderIndex.get(a.id) ?? 0) - (this.orderIndex.get(b.id) ?? 0)
        );
      })
      .slice(0, limit);

    if (ready.length === 0) return [];

    const operations: TaskGraphPatchOperation[] = ready.map((task) => ({
      op: "update_task",
      taskId: task.id,
      patch: {
        status: "in_progress",
        startedAt: task.startedAt ?? new Date(),
      },
    }));

    const result = this.applyPatch(
      {
        actor: "scheduler",
        reason: "claim_ready_tasks",
        operations,
      },
      this.graphVersion
    );
    if (!result.applied) {
      throw new Error(result.error ?? "Failed to claim ready tasks");
    }

    return ready.map((task) => cloneTask(this.tasks.get(task.id)!));
  }

  /**
   * Resolve a claimed task into done/failed terminal status.
   */
  resolveTask(result: TeamTask): TeamTask {
    const existing = this.tasks.get(result.id);
    if (!existing) {
      throw new Error(`Cannot resolve unknown task "${result.id}"`);
    }

    const status: TeamTask["status"] = result.status === "done" ? "done" : "failed";
    const patchResult = this.applyPatch(
      {
        actor: "scheduler",
        reason: "resolve_task",
        operations: [
          {
            op: "update_task",
            taskId: existing.id,
            patch: {
              ...result,
              status,
              startedAt: existing.startedAt ?? result.startedAt,
              completedAt: result.completedAt ?? new Date(),
            },
          },
        ],
      },
      this.graphVersion
    );
    if (!patchResult.applied) {
      throw new Error(patchResult.error ?? "Failed to resolve task");
    }

    return cloneTask(this.tasks.get(existing.id)!);
  }

  /**
   * Mark pending tasks as failed when any dependency already failed.
   * Runs transitively until no additional failures are found.
   */
  markBlockedTasksAsFailed(): TeamTask[] {
    const failed: TeamTask[] = [];
    let changed = true;

    while (changed) {
      changed = false;
      for (const id of this.order) {
        const task = this.tasks.get(id)!;
        if (task.status !== "pending") continue;

        const failingDependency = this.findFailingDependency(task, this.tasks);
        if (!failingDependency) continue;

        const patchResult = this.applyPatch(
          {
            actor: "scheduler",
            reason: "dependency_failed",
            operations: [
              {
                op: "update_task",
                taskId: task.id,
                patch: {
                  status: "failed",
                  error: `Blocked by failed dependency "${failingDependency.id}"`,
                  completedAt: new Date(),
                },
              },
            ],
          },
          this.graphVersion
        );

        if (!patchResult.applied) {
          throw new Error(
            patchResult.error ??
              `Failed to mark dependency-blocked task "${task.id}" as failed`
          );
        }
        failed.push(cloneTask(this.tasks.get(task.id)!));
        changed = true;
      }
    }

    return failed;
  }

  /**
   * Apply a versioned patch to the graph.
   * Returns conflict/error details instead of throwing for deterministic control flow.
   */
  applyPatch(
    patch: TaskGraphPatch,
    expectedVersion: number,
    options?: { recordEvent?: boolean; timestamp?: Date }
  ): TaskGraphPatchResult {
    if (expectedVersion !== this.graphVersion) {
      return {
        applied: false,
        graphVersion: this.graphVersion,
        tasks: this.getTasks(),
        conflict: {
          expectedVersion,
          actualVersion: this.graphVersion,
        },
        error: `version_conflict expected=${expectedVersion} actual=${this.graphVersion}`,
      };
    }

    if (!Array.isArray(patch.operations) || patch.operations.length === 0) {
      return {
        applied: false,
        graphVersion: this.graphVersion,
        tasks: this.getTasks(),
        error: "patch must include at least one operation",
      };
    }

    const draftTasks = cloneTaskMap(this.tasks);
    const draftOrder = [...this.order];

    try {
      for (const op of patch.operations) {
        this.applyOperation(op, draftTasks, draftOrder);
      }
      this.validateInvariants(draftTasks, draftOrder);
    } catch (error) {
      return {
        applied: false,
        graphVersion: this.graphVersion,
        tasks: this.getTasks(),
        error: (error as Error).message,
      };
    }

    this.tasks = draftTasks;
    this.order = draftOrder;
    this.reindexOrder();
    this.graphVersion++;

    let event: TaskGraphMutationEvent | undefined;
    if (options?.recordEvent ?? true) {
      event = {
        id: patch.id?.trim() || `patch-${++this.eventSeq}`,
        schemaVersion: 1,
        actor: patch.actor?.trim() || "unknown",
        expectedVersion,
        graphVersion: this.graphVersion,
        timestamp: (options?.timestamp ?? new Date()).toISOString(),
        reason: patch.reason,
        patch: {
          ...patch,
          operations: patch.operations.map((operation) =>
            clonePatchOperation(operation)
          ),
        },
      };
      this.mutationEvents.push(event);
    }

    return {
      applied: true,
      graphVersion: this.graphVersion,
      tasks: this.getTasks(),
      event,
    };
  }

  /**
   * Replay a sequence of recorded patch events on top of an initial graph.
   * MVP replay guarantee: final-state equivalence with patch-sequence integrity.
   */
  static replay(
    initialTasks: TeamTask[],
    events: TaskGraphMutationEvent[]
  ): TaskGraph {
    const graph = new TaskGraph(initialTasks);
    for (const event of events) {
      const result = graph.applyPatch(event.patch, event.expectedVersion, {
        recordEvent: false,
      });
      if (!result.applied) {
        throw new Error(
          `Replay failed for event ${event.id}: ${result.error ?? "unknown error"}`
        );
      }
      if (result.graphVersion !== event.graphVersion) {
        throw new Error(
          `Replay graph version mismatch for event ${event.id}: replay=${result.graphVersion} expected=${event.graphVersion}`
        );
      }
    }
    return graph;
  }

  getVersion(): number {
    return this.graphVersion;
  }

  getEvents(): TaskGraphMutationEvent[] {
    return this.mutationEvents.map((event) => ({
      ...event,
      patch: {
        ...event.patch,
        operations: event.patch.operations.map((operation) =>
          clonePatchOperation(operation)
        ),
      },
    }));
  }

  isComplete(): boolean {
    return this.order.every((id) => {
      const status = this.tasks.get(id)?.status;
      return status === "done" || status === "failed";
    });
  }

  getPendingTasks(): TeamTask[] {
    return this.order
      .map((id) => this.tasks.get(id)!)
      .filter((task) => task.status === "pending")
      .map((task) => cloneTask(task));
  }

  getTasks(): TeamTask[] {
    return this.order.map((id) => cloneTask(this.tasks.get(id)!));
  }

  private applyOperation(
    operation: TaskGraphPatchOperation,
    draftTasks: TaskMap,
    draftOrder: string[]
  ): void {
    switch (operation.op) {
      case "add_task": {
        const task = normalizeTask(operation.task);
        if (draftTasks.has(task.id)) {
          throw new Error(`Cannot add duplicate task "${task.id}"`);
        }
        const index =
          operation.index == null
            ? draftOrder.length
            : Math.max(0, Math.min(draftOrder.length, Math.trunc(operation.index)));
        draftTasks.set(task.id, task);
        draftOrder.splice(index, 0, task.id);
        return;
      }

      case "remove_task": {
        const taskId = operation.taskId.trim();
        if (!draftTasks.has(taskId)) {
          throw new Error(`Cannot remove unknown task "${taskId}"`);
        }
        const dependents = draftOrder
          .map((id) => draftTasks.get(id)!)
          .filter((task) => (task.blockedBy ?? []).includes(taskId));
        if (dependents.length > 0) {
          throw new Error(
            `Cannot remove task "${taskId}" while depended on by: ${dependents
              .map((task) => task.id)
              .join(", ")}`
          );
        }
        draftTasks.delete(taskId);
        const idx = draftOrder.indexOf(taskId);
        if (idx >= 0) draftOrder.splice(idx, 1);
        return;
      }

      case "update_task": {
        const taskId = operation.taskId.trim();
        const current = draftTasks.get(taskId);
        if (!current) {
          throw new Error(`Cannot update unknown task "${taskId}"`);
        }
        if (
          operation.patch.id !== undefined &&
          operation.patch.id.trim() !== taskId
        ) {
          throw new Error(
            `Task id mutation is not allowed (${taskId} -> ${operation.patch.id})`
          );
        }

        const next = normalizeTask({
          ...current,
          ...operation.patch,
          id: taskId,
        });

        if (TERMINAL_STATUSES.has(current.status)) {
          if (!TERMINAL_STATUSES.has(next.status) || next.status !== current.status) {
            throw new Error(
              `Task "${taskId}" is terminal (${current.status}) and cannot transition to ${next.status}`
            );
          }
        }

        draftTasks.set(taskId, next);
        return;
      }

      default: {
        const exhaustive: never = operation;
        throw new Error(`Unsupported patch operation: ${(exhaustive as { op: string }).op}`);
      }
    }
  }

  private validateInvariants(taskMap: TaskMap, order: string[]): void {
    if (order.length === 0) {
      throw new Error("Task graph must contain at least one task");
    }
    if (new Set(order).size !== order.length) {
      throw new Error("Task graph order contains duplicate task ids");
    }
    for (const id of order) {
      if (!taskMap.has(id)) {
        throw new Error(`Task graph order references unknown task "${id}"`);
      }
    }
    this.validateDependencies(taskMap, order);
    this.assertAcyclic(taskMap, order);
  }

  private validateDependencies(taskMap: TaskMap, order: string[]): void {
    for (const id of order) {
      const task = taskMap.get(id)!;
      for (const depId of task.blockedBy ?? []) {
        if (!taskMap.has(depId)) {
          throw new Error(`Task "${task.id}" depends on unknown task "${depId}"`);
        }
        if (depId === task.id) {
          throw new Error(`Task "${task.id}" cannot depend on itself`);
        }
      }
    }
  }

  private assertAcyclic(taskMap: TaskMap, order: string[]): void {
    const marks = new Map<string, 0 | 1 | 2>();

    const visit = (id: string): void => {
      const mark = marks.get(id) ?? 0;
      if (mark === 1) {
        throw new Error(`Cycle detected in task graph at "${id}"`);
      }
      if (mark === 2) return;

      marks.set(id, 1);
      const task = taskMap.get(id)!;
      for (const depId of task.blockedBy ?? []) {
        visit(depId);
      }
      marks.set(id, 2);
    };

    for (const id of order) {
      visit(id);
    }
  }

  private dependenciesDone(task: TeamTask, taskMap: TaskMap): boolean {
    for (const depId of task.blockedBy ?? []) {
      if (taskMap.get(depId)?.status !== "done") return false;
    }
    return true;
  }

  private findFailingDependency(task: TeamTask, taskMap: TaskMap): TeamTask | null {
    for (const depId of task.blockedBy ?? []) {
      const dep = taskMap.get(depId);
      if (dep?.status === "failed") {
        return dep;
      }
    }
    return null;
  }

  private reindexOrder(): void {
    this.orderIndex = new Map<string, number>();
    for (let i = 0; i < this.order.length; i++) {
      this.orderIndex.set(this.order[i], i);
    }
  }
}

function normalizeTask(task: TeamTask): TeamTask {
  const id = task.id.trim();
  const description = task.description.trim();
  if (!id) {
    throw new Error("Task graph received task with empty id");
  }
  if (!description) {
    throw new Error(`Task "${id}" must have a non-empty description`);
  }

  const blockedBy = task.blockedBy
    ? Array.from(
        new Set(task.blockedBy.map((dep) => dep.trim()).filter(Boolean))
      )
    : undefined;

  if (
    task.status !== "pending" &&
    task.status !== "in_progress" &&
    task.status !== "done" &&
    task.status !== "failed" &&
    task.status !== "deferred"
  ) {
    throw new Error(`Task "${id}" has invalid status "${String(task.status)}"`);
  }

  return {
    ...task,
    id,
    description,
    blockedBy: blockedBy && blockedBy.length > 0 ? blockedBy : undefined,
    metadata: task.metadata ? { ...task.metadata } : undefined,
    startedAt: task.startedAt ? new Date(task.startedAt) : undefined,
    completedAt: task.completedAt ? new Date(task.completedAt) : undefined,
  };
}

function cloneTask(task: TeamTask): TeamTask {
  return {
    ...task,
    blockedBy: task.blockedBy ? [...task.blockedBy] : undefined,
    metadata: task.metadata ? { ...task.metadata } : undefined,
    startedAt: task.startedAt ? new Date(task.startedAt) : undefined,
    completedAt: task.completedAt ? new Date(task.completedAt) : undefined,
  };
}

function cloneTaskMap(source: TaskMap): TaskMap {
  const next = new Map<string, TeamTask>();
  for (const [id, task] of source.entries()) {
    next.set(id, cloneTask(task));
  }
  return next;
}

function cloneTaskPatch(patch: Partial<TeamTask>): Partial<TeamTask> {
  return {
    ...patch,
    blockedBy: patch.blockedBy ? [...patch.blockedBy] : undefined,
    metadata: patch.metadata ? { ...patch.metadata } : undefined,
    startedAt: patch.startedAt ? new Date(patch.startedAt) : undefined,
    completedAt: patch.completedAt ? new Date(patch.completedAt) : undefined,
  };
}

function clonePatchOperation(
  operation: TaskGraphPatchOperation
): TaskGraphPatchOperation {
  switch (operation.op) {
    case "add_task":
      return {
        op: "add_task",
        index: operation.index,
        task: cloneTask(operation.task),
      };
    case "remove_task":
      return { op: "remove_task", taskId: operation.taskId };
    case "update_task":
      return {
        op: "update_task",
        taskId: operation.taskId,
        patch: cloneTaskPatch(operation.patch),
      };
    default: {
      const exhaustive: never = operation;
      return exhaustive;
    }
  }
}
