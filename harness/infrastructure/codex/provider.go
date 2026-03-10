// Package codex implements the OpenAI Codex (OpenAI-compatible) LLM provider.
package codex

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/HyperBlaze456/ssenrah/harness/domain/provider"
	"github.com/HyperBlaze456/ssenrah/harness/domain/shared"
)

// Compile-time interface assertion.
var _ provider.LLMProvider = (*Provider)(nil)

const baseURL = "https://api.openai.com/v1"

// oSeriesModels is the set of model ID prefixes that use the "developer" role
// for system-level instructions.
var oSeriesModels = map[string]bool{
	"o1":       true,
	"o3":       true,
	"o1-mini":  true,
	"o3-mini":  true,
	"o1-pro":   true,
}

// knownModels holds hardcoded metadata for well-known OpenAI models.
var knownModels = map[string]provider.ModelInfo{
	"gpt-4o": {
		ID:                  "gpt-4o",
		Name:                "GPT-4o",
		ContextWindow:       128000,
		PricePerInputToken:  0.000005,
		PricePerOutputToken: 0.000015,
	},
	"gpt-4o-mini": {
		ID:                  "gpt-4o-mini",
		Name:                "GPT-4o Mini",
		ContextWindow:       128000,
		PricePerInputToken:  0.00000015,
		PricePerOutputToken: 0.0000006,
	},
	"o1": {
		ID:                  "o1",
		Name:                "o1",
		ContextWindow:       200000,
		PricePerInputToken:  0.000015,
		PricePerOutputToken: 0.00006,
	},
	"o3-mini": {
		ID:                  "o3-mini",
		Name:                "o3-mini",
		ContextWindow:       200000,
		PricePerInputToken:  0.0000011,
		PricePerOutputToken: 0.0000044,
	},
	"codex-mini-latest": {
		ID:                  "codex-mini-latest",
		Name:                "Codex Mini (Latest)",
		ContextWindow:       200000,
		PricePerInputToken:  0.0000015,
		PricePerOutputToken: 0.000006,
	},
}

// Provider implements provider.LLMProvider for the OpenAI API.
type Provider struct {
	apiKey string
	client *http.Client
}

// NewProvider creates a new Codex provider with the given API key.
func NewProvider(apiKey string) *Provider {
	return &Provider{
		apiKey: apiKey,
		client: &http.Client{Timeout: 120 * time.Second},
	}
}

// Name returns the provider's display name.
func (p *Provider) Name() string { return "codex" }

// --- OpenAI wire types ---

type openAIMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type openAIChatRequest struct {
	Model       string          `json:"model"`
	Messages    []openAIMessage `json:"messages"`
	MaxTokens   int             `json:"max_tokens,omitempty"`
	Temperature *float64        `json:"temperature,omitempty"`
	TopP        *float64        `json:"top_p,omitempty"`
	Stop        []string        `json:"stop,omitempty"`
	Stream      bool            `json:"stream,omitempty"`
}

type openAIChoice struct {
	Message      *openAIMessage  `json:"message"`
	Delta        *openAIMessage  `json:"delta"`
	FinishReason string          `json:"finish_reason"`
}

type openAIUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
}

type openAIChatResponse struct {
	ID      string         `json:"id"`
	Choices []openAIChoice `json:"choices"`
	Usage   openAIUsage    `json:"usage"`
}

type openAIModel struct {
	ID string `json:"id"`
}

type openAIModelsResponse struct {
	Data []openAIModel `json:"data"`
}

// --- Helpers ---

// isOSeries returns true when the model uses reasoning-style "developer" role.
func isOSeries(model string) bool {
	for prefix := range oSeriesModels {
		if model == prefix || strings.HasPrefix(model, prefix+"-") {
			return true
		}
	}
	return false
}

// buildMessages converts a ChatRequest into the OpenAI message slice.
func buildMessages(req provider.ChatRequest) []openAIMessage {
	msgs := make([]openAIMessage, 0, len(req.Messages)+1)

	if req.SystemPrompt != "" {
		role := "system"
		if isOSeries(req.Model) {
			role = "developer"
		}
		msgs = append(msgs, openAIMessage{Role: role, Content: req.SystemPrompt})
	}

	for _, m := range req.Messages {
		msgs = append(msgs, openAIMessage{
			Role:    string(m.Role),
			Content: m.Content,
		})
	}
	return msgs
}

// buildRequest constructs the OpenAI chat request body.
func buildRequest(req provider.ChatRequest, stream bool) openAIChatRequest {
	r := openAIChatRequest{
		Model:     req.Model,
		Messages:  buildMessages(req),
		MaxTokens: req.MaxTokens,
		Stream:    stream,
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

// doPost sends a POST request to the given path and returns the response body.
func (p *Provider) doPost(ctx context.Context, path string, body any) (*http.Response, error) {
	data, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("codex: marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+path, bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("codex: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+p.apiKey)

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, shared.ErrProviderUnavailable
	}
	return resp, nil
}

// doGet sends a GET request to the given path and returns the response body.
func (p *Provider) doGet(ctx context.Context, path string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+path, nil)
	if err != nil {
		return nil, fmt.Errorf("codex: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+p.apiKey)

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, shared.ErrProviderUnavailable
	}
	return resp, nil
}

// checkStatus returns ErrProviderUnavailable for 401/403 and a generic error for other non-2xx.
func checkStatus(resp *http.Response) error {
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return shared.ErrProviderUnavailable
	}
	return fmt.Errorf("codex: API error %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
}

// --- LLMProvider methods ---

// Chat sends a non-streaming request and returns the complete response.
func (p *Provider) Chat(ctx context.Context, req provider.ChatRequest) (provider.ChatResponse, error) {
	body := buildRequest(req, false)

	resp, err := p.doPost(ctx, "/chat/completions", body)
	if err != nil {
		return provider.ChatResponse{}, err
	}
	defer resp.Body.Close()

	if err := checkStatus(resp); err != nil {
		return provider.ChatResponse{}, err
	}

	var result openAIChatResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return provider.ChatResponse{}, fmt.Errorf("codex: decode response: %w", err)
	}

	var text string
	var stopReason string
	if len(result.Choices) > 0 {
		if result.Choices[0].Message != nil {
			text = result.Choices[0].Message.Content
		}
		stopReason = result.Choices[0].FinishReason
	}

	return provider.ChatResponse{
		TextContent: text,
		StopReason:  stopReason,
		Usage: shared.Usage{
			InputTokens:  result.Usage.PromptTokens,
			OutputTokens: result.Usage.CompletionTokens,
		},
	}, nil
}

// ChatStream sends a streaming request, calling handler for each content chunk.
func (p *Provider) ChatStream(ctx context.Context, req provider.ChatRequest, handler provider.StreamHandler) error {
	body := buildRequest(req, true)

	resp, err := p.doPost(ctx, "/chat/completions", body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if err := checkStatus(resp); err != nil {
		return err
	}

	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		select {
		case <-ctx.Done():
			return shared.ErrStreamCancelled
		default:
		}

		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		payload := strings.TrimPrefix(line, "data: ")
		if payload == "[DONE]" {
			handler(shared.StreamChunk{Done: true})
			return nil
		}

		var event openAIChatResponse
		if err := json.Unmarshal([]byte(payload), &event); err != nil {
			// Skip malformed SSE events.
			continue
		}

		if len(event.Choices) == 0 || event.Choices[0].Delta == nil {
			continue
		}

		delta := event.Choices[0].Delta.Content
		if delta == "" {
			continue
		}

		handler(shared.StreamChunk{
			Delta:     delta,
			MessageID: event.ID,
		})
	}

	if err := scanner.Err(); err != nil {
		select {
		case <-ctx.Done():
			return shared.ErrStreamCancelled
		default:
			return fmt.Errorf("codex: stream read error: %w", err)
		}
	}

	return nil
}

// chatCapable returns true for models that support the chat completions endpoint.
func chatCapable(id string) bool {
	// Include models whose IDs contain these substrings.
	chatPrefixes := []string{"gpt-", "o1", "o3", "o4", "codex"}
	for _, prefix := range chatPrefixes {
		if strings.Contains(id, prefix) {
			return true
		}
	}
	return false
}

// Models returns available chat-capable models from the OpenAI API.
func (p *Provider) Models(ctx context.Context) ([]provider.ModelInfo, error) {
	resp, err := p.doGet(ctx, "/models")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if err := checkStatus(resp); err != nil {
		return nil, err
	}

	var result openAIModelsResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("codex: decode models: %w", err)
	}

	models := make([]provider.ModelInfo, 0, len(result.Data))
	for _, m := range result.Data {
		if !chatCapable(m.ID) {
			continue
		}
		if info, ok := knownModels[m.ID]; ok {
			models = append(models, info)
		} else {
			models = append(models, provider.ModelInfo{
				ID:                  m.ID,
				Name:                m.ID,
				ContextWindow:       16384,
				PricePerInputToken:  0,
				PricePerOutputToken: 0,
			})
		}
	}
	return models, nil
}
