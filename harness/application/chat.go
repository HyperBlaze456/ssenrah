package application

import (
	"context"
	"strings"

	"github.com/HyperBlaze456/ssenrah/harness/domain/conversation"
	"github.com/HyperBlaze456/ssenrah/harness/domain/provider"
	"github.com/HyperBlaze456/ssenrah/harness/domain/shared"
)

// ChatService orchestrates the message flow between user input, LLM provider, and conversation history.
type ChatService struct {
	conversation *conversation.Conversation
	provider     provider.LLMProvider
	systemPrompt string
	model        string
	lastUsage    shared.Usage
}

// NewChatService creates a ChatService with the given dependencies.
func NewChatService(conv *conversation.Conversation, prov provider.LLMProvider, systemPrompt string) *ChatService {
	return &ChatService{conversation: conv, provider: prov, systemPrompt: systemPrompt}
}

// SetProvider switches the active LLM provider at runtime.
func (s *ChatService) SetProvider(prov provider.LLMProvider) {
	s.provider = prov
}

// SetModel sets the model name used in requests.
func (s *ChatService) SetModel(model string) {
	s.model = model
}

// ProviderName returns the current provider's name.
func (s *ChatService) ProviderName() string {
	return s.provider.Name()
}

// LastUsage returns the usage from the most recent response.
func (s *ChatService) LastUsage() shared.Usage {
	return s.lastUsage
}

// Models returns available models from the current provider.
func (s *ChatService) Models(ctx context.Context) ([]provider.ModelInfo, error) {
	return s.provider.Models(ctx)
}

// SendMessage performs the full round-trip:
//  1. Validates the user message (returns shared.ErrEmptyMessage if blank)
//  2. Appends the pre-built user Message to Conversation
//  3. Calls provider.ChatStream with full history
//  4. Forwards each StreamChunk to handler in real-time
//  5. Internally accumulates chunks to build final content
//  6. Appends assistant Message to Conversation
//  7. Returns the final assistant Message
//
// The caller creates the user Message to ensure a single identity is shared
// between TUI display and domain state. This method is BLOCKING — in
// Bubbletea, wrap in a tea.Cmd.
func (s *ChatService) SendMessage(ctx context.Context, userMsg shared.Message, handler provider.StreamHandler) (shared.Message, error) {
	if strings.TrimSpace(userMsg.Content) == "" {
		return shared.Message{}, shared.ErrEmptyMessage
	}

	// Append user message (same object the TUI is already displaying)
	s.conversation.Append(userMsg)

	// Build request
	req := provider.ChatRequest{
		Model:        s.model,
		SystemPrompt: s.systemPrompt,
		Messages:     s.conversation.History(),
	}

	// Accumulate chunks internally while forwarding to handler
	var buf strings.Builder
	wrappedHandler := func(chunk shared.StreamChunk) {
		buf.WriteString(chunk.Delta)
		if handler != nil {
			handler(chunk)
		}
	}

	// Call provider (blocking)
	err := s.provider.ChatStream(ctx, req, wrappedHandler)
	if err != nil {
		return shared.Message{}, err
	}

	// Create and append assistant message
	assistantMsg := shared.NewMessage(shared.RoleAssistant, buf.String())
	s.conversation.Append(assistantMsg)

	// Estimate usage for streaming (providers may include usage in final chunk in v0.3+)
	s.lastUsage = shared.Usage{
		InputTokens:  estimateTokens(s.systemPrompt) + estimateConversationTokens(s.conversation.History()),
		OutputTokens: estimateTokens(buf.String()),
	}

	return assistantMsg, nil
}

// History returns the conversation message history.
func (s *ChatService) History() []shared.Message {
	return s.conversation.History()
}

// estimateTokens gives a rough token count (~4 chars per token).
func estimateTokens(s string) int {
	return len([]rune(s)) / 4
}

// estimateConversationTokens sums estimated tokens across all messages.
func estimateConversationTokens(msgs []shared.Message) int {
	total := 0
	for _, m := range msgs {
		total += estimateTokens(m.Content)
	}
	return total
}
