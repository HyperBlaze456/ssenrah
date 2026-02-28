import { TeamRuntimeEvent } from "./events";
import { TeamRunState } from "./state";

export interface TeamStateSnapshot {
  schemaVersion: 1;
  capturedAt: Date;
  runId: string;
  graphVersion: number;
  phase: TeamRunState["phase"];
  taskCount: number;
  tasks: TeamRunState["tasks"];
  heartbeats: TeamRunState["heartbeats"];
  eventCount: number;
  lastEventId?: string;
}

export interface RetentionPolicy {
  /**
   * Keep only the most recent N events in memory after snapshot capture.
   * Value must be >= 0.
   */
  retainLastEvents: number;
}

export interface RetentionResult {
  snapshot: TeamStateSnapshot;
  retainedEvents: TeamRuntimeEvent[];
  truncatedCount: number;
}

function cloneEvent(event: TeamRuntimeEvent): TeamRuntimeEvent {
  return {
    ...event,
    timestamp: new Date(event.timestamp),
    payload: event.payload ? { ...event.payload } : undefined,
  };
}

/**
 * Capture a replay-linkable state snapshot for retention/compaction workflows.
 */
export function createTeamStateSnapshot(
  state: TeamRunState,
  now = new Date()
): TeamStateSnapshot {
  const events = state.events.map((event) => cloneEvent(event));
  return {
    schemaVersion: 1,
    capturedAt: now,
    runId: state.runId,
    graphVersion: state.graphVersion,
    phase: state.phase,
    taskCount: state.tasks.length,
    tasks: state.tasks.map((task) => ({ ...task })),
    heartbeats: state.heartbeats.map((heartbeat) => ({
      ...heartbeat,
      updatedAt: new Date(heartbeat.updatedAt),
    })),
    eventCount: events.length,
    lastEventId: events[events.length - 1]?.id,
  };
}

/**
 * Applies snapshot+truncate style compaction in-memory.
 * Returns the captured snapshot and retained event tail.
 */
export function applyRetentionPolicy(
  state: TeamRunState,
  policy: RetentionPolicy
): RetentionResult {
  if (!Number.isInteger(policy.retainLastEvents) || policy.retainLastEvents < 0) {
    throw new Error(
      `retainLastEvents must be a non-negative integer, got ${policy.retainLastEvents}`
    );
  }

  const snapshot = createTeamStateSnapshot(state);
  const total = state.events.length;
  const retain = policy.retainLastEvents;
  const retainedEvents =
    retain === 0
      ? []
      : state.events
          .slice(Math.max(0, total - retain))
          .map((event) => cloneEvent(event));

  return {
    snapshot,
    retainedEvents,
    truncatedCount: Math.max(0, total - retainedEvents.length),
  };
}
