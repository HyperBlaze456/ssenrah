import * as fs from "fs";
import * as path from "path";

export const KNOWN_HARNESS_EVENT_TYPES = [
  "intent",
  "tool_call",
  "tool_result",
  "policy",
  "beholder_action",
  "fallback",
  "turn_result",
  "error",
] as const;

export type KnownHarnessEventType = typeof KNOWN_HARNESS_EVENT_TYPES[number];

export type HarnessEventType = KnownHarnessEventType | (string & {});

export interface HarnessEvent {
  timestamp: string;
  type: HarnessEventType;
  agentId: string;
  data: Record<string, unknown>;
}

const KNOWN_HARNESS_EVENT_SET = new Set<string>(KNOWN_HARNESS_EVENT_TYPES);

export function isKnownHarnessEventType(
  eventType: string
): eventType is KnownHarnessEventType {
  return KNOWN_HARNESS_EVENT_SET.has(eventType);
}

export interface HarnessEventTypeSummary {
  knownCounts: Record<KnownHarnessEventType, number>;
  unknownCount: number;
  unknownTypes: string[];
}

export function summarizeHarnessEventTypes(
  events: ReadonlyArray<Pick<HarnessEvent, "type">>
): HarnessEventTypeSummary {
  const knownCounts = Object.fromEntries(
    KNOWN_HARNESS_EVENT_TYPES.map((eventType) => [eventType, 0])
  ) as Record<KnownHarnessEventType, number>;
  let unknownCount = 0;
  const unknownTypes = new Set<string>();

  for (const event of events) {
    if (isKnownHarnessEventType(event.type)) {
      knownCounts[event.type] += 1;
      continue;
    }

    unknownCount += 1;
    unknownTypes.add(event.type);
  }

  return {
    knownCounts,
    unknownCount,
    unknownTypes: Array.from(unknownTypes).sort(),
  };
}

/**
 * Simple JSONL event logger.
 * Writes events to a file or collects in memory.
 */
export class EventLogger {
  private filePath?: string;
  private buffer: HarnessEvent[] = [];

  constructor(options?: { filePath?: string }) {
    this.filePath = options?.filePath;
    if (this.filePath) {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    }
  }

  log(event: HarnessEvent): void {
    this.buffer.push(event);
    if (this.filePath) {
      const line = JSON.stringify(event) + "\n";
      fs.appendFileSync(this.filePath, line, "utf8");
    }
  }

  /** Get all events (from memory buffer) */
  getEvents(): HarnessEvent[] {
    return [...this.buffer];
  }

  /** Flush to disk if file-backed */
  flush(): void {
    if (!this.filePath) return;
    const content =
      this.buffer.map((e) => JSON.stringify(e)).join("\n") +
      (this.buffer.length > 0 ? "\n" : "");
    fs.writeFileSync(this.filePath, content, "utf8");
  }
}
