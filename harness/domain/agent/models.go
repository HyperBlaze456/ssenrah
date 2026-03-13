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
	PolicyTier   string
	MaxTurns     int
}

// AgentType is an immutable template defining an agent's capabilities.
// Loaded from YAML config. Not modified at runtime.
type AgentType struct {
	Name         string
	Description  string
	Model        string
	PolicyTier   string   // references a PolicyProfile by name
	Tools        []string // tool names this agent is allowed to use
	SystemPrompt string
	MaxTurns     int
}
