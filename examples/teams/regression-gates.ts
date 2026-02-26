export interface RegressionGate {
  name: string;
  passed: boolean;
  details?: string;
}

export interface RolloutGateReport {
  phase: "mvp";
  passed: boolean;
  evaluatedAt: Date;
  gates: RegressionGate[];
}

export interface EvaluateMvpGateInput {
  replayEquivalent: boolean;
  capEnforcementActive: boolean;
  heartbeatPolicyActive: boolean;
  trustGatingActive: boolean;
  mutableGraphEnabled: boolean;
  reconcileEnabled: boolean;
}

/**
 * MVP regression gates used before enabling higher-autonomy phases.
 */
export function evaluateMvpRegressionGates(
  input: EvaluateMvpGateInput
): RolloutGateReport {
  const gates: RegressionGate[] = [
    {
      name: "mutable_graph_enabled",
      passed: input.mutableGraphEnabled,
      details:
        "Feature flag mutableGraphEnabled must be on for MVP mutate/replay checks",
    },
    {
      name: "reconcile_loop_enabled",
      passed: input.reconcileEnabled,
      details: "Feature flag reconcileEnabled must be on for adaptive planning",
    },
    {
      name: "replay_equivalence",
      passed: input.replayEquivalent,
      details: "Replayed patches must match final task-state snapshot",
    },
    {
      name: "cap_enforcement_active",
      passed: input.capEnforcementActive,
      details: "Runtime policy caps must be checked during execution",
    },
    {
      name: "heartbeat_policy_active",
      passed: input.heartbeatPolicyActive,
      details: "Heartbeat stale detection policy must be configured",
    },
    {
      name: "trust_gating_active",
      passed: input.trustGatingActive,
      details:
        "Trust-gated extensibility must be active before expansion",
    },
  ];

  return {
    phase: "mvp",
    passed: gates.every((gate) => gate.passed),
    evaluatedAt: new Date(),
    gates,
  };
}
