/**
 * Shared event-log storage — the single place that knows how to append to and
 * read from `~/.ssenrah/events/events.jsonl`.
 *
 * Two invariants keep the hook cheap regardless of how large the log grows:
 *
 *  - Appends rotate the file once it crosses SSENRAH_MAX_LOG_BYTES, so a single
 *    log can never grow without bound (the old runaway turned this file into a
 *    313 MB blob that every hook process then re-read into memory).
 *  - Reads only ever pull the *tail* of the file (SSENRAH_TAIL_BYTES). Escalation
 *    and anomaly detection care about recent activity, not the entire history,
 *    so we never parse the whole log into the heap on a hot path again.
 */
import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import type { AgentEvent } from "./types.js";

/** Rotate the active log once it exceeds this size (default 50 MB). */
const MAX_LOG_BYTES = Number(process.env.SSENRAH_MAX_LOG_BYTES ?? 50 * 1024 * 1024);
/** Only the last this-many bytes are read back for analysis (default 4 MB). */
const TAIL_READ_BYTES = Number(process.env.SSENRAH_TAIL_BYTES ?? 4 * 1024 * 1024);

export function getLogDir(): string {
  return process.env.SSENRAH_LOG_DIR ?? join(process.env.HOME ?? "~", ".ssenrah", "events");
}

export function getLogFile(): string {
  return join(getLogDir(), "events.jsonl");
}

export function ensureLogDir(): void {
  const dir = getLogDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * Rename the active log to `<file>.1` once it grows past MAX_LOG_BYTES.
 * Keeps exactly one previous generation; older history is intentionally dropped
 * so disk usage stays bounded.
 */
function rotateIfNeeded(file: string): void {
  if (!existsSync(file)) return;
  try {
    if (statSync(file).size > MAX_LOG_BYTES) {
      renameSync(file, `${file}.1`);
    }
  } catch {
    // A rotation failure must never block the append that triggered it.
  }
}

/** Append a single pre-serialized JSONL line (caller supplies the trailing newline). */
export function appendLogLine(line: string): void {
  ensureLogDir();
  const file = getLogFile();
  rotateIfNeeded(file);
  appendFileSync(file, line, "utf-8");
}

/**
 * Read back the most recent events from the log.
 *
 * Reads at most `maxBytes` from the end of the file, discards the (likely
 * partial) first line, and parses the rest. Memory use is bounded by maxBytes,
 * not by total log size.
 */
export function readRecentEvents(maxBytes = TAIL_READ_BYTES): AgentEvent[] {
  const file = getLogFile();
  if (!existsSync(file)) return [];

  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const size = fstatSync(fd).size;
    if (size === 0) return [];

    const start = size > maxBytes ? size - maxBytes : 0;
    const length = size - start;
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, start);

    let text = buffer.toString("utf-8");
    // When we seek into the middle of the file the first line is almost
    // certainly truncated — drop everything up to the first newline.
    if (start > 0) {
      const newlineIndex = text.indexOf("\n");
      text = newlineIndex >= 0 ? text.slice(newlineIndex + 1) : "";
    }

    const events: AgentEvent[] = [];
    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      try {
        events.push(JSON.parse(line) as AgentEvent);
      } catch {
        // Skip malformed lines — a partial tail line or a torn write.
      }
    }
    return events;
  } catch {
    return [];
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
