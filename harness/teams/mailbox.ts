import { TeamMessage } from "./types";

export interface SendTeamMessageInput {
  from: string;
  to: string;
  content: string;
  taskId?: string;
  metadata?: Record<string, unknown>;
  timestamp?: Date;
}

/**
 * TeamMailbox provides a simple in-memory messaging channel between team actors.
 */
export class TeamMailbox {
  private messages: TeamMessage[] = [];
  private seq = 0;

  send(input: SendTeamMessageInput): TeamMessage {
    const message: TeamMessage = {
      id: `msg-${++this.seq}`,
      from: input.from,
      to: input.to,
      content: input.content,
      taskId: input.taskId,
      metadata: input.metadata ? { ...input.metadata } : undefined,
      timestamp: input.timestamp ?? new Date(),
      delivered: false,
    };
    this.messages.push(message);
    return this.clone(message);
  }

  list(
    recipient: string,
    options?: { includeDelivered?: boolean }
  ): TeamMessage[] {
    const includeDelivered = options?.includeDelivered ?? false;
    return this.messages
      .filter(
        (message) =>
          message.to === recipient &&
          (includeDelivered || message.delivered !== true)
      )
      .map((message) => this.clone(message));
  }

  markDelivered(messageId: string): TeamMessage | null {
    const index = this.messages.findIndex((message) => message.id === messageId);
    if (index === -1) return null;
    const current = this.messages[index];
    if (current.delivered) {
      return this.clone(current);
    }

    const next: TeamMessage = {
      ...current,
      delivered: true,
      deliveredAt: new Date(),
    };
    this.messages[index] = next;
    return this.clone(next);
  }

  getAll(): TeamMessage[] {
    return this.messages.map((message) => this.clone(message));
  }

  private clone(message: TeamMessage): TeamMessage {
    return {
      ...message,
      timestamp: new Date(message.timestamp),
      deliveredAt: message.deliveredAt ? new Date(message.deliveredAt) : undefined,
      metadata: message.metadata ? { ...message.metadata } : undefined,
    };
  }
}
