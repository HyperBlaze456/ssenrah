import { TeamEventBus } from "../teams/events";
import { TeamStateTracker } from "../teams/state";
import {
  applyRetentionPolicy,
  createTeamStateSnapshot,
} from "../teams/retention";

describe("team retention policy", () => {
  function makeStateWithEvents(): TeamStateTracker {
    const state = new TeamStateTracker({
      runId: "run-retention",
      goal: "retention test",
    });
    state.setGraphVersion(2);
    state.setPhase("executing");
    state.setTasks([
      { id: "t1", description: "task1", status: "done" },
      { id: "t2", description: "task2", status: "pending", blockedBy: ["t1"] },
    ]);
    state.upsertHeartbeat({
      workerId: "worker-1",
      status: "busy",
      taskId: "t2",
      attempt: 1,
    });

    const bus = new TeamEventBus();
    state.addEvent(bus.emit("run_started", "team", { goal: "retention" }));
    state.addEvent(bus.emit("plan_created", "orchestrator", { taskCount: 2 }));
    state.addEvent(bus.emit("batch_claimed", "scheduler", { taskIds: ["t2"] }));
    state.addEvent(bus.emit("task_resolved", "scheduler", { taskId: "t1" }));
    state.addEvent(bus.emit("run_completed", "team", { success: false }));
    return state;
  }

  it("captures replay-linkable snapshot metadata", () => {
    const state = makeStateWithEvents().snapshot();
    const snapshot = createTeamStateSnapshot(state);

    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.runId).toBe("run-retention");
    expect(snapshot.graphVersion).toBe(2);
    expect(snapshot.taskCount).toBe(2);
    expect(snapshot.eventCount).toBe(5);
    expect(snapshot.lastEventId).toBe("evt-5");
    expect(snapshot.tasks[1].id).toBe("t2");
  });

  it("truncates to retained event tail and reports truncation count", () => {
    const state = makeStateWithEvents().snapshot();
    const result = applyRetentionPolicy(state, { retainLastEvents: 2 });

    expect(result.snapshot.eventCount).toBe(5);
    expect(result.retainedEvents).toHaveLength(2);
    expect(result.retainedEvents.map((event) => event.id)).toEqual([
      "evt-4",
      "evt-5",
    ]);
    expect(result.truncatedCount).toBe(3);
  });

  it("allows retaining zero events", () => {
    const state = makeStateWithEvents().snapshot();
    const result = applyRetentionPolicy(state, { retainLastEvents: 0 });
    expect(result.retainedEvents).toEqual([]);
    expect(result.truncatedCount).toBe(5);
  });

  it("rejects invalid retention policies", () => {
    const state = makeStateWithEvents().snapshot();
    expect(() =>
      applyRetentionPolicy(state, { retainLastEvents: -1 })
    ).toThrow(/retainLastEvents/i);
  });
});
