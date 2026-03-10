// Package openrouter implements the OpenRouter LLM provider.
package openrouter

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/HyperBlaze456/ssenrah/harness/domain/provider"
	"github.com/HyperBlaze456/ssenrah/harness/domain/shared"
)

// Compile-time interface assertion.
var _ provider.LLMProvider = (*Provider)(nil)

const (
	baseURL   = "https://openrouter.ai/api/v1"
	httpReferer = "https://github.com/HyperBlaze456/ssenrah"
	appTitle  = "ssenrah"
)

// Provider implements provider.LLMProvider for OpenRouter.
type Provider struct {
	apiKey string
	client *http.Client
}

// NewProvider creates a new OpenRouter provider with the given API key.
func NewProvider(apiKey string) *Provider {
	return &Provider{
		apiKey: apiKey,
		client: &http.Client{},
	}
}

// Name returns the provider's display name.
func (p *Provider) Name() string { return "openrouter" }

// --- OpenAI-compatible wire types ---

type orMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type orChatRequest struct {
	Model       string      `json:"model"`
	Messages    []orMessage `json:"messages"`
	MaxTokens   int         `json:"max_tokens,omitempty"`
	Stream      bool        `json:"stream,omitempty"`
	Temperature *float64    `json:"temperature,omitempty"`
	TopP        *float64    `json:"top_p,omitempty"`
	Stop        []string    `json:"stop,omitempty"`
}

type orToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type orChoice struct {
	Message struct {
		Content   string       `json:"content"`
		ToolCalls []orToolCall `json:"tool_calls"`
	} `json:"message"`
	FinishReason string `json:"finish_reason"`
}

type orUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
}

type orChatResponse struct {
	Choices []orChoice `json:"choices"`
	Usage   orUsage    `json:"usage"`
}

type orStreamDelta struct {
	Content   string       `json:"content"`
	ToolCalls []orToolCall `json:"tool_calls"`
}

type orStreamChoice struct {
	Delta        orStreamDelta `json:"delta"`
	FinishReason *string       `json:"finish_reason"`
}

type orStreamChunk struct {
	ID      string           `json:"id"`
	Choices []orStreamChoice `json:"choices"`
	Usage   *orUsage         `json:"usage"`
}

type orModel struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	ContextLength int     `json:"context_length"`
	Pricing       struct {
		Prompt     string `json:"prompt"`
		Completion string `json:"completion"`
	} `json:"pricing"`
}

type orModelsResponse struct {
	Data []orModel `json:"data"`
}

// --- Helpers ---

func (p *Provider) newRequest(ctx context.Context, method, path string, body io.Reader) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, method, baseURL+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+p.apiKey)
	req.Header.Set("HTTP-Referer", httpReferer)
	req.Header.Set("X-Title", appTitle)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	return req, nil
}

func buildMessages(systemPrompt string, messages []shared.Message) []orMessage {
	var out []orMessage
	if systemPrompt != "" {
		out = append(out, orMessage{Role: "system", Content: systemPrompt})
	}
	for _, m := range messages {
		out = append(out, orMessage{Role: string(m.Role), Content: m.Content})
	}
	return out
}

func buildChatRequest(req provider.ChatRequest, stream bool) orChatRequest {
	r := orChatRequest{
		Model:     req.Model,
		Messages:  buildMessages(req.SystemPrompt, req.Messages),
		Stream:    stream,
	}
	if req.MaxTokens > 0 {
		r.MaxTokens = req.MaxTokens
	}
	if req.Options.Temperature != 0 {
		t := req.Options.Temperature
		r.Temperature = &t
	}
	if req.Options.TopP != 0 {
		tp := req.Options.TopP
		r.TopP = &tp
	}
	if len(req.Options.StopSequences) > 0 {
		r.Stop = req.Options.StopSequences
	}
	return r
}

func mapToolCalls(orCalls []orToolCall) []shared.ToolCall {
	if len(orCalls) == 0 {
		return nil
	}
	calls := make([]shared.ToolCall, len(orCalls))
	for i, tc := range orCalls {
		// Decode arguments JSON into map[string]any for shared.ToolCall.Input.
		var input map[string]any
		if tc.Function.Arguments != "" {
			_ = json.Unmarshal([]byte(tc.Function.Arguments), &input)
		}
		calls[i] = shared.ToolCall{
			ID:       tc.ID,
			ToolName: tc.Function.Name,
			Input:    input,
		}
	}
	return calls
}

func parseFloat(s string) float64 {
	var f float64
	fmt.Sscanf(s, "%f", &f)
	return f
}

// --- LLMProvider methods ---

// Chat sends a non-streaming request and returns the complete response.
func (p *Provider) Chat(ctx context.Context, req provider.ChatRequest) (provider.ChatResponse, error) {
	payload, err := json.Marshal(buildChatRequest(req, false))
	if err != nil {
		return provider.ChatResponse{}, fmt.Errorf("%w: marshal: %v", shared.ErrProviderUnavailable, err)
	}

	httpReq, err := p.newRequest(ctx, http.MethodPost, "/chat/completions", bytes.NewReader(payload))
	if err != nil {
		return provider.ChatResponse{}, fmt.Errorf("%w: %v", shared.ErrProviderUnavailable, err)
	}

	resp, err := p.client.Do(httpReq)
	if err != nil {
		if ctx.Err() != nil {
			return provider.ChatResponse{}, shared.ErrStreamCancelled
		}
		return provider.ChatResponse{}, fmt.Errorf("%w: %v", shared.ErrProviderUnavailable, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return provider.ChatResponse{}, fmt.Errorf("%w: status %d: %s", shared.ErrProviderUnavailable, resp.StatusCode, string(body))
	}

	var orResp orChatResponse
	if err := json.NewDecoder(resp.Body).Decode(&orResp); err != nil {
		return provider.ChatResponse{}, fmt.Errorf("%w: decode: %v", shared.ErrProviderUnavailable, err)
	}

	if len(orResp.Choices) == 0 {
		return provider.ChatResponse{}, fmt.Errorf("%w: empty choices", shared.ErrProviderUnavailable)
	}

	choice := orResp.Choices[0]
	return provider.ChatResponse{
		TextContent: choice.Message.Content,
		ToolCalls:   mapToolCalls(choice.Message.ToolCalls),
		StopReason:  choice.FinishReason,
		Usage: shared.Usage{
			InputTokens:  orResp.Usage.PromptTokens,
			OutputTokens: orResp.Usage.CompletionTokens,
		},
	}, nil
}

// ChatStream sends a streaming request. handler is called for each delta chunk.
// Returns shared.ErrStreamCancelled if ctx is cancelled during streaming.
func (p *Provider) ChatStream(ctx context.Context, req provider.ChatRequest, handler provider.StreamHandler) error {
	payload, err := json.Marshal(buildChatRequest(req, true))
	if err != nil {
		return fmt.Errorf("%w: marshal: %v", shared.ErrProviderUnavailable, err)
	}

	httpReq, err := p.newRequest(ctx, http.MethodPost, "/chat/completions", bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("%w: %v", shared.ErrProviderUnavailable, err)
	}
	httpReq.Header.Set("Accept", "text/event-stream")

	resp, err := p.client.Do(httpReq)
	if err != nil {
		if ctx.Err() != nil {
			return shared.ErrStreamCancelled
		}
		return fmt.Errorf("%w: %v", shared.ErrProviderUnavailable, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("%w: status %d: %s", shared.ErrProviderUnavailable, resp.StatusCode, string(body))
	}

	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		// Check for context cancellation between lines.
		select {
		case <-ctx.Done():
			return shared.ErrStreamCancelled
		default:
		}

		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}

		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			handler(shared.StreamChunk{Done: true})
			return nil
		}

		var chunk orStreamChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			// Malformed chunk — skip rather than abort.
			continue
		}

		if len(chunk.Choices) == 0 {
			continue
		}

		delta := chunk.Choices[0].Delta.Content
		if delta != "" {
			handler(shared.StreamChunk{
				Delta:     delta,
				MessageID: chunk.ID,
			})
		}
	}

	if err := scanner.Err(); err != nil {
		if ctx.Err() != nil {
			return shared.ErrStreamCancelled
		}
		return fmt.Errorf("%w: read: %v", shared.ErrProviderUnavailable, err)
	}

	return nil
}

// Models returns the list of models available on OpenRouter.
func (p *Provider) Models(ctx context.Context) ([]provider.ModelInfo, error) {
	httpReq, err := p.newRequest(ctx, http.MethodGet, "/models", nil)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", shared.ErrProviderUnavailable, err)
	}
	httpReq.Header.Del("Content-Type")

	resp, err := p.client.Do(httpReq)
	if err != nil {
		if ctx.Err() != nil {
			return nil, shared.ErrStreamCancelled
		}
		return nil, fmt.Errorf("%w: %v", shared.ErrProviderUnavailable, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("%w: status %d: %s", shared.ErrProviderUnavailable, resp.StatusCode, string(body))
	}

	var modelsResp orModelsResponse
	if err := json.NewDecoder(resp.Body).Decode(&modelsResp); err != nil {
		return nil, fmt.Errorf("%w: decode: %v", shared.ErrProviderUnavailable, err)
	}

	models := make([]provider.ModelInfo, 0, len(modelsResp.Data))
	for _, m := range modelsResp.Data {
		models = append(models, provider.ModelInfo{
			ID:                  m.ID,
			Name:                m.Name,
			ContextWindow:       m.ContextLength,
			PricePerInputToken:  parseFloat(m.Pricing.Prompt),
			PricePerOutputToken: parseFloat(m.Pricing.Completion),
		})
	}
	return models, nil
}
