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

export function defaultCheckpointDir(): string {
  return path.join(os.homedir(), ".ssenrah", "checkpoints");
}

export function buildCheckpointPath(
  checkpointId: string,
  baseDir = defaultCheckpointDir()
): string {
  const safeId = checkpointId.trim();
  if (!safeId) {
    throw new Error("checkpointId must be non-empty");
  }
  return path.join(baseDir, `${safeId}.json`);
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
    checkpointId: input.checkpointId.trim(),
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
    checkpointId: obj["checkpointId"].trim(),
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
  baseDir = defaultCheckpointDir()
): string {
  const filePath = buildCheckpointPath(checkpoint.checkpointId, baseDir);
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

export function listCheckpointFiles(baseDir = defaultCheckpointDir()): string[] {
  if (!fs.existsSync(baseDir)) return [];
  return fs
    .readdirSync(baseDir)
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .map((name) => path.join(baseDir, name))
    .sort((a, b) => a.localeCompare(b));
}

