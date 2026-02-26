import { Team } from "../teams/team";
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
});
