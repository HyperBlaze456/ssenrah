import { evaluateMvpRegressionGates } from "../teams/regression-gates";

describe("MVP regression gates", () => {
  it("passes only when all gate signals are true", () => {
    const passed = evaluateMvpRegressionGates({
      replayEquivalent: true,
      capEnforcementActive: true,
      heartbeatPolicyActive: true,
      trustGatingActive: true,
      mutableGraphEnabled: true,
      reconcileEnabled: true,
    });
    expect(passed.passed).toBe(true);
    expect(passed.gates.every((gate) => gate.passed)).toBe(true);

    const failed = evaluateMvpRegressionGates({
      replayEquivalent: true,
      capEnforcementActive: false,
      heartbeatPolicyActive: true,
      trustGatingActive: true,
      mutableGraphEnabled: true,
      reconcileEnabled: true,
    });
    expect(failed.passed).toBe(false);
    expect(failed.gates.find((gate) => gate.name === "cap_enforcement_active")?.passed).toBe(false);
  });
});
