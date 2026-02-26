import { PriorityMailbox } from "../teams/priority-mailbox";

describe("PriorityMailbox", () => {
  it("orders messages by priority then timestamp", () => {
    const mailbox = new PriorityMailbox();
    mailbox.send({
      from: "orchestrator",
      to: "worker-1",
      content: "normal",
      priority: "normal",
    });
    mailbox.send({
      from: "orchestrator",
      to: "worker-1",
      content: "critical",
      priority: "critical",
    });
    mailbox.send({
      from: "orchestrator",
      to: "worker-1",
      content: "high",
      priority: "high",
    });

    expect(mailbox.list("worker-1").map((message) => message.content)).toEqual([
      "critical",
      "high",
      "normal",
    ]);
  });

  it("filters by type/topic and handles delivery", () => {
    const mailbox = new PriorityMailbox();
    const msg = mailbox.send({
      from: "worker-1",
      to: "orchestrator",
      content: "need context",
      type: "needs_context",
      topic: "context",
    });
    mailbox.send({
      from: "worker-1",
      to: "orchestrator",
      content: "progress update",
      type: "progress",
      topic: "status",
    });

    expect(mailbox.listByType("orchestrator", "needs_context")).toHaveLength(1);
    expect(mailbox.listByTopic("orchestrator", "context")).toHaveLength(1);

    mailbox.markDelivered(msg.id);
    expect(mailbox.list("orchestrator")).toHaveLength(1);
    expect(mailbox.list("orchestrator", { includeDelivered: true })).toHaveLength(
      2
    );
  });

  it("prunes expired TTL messages", async () => {
    const mailbox = new PriorityMailbox();
    mailbox.send({
      from: "orchestrator",
      to: "worker-1",
      content: "short lived",
      ttlMs: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    const removed = mailbox.pruneExpired();
    expect(removed).toBe(1);
    expect(mailbox.list("worker-1")).toHaveLength(0);
  });
});
