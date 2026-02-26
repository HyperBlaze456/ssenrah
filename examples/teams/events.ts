export type TeamRuntimeEventType =
  | "run_started"
  | "plan_created"
  | "batch_claimed"
  | "task_resolved"
  | "tasks_dependency_failed"
  | "worker_attempt_started"
  | "worker_attempt_finished"
  | "worker_restarted"
  | "phase_changed"
  | "patch_requested"
  | "patch_applied"
  | "patch_rejected"
  | "reconcile_started"
  | "reconcile_completed"
  | "heartbeat_received"
  | "heartbeat_stale"
  | "policy_enforced"
  | "cap_reached"
  | "trace_replayed"
  | "regression_gate_evaluated"
  | "run_completed"
  | "run_failed";

export interface TeamRuntimeEvent {
  id: string;
  schemaVersion: number;
  type: TeamRuntimeEventType;
  actor: string;
  timestamp: Date;
  graphVersion?: number;
  expectedVersion?: number;
  payload?: Record<string, unknown>;
}

export type TeamRuntimeEventListener = (event: TeamRuntimeEvent) => void;

interface EmitMeta {
  graphVersion?: number;
  expectedVersion?: number;
}

/**
 * In-memory runtime event stream.
 */
export class TeamEventBus {
  private events: TeamRuntimeEvent[] = [];
  private listeners = new Set<TeamRuntimeEventListener>();
  private seq = 0;

  emit(
    type: TeamRuntimeEventType,
    actor: string,
    payload?: Record<string, unknown>,
    meta?: EmitMeta
  ): TeamRuntimeEvent {
    const event: TeamRuntimeEvent = {
      id: `evt-${++this.seq}`,
      schemaVersion: 1,
      type,
      actor,
      timestamp: new Date(),
      graphVersion: meta?.graphVersion,
      expectedVersion: meta?.expectedVersion,
      payload: payload ? { ...payload } : undefined,
    };

    this.events.push(event);
    for (const listener of this.listeners) {
      listener(this.clone(event));
    }
    return this.clone(event);
  }

  list(): TeamRuntimeEvent[] {
    return this.events.map((event) => this.clone(event));
  }

  clear(): void {
    this.events = [];
    this.seq = 0;
  }

  subscribe(listener: TeamRuntimeEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private clone(event: TeamRuntimeEvent): TeamRuntimeEvent {
    return {
      ...event,
      timestamp: new Date(event.timestamp),
      payload: event.payload ? { ...event.payload } : undefined,
    };
  }
}
