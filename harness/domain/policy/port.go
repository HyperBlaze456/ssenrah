package policy

import "github.com/HyperBlaze456/ssenrah/harness/domain/shared"

// Package policy defines the policy engine port for the agent harness.
//
// UNSTABLE: This interface will evolve when the policy engine is implemented in v0.4.

// PolicyEngine evaluates whether a tool call should be allowed, denied, or require user approval.
type PolicyEngine interface {
	Evaluate(call shared.ToolCall, profile PolicyProfile) PolicyDecision
}
