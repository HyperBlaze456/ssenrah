import { TeamRuntimeEvent } from "./events";
import { TeamTask } from "./types";

export type TeamPhase =
  | "planning"
  | "executing"
  | "reconciling"
  | "synthesizing"
  | "completed"
  | "failed"
  | "await_user";

export type ReconcileTrigger =
  | "initial_plan"
  | "batch_claimed"
  | "task_resolved"
  | "dependency_failure"
  | "worker_restarted"
  | "worker_failed"
  | "worker_completed"
  | "heartbeat_stale"
  | "run_completed"
  | "run_failed";

export interface WorkerHeartbeat {
  workerId: string;
  status: "idle" | "busy" | "restarting" | "done" | "failed";
  taskId?: string;
  attempt: number;
  detail?: string;
  updatedAt: Date;
}

export interface TeamRunState {
  runId: string;
  goal: string;
  phase: TeamPhase;
  iteration: number;
  graphVersion: number;
  startedAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  lastTrigger?: ReconcileTrigger;
  tasks: TeamTask[];
  heartbeats: WorkerHeartbeat[];
  events: TeamRuntimeEvent[];
}

interface TeamStateTrackerConfig {
  runId: string;
  goal: string;
}

/**
 * Mutable runtime state tracker for reconcile/trace workflows.
 */
export class TeamStateTracker {
  private state: TeamRunState;

  constructor(config: TeamStateTrackerConfig) {
    const now = new Date();
    this.state = {
      runId: config.runId,
      goal: config.goal,
      phase: "planning",
      iteration: 0,
      graphVersion: 0,
      startedAt: now,
      updatedAt: now,
      tasks: [],
      heartbeats: [],
      events: [],
    };
  }

  setPhase(phase: TeamPhase): void {
    this.state.phase = phase;
    this.touch();
  }

  setIteration(iteration: number): void {
    this.state.iteration = iteration;
    this.touch();
  }

  setGraphVersion(version: number): void {
    this.state.graphVersion = version;
    this.touch();
  }

  setLastTrigger(trigger: ReconcileTrigger): void {
    this.state.lastTrigger = trigger;
    this.touch();
  }

  setTasks(tasks: TeamTask[]): void {
    this.state.tasks = tasks.map((task) => ({ ...task }));
    this.touch();
  }

  upsertHeartbeat(heartbeat: Omit<WorkerHeartbeat, "updatedAt">): void {
    const next: WorkerHeartbeat = { ...heartbeat, updatedAt: new Date() };
    const index = this.state.heartbeats.findIndex(
      (existing) => existing.workerId === next.workerId
    );
    if (index === -1) {
      this.state.heartbeats.push(next);
    } else {
      this.state.heartbeats[index] = next;
    }
    this.touch();
  }

  getStaleHeartbeats(staleAfterMs: number, now = new Date()): WorkerHeartbeat[] {
    return this.state.heartbeats
      .filter((heartbeat) => heartbeat.status === "busy")
      .filter(
        (heartbeat) =>
          now.getTime() - heartbeat.updatedAt.getTime() > staleAfterMs
      )
      .map((heartbeat) => ({
        ...heartbeat,
        updatedAt: new Date(heartbeat.updatedAt),
      }));
  }

  addEvent(event: TeamRuntimeEvent): void {
    this.state.events.push({
      ...event,
      timestamp: new Date(event.timestamp),
      payload: event.payload ? { ...event.payload } : undefined,
    });
    this.touch();
  }

  addEvents(events: TeamRuntimeEvent[]): void {
    for (const event of events) {
      this.addEvent(event);
    }
  }

  finalize(phase: "completed" | "failed"): void {
    const now = new Date();
    this.state.phase = phase;
    this.state.updatedAt = now;
    this.state.completedAt = now;
  }

  snapshot(): TeamRunState {
    return {
      ...this.state,
      startedAt: new Date(this.state.startedAt),
      updatedAt: new Date(this.state.updatedAt),
      completedAt: this.state.completedAt
        ? new Date(this.state.completedAt)
        : undefined,
      tasks: this.state.tasks.map((task) => ({ ...task })),
      heartbeats: this.state.heartbeats.map((heartbeat) => ({
        ...heartbeat,
        updatedAt: new Date(heartbeat.updatedAt),
      })),
      events: this.state.events.map((event) => ({
        ...event,
        timestamp: new Date(event.timestamp),
        payload: event.payload ? { ...event.payload } : undefined,
      })),
    };
  }

  private touch(): void {
    this.state.updatedAt = new Date();
  }
}
