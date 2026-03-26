export type {
  AgentEvent,
  HookEventType,
  EscalationRule,
  EscalationConfig,
  RedactionPattern,
  HookBasePayload,
} from "./types.js";

export { redactString, redactObject, redactPayload } from "./redact.js";
export { calculateSessionCost, formatCost, formatTokens } from "./cost.js";
export type { SessionCost, TokenUsage } from "./cost.js";
export {
  loadEscalationConfig,
  createDefaultConfig,
  computeSessionState,
  evaluateRules,
  checkEscalation,
} from "./escalation.js";
export type { SessionState, EscalationAlert } from "./escalation.js";
