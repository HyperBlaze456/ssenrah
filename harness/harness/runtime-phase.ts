export type RuntimePhase =
  | "planning"
  | "executing"
  | "reconciling"
  | "await_user"
  | "failed"
  | "completed";

export const RUNTIME_PHASE_TRANSITIONS: Readonly<Record<RuntimePhase, readonly RuntimePhase[]>> = {
  planning: ["executing", "await_user", "failed"],
  executing: ["reconciling", "await_user", "failed"],
  reconciling: ["planning", "await_user", "failed", "completed"],
  await_user: ["planning", "failed"],
  failed: [],
  completed: [],
};

export class InvalidRuntimePhaseTransitionError extends Error {
  readonly from: RuntimePhase;
  readonly to: RuntimePhase;
  readonly allowedTransitions: readonly RuntimePhase[];

  constructor(from: RuntimePhase, to: RuntimePhase, allowedTransitions: readonly RuntimePhase[]) {
    const allowed = allowedTransitions.length > 0 ? allowedTransitions.join(", ") : "none (terminal phase)";
    super(
      `Invalid runtime phase transition: "${from}" -> "${to}". Allowed transitions from "${from}": ${allowed}.`
    );
    this.name = "InvalidRuntimePhaseTransitionError";
    this.from = from;
    this.to = to;
    this.allowedTransitions = allowedTransitions;
  }
}

export function getAllowedRuntimePhaseTransitions(phase: RuntimePhase): readonly RuntimePhase[] {
  return RUNTIME_PHASE_TRANSITIONS[phase];
}

export function canTransitionRuntimePhase(from: RuntimePhase, to: RuntimePhase): boolean {
  return RUNTIME_PHASE_TRANSITIONS[from].includes(to);
}

export function assertValidRuntimePhaseTransition(from: RuntimePhase, to: RuntimePhase): void {
  const allowedTransitions = getAllowedRuntimePhaseTransitions(from);
  if (!allowedTransitions.includes(to)) {
    throw new InvalidRuntimePhaseTransitionError(from, to, allowedTransitions);
  }
}

export function isTerminalRuntimePhase(phase: RuntimePhase): boolean {
  return RUNTIME_PHASE_TRANSITIONS[phase].length === 0;
}

export class RuntimePhaseMachine {
  private phase: RuntimePhase;

  constructor(initialPhase: RuntimePhase = "planning") {
    this.phase = initialPhase;
  }

  get currentPhase(): RuntimePhase {
    return this.phase;
  }

  getAllowedTransitions(): readonly RuntimePhase[] {
    return getAllowedRuntimePhaseTransitions(this.phase);
  }

  canTransitionTo(nextPhase: RuntimePhase): boolean {
    return canTransitionRuntimePhase(this.phase, nextPhase);
  }

  isTerminal(): boolean {
    return isTerminalRuntimePhase(this.phase);
  }

  transitionTo(nextPhase: RuntimePhase): RuntimePhase {
    assertValidRuntimePhaseTransition(this.phase, nextPhase);
    this.phase = nextPhase;
    return this.phase;
  }
}
