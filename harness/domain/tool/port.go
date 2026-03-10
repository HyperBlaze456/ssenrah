package tool

import "context"

// Package tool defines the tool execution port for the agent harness.
//
// UNSTABLE: This interface will evolve when tool execution is implemented in v0.3.

// Tool represents an executable tool that an agent can invoke.
type Tool interface {
	Name() string
	Description() string
	Parameters() ParameterSchema
	Execute(ctx context.Context, input map[string]any) (ToolResult, error)
}
