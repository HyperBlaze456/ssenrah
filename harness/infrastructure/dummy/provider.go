package dummy

import (
	"context"
	"fmt"
	"math/rand"
	"strings"
	"time"

	"github.com/HyperBlaze456/ssenrah/harness/domain/provider"
	"github.com/HyperBlaze456/ssenrah/harness/domain/shared"
)

// Compile-time interface assertion.
var _ provider.LLMProvider = (*Provider)(nil)

// Provider is a dummy LLM provider that simulates streaming responses with rich markdown.
// When tools are available, it simulates a multi-turn agent loop with tool calls.
type Provider struct{}

// NewProvider creates a new dummy provider.
func NewProvider() *Provider {
	return &Provider{}
}

// Name returns the provider's display name.
func (p *Provider) Name() string { return "dummy" }

// Chat sends a non-streaming request and returns the complete response.
func (p *Provider) Chat(ctx context.Context, req provider.ChatRequest) (provider.ChatResponse, error) {
	response, toolCalls, stopReason := pickAgentResponse(req)
	return provider.ChatResponse{
		TextContent: response,
		ToolCalls:   toolCalls,
		StopReason:  stopReason,
		Usage:       shared.Usage{InputTokens: len(req.Messages) * 50, OutputTokens: len(response) / 4},
	}, nil
}

// ChatStream sends a streaming request, delivering chunks character-by-character with variable delays.
// When tools are available, simulates multi-turn tool calling behavior.
func (p *Provider) ChatStream(ctx context.Context, req provider.ChatRequest, handler provider.StreamHandler) error {
	response, toolCalls, stopReason := pickAgentResponse(req)
	runes := []rune(response)

	// Stream character-by-character with variable delays for natural feel.
	for _, ch := range runes {
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
			Delta:     string(ch),
			MessageID: "dummy-msg",
		})
	}

	// Send final chunk with tool calls (if any) and stop reason
	handler(shared.StreamChunk{
		Done:       true,
		ToolCalls:  toolCalls,
		StopReason: stopReason,
	})

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

// pickAgentResponse selects a response based on whether tools are available and
// what turn the agent is on (determined by counting tool result messages).
func pickAgentResponse(req provider.ChatRequest) (text string, toolCalls []shared.ToolCall, stopReason string) {
	// If no tools available, use classic canned responses
	if len(req.Tools) == 0 {
		return pickClassicResponse(req), nil, "end_turn"
	}

	// Count tool result messages to determine which turn we're on
	toolResultCount := 0
	for _, m := range req.Messages {
		if m.Role == shared.RoleTool {
			toolResultCount++
		}
	}

	switch toolResultCount {
	case 0:
		// Turn 1: Stream thinking text, then request 2 tool calls (read_file + bash)
		return turn1Response()
	case 2:
		// Turn 2: After both tool results from turn 1, request 1 more tool call (write_file)
		return turn2Response()
	default:
		// Turn 3+: Final summary — no more tool calls
		return turn3Response(toolResultCount), nil, "end_turn"
	}
}

// turn1Response simulates the agent deciding to read a file and check the system.
func turn1Response() (string, []shared.ToolCall, string) {
	text := "Let me investigate your project. I'll read the go.mod to understand the module structure and check the current directory."

	toolCalls := []shared.ToolCall{
		{
			ID:       fmt.Sprintf("call_%d_read", time.Now().UnixNano()),
			ToolName: "read_file",
			Input:    map[string]any{"path": "go.mod"},
		},
		{
			ID:       fmt.Sprintf("call_%d_bash", time.Now().UnixNano()),
			ToolName: "bash",
			Input:    map[string]any{"command": "ls -la"},
		},
	}

	return text, toolCalls, "tool_use"
}

// turn2Response simulates the agent writing a summary file based on findings.
func turn2Response() (string, []shared.ToolCall, string) {
	text := "I found the project structure. Let me create a quick summary of what I discovered."

	toolCalls := []shared.ToolCall{
		{
			ID:       fmt.Sprintf("call_%d_write", time.Now().UnixNano()),
			ToolName: "write_file",
			Input: map[string]any{
				"path":    "/tmp/ssenrah-agent-demo.txt",
				"content": "Agent Demo Summary\n==================\nThe ssenrah harness is a Go + Bubbletea TUI agent\nwith hexagonal DDD architecture.\n\nThis file was created by the agent loop demo.\n",
			},
		},
	}

	return text, toolCalls, "tool_use"
}

// turn3Response produces the final summary after all tool calls are done.
func turn3Response(toolResults int) string {
	return fmt.Sprintf(strings.TrimSpace(`
## Agent Loop Demo Complete

Here's what I did across **%d tool executions**:

1. **Read** the go.mod file to understand the module structure
2. **Ran** a shell command to list the directory contents
3. **Wrote** a summary file to /tmp/ssenrah-agent-demo.txt

### How It Works

The agent loop runs in a goroutine, streaming each response to the TUI.
When I need to use a tool, the loop pauses and requests your approval.
After you approve (Y), deny (N), or always-allow (A), execution continues.

Each turn follows this cycle:

`+"```"+`
User message
  -> LLM streams response
  -> Tool calls detected?
     Yes -> Show approval modal -> Execute -> Feed results back
     No  -> Done
`+"```"+`

This is the **v0.3 agent loop** in action!
`), toolResults)
}

// pickClassicResponse selects a canned response for non-tool mode.
func pickClassicResponse(req provider.ChatRequest) string {
	responses := []string{
		markdownDemo(),
		codeBlockDemo(),
		tableDemo(),
	}
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
