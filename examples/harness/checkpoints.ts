import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { RuntimePhase } from "./runtime-phase";

export interface HarnessCheckpoint {
  schemaVersion: 1;
  checkpointId: string;
  createdAt: string;
  updatedAt: string;
  phase: RuntimePhase;
  goal: string;
  summary?: string;
  policyProfile?: "local-permissive" | "strict" | "managed";
  pendingTasks?: string[];
  metadata?: Record<string, unknown>;
}

export interface CheckpointPathOptions {
  /** Canonical base path. Defaults to ~/.ssenrah */
  baseDir?: string;
  /** Session id for ~/.ssenrah/sessions/<sessionId>/checkpoints */
  sessionId?: string;
  /** Explicit directory override (legacy + tests). */
  checkpointDir?: string;
}

const DEFAULT_SESSION_ID = "default-session";
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function defaultCheckpointBaseDir(): string {
  return path.join(os.homedir(), ".ssenrah");
}

function sanitizeSessionId(sessionId: string): string {
  const trimmed = sessionId.trim();
  if (!trimmed) {
    throw new Error("sessionId must be non-empty");
  }
  if (trimmed === "." || trimmed === "..") {
    throw new Error("sessionId cannot be '.' or '..'");
  }
  if (!SAFE_ID_PATTERN.test(trimmed)) {
    throw new Error(
      "sessionId may contain only letters, numbers, dot, underscore, or hyphen"
    );
  }
  return trimmed;
}

function sanitizeCheckpointId(checkpointId: string): string {
  const trimmed = checkpointId.trim();
  if (!trimmed) {
    throw new Error("checkpointId must be non-empty");
  }
  if (trimmed === "." || trimmed === "..") {
    throw new Error("checkpointId cannot be '.' or '..'");
  }
  if (!SAFE_ID_PATTERN.test(trimmed)) {
    throw new Error(
      "checkpointId may contain only letters, numbers, dot, underscore, or hyphen"
    );
  }
  return trimmed;
}

export function defaultSessionCheckpointDir(
  sessionId: string,
  baseDir = defaultCheckpointBaseDir()
): string {
  return path.join(baseDir, "sessions", sanitizeSessionId(sessionId), "checkpoints");
}

/**
 * Legacy compatibility helper name.
 * Uses canonical ~/.ssenrah/sessions/<sessionId>/checkpoints path.
 */
export function defaultCheckpointDir(
  options?: string | CheckpointPathOptions
): string {
  return resolveCheckpointDir(options);
}

export function resolveCheckpointDir(
  options?: string | CheckpointPathOptions
): string {
  if (typeof options === "string") {
    // legacy behavior: explicit directory string
    return options;
  }
  if (options?.checkpointDir) {
    return options.checkpointDir;
  }

  const baseDir = options?.baseDir ?? defaultCheckpointBaseDir();
  const sessionId = options?.sessionId ?? DEFAULT_SESSION_ID;
  return defaultSessionCheckpointDir(sessionId, baseDir);
}

export function buildCheckpointPath(
  checkpointId: string,
  options?: string | CheckpointPathOptions
): string {
  const safeId = sanitizeCheckpointId(checkpointId);
  return path.join(resolveCheckpointDir(options), `${safeId}.json`);
}

export function createCheckpoint(input: {
  checkpointId: string;
  phase: RuntimePhase;
  goal: string;
  summary?: string;
  policyProfile?: "local-permissive" | "strict" | "managed";
  pendingTasks?: string[];
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}): HarnessCheckpoint {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    checkpointId: sanitizeCheckpointId(input.checkpointId),
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    phase: input.phase,
    goal: input.goal,
    summary: input.summary,
    policyProfile: input.policyProfile,
    pendingTasks: input.pendingTasks ? [...input.pendingTasks] : undefined,
    metadata: input.metadata ? { ...input.metadata } : undefined,
  };
}

export function validateCheckpoint(
  raw: unknown,
  source = "checkpoint"
): HarnessCheckpoint {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`${source}: checkpoint must be an object`);
  }
  const obj = raw as Record<string, unknown>;
  if (obj["schemaVersion"] !== 1) {
    throw new Error(`${source}: schemaVersion must be 1`);
  }
  if (typeof obj["checkpointId"] !== "string" || obj["checkpointId"].trim() === "") {
    throw new Error(`${source}: checkpointId must be a non-empty string`);
  }
  const checkpointId = sanitizeCheckpointId(obj["checkpointId"]);
  if (typeof obj["createdAt"] !== "string" || typeof obj["updatedAt"] !== "string") {
    throw new Error(`${source}: createdAt/updatedAt must be ISO strings`);
  }
  if (typeof obj["goal"] !== "string" || obj["goal"].trim() === "") {
    throw new Error(`${source}: goal must be a non-empty string`);
  }

  const phase = obj["phase"];
  const allowedPhases: RuntimePhase[] = [
    "planning",
    "executing",
    "reconciling",
    "await_user",
    "failed",
    "completed",
  ];
  if (!allowedPhases.includes(phase as RuntimePhase)) {
    throw new Error(`${source}: invalid phase "${String(phase)}"`);
  }

  const pendingTasks = obj["pendingTasks"];
  if (
    pendingTasks !== undefined &&
    (!Array.isArray(pendingTasks) ||
      pendingTasks.some((item) => typeof item !== "string" || item.trim() === ""))
  ) {
    throw new Error(`${source}: pendingTasks must be string[]`);
  }

  const policyProfile = obj["policyProfile"];
  if (
    policyProfile !== undefined &&
    policyProfile !== "local-permissive" &&
    policyProfile !== "strict" &&
    policyProfile !== "managed"
  ) {
    throw new Error(`${source}: invalid policyProfile "${String(policyProfile)}"`);
  }

  return {
    schemaVersion: 1,
    checkpointId,
    createdAt: obj["createdAt"],
    updatedAt: obj["updatedAt"],
    phase: phase as RuntimePhase,
    goal: obj["goal"],
    summary: typeof obj["summary"] === "string" ? obj["summary"] : undefined,
    policyProfile: policyProfile as
      | "local-permissive"
      | "strict"
      | "managed"
      | undefined,
    pendingTasks:
      pendingTasks !== undefined ? [...(pendingTasks as string[])] : undefined,
    metadata:
      typeof obj["metadata"] === "object" && obj["metadata"] !== null
        ? { ...(obj["metadata"] as Record<string, unknown>) }
        : undefined,
  };
}

export function saveCheckpoint(
  checkpoint: HarnessCheckpoint,
  options?: string | CheckpointPathOptions
): string {
  const filePath = buildCheckpointPath(checkpoint.checkpointId, options);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(checkpoint, null, 2) + "\n", "utf8");
  return filePath;
}

export function loadCheckpoint(filePath: string): HarnessCheckpoint {
  const absolute = path.resolve(filePath);
  const raw = fs.readFileSync(absolute, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  return validateCheckpoint(parsed, absolute);
}

/**
 * Non-throwing checkpoint loader for robustness in resume flows.
 * Returns null for missing/corrupt/invalid checkpoint files.
 */
export function loadCheckpointSafe(filePath: string): HarnessCheckpoint | null {
  try {
    return loadCheckpoint(filePath);
  } catch {
    return null;
  }
}

export function listCheckpointFiles(
  options?: string | CheckpointPathOptions
): string[] {
  const checkpointDir = resolveCheckpointDir(options);
  if (!fs.existsSync(checkpointDir)) return [];
  return fs
    .readdirSync(checkpointDir)
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .map((name) => path.join(checkpointDir, name))
    .sort((a, b) => a.localeCompare(b));
}
