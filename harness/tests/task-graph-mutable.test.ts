import { TaskGraph } from "../teams/task-graph";

describe("TaskGraph mutable patching", () => {
  it("applies patch with expectedVersion and increments graphVersion", () => {
    const graph = new TaskGraph([
      { id: "t1", description: "root", status: "pending" },
      { id: "t2", description: "child", blockedBy: ["t1"], status: "pending" },
    ]);

    const result = graph.applyPatch(
      {
        actor: "test",
        reason: "raise priority",
        operations: [
          {
            op: "update_task",
            taskId: "t2",
            patch: { priority: 10 },
          },
        ],
      },
      0
    );

    expect(result.applied).toBe(true);
    expect(result.graphVersion).toBe(1);
    expect(graph.getVersion()).toBe(1);
    expect(graph.getTasks().find((task) => task.id === "t2")?.priority).toBe(10);
  });

  it("rejects stale expectedVersion deterministically", () => {
    const graph = new TaskGraph([
      { id: "t1", description: "root", status: "pending" },
    ]);

    const first = graph.applyPatch(
      {
        actor: "test",
        operations: [{ op: "update_task", taskId: "t1", patch: { priority: 1 } }],
      },
      0
    );
    expect(first.applied).toBe(true);

    const stale = graph.applyPatch(
      {
        actor: "test",
        operations: [{ op: "update_task", taskId: "t1", patch: { priority: 2 } }],
      },
      0
    );

    expect(stale.applied).toBe(false);
    expect(stale.conflict).toEqual({ expectedVersion: 0, actualVersion: 1 });
    expect(stale.error).toMatch(/version_conflict/i);
  });

  it("enforces graph invariants on patch apply", () => {
    const graph = new TaskGraph([
      { id: "a", description: "a", status: "pending" },
      { id: "b", description: "b", status: "pending" },
    ]);

    const result = graph.applyPatch(
      {
        actor: "test",
        operations: [
          {
            op: "update_task",
            taskId: "a",
            patch: { blockedBy: ["b"] },
          },
          {
            op: "update_task",
            taskId: "b",
            patch: { blockedBy: ["a"] },
          },
        ],
      },
      0
    );

    expect(result.applied).toBe(false);
    expect(result.error).toMatch(/Cycle detected/i);
    expect(graph.getVersion()).toBe(0);
  });

  it("replays mutation events to equivalent final state", () => {
    const initial = [
      { id: "t1", description: "root", status: "pending" as const },
      { id: "t2", description: "child", blockedBy: ["t1"], status: "pending" as const },
    ];
    const graph = new TaskGraph(initial);

    graph.claimReadyTasks(1);
    graph.resolveTask({
      id: "t1",
      description: "root",
      status: "done",
      completedAt: new Date(),
    });
    graph.claimReadyTasks(1);
    graph.resolveTask({
      id: "t2",
      description: "child",
      blockedBy: ["t1"],
      status: "done",
      completedAt: new Date(),
    });

    const replayed = TaskGraph.replay(initial, graph.getEvents());
    expect(replayed.getTasks().map((task) => task.status)).toEqual(
      graph.getTasks().map((task) => task.status)
    );
    expect(replayed.getVersion()).toBe(graph.getVersion());
  });
});
