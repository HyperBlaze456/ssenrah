package provider

import (
	"context"
	"github.com/HyperBlaze456/ssenrah/harness/domain/shared"
)

// Package provider defines the LLM provider port for the agent harness.
//
// UNSTABLE: This interface will evolve when real providers are implemented in v0.2.

// LLMProvider abstracts communication with a large language model.
type LLMProvider interface {
	// Name returns the provider's display name.
	Name() string
	// Chat sends a non-streaming request and returns the complete response.
	Chat(ctx context.Context, req ChatRequest) (ChatResponse, error)
	// ChatStream sends a streaming request. The handler is called for each chunk
	// on the calling goroutine. Returns when streaming completes or ctx is cancelled.
	ChatStream(ctx context.Context, req ChatRequest, handler StreamHandler) error
	// Models returns available models. May require an API call for some providers.
	Models(ctx context.Context) ([]ModelInfo, error)
}

// StreamHandler receives streaming chunks. Called on the goroutine running
// ChatStream — callers that need to forward to another goroutine (e.g. Bubbletea)
// must handle the send themselves.
type StreamHandler func(chunk shared.StreamChunk)
