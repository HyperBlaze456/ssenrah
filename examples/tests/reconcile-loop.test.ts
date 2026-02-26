import { PriorityMailbox } from "../teams/priority-mailbox";
import { RuntimePolicy } from "../teams/policy";
import { ReconcileLoop } from "../teams/reconcile";
import { TeamStateTracker } from "../teams/state";

describe("ReconcileLoop", () => {
  it("returns noop when reconcile flag is disabled", () => {
    const policy = new RuntimePolicy({ reconcileEnabled: false });
    const mailbox = new PriorityMailbox();
    const state = new TeamStateTracker({ runId: "run-1", goal: "test goal" });
    const loop = new ReconcileLoop({ policy, mailbox, state });

    const decision = loop.run({
      trigger: "task_resolved",
      pendingTaskCount: 1,
    });

    expect(decision.actions).toEqual([
      { type: "noop", reason: "reconcile feature flag disabled" },
    ]);
    expect(mailbox.getAll()).toHaveLength(0);
  });

  it("routes needs_context + stale-heartbeat events through priority mailbox", () => {
    const policy = new RuntimePolicy(
      { reconcileEnabled: true },
      { heartbeatStalenessMs: 10 }
    );
    const mailbox = new PriorityMailbox();
    const state = new TeamStateTracker({ runId: "run-2", goal: "test goal" });
    const loop = new ReconcileLoop({ policy, mailbox, state });

    state.upsertHeartbeat({
      workerId: "worker-1",
      status: "busy",
      taskId: "t1",
      attempt: 1,
    });

    const now = new Date(Date.now() + 50);
    const decision = loop.run({
      trigger: "heartbeat_stale",
      pendingTaskCount: 1,
      now,
      needsContext: [
        {
          workerId: "worker-2",
          taskId: "t2",
          detail: "Need repo architecture context",
        },
      ],
    });

    expect(decision.actions.some((action) => action.type === "request_context")).toBe(
      true
    );
    expect(decision.actions.some((action) => action.type === "escalate_user")).toBe(
      true
    );
    expect(mailbox.list("orchestrator", { includeDelivered: true }).length).toBe(2);
    expect(
      mailbox.listByType("orchestrator", "needs_context")[0]?.priority
    ).toBe("high");
    expect(mailbox.listByType("orchestrator", "heartbeat")[0]?.priority).toBe(
      "critical"
    );
  });
});
