/**
 * Typed priority mailbox with TTL and topic filtering.
 */
export type MessagePriority = "low" | "normal" | "high" | "critical";

export type MessageType =
  | "context"
  | "alert"
  | "decision_request"
  | "directive"
  | "progress"
  | "needs_context"
  | "heartbeat";

export interface PriorityMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  type: MessageType;
  priority: MessagePriority;
  topic?: string;
  taskId?: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
  ttlMs?: number;
  delivered: boolean;
  deliveredAt?: Date;
  expired?: boolean;
}

export interface SendPriorityMessageInput {
  from: string;
  to: string;
  content: string;
  type?: MessageType;
  priority?: MessagePriority;
  topic?: string;
  taskId?: string;
  metadata?: Record<string, unknown>;
  ttlMs?: number;
}

const PRIORITY_RANK: Readonly<Record<MessagePriority, number>> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export class PriorityMailbox {
  private messages: PriorityMessage[] = [];
  private seq = 0;

  send(input: SendPriorityMessageInput): PriorityMessage {
    const message: PriorityMessage = {
      id: `pmsg-${++this.seq}`,
      from: input.from,
      to: input.to,
      content: input.content,
      type: input.type ?? "context",
      priority: input.priority ?? "normal",
      topic: input.topic,
      taskId: input.taskId,
      metadata: input.metadata ? { ...input.metadata } : undefined,
      timestamp: new Date(),
      ttlMs: input.ttlMs,
      delivered: false,
    };
    this.messages.push(message);
    return this.clone(message);
  }

  list(
    recipient: string,
    options?: { includeDelivered?: boolean; includeExpired?: boolean; topic?: string }
  ): PriorityMessage[] {
    const now = Date.now();
    return this.messages
      .filter((message) => {
        if (message.to !== recipient) return false;
        if (options?.topic && message.topic !== options.topic) return false;
        if (!options?.includeDelivered && message.delivered) return false;
        if (this.isExpired(message, now)) {
          message.expired = true;
          if (!options?.includeExpired) return false;
        }
        return true;
      })
      .sort(
        (a, b) =>
          PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
          a.timestamp.getTime() - b.timestamp.getTime()
      )
      .map((message) => this.clone(message));
  }

  listByType(recipient: string, type: MessageType): PriorityMessage[] {
    return this.list(recipient).filter((message) => message.type === type);
  }

  listByTopic(recipient: string, topic: string): PriorityMessage[] {
    return this.list(recipient, { topic });
  }

  markDelivered(messageId: string): PriorityMessage | null {
    const message = this.messages.find((candidate) => candidate.id === messageId);
    if (!message) return null;
    if (message.delivered) return this.clone(message);
    message.delivered = true;
    message.deliveredAt = new Date();
    return this.clone(message);
  }

  countPending(recipient: string): number {
    const now = Date.now();
    return this.messages.filter(
      (message) =>
        message.to === recipient &&
        !message.delivered &&
        !this.isExpired(message, now)
    ).length;
  }

  pruneExpired(): number {
    const now = Date.now();
    const before = this.messages.length;
    this.messages = this.messages.filter(
      (message) => !this.isExpired(message, now)
    );
    return before - this.messages.length;
  }

  getAll(): PriorityMessage[] {
    return this.messages.map((message) => this.clone(message));
  }

  private isExpired(message: PriorityMessage, now: number): boolean {
    if (message.ttlMs == null) return false;
    return now - message.timestamp.getTime() > message.ttlMs;
  }

  private clone(message: PriorityMessage): PriorityMessage {
    return {
      ...message,
      timestamp: new Date(message.timestamp),
      deliveredAt: message.deliveredAt
        ? new Date(message.deliveredAt)
        : undefined,
      metadata: message.metadata ? { ...message.metadata } : undefined,
    };
  }
}
