import { TeamMailbox } from "../teams/mailbox";
import { TaskGraph } from "../teams/task-graph";

describe("TaskGraph", () => {
  it("claims tasks only when dependencies are complete", () => {
    const graph = new TaskGraph([
      { id: "t1", description: "root", status: "pending" },
      { id: "t2", description: "depends on t1", blockedBy: ["t1"], status: "pending" },
    ]);

    const firstBatch = graph.claimReadyTasks(2);
    expect(firstBatch.map((t) => t.id)).toEqual(["t1"]);

    graph.resolveTask({ ...firstBatch[0], status: "done", completedAt: new Date() });
    const secondBatch = graph.claimReadyTasks(2);
    expect(secondBatch.map((t) => t.id)).toEqual(["t2"]);
  });

  it("orders ready tasks by priority first", () => {
    const graph = new TaskGraph([
      { id: "low", description: "low", priority: 1, status: "pending" },
      { id: "high", description: "high", priority: 10, status: "pending" },
      { id: "mid", description: "mid", priority: 5, status: "pending" },
    ]);

    const batch = graph.claimReadyTasks(3);
    expect(batch.map((t) => t.id)).toEqual(["high", "mid", "low"]);
  });

  it("propagates dependency failures transitively", () => {
    const graph = new TaskGraph([
      { id: "t1", description: "root", status: "pending" },
      { id: "t2", description: "depends on t1", blockedBy: ["t1"], status: "pending" },
      { id: "t3", description: "depends on t2", blockedBy: ["t2"], status: "pending" },
    ]);

    const claimed = graph.claimReadyTasks(1);
    graph.resolveTask({
      ...claimed[0],
      status: "failed",
      error: "boom",
      completedAt: new Date(),
    });

    const blocked = graph.markBlockedTasksAsFailed();
    expect(blocked.map((t) => t.id)).toEqual(["t2", "t3"]);
    expect(graph.isComplete()).toBe(true);
  });

  it("rejects unknown dependencies", () => {
    expect(
      () =>
        new TaskGraph([
          { id: "t1", description: "task", blockedBy: ["missing"], status: "pending" },
        ])
    ).toThrow(/unknown task/i);
  });

  it("rejects cyclic dependencies", () => {
    expect(
      () =>
        new TaskGraph([
          { id: "a", description: "a", blockedBy: ["b"], status: "pending" },
          { id: "b", description: "b", blockedBy: ["a"], status: "pending" },
        ])
    ).toThrow(/Cycle detected/i);
  });
});

describe("TeamMailbox", () => {
  it("stores, lists, and acknowledges messages", () => {
    const mailbox = new TeamMailbox();
    const message = mailbox.send({
      from: "orchestrator",
      to: "worker-1",
      taskId: "t1",
      content: "Start task t1",
      metadata: { attempt: 1 },
    });

    const inbox = mailbox.list("worker-1");
    expect(inbox).toHaveLength(1);
    expect(inbox[0].id).toBe(message.id);
    expect(inbox[0].delivered).toBe(false);

    const delivered = mailbox.markDelivered(message.id);
    expect(delivered?.delivered).toBe(true);
    expect(mailbox.list("worker-1")).toHaveLength(0);
    expect(mailbox.list("worker-1", { includeDelivered: true })).toHaveLength(1);
  });

  it("filters inbox by recipient", () => {
    const mailbox = new TeamMailbox();
    mailbox.send({ from: "orchestrator", to: "worker-1", content: "one" });
    mailbox.send({ from: "orchestrator", to: "worker-2", content: "two" });

    expect(mailbox.list("worker-1")).toHaveLength(1);
    expect(mailbox.list("worker-2")).toHaveLength(1);
  });
});
