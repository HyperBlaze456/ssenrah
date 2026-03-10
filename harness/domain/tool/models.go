package tool

import "github.com/HyperBlaze456/ssenrah/harness/domain/shared"

// ToolResult represents the output of a tool execution.
type ToolResult struct {
	CallID  string
	Content string
	IsError bool
}

// ApprovalRequest represents a request for user approval before tool execution.
type ApprovalRequest struct {
	ToolCall  shared.ToolCall
	RiskLevel string
	Reason    string
}

// ParameterSchema describes the expected input parameters for a tool.
type ParameterSchema struct {
	Properties map[string]ParameterProperty
	Required   []string
}

// ParameterProperty describes a single parameter.
type ParameterProperty struct {
	Type        string
	Description string
}
