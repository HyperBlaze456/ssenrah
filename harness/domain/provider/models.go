package provider

import "github.com/HyperBlaze456/ssenrah/harness/domain/shared"

// ChatOptions holds optional generation parameters.
// Zero values mean "use provider defaults".
type ChatOptions struct {
	Temperature   float64  // 0.0–2.0; 0 means provider default
	TopP          float64  // 0.0–1.0; 0 means provider default
	StopSequences []string // optional stop sequences
}

// ChatRequest represents a request to the LLM provider.
type ChatRequest struct {
	Model        string
	SystemPrompt string
	Messages     []shared.Message
	MaxTokens    int
	Options      ChatOptions
}

// ChatResponse represents a complete (non-streaming) response from the LLM.
type ChatResponse struct {
	TextContent string
	ToolCalls   []shared.ToolCall
	StopReason  string
	Usage       shared.Usage
}

// ModelInfo describes an available model from a provider.
type ModelInfo struct {
	ID                  string
	Name                string
	ContextWindow       int
	PricePerInputToken  float64
	PricePerOutputToken float64
}
