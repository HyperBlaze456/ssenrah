package agent

import "github.com/HyperBlaze456/ssenrah/harness/domain/shared"

// TurnResult represents the outcome of a single agent turn.
type TurnResult struct {
	Status   string
	Messages []shared.Message
	Usage    shared.Usage
}

// RunOptions configures an agent execution run.
type RunOptions struct {
	MaxTurns     int
	SystemPrompt string
	Model        string
}

// AgentConfig defines the configuration for an agent type.
type AgentConfig struct {
	Name         string
	Model        string
	SystemPrompt string
	ToolPacks    []string
	MaxTurns     int
}
