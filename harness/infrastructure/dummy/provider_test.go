package dummy

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/HyperBlaze456/ssenrah/harness/domain/provider"
	"github.com/HyperBlaze456/ssenrah/harness/domain/shared"
)

func TestChat_DecompositionRequest(t *testing.T) {
	p := NewProvider()

	req := provider.ChatRequest{
		Model:        "dummy-v1",
		SystemPrompt: "You are a task decomposition engine for an agent harness.",
		Messages:     []shared.Message{shared.NewMessage(shared.RoleUser, "Build a REST API")},
		MaxTokens:    2048,
	}

	resp, err := p.Chat(context.Background(), req)
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}

	// Response must be valid JSON array.
	var tasks []struct {
		ID          string   `json:"id"`
		Description string   `json:"description"`
		Category    string   `json:"category"`
		BlockedBy   []string `json:"blocked_by"`
		Priority    int      `json:"priority"`
	}
	if err := json.Unmarshal([]byte(resp.TextContent), &tasks); err != nil {
		t.Fatalf("response is not valid JSON: %v\nresponse: %s", err, resp.TextContent)
	}

	if len(tasks) == 0 {
		t.Fatal("expected at least 1 task, got 0")
	}

	// Verify task structure.
	for _, task := range tasks {
		if task.ID == "" {
			t.Error("task has empty ID")
		}
		if task.Description == "" {
			t.Error("task has empty description")
		}
		if task.Category == "" {
			t.Error("task has empty category")
		}
	}

	// Verify goal is incorporated into descriptions.
	foundGoal := false
	for _, task := range tasks {
		if strings.Contains(task.Description, "Build a REST API") {
			foundGoal = true
			break
		}
	}
	if !foundGoal {
		t.Error("expected at least one task description to reference the user's goal")
	}

	// Verify dependencies are internally consistent.
	idSet := make(map[string]bool)
	for _, task := range tasks {
		idSet[task.ID] = true
	}
	for _, task := range tasks {
		for _, dep := range task.BlockedBy {
			if !idSet[dep] {
				t.Errorf("task %q depends on %q which doesn't exist", task.ID, dep)
			}
		}
	}
}

func TestChat_NonDecompositionRequest(t *testing.T) {
	p := NewProvider()

	// Regular chat request (no decomposition system prompt, no tools).
	req := provider.ChatRequest{
		Model:        "dummy-v1",
		SystemPrompt: "You are a helpful assistant.",
		Messages:     []shared.Message{shared.NewMessage(shared.RoleUser, "Hello")},
	}

	resp, err := p.Chat(context.Background(), req)
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}

	// Should NOT return JSON — should return markdown demo text.
	var tasks []any
	if err := json.Unmarshal([]byte(resp.TextContent), &tasks); err == nil {
		t.Error("expected non-JSON response for regular chat, but got valid JSON")
	}

	if resp.TextContent == "" {
		t.Error("expected non-empty response")
	}
}

