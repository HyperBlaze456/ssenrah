package policy

import "github.com/HyperBlaze456/ssenrah/harness/domain/shared"

// Compile-time interface check.
var _ PolicyEngine = (*DefaultPolicyEngine)(nil)

// DefaultPolicyEngine evaluates tool calls against a PolicyProfile.
type DefaultPolicyEngine struct{}

// NewPolicyEngine creates a new DefaultPolicyEngine.
func NewPolicyEngine() *DefaultPolicyEngine {
	return &DefaultPolicyEngine{}
}

// Evaluate checks the profile's ToolRules for the tool name.
// If a rule exists, return its action. Otherwise return DefaultAction.
func (e *DefaultPolicyEngine) Evaluate(call shared.ToolCall, profile PolicyProfile) PolicyDecision {
	if rule, ok := profile.ToolRules[call.ToolName]; ok {
		return rule.Action
	}
	return profile.DefaultAction
}

// EvaluateWithReason checks the profile and returns both the decision and the reason.
// This is used to populate ApprovalRequest.RiskLevel.
func (e *DefaultPolicyEngine) EvaluateWithReason(call shared.ToolCall, profile PolicyProfile) (PolicyDecision, string) {
	if rule, ok := profile.ToolRules[call.ToolName]; ok {
		return rule.Action, rule.Reason
	}
	return profile.DefaultAction, "Default policy: " + profile.DefaultAction.String()
}
