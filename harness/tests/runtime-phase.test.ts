import {
  assertValidRuntimePhaseTransition,
  canTransitionRuntimePhase,
  getAllowedRuntimePhaseTransitions,
  InvalidRuntimePhaseTransitionError,
  isTerminalRuntimePhase,
  RuntimePhaseMachine,
} from "../harness/runtime-phase";

describe("runtime phase transition helpers", () => {
  it("returns deterministic allowed transitions per phase", () => {
    expect(getAllowedRuntimePhaseTransitions("planning")).toEqual(["executing", "await_user", "failed"]);
    expect(getAllowedRuntimePhaseTransitions("executing")).toEqual(["reconciling", "await_user", "failed"]);
    expect(getAllowedRuntimePhaseTransitions("reconciling")).toEqual([
      "planning",
      "await_user",
      "failed",
      "completed",
    ]);
    expect(getAllowedRuntimePhaseTransitions("await_user")).toEqual(["planning", "failed"]);
    expect(getAllowedRuntimePhaseTransitions("failed")).toEqual([]);
    expect(getAllowedRuntimePhaseTransitions("completed")).toEqual([]);
  });

  it("validates legal and illegal transitions deterministically", () => {
    expect(canTransitionRuntimePhase("planning", "executing")).toBe(true);
    expect(canTransitionRuntimePhase("executing", "reconciling")).toBe(true);
    expect(canTransitionRuntimePhase("reconciling", "completed")).toBe(true);

    expect(canTransitionRuntimePhase("planning", "completed")).toBe(false);
    expect(canTransitionRuntimePhase("await_user", "executing")).toBe(false);
    expect(canTransitionRuntimePhase("completed", "planning")).toBe(false);
  });

  it("throws clear transition errors for invalid transitions", () => {
    expect(() => assertValidRuntimePhaseTransition("planning", "completed")).toThrow(
      'Invalid runtime phase transition: "planning" -> "completed". Allowed transitions from "planning": executing, await_user, failed.'
    );

    expect(() => assertValidRuntimePhaseTransition("completed", "planning")).toThrow(
      'Invalid runtime phase transition: "completed" -> "planning". Allowed transitions from "completed": none (terminal phase).'
    );
  });

  it("marks failed and completed as terminal phases", () => {
    expect(isTerminalRuntimePhase("planning")).toBe(false);
    expect(isTerminalRuntimePhase("await_user")).toBe(false);
    expect(isTerminalRuntimePhase("failed")).toBe(true);
    expect(isTerminalRuntimePhase("completed")).toBe(true);
  });
});

describe("RuntimePhaseMachine", () => {
  it("walks a valid deterministic phase path", () => {
    const machine = new RuntimePhaseMachine();

    expect(machine.currentPhase).toBe("planning");
    expect(machine.transitionTo("executing")).toBe("executing");
    expect(machine.transitionTo("reconciling")).toBe("reconciling");
    expect(machine.transitionTo("planning")).toBe("planning");
    expect(machine.transitionTo("await_user")).toBe("await_user");
    expect(machine.transitionTo("planning")).toBe("planning");
    expect(machine.transitionTo("executing")).toBe("executing");
    expect(machine.transitionTo("reconciling")).toBe("reconciling");
    expect(machine.transitionTo("completed")).toBe("completed");

    expect(machine.isTerminal()).toBe(true);
    expect(machine.getAllowedTransitions()).toEqual([]);
  });

  it("throws InvalidRuntimePhaseTransitionError and preserves state when invalid", () => {
    const machine = new RuntimePhaseMachine("await_user");

    expect(() => machine.transitionTo("completed")).toThrow(InvalidRuntimePhaseTransitionError);
    expect(machine.currentPhase).toBe("await_user");
  });
});
