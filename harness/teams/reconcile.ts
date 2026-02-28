import { PriorityMailbox } from "./priority-mailbox";
import { RuntimePolicy } from "./policy";
import { TeamStateTracker, ReconcileTrigger } from "./state";

export type ReconcileActionType =
  | "noop"
  | "request_context"
  | "escalate_user"
  | "policy_violation";

export interface ReconcileAction {
  type: ReconcileActionType;
  reason: string;
  workerId?: string;
  taskId?: string;
}

export interface NeedsContextRequest {
  workerId: string;
  taskId?: string;
  detail: string;
}

export interface ReconcileDecision {
  trigger: ReconcileTrigger;
  performedAt: Date;
  actions: ReconcileAction[];
}

export interface ReconcileLoopContext {
  trigger: ReconcileTrigger;
  pendingTaskCount: number;
  needsContext?: NeedsContextRequest[];
  now?: Date;
}

/**
 * Reconcile loop foundation.
 * Event-triggered by design for MVP (with heartbeat-stale checks), timer-based
 * reconcile is deferred to post-MVP.
 */
export class ReconcileLoop {
  private readonly policy: RuntimePolicy;
  private readonly mailbox: PriorityMailbox;
  private readonly state: TeamStateTracker;

  constructor(input: {
    policy: RuntimePolicy;
    mailbox: PriorityMailbox;
    state: TeamStateTracker;
  }) {
    this.policy = input.policy;
    this.mailbox = input.mailbox;
    this.state = input.state;
  }

  run(context: ReconcileLoopContext): ReconcileDecision {
    const now = context.now ?? new Date();
    const actions: ReconcileAction[] = [];
    this.state.setLastTrigger(context.trigger);

    if (!this.policy.flags.reconcileEnabled) {
      actions.push({
        type: "noop",
        reason: "reconcile feature flag disabled",
      });
      return { trigger: context.trigger, performedAt: now, actions };
    }

    this.state.setPhase("reconciling");

    // Cap policy check
    try {
      this.policy.enforceTaskCap(context.pendingTaskCount);
    } catch (error) {
      const message = (error as Error).message;
      this.mailbox.send({
        from: "reconciler",
        to: "orchestrator",
        type: "alert",
        priority: "critical",
        topic: "caps",
        content: `Policy cap reached during reconcile: ${message}`,
      });
      actions.push({
        type: "policy_violation",
        reason: message,
      });
      actions.push({
        type: "escalate_user",
        reason: "forced user gate due to cap policy",
      });
    }

    // Typed needs_context flow
    for (const request of context.needsContext ?? []) {
      this.mailbox.send({
        from: request.workerId,
        to: "orchestrator",
        taskId: request.taskId,
        type: "needs_context",
        priority: "high",
        topic: "context",
        content: request.detail,
      });
      actions.push({
        type: "request_context",
        reason: request.detail,
        workerId: request.workerId,
        taskId: request.taskId,
      });
    }

    // Heartbeat stale checks
    const stale = this.state.getStaleHeartbeats(
      this.policy.caps.heartbeatStalenessMs,
      now
    );
    for (const heartbeat of stale) {
      const reason = `worker ${heartbeat.workerId} stale for >${this.policy.caps.heartbeatStalenessMs}ms`;
      this.mailbox.send({
        from: "reconciler",
        to: "orchestrator",
        taskId: heartbeat.taskId,
        type: "heartbeat",
        priority: "critical",
        topic: "heartbeat",
        content: reason,
      });
      actions.push({
        type: "escalate_user",
        reason,
        workerId: heartbeat.workerId,
        taskId: heartbeat.taskId,
      });
    }

    this.state.setPhase("executing");
    return { trigger: context.trigger, performedAt: now, actions };
  }
}
