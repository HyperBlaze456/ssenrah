import { TeamTask } from "./types";

/**
 * TaskGraph manages dependency-aware task scheduling for Team execution.
 */
export class TaskGraph {
  private readonly tasks = new Map<string, TeamTask>();
  private readonly order: string[] = [];
  private readonly orderIndex = new Map<string, number>();

  constructor(tasks: TeamTask[]) {
    if (!Array.isArray(tasks) || tasks.length === 0) {
      throw new Error("Task graph requires at least one task");
    }

    for (const rawTask of tasks) {
      const id = rawTask.id.trim();
      if (!id) {
        throw new Error("Task graph received task with empty id");
      }
      if (this.tasks.has(id)) {
        throw new Error(`Duplicate task id "${id}" in task graph`);
      }
      const blockedBy = Array.from(
        new Set((rawTask.blockedBy ?? []).map((dep) => dep.trim()).filter(Boolean))
      );
      const normalizedTask: TeamTask = {
        ...rawTask,
        id,
        description: rawTask.description.trim(),
        blockedBy: blockedBy.length > 0 ? blockedBy : undefined,
      };
      this.tasks.set(id, normalizedTask);
      this.orderIndex.set(id, this.order.length);
      this.order.push(id);
    }

    this.validateDependencies();
    this.assertAcyclic();
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
      .filter((task) => task.status === "pending" && this.dependenciesDone(task))
      .sort((a, b) => {
        const priorityDelta = (b.priority ?? 0) - (a.priority ?? 0);
        if (priorityDelta !== 0) return priorityDelta;
        return (this.orderIndex.get(a.id) ?? 0) - (this.orderIndex.get(b.id) ?? 0);
      })
      .slice(0, limit);

    return ready.map((task) =>
      this.updateTask(task.id, {
        status: "in_progress",
        startedAt: task.startedAt ?? new Date(),
      })
    );
  }

  /**
   * Resolve a claimed task into done/failed terminal status.
   */
  resolveTask(result: TeamTask): TeamTask {
    const existing = this.tasks.get(result.id);
    if (!existing) {
      throw new Error(`Cannot resolve unknown task "${result.id}"`);
    }

    const status = result.status === "done" ? "done" : "failed";
    return this.updateTask(existing.id, {
      ...result,
      status,
      startedAt: existing.startedAt ?? result.startedAt,
      completedAt: result.completedAt ?? new Date(),
    });
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

        const failingDependency = this.findFailingDependency(task);
        if (!failingDependency) continue;

        failed.push(
          this.updateTask(task.id, {
            status: "failed",
            error: `Blocked by failed dependency "${failingDependency.id}"`,
            completedAt: new Date(),
          })
        );
        changed = true;
      }
    }

    return failed;
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
      .filter((task) => task.status === "pending");
  }

  getTasks(): TeamTask[] {
    return this.order.map((id) => ({ ...this.tasks.get(id)! }));
  }

  private validateDependencies(): void {
    for (const id of this.order) {
      const task = this.tasks.get(id)!;
      for (const depId of task.blockedBy ?? []) {
        if (!this.tasks.has(depId)) {
          throw new Error(`Task "${task.id}" depends on unknown task "${depId}"`);
        }
        if (depId === task.id) {
          throw new Error(`Task "${task.id}" cannot depend on itself`);
        }
      }
    }
  }

  private assertAcyclic(): void {
    const marks = new Map<string, 0 | 1 | 2>();

    const visit = (id: string): void => {
      const mark = marks.get(id) ?? 0;
      if (mark === 1) {
        throw new Error(`Cycle detected in task graph at "${id}"`);
      }
      if (mark === 2) return;

      marks.set(id, 1);
      const task = this.tasks.get(id)!;
      for (const depId of task.blockedBy ?? []) {
        visit(depId);
      }
      marks.set(id, 2);
    };

    for (const id of this.order) {
      visit(id);
    }
  }

  private dependenciesDone(task: TeamTask): boolean {
    for (const depId of task.blockedBy ?? []) {
      if (this.tasks.get(depId)?.status !== "done") return false;
    }
    return true;
  }

  private findFailingDependency(task: TeamTask): TeamTask | null {
    for (const depId of task.blockedBy ?? []) {
      const dep = this.tasks.get(depId);
      if (dep?.status === "failed") {
        return dep;
      }
    }
    return null;
  }

  private updateTask(taskId: string, patch: Partial<TeamTask>): TeamTask {
    const current = this.tasks.get(taskId);
    if (!current) {
      throw new Error(`Cannot update unknown task "${taskId}"`);
    }
    const next: TeamTask = { ...current, ...patch };
    this.tasks.set(taskId, next);
    return next;
  }
}
