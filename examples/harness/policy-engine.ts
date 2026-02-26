/**
 * Lightweight runtime policy engine for tool-execution governance.
 *
 * Default behavior is intentionally permissive (similar to local CLI harnesses):
 * - local-permissive: allow read/write/exec, gate only destructive by default.
 * - strict: gate write/exec/destructive.
 * - managed: gate write, deny exec/destructive unless explicitly approved.
 */

export type RiskLevel = "read" | "write" | "exec" | "destructive";

export type PolicyProfile = "local-permissive" | "strict" | "managed";

export type PolicyAction = "allow" | "await_user" | "deny";

export interface PolicyDecision {
  action: PolicyAction;
  reason: string;
}

export interface PolicyContext {
  toolName: string;
  riskLevel: RiskLevel;
  toolCallCount: number;
}

export interface ApprovalRequest {
  profile: PolicyProfile;
  toolName: string;
  riskLevel: RiskLevel;
  reason: string;
}

export type ApprovalHandler =
  | ((request: ApprovalRequest) => "approve" | "reject")
  | ((request: ApprovalRequest) => Promise<"approve" | "reject">);

export interface PolicyEngineOptions {
  profile?: PolicyProfile;
  maxToolCalls?: number;
  allowTools?: string[];
  denyTools?: string[];
}

const DEFAULT_MAX_TOOL_CALLS: Readonly<Record<PolicyProfile, number>> = {
  "local-permissive": 250,
  strict: 120,
  managed: 80,
};

export class PolicyEngine {
  readonly profile: PolicyProfile;
  readonly maxToolCalls: number;
  private allowTools: Set<string>;
  private denyTools: Set<string>;

  constructor(options?: PolicyEngineOptions) {
    this.profile = options?.profile ?? "local-permissive";
    this.maxToolCalls =
      options?.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS[this.profile];
    this.allowTools = new Set(options?.allowTools ?? []);
    this.denyTools = new Set(options?.denyTools ?? []);
  }

  async evaluateToolCall(
    context: PolicyContext,
    approvalHandler?: ApprovalHandler
  ): Promise<PolicyDecision> {
    const byRules = this.evaluateByRules(context);
    if (byRules.action !== "await_user") {
      return byRules;
    }

    if (!approvalHandler) {
      return byRules;
    }

    const approval = await approvalHandler({
      profile: this.profile,
      toolName: context.toolName,
      riskLevel: context.riskLevel,
      reason: byRules.reason,
    });

    if (approval === "approve") {
      return {
        action: "allow",
        reason: `approved_by_handler: ${context.toolName} (${context.riskLevel})`,
      };
    }

    return {
      action: "deny",
      reason: `approval_rejected: ${context.toolName} (${context.riskLevel})`,
    };
  }

  private evaluateByRules(context: PolicyContext): PolicyDecision {
    if (context.toolCallCount > this.maxToolCalls) {
      return {
        action: "await_user",
        reason: `tool_call_cap_reached: ${context.toolCallCount} > ${this.maxToolCalls}`,
      };
    }

    if (this.denyTools.has(context.toolName)) {
      return {
        action: "deny",
        reason: `tool_denied_by_name: ${context.toolName}`,
      };
    }

    if (this.allowTools.has(context.toolName)) {
      return {
        action: "allow",
        reason: `tool_allowed_by_name: ${context.toolName}`,
      };
    }

    switch (this.profile) {
      case "local-permissive":
        return context.riskLevel === "destructive"
          ? {
              action: "await_user",
              reason: `destructive_action_requires_approval: ${context.toolName}`,
            }
          : { action: "allow", reason: "local_permissive_default_allow" };

      case "strict":
        return context.riskLevel === "read"
          ? { action: "allow", reason: "strict_read_allowed" }
          : {
              action: "await_user",
              reason: `strict_profile_requires_approval: ${context.riskLevel}`,
            };

      case "managed":
        if (context.riskLevel === "read") {
          return { action: "allow", reason: "managed_read_allowed" };
        }
        if (context.riskLevel === "write") {
          return {
            action: "await_user",
            reason: "managed_write_requires_approval",
          };
        }
        return {
          action: "deny",
          reason: `managed_profile_denies_${context.riskLevel}`,
        };
    }
  }
}

