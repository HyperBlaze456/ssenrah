/**
 * Runtime policy contract: deterministic phase transitions, safety caps,
 * feature flags, and trust-gated extensibility.
 */
import type { TrustLevel } from "./types";

export interface FeatureFlags {
  reconcileEnabled: boolean;
  mutableGraphEnabled: boolean;
  priorityMailboxEnabled: boolean;
  traceReplayEnabled: boolean;
  regressionGatesEnabled: boolean;
  trustGatingEnabled: boolean;
  hierarchyEnabled: boolean;
}

export const DEFAULT_FEATURE_FLAGS: Readonly<FeatureFlags> = Object.freeze({
  reconcileEnabled: false,
  mutableGraphEnabled: false,
  priorityMailboxEnabled: false,
  traceReplayEnabled: false,
  regressionGatesEnabled: false,
  trustGatingEnabled: false,
  hierarchyEnabled: false,
});

export interface SafetyCaps {
  maxTasks: number;
  maxWorkers: number;
  maxDepth: number;
  maxRetries: number;
  maxCompensatingTasks: number;
  maxRuntimeMs: number;
  reconcileCooldownMs: number;
  heartbeatStalenessMs: number;
  workerTimeoutMs: number;
}

export const DEFAULT_SAFETY_CAPS: Readonly<SafetyCaps> = Object.freeze({
  maxTasks: 20,
  maxWorkers: 5,
  maxDepth: 0, // hierarchy off by default
  maxRetries: 2,
  maxCompensatingTasks: 3,
  maxRuntimeMs: 10 * 60_000,
  reconcileCooldownMs: 5_000,
  heartbeatStalenessMs: 30_000,
  workerTimeoutMs: 120_000,
});

export type RuntimePhase =
  | "idle"
  | "planning"
  | "await_approval"
  | "executing"
  | "reconciling"
  | "synthesizing"
  | "completed"
  | "failed"
  | "await_user";

export const VALID_TRANSITIONS: Readonly<
  Record<RuntimePhase, readonly RuntimePhase[]>
> = Object.freeze({
  idle: ["planning"],
  planning: ["await_approval", "executing", "failed"],
  await_approval: ["executing", "failed", "idle"],
  executing: ["reconciling", "synthesizing", "failed", "await_user"],
  reconciling: ["executing", "synthesizing", "failed", "await_user"],
  synthesizing: ["completed", "failed"],
  completed: ["idle"],
  failed: ["idle"],
  await_user: ["executing", "reconciling", "failed", "idle"],
});

export type ExtensionCapability =
  | "read"
  | "write"
  | "exec"
  | "network"
  | "hook"
  | "plugin"
  | "trace";

export interface ExtensionManifest {
  name: string;
  version: string;
  trustRequired: TrustLevel;
  capabilities: ExtensionCapability[];
}

const TRUST_RANK: Readonly<Record<TrustLevel, number>> = {
  untrusted: 0,
  workspace: 1,
  user: 2,
  managed: 3,
};

const BLOCKED_WHEN_UNTRUSTED = new Set<ExtensionCapability>([
  "write",
  "exec",
  "network",
  "hook",
  "plugin",
]);

// ---------------------------------------------------------------------------
// Policy violation type.
// ---------------------------------------------------------------------------
export class PolicyViolation extends Error {
  readonly phase?: RuntimePhase;
  readonly cap?: string;

  constructor(message: string, opts?: { phase?: RuntimePhase; cap?: string }) {
    super(message);
    this.name = "PolicyViolation";
    this.phase = opts?.phase;
    this.cap = opts?.cap;
  }
}

// ---------------------------------------------------------------------------
// RuntimePolicy — source of truth for transitions/caps/flags/trust checks.
// ---------------------------------------------------------------------------
export class RuntimePolicy {
  readonly flags: FeatureFlags;
  readonly caps: SafetyCaps;
  private phase: RuntimePhase = "idle";

  constructor(flags?: Partial<FeatureFlags>, caps?: Partial<SafetyCaps>) {
    this.flags = { ...DEFAULT_FEATURE_FLAGS, ...flags };
    this.caps = { ...DEFAULT_SAFETY_CAPS, ...caps };
  }

  getPhase(): RuntimePhase {
    return this.phase;
  }

  canTransition(to: RuntimePhase): boolean {
    return (VALID_TRANSITIONS[this.phase] ?? []).includes(to);
  }

  transition(to: RuntimePhase): void {
    if (!this.canTransition(to)) {
      const valid = (VALID_TRANSITIONS[this.phase] ?? []).join(", ") || "none";
      throw new PolicyViolation(
        `Illegal transition: ${this.phase} → ${to}. Valid targets: [${valid}]`,
        { phase: this.phase }
      );
    }
    this.phase = to;
  }

  enforceTaskCap(current: number): void {
    if (current >= this.caps.maxTasks) {
      throw new PolicyViolation(
        `Task cap reached: ${current} >= ${this.caps.maxTasks}`,
        { cap: "maxTasks" }
      );
    }
  }

  enforceWorkerCap(current: number): void {
    if (current > this.caps.maxWorkers) {
      throw new PolicyViolation(
        `Worker cap reached: ${current} > ${this.caps.maxWorkers}`,
        { cap: "maxWorkers" }
      );
    }
  }

  enforceDepthCap(current: number): void {
    if (current > this.caps.maxDepth) {
      throw new PolicyViolation(
        `Depth cap reached: ${current} > ${this.caps.maxDepth}`,
        { cap: "maxDepth" }
      );
    }
  }

  enforceRetryCap(current: number): void {
    if (current >= this.caps.maxRetries) {
      throw new PolicyViolation(
        `Retry cap reached: ${current} >= ${this.caps.maxRetries}`,
        { cap: "maxRetries" }
      );
    }
  }

  enforceRuntimeBudget(elapsedMs: number): void {
    if (elapsedMs > this.caps.maxRuntimeMs) {
      throw new PolicyViolation(
        `Runtime cap reached: ${elapsedMs}ms > ${this.caps.maxRuntimeMs}ms`,
        { cap: "maxRuntimeMs" }
      );
    }
  }

  isHeartbeatStale(lastHeartbeat: Date, now = new Date()): boolean {
    return now.getTime() - lastHeartbeat.getTime() > this.caps.heartbeatStalenessMs;
  }

  assertExtensionAllowed(
    manifest: ExtensionManifest,
    currentTrust: TrustLevel
  ): void {
    if (!this.flags.trustGatingEnabled) {
      return;
    }

    this.validateExtensionManifest(manifest);

    if (TRUST_RANK[currentTrust] < TRUST_RANK[manifest.trustRequired]) {
      throw new PolicyViolation(
        `Extension ${manifest.name}@${manifest.version} requires trust=${manifest.trustRequired}, current trust=${currentTrust}`
      );
    }

    if (currentTrust === "untrusted") {
      const blocked = manifest.capabilities.find((cap) =>
        BLOCKED_WHEN_UNTRUSTED.has(cap)
      );
      if (blocked) {
        throw new PolicyViolation(
          `Untrusted mode blocks extension capability "${blocked}" for ${manifest.name}`
        );
      }
    }
  }

  private validateExtensionManifest(manifest: ExtensionManifest): void {
    if (!/^[a-z0-9._-]+$/i.test(manifest.name)) {
      throw new PolicyViolation(`Invalid extension name: "${manifest.name}"`);
    }
    if (!/^\d+\.\d+\.\d+/.test(manifest.version)) {
      throw new PolicyViolation(
        `Invalid extension version: "${manifest.version}" (expected semver-like)`
      );
    }
    if (!Array.isArray(manifest.capabilities) || manifest.capabilities.length === 0) {
      throw new PolicyViolation(
        `Extension ${manifest.name} must declare at least one capability`
      );
    }
  }
}
