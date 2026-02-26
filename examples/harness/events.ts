import * as fs from "fs";
import * as path from "path";

export interface HarnessEvent {
  timestamp: string;
  type:
    | "intent"
    | "tool_call"
    | "tool_result"
    | "policy"
    | "beholder_action"
    | "fallback"
    | "turn_result"
    | "error";
  agentId: string;
  data: Record<string, unknown>;
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
    const content = this.buffer.map((e) => JSON.stringify(e)).join("\n") + (this.buffer.length > 0 ? "\n" : "");
    fs.writeFileSync(this.filePath, content, "utf8");
  }
}
