import { TaskGraph } from "../teams/task-graph";
import type { TeamTask } from "../teams/types";

function createBasicTasks(): TeamTask[] {
  return [
    { id: "t1", description: "Task 1", status: "pending" },
    { id: "t2", description: "Task 2", status: "pending", blockedBy: ["t1"] },
  ];
}

describe("TaskGraph review flow", () => {
  describe("submitResult", () => {
    it("sets result without changing status from in_progress", () => {
      const graph = new TaskGraph(createBasicTasks());
      graph.claimReadyTasks(1); // t1 → in_progress

      const updated = graph.submitResult("t1", "Work done here");

      expect(updated.status).toBe("in_progress");
      expect(updated.result).toBe("Work done here");
    });

    it("overwrites previous result on resubmission", () => {
      const graph = new TaskGraph(createBasicTasks());
      graph.claimReadyTasks(1);

      graph.submitResult("t1", "First attempt");
      const updated = graph.submitResult("t1", "Second attempt");

      expect(updated.result).toBe("Second attempt");
      expect(updated.status).toBe("in_progress");
    });

    it("throws for unknown task", () => {
      const graph = new TaskGraph(createBasicTasks());

      expect(() => graph.submitResult("unknown", "result")).toThrow(
        "unknown task"
      );
    });

    it("throws for task not in in_progress status", () => {
      const graph = new TaskGraph(createBasicTasks());
      // t1 is still "pending"

      expect(() => graph.submitResult("t1", "result")).toThrow(
        "must be in_progress"
      );
    });
  });

  describe("completeTask", () => {
    it("marks task as done when result has been submitted", () => {
      const graph = new TaskGraph(createBasicTasks());
      graph.claimReadyTasks(1);
      graph.submitResult("t1", "Work done");

      const updated = graph.completeTask("t1");

      expect(updated.status).toBe("done");
      expect(updated.result).toBe("Work done");
      expect(updated.completedAt).toBeDefined();
    });

    it("throws when no result has been submitted", () => {
      const graph = new TaskGraph(createBasicTasks());
      graph.claimReadyTasks(1); // in_progress but no result

      expect(() => graph.completeTask("t1")).toThrow(
        "without a submitted result"
      );
    });

    it("throws for task not in in_progress status", () => {
      const graph = new TaskGraph(createBasicTasks());

      expect(() => graph.completeTask("t1")).toThrow("must be in_progress");
    });

    it("throws for unknown task", () => {
      const graph = new TaskGraph(createBasicTasks());

      expect(() => graph.completeTask("unknown")).toThrow("unknown task");
    });

    it("unblocks dependent tasks after completion", () => {
      const graph = new TaskGraph(createBasicTasks());
      graph.claimReadyTasks(1); // t1 → in_progress
      graph.submitResult("t1", "done");
      graph.completeTask("t1");

      // t2 should now be claimable since t1 is done
      const batch = graph.claimReadyTasks(1);
      expect(batch).toHaveLength(1);
      expect(batch[0].id).toBe("t2");
    });
  });

  describe("rejectTask", () => {
    it("sets status to deferred (not failed)", () => {
      const graph = new TaskGraph(createBasicTasks());
      graph.claimReadyTasks(1);
      graph.submitResult("t1", "bad work");

      const updated = graph.rejectTask("t1", "Quality too low");

      expect(updated.status).toBe("deferred");
      expect(updated.error).toBe("Quality too low");
    });

    it("clears the submitted result on rejection", () => {
      const graph = new TaskGraph(createBasicTasks());
      graph.claimReadyTasks(1);
      graph.submitResult("t1", "bad work");

      const updated = graph.rejectTask("t1", "Rejected");

      expect(updated.result).toBeUndefined();
    });

    it("throws for task not in in_progress status", () => {
      const graph = new TaskGraph(createBasicTasks());

      expect(() => graph.rejectTask("t1", "reason")).toThrow(
        "must be in_progress"
      );
    });

    it("throws for unknown task", () => {
      const graph = new TaskGraph(createBasicTasks());

      expect(() => graph.rejectTask("unknown", "reason")).toThrow(
        "unknown task"
      );
    });
  });

  describe("requeueTask", () => {
    it("moves deferred task back to pending", () => {
      const graph = new TaskGraph(createBasicTasks());
      graph.claimReadyTasks(1);
      graph.submitResult("t1", "bad");
      graph.rejectTask("t1", "Rejected");

      const updated = graph.requeueTask("t1");

      expect(updated.status).toBe("pending");
      expect(updated.error).toBeUndefined();
      expect(updated.result).toBeUndefined();
      expect(updated.assignedTo).toBeUndefined();
    });

    it("allows re-claiming after requeue", () => {
      const graph = new TaskGraph(createBasicTasks());
      graph.claimReadyTasks(1);
      graph.submitResult("t1", "bad");
      graph.rejectTask("t1", "Rejected");
      graph.requeueTask("t1");

      const batch = graph.claimReadyTasks(1);
      expect(batch).toHaveLength(1);
      expect(batch[0].id).toBe("t1");
      expect(batch[0].status).toBe("in_progress");
    });

    it("throws for non-deferred task", () => {
      const graph = new TaskGraph(createBasicTasks());

      expect(() => graph.requeueTask("t1")).toThrow("must be deferred");
    });

    it("throws for unknown task", () => {
      const graph = new TaskGraph(createBasicTasks());

      expect(() => graph.requeueTask("unknown")).toThrow("unknown task");
    });
  });

  describe("getAwaitingReview", () => {
    it("returns tasks that are in_progress with a result", () => {
      const graph = new TaskGraph(createBasicTasks());
      graph.claimReadyTasks(1);
      graph.submitResult("t1", "Result here");

      const awaiting = graph.getAwaitingReview();

      expect(awaiting).toHaveLength(1);
      expect(awaiting[0].id).toBe("t1");
      expect(awaiting[0].result).toBe("Result here");
    });

    it("does not include in_progress tasks without result", () => {
      const graph = new TaskGraph(createBasicTasks());
      graph.claimReadyTasks(1); // in_progress but no result

      const awaiting = graph.getAwaitingReview();
      expect(awaiting).toHaveLength(0);
    });

    it("does not include completed tasks", () => {
      const graph = new TaskGraph(createBasicTasks());
      graph.claimReadyTasks(1);
      graph.submitResult("t1", "done");
      graph.completeTask("t1");

      const awaiting = graph.getAwaitingReview();
      expect(awaiting).toHaveLength(0);
    });

    it("does not include deferred tasks", () => {
      const graph = new TaskGraph(createBasicTasks());
      graph.claimReadyTasks(1);
      graph.submitResult("t1", "bad");
      graph.rejectTask("t1", "rejected");

      const awaiting = graph.getAwaitingReview();
      expect(awaiting).toHaveLength(0);
    });
  });

  describe("deferred tasks and claimReadyTasks", () => {
    it("deferred tasks are NOT auto-claimed by claimReadyTasks", () => {
      const tasks: TeamTask[] = [
        { id: "t1", description: "Task 1", status: "pending" },
      ];
      const graph = new TaskGraph(tasks);
      graph.claimReadyTasks(1);
      graph.submitResult("t1", "bad");
      graph.rejectTask("t1", "rejected");

      // t1 is now "deferred" — should NOT be claimed
      const batch = graph.claimReadyTasks(1);
      expect(batch).toHaveLength(0);
    });
  });

  describe("patch versioning", () => {
    it("all new methods increment graph version", () => {
      const graph = new TaskGraph(createBasicTasks());
      const v0 = graph.getVersion();

      graph.claimReadyTasks(1);
      const v1 = graph.getVersion();
      expect(v1).toBeGreaterThan(v0);

      graph.submitResult("t1", "result");
      const v2 = graph.getVersion();
      expect(v2).toBeGreaterThan(v1);

      graph.completeTask("t1");
      const v3 = graph.getVersion();
      expect(v3).toBeGreaterThan(v2);
    });

    it("rejectTask and requeueTask increment versions", () => {
      const tasks: TeamTask[] = [
        { id: "t1", description: "Task 1", status: "pending" },
      ];
      const graph = new TaskGraph(tasks);
      graph.claimReadyTasks(1);
      graph.submitResult("t1", "bad");

      const vBefore = graph.getVersion();
      graph.rejectTask("t1", "rejected");
      expect(graph.getVersion()).toBeGreaterThan(vBefore);

      const vBeforeRequeue = graph.getVersion();
      graph.requeueTask("t1");
      expect(graph.getVersion()).toBeGreaterThan(vBeforeRequeue);
    });
  });
});
