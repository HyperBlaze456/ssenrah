package dummy

import (
	"context"
	"math/rand"
	"strings"
	"time"

	"github.com/HyperBlaze456/ssenrah/harness/domain/provider"
	"github.com/HyperBlaze456/ssenrah/harness/domain/shared"
)

// Compile-time interface assertion.
var _ provider.LLMProvider = (*Provider)(nil)

// Provider is a dummy LLM provider that simulates streaming responses with rich markdown.
type Provider struct{}

// NewProvider creates a new dummy provider.
func NewProvider() *Provider {
	return &Provider{}
}

// Name returns the provider's display name.
func (p *Provider) Name() string { return "dummy" }

// Chat sends a non-streaming request and returns the complete response.
func (p *Provider) Chat(ctx context.Context, req provider.ChatRequest) (provider.ChatResponse, error) {
	response := pickResponse(req)
	return provider.ChatResponse{
		TextContent: response,
		StopReason:  "end_turn",
		Usage:       shared.Usage{InputTokens: len(req.Messages) * 50, OutputTokens: len(response) / 4},
	}, nil
}

// ChatStream sends a streaming request, delivering chunks character-by-character with variable delays.
func (p *Provider) ChatStream(ctx context.Context, req provider.ChatRequest, handler provider.StreamHandler) error {
	response := pickResponse(req)
	runes := []rune(response)

	// Stream character-by-character with variable delays for natural feel.
	for i, ch := range runes {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		delay := 15 + rand.Intn(25) // 15-40ms per char
		// Longer pauses at word boundaries.
		if ch == ' ' || ch == '\n' {
			delay += 10
		}
		time.Sleep(time.Duration(delay) * time.Millisecond)

		handler(shared.StreamChunk{
			Delta: string(ch),
			Done:  i == len(runes)-1,
		})
	}
	return nil
}

// Models returns available models for the dummy provider.
func (p *Provider) Models(ctx context.Context) ([]provider.ModelInfo, error) {
	return []provider.ModelInfo{
		{
			ID:                  "dummy-v1",
			Name:                "Dummy Model",
			ContextWindow:       128000,
			PricePerInputToken:  0.0,
			PricePerOutputToken: 0.0,
		},
	}, nil
}

// pickResponse selects a canned response with rich markdown content.
func pickResponse(req provider.ChatRequest) string {
	responses := []string{
		markdownDemo(),
		codeBlockDemo(),
		tableDemo(),
	}
	// Rotate based on message count.
	idx := 0
	if len(req.Messages) > 0 {
		idx = len(req.Messages) % len(responses)
	}
	return responses[idx]
}

func markdownDemo() string {
	return strings.TrimSpace(`
# Hello from ssenrah!

This is a **bold** statement and an *italic* one. Here's some ` + "`inline code`" + `.

## Features
- Streaming responses with character-by-character rendering
- Full **markdown** support
- Adaptive layout with sidebar

> "The best way to predict the future is to invent it." — Alan Kay

---

Need anything else? Just ask!
`)
}

func codeBlockDemo() string {
	return strings.TrimSpace("Here's a Go example:\n\n```go\npackage main\n\nimport \"fmt\"\n\nfunc main() {\n\tfmt.Println(\"Hello from ssenrah harness!\")\n}\n```\n\nThis code prints a greeting. The harness uses **Go + Bubbletea** for a smooth TUI experience.")
}

func tableDemo() string {
	return strings.TrimSpace(`
Here's a comparison table:

| Feature | ssenrah | Others |
|---------|---------|--------|
| Language | **Go** | TypeScript |
| TUI Framework | Bubbletea | Ink/Blessed |
| Performance | Fast | Variable |
| Modularity | DDD Hexagonal | Varies |

The key advantage is the *modular architecture* — every component is behind a Go interface.
`)
}
