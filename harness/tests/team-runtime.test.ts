import { Team } from "../teams/team";
import { TeamEventBus } from "../teams/events";
import { ChatResponse, LLMProvider } from "../providers/types";

function createSequencedProvider(
  name: string,
  responses: ChatResponse[]
): LLMProvider {
  const queue = [...responses];
  return {
    name,
    chat: jest.fn().mockImplementation(async () => {
      if (queue.length === 0) {
        throw new Error(`${name} mock provider exhausted`);
      }
      return queue.shift() as ChatResponse;
    }),
  };
}

describe("Team runtime integration", () => {
  it("preserves default team behavior when MVP runtime flags are off", async () => {
    const orchestratorProvider = createSequencedProvider("orchestrator-default", [
      {
        textBlocks: [
          JSON.stringify([
            {
              id: "t1",
              description: "Write a single sentence summary",
              status: "pending",
            },
          ]),
        ],
        toolCalls: [],
        stopReason: "end_turn",
      },
      {
        textBlocks: ["Summary complete."],
        toolCalls: [],
        stopReason: "end_turn",
      },
    ]);

    const workerProvider = createSequencedProvider("worker-default", [
      {
        textBlocks: ["Task complete."],
        toolCalls: [],
        stopReason: "end_turn",
      },
    ]);

    const team = new Team({
      name: "default-runtime-team",
      orchestratorProvider,
      workerProvider,
      maxWorkers: 1,
    });

    const result = await team.run("produce one summary task");
    expect(result.success).toBe(true);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].status).toBe("done");
    expect(result.rolloutGates).toBeUndefined();
    expect(result.runtimeEvents && result.runtimeEvents.length).toBeGreaterThan(0);
    expect(result.runtimeState?.phase).toBe("completed");
  });

  it("emits regression gate report when runtime flags are enabled", async () => {
    const orchestratorProvider = createSequencedProvider("orchestrator-flags", [
      {
        textBlocks: [
          JSON.stringify([
            {
              id: "t1",
              description: "Task one",
              status: "pending",
            },
            {
              id: "t2",
              description: "Task two depends on t1",
              blockedBy: ["t1"],
              status: "pending",
            },
          ]),
        ],
        toolCalls: [],
        stopReason: "end_turn",
      },
      {
        textBlocks: ["All tasks complete."],
        toolCalls: [],
        stopReason: "end_turn",
      },
    ]);

    const workerProvider = createSequencedProvider("worker-flags", [
      {
        textBlocks: ["Task one complete."],
        toolCalls: [],
        stopReason: "end_turn",
      },
      {
        textBlocks: ["Task two complete."],
        toolCalls: [],
        stopReason: "end_turn",
      },
    ]);

    const team = new Team({
      name: "flagged-runtime-team",
      orchestratorProvider,
      workerProvider,
      maxWorkers: 1,
      runtimeFeatureFlags: {
        mutableGraphEnabled: true,
        reconcileEnabled: true,
        priorityMailboxEnabled: true,
        traceReplayEnabled: true,
        regressionGatesEnabled: true,
        trustGatingEnabled: true,
      },
    });

    const result = await team.run("run two sequenced tasks");
    expect(result.success).toBe(true);
    expect(result.tasks.map((task) => task.status)).toEqual(["done", "done"]);
    expect(result.rolloutGates).toBeDefined();
    expect(result.rolloutGates?.passed).toBe(true);
    expect(
      result.runtimeEvents?.some(
        (event) => event.type === "regression_gate_evaluated"
      )
    ).toBe(true);
  });

  it("claims and executes parallel batches when maxWorkers > 1", async () => {
    const orchestratorProvider = createSequencedProvider("orchestrator-parallel", [
      {
        textBlocks: [
          JSON.stringify([
            { id: "t1", description: "Task one", status: "pending" },
            { id: "t2", description: "Task two", status: "pending" },
          ]),
        ],
        toolCalls: [],
        stopReason: "end_turn",
      },
      {
        textBlocks: ["Parallel summary complete."],
        toolCalls: [],
        stopReason: "end_turn",
      },
    ]);

    const workerProvider = createSequencedProvider("worker-parallel", [
      {
        textBlocks: ["Task one complete."],
        toolCalls: [],
        stopReason: "end_turn",
      },
      {
        textBlocks: ["Task two complete."],
        toolCalls: [],
        stopReason: "end_turn",
      },
    ]);

    const team = new Team({
      name: "parallel-runtime-team",
      orchestratorProvider,
      workerProvider,
      maxWorkers: 2,
    });

    const result = await team.run("run two independent tasks in parallel");
    expect(result.success).toBe(true);
    expect(result.tasks.map((task) => task.status)).toEqual(["done", "done"]);
    const batchEvents =
      result.runtimeEvents?.filter((event) => event.type === "batch_claimed") ?? [];
    expect(batchEvents.length).toBeGreaterThan(0);
    expect(batchEvents[0]?.payload?.size).toBe(2);
    expect((workerProvider.chat as jest.Mock).mock.calls.length).toBe(2);
  });

  it("emits cap_reached with triggerSource payload on policy cap violations", async () => {
    const emitSpy = jest.spyOn(TeamEventBus.prototype, "emit");
    const orchestratorProvider = createSequencedProvider("orchestrator-cap", [
      {
        textBlocks: [
          JSON.stringify([{ id: "t1", description: "Task one", status: "pending" }]),
        ],
        toolCalls: [],
        stopReason: "end_turn",
      },
    ]);
    const workerProvider = createSequencedProvider("worker-cap", []);

    const team = new Team({
      name: "cap-runtime-team",
      orchestratorProvider,
      workerProvider,
      maxWorkers: 2,
      triggerSource: "slash",
      runtimeSafetyCaps: { maxWorkers: 1 },
    });

    await expect(team.run("trigger worker cap")).rejects.toThrow(
      /Worker cap reached/i
    );

    const capReachedCall = emitSpy.mock.calls.find(
      (call) => call[0] === "cap_reached"
    );
    expect(capReachedCall).toBeDefined();
    expect(capReachedCall?.[2]).toMatchObject({
      cap: "maxWorkers",
      triggerSource: "slash",
    });
    emitSpy.mockRestore();
  });

  it("wires tasklist tools into worker runtime tool schemas", async () => {
    const orchestratorProvider = createSequencedProvider("orchestrator-tasklist", [
      {
        textBlocks: [
          JSON.stringify([
            { id: "t1", description: "Inspect tasks and report", status: "pending" },
          ]),
        ],
        toolCalls: [],
        stopReason: "end_turn",
      },
      {
        textBlocks: ["Tasklist summary complete."],
        toolCalls: [],
        stopReason: "end_turn",
      },
    ]);

    const workerProvider = createSequencedProvider("worker-tasklist", [
      {
        textBlocks: [],
        toolCalls: [{ id: "tool-1", name: "list_tasks", input: {} }],
        stopReason: "tool_use",
      },
      {
        textBlocks: ["Used tasklist successfully."],
        toolCalls: [],
        stopReason: "end_turn",
      },
    ]);

    const team = new Team({
      name: "tasklist-runtime-team",
      orchestratorProvider,
      workerProvider,
      maxWorkers: 1,
    });

    const result = await team.run("use tasklist");
    expect(result.success).toBe(true);
    expect(result.tasks[0]?.status).toBe("done");

    const firstWorkerRequest = (workerProvider.chat as jest.Mock).mock.calls[0]?.[0];
    const toolNames = (firstWorkerRequest?.tools ?? []).map(
      (tool: { name: string }) => tool.name
    );
    expect(toolNames).toContain("list_tasks");
    expect(toolNames).toContain("get_task");
    expect(toolNames).toContain("submit_result");
  });
});
