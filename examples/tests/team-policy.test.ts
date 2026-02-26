import { RuntimePolicy } from "../teams/policy";

describe("team runtime policy contract", () => {
  it("enforces deterministic transitions", () => {
    const policy = new RuntimePolicy();
    expect(policy.getPhase()).toBe("idle");
    policy.transition("planning");
    policy.transition("executing");
    policy.transition("synthesizing");
    policy.transition("completed");
    policy.transition("idle");
    expect(policy.getPhase()).toBe("idle");
  });

  it("throws on illegal transitions", () => {
    const policy = new RuntimePolicy();
    expect(() => policy.transition("completed")).toThrow(/Illegal transition/i);
  });

  it("enforces cap rules", () => {
    const policy = new RuntimePolicy(undefined, { maxTasks: 1, maxWorkers: 1 });
    expect(() => policy.enforceTaskCap(1)).toThrow(/Task cap reached/i);
    expect(() => policy.enforceWorkerCap(2)).toThrow(/Worker cap reached/i);
  });

  it("trust-gates extension capabilities", () => {
    const policy = new RuntimePolicy({ trustGatingEnabled: true });

    expect(() =>
      policy.assertExtensionAllowed(
        {
          name: "safe-observer",
          version: "1.0.0",
          trustRequired: "workspace",
          capabilities: ["read", "trace"],
        },
        "workspace"
      )
    ).not.toThrow();

    expect(() =>
      policy.assertExtensionAllowed(
        {
          name: "exec-plugin",
          version: "1.0.0",
          trustRequired: "workspace",
          capabilities: ["exec"],
        },
        "untrusted"
      )
    ).toThrow(/requires trust|blocks extension capability/i);
  });
});
