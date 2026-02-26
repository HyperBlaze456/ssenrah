import { HarnessEvent, summarizeHarnessEventTypes } from "../harness/events";

function event(type: HarnessEvent["type"]): HarnessEvent {
  return {
    timestamp: "2026-02-26T00:00:00.000Z",
    type,
    agentId: "agent-1",
    data: {},
  };
}

describe("event schema compatibility", () => {
  it("summarizes legacy event streams that only contain pre-policy types", () => {
    const summary = summarizeHarnessEventTypes([
      event("intent"),
      event("tool_call"),
      event("tool_result"),
      event("error"),
    ]);

    expect(summary.knownCounts.intent).toBe(1);
    expect(summary.knownCounts.tool_call).toBe(1);
    expect(summary.knownCounts.tool_result).toBe(1);
    expect(summary.knownCounts.error).toBe(1);
    expect(summary.knownCounts.policy).toBe(0);
    expect(summary.knownCounts.turn_result).toBe(0);
    expect(summary.unknownCount).toBe(0);
    expect(summary.unknownTypes).toEqual([]);
  });

  it("summarizes newer event streams with policy and turn_result events", () => {
    const summary = summarizeHarnessEventTypes([
      event("intent"),
      event("policy"),
      event("tool_call"),
      event("tool_result"),
      event("turn_result"),
    ]);

    expect(summary.knownCounts.intent).toBe(1);
    expect(summary.knownCounts.policy).toBe(1);
    expect(summary.knownCounts.turn_result).toBe(1);
    expect(summary.unknownCount).toBe(0);
  });

  it("groups unknown event types without failing", () => {
    const summary = summarizeHarnessEventTypes([
      event("intent"),
      event("approval_prompted"),
      event("approval_prompted"),
      event("audit_timeline"),
    ]);

    expect(summary.knownCounts.intent).toBe(1);
    expect(summary.unknownCount).toBe(3);
    expect(summary.unknownTypes).toEqual([
      "approval_prompted",
      "audit_timeline",
    ]);
  });
});
