import { createTaskTools } from "../tools/task-tools";
import { TaskGraph } from "../teams/task-graph";
import type { TeamTask } from "../teams/types";

function createTestGraph(): TaskGraph {
  const tasks: TeamTask[] = [
    { id: "t1", description: "First task", status: "pending" },
    { id: "t2", description: "Second task", status: "pending", blockedBy: ["t1"] },
  ];
  return new TaskGraph(tasks);
}

describe("Task tools", () => {
  describe("role gating", () => {
    it("workers get list_tasks, get_task, submit_result", () => {
      const graph = createTestGraph();
      const tools = createTaskTools({
        taskGraph: graph,
        actorId: "worker-1",
        isOrchestrator: false,
      });

      const names = tools.map((t) => t.name);
      expect(names).toContain("list_tasks");
      expect(names).toContain("get_task");
      expect(names).toContain("submit_result");
      expect(names).not.toContain("create_task");
      expect(names).not.toContain("complete_task");
      expect(names).not.toContain("reject_task");
    });

    it("orchestrator gets list_tasks, get_task, create_task, complete_task, reject_task", () => {
      const graph = createTestGraph();
      const tools = createTaskTools({
        taskGraph: graph,
        actorId: "orchestrator",
        isOrchestrator: true,
      });

      const names = tools.map((t) => t.name);
      expect(names).toContain("list_tasks");
      expect(names).toContain("get_task");
      expect(names).toContain("create_task");
      expect(names).toContain("complete_task");
      expect(names).toContain("reject_task");
      expect(names).not.toContain("submit_result");
    });
  });

  describe("list_tasks", () => {
    it("lists all tasks with status", async () => {
      const graph = createTestGraph();
      const tools = createTaskTools({
        taskGraph: graph,
        actorId: "worker-1",
      });

      const listTool = tools.find((t) => t.name === "list_tasks")!;
      const result = await listTool.run({});

      expect(result).toContain("t1");
      expect(result).toContain("t2");
      expect(result).toContain("pending");
    });
  });

  describe("get_task", () => {
    it("returns task details as JSON", async () => {
      const graph = createTestGraph();
      const tools = createTaskTools({
        taskGraph: graph,
        actorId: "worker-1",
      });

      const getTool = tools.find((t) => t.name === "get_task")!;
      const result = await getTool.run({ taskId: "t1" });
      const parsed = JSON.parse(result);

      expect(parsed.id).toBe("t1");
      expect(parsed.description).toBe("First task");
    });

    it("returns error for unknown task", async () => {
      const graph = createTestGraph();
      const tools = createTaskTools({
        taskGraph: graph,
        actorId: "worker-1",
      });

      const getTool = tools.find((t) => t.name === "get_task")!;
      const result = await getTool.run({ taskId: "unknown" });

      expect(result).toContain("Error");
      expect(result).toContain("not found");
    });
  });

  describe("submit_result (worker)", () => {
    it("submits result for an in_progress task", async () => {
      const graph = createTestGraph();
      graph.claimReadyTasks(1); // t1 → in_progress

      const tools = createTaskTools({
        taskGraph: graph,
        actorId: "worker-1",
        isOrchestrator: false,
      });

      const submitTool = tools.find((t) => t.name === "submit_result")!;
      const result = await submitTool.run({
        taskId: "t1",
        result: "Work completed",
      });

      expect(result).toContain("Result submitted");
      expect(result).toContain("Awaiting orchestrator review");
    });

    it("returns error when orchestrator tries to submit", async () => {
      const graph = createTestGraph();
      graph.claimReadyTasks(1);

      // Orchestrator tools don't include submit_result
      const tools = createTaskTools({
        taskGraph: graph,
        actorId: "orchestrator",
        isOrchestrator: true,
      });

      const submitTool = tools.find((t) => t.name === "submit_result");
      expect(submitTool).toBeUndefined();
    });
  });

  describe("create_task (orchestrator)", () => {
    it("creates a new task", async () => {
      const graph = createTestGraph();
      const tools = createTaskTools({
        taskGraph: graph,
        actorId: "orchestrator",
        isOrchestrator: true,
      });

      const createTool = tools.find((t) => t.name === "create_task")!;
      const result = await createTool.run({
        id: "t3",
        description: "New task",
      });

      expect(result).toContain("created successfully");
      expect(graph.getTasks()).toHaveLength(3);
    });

    it("returns error when worker tries to create", async () => {
      const graph = createTestGraph();
      const tools = createTaskTools({
        taskGraph: graph,
        actorId: "worker-1",
        isOrchestrator: false,
      });

      // Workers don't have create_task tool at all
      const createTool = tools.find((t) => t.name === "create_task");
      expect(createTool).toBeUndefined();
    });
  });

  describe("complete_task (orchestrator)", () => {
    it("completes a task with submitted result", async () => {
      const graph = createTestGraph();
      graph.claimReadyTasks(1);
      graph.submitResult("t1", "Work done");

      const tools = createTaskTools({
        taskGraph: graph,
        actorId: "orchestrator",
        isOrchestrator: true,
      });

      const completeTool = tools.find((t) => t.name === "complete_task")!;
      const result = await completeTool.run({ taskId: "t1" });

      expect(result).toContain("marked as done");
    });

    it("returns error when worker tries to complete", async () => {
      const graph = createTestGraph();
      graph.claimReadyTasks(1);
      graph.submitResult("t1", "Work done");

      const tools = createTaskTools({
        taskGraph: graph,
        actorId: "worker-1",
        isOrchestrator: false,
      });

      const completeTool = tools.find((t) => t.name === "complete_task");
      expect(completeTool).toBeUndefined();
    });
  });

  describe("reject_task (orchestrator)", () => {
    it("rejects a task with reason", async () => {
      const graph = createTestGraph();
      graph.claimReadyTasks(1);
      graph.submitResult("t1", "bad work");

      const tools = createTaskTools({
        taskGraph: graph,
        actorId: "orchestrator",
        isOrchestrator: true,
      });

      const rejectTool = tools.find((t) => t.name === "reject_task")!;
      const result = await rejectTool.run({
        taskId: "t1",
        reason: "Quality insufficient",
      });

      expect(result).toContain("rejected");
      expect(result).toContain("deferred");
    });

    it("returns error when worker tries to reject", async () => {
      const graph = createTestGraph();

      const tools = createTaskTools({
        taskGraph: graph,
        actorId: "worker-1",
        isOrchestrator: false,
      });

      const rejectTool = tools.find((t) => t.name === "reject_task");
      expect(rejectTool).toBeUndefined();
    });
  });
});
