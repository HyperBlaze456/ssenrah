package agent

import "context"

// Package agent defines the agent execution loop port for the agent harness.
//
// UNSTABLE: This interface will evolve when the agent loop is implemented in v0.3.

// AgentLoop orchestrates multi-turn agent execution.
type AgentLoop interface {
	Run(ctx context.Context, prompt string, opts RunOptions) (TurnResult, error)
	Cancel()
}
