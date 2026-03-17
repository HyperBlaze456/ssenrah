package application

import (
	"context"
	"fmt"
	"testing"

	"github.com/HyperBlaze456/ssenrah/harness/domain/provider"
	"github.com/HyperBlaze456/ssenrah/harness/domain/task"
)

// mockLLMProvider is a test double for provider.LLMProvider.
type mockLLMProvider struct {
	chatResponse provider.ChatResponse
	chatErr      error
}

func (m *mockLLMProvider) Name() string { return "mock" }
func (m *mockLLMProvider) Chat(_ context.Context, _ provider.ChatRequest) (provider.ChatResponse, error) {
	return m.chatResponse, m.chatErr
}
func (m *mockLLMProvider) ChatStream(_ context.Context, _ provider.ChatRequest, _ provider.StreamHandler) error {
	return fmt.Errorf("not implemented")
}
func (m *mockLLMProvider) Models(_ context.Context) ([]provider.ModelInfo, error) {
	return nil, nil
}

func TestDecomposer_Decompose_ParsesJSON(t *testing.T) {
	prov := &mockLLMProvider{
		chatResponse: provider.ChatResponse{
			TextContent: `[
				{"id": "explore-code", "description": "Read the codebase", "category": "explore", "blocked_by": [], "priority": 0},
				{"id": "impl-feature", "description": "Implement the feature", "category": "implement", "blocked_by": ["explore-code"], "priority": 1},
				{"id": "verify-feature", "description": "Verify the feature works", "category": "verify", "blocked_by": ["impl-feature"], "priority": 2}
			]`,
		},
	}

	d := NewDecomposer(prov, "test-model")
	specs, err := d.Decompose(context.Background(), "Add a login page")
	if err != nil {
		t.Fatalf("Decompose: %v", err)
	}

	if len(specs) != 3 {
		t.Fatalf("expected 3 specs, got %d", len(specs))
	}

	// Verify first task.
	if specs[0].ID != "explore-code" {
		t.Errorf("specs[0].ID = %q, want %q", specs[0].ID, "explore-code")
	}
	if specs[0].Category != task.CategoryExplore {
		t.Errorf("specs[0].Category = %q, want %q", specs[0].Category, task.CategoryExplore)
	}
	if len(specs[0].BlockedBy) != 0 {
		t.Errorf("specs[0].BlockedBy = %v, want empty", specs[0].BlockedBy)
	}

	// Verify second task depends on first.
	if len(specs[1].BlockedBy) != 1 || specs[1].BlockedBy[0] != "explore-code" {
		t.Errorf("specs[1].BlockedBy = %v, want [explore-code]", specs[1].BlockedBy)
	}

	// Verify priorities.
	if specs[0].Priority != 0 {
		t.Errorf("specs[0].Priority = %d, want 0", specs[0].Priority)
	}
	if specs[2].Priority != 2 {
		t.Errorf("specs[2].Priority = %d, want 2", specs[2].Priority)
	}
}

func TestDecomposer_Decompose_HandlesCodeFences(t *testing.T) {
	prov := &mockLLMProvider{
		chatResponse: provider.ChatResponse{
			TextContent: "```json\n" + `[
				{"id": "task-1", "description": "Do something", "category": "generic", "blocked_by": [], "priority": 0}
			]` + "\n```",
		},
	}

	d := NewDecomposer(prov, "test-model")
	specs, err := d.Decompose(context.Background(), "Build a thing")
	if err != nil {
		t.Fatalf("Decompose: %v", err)
	}

	if len(specs) != 1 {
		t.Fatalf("expected 1 spec, got %d", len(specs))
	}
	if specs[0].ID != "task-1" {
		t.Errorf("specs[0].ID = %q, want %q", specs[0].ID, "task-1")
	}
}

func TestDecomposer_Decompose_InvalidJSON(t *testing.T) {
	prov := &mockLLMProvider{
		chatResponse: provider.ChatResponse{
			TextContent: "Sure! Here are the tasks I would suggest...",
		},
	}

	d := NewDecomposer(prov, "test-model")
	_, err := d.Decompose(context.Background(), "Do something")
	if err == nil {
		t.Fatal("expected error for invalid JSON, got nil")
	}
}

func TestDecomposer_Decompose_EmptyTasks(t *testing.T) {
	prov := &mockLLMProvider{
		chatResponse: provider.ChatResponse{
			TextContent: "[]",
		},
	}

	d := NewDecomposer(prov, "test-model")
	_, err := d.Decompose(context.Background(), "Do something")
	if err == nil {
		t.Fatal("expected error for empty tasks, got nil")
	}
}

func TestDecomposer_Decompose_ValidatesCategory(t *testing.T) {
	prov := &mockLLMProvider{
		chatResponse: provider.ChatResponse{
			TextContent: `[
				{"id": "bad-cat", "description": "Task with bad category", "category": "nonsense", "blocked_by": [], "priority": 0}
			]`,
		},
	}

	d := NewDecomposer(prov, "test-model")
	specs, err := d.Decompose(context.Background(), "Do something")
	if err != nil {
		t.Fatalf("Decompose: %v", err)
	}

	if len(specs) != 1 {
		t.Fatalf("expected 1 spec, got %d", len(specs))
	}
	if specs[0].Category != task.CategoryGeneric {
		t.Errorf("expected category %q for invalid input, got %q", task.CategoryGeneric, specs[0].Category)
	}
}

func TestDecomposer_Decompose_ValidatesDependencies(t *testing.T) {
	prov := &mockLLMProvider{
		chatResponse: provider.ChatResponse{
			TextContent: `[
				{"id": "real-task", "description": "A real task", "category": "explore", "blocked_by": [], "priority": 0},
				{"id": "dep-task", "description": "Depends on ghost", "category": "implement", "blocked_by": ["real-task", "ghost-task"], "priority": 1}
			]`,
		},
	}

	d := NewDecomposer(prov, "test-model")
	specs, err := d.Decompose(context.Background(), "Do something")
	if err != nil {
		t.Fatalf("Decompose: %v", err)
	}

	if len(specs) != 2 {
		t.Fatalf("expected 2 specs, got %d", len(specs))
	}

	// The second task should only have "real-task" as a dependency; "ghost-task" should be dropped.
	if len(specs[1].BlockedBy) != 1 {
		t.Fatalf("expected 1 dep, got %d: %v", len(specs[1].BlockedBy), specs[1].BlockedBy)
	}
	if specs[1].BlockedBy[0] != "real-task" {
		t.Errorf("expected dep %q, got %q", "real-task", specs[1].BlockedBy[0])
	}
}

func TestDecomposer_Decompose_ProviderError(t *testing.T) {
	prov := &mockLLMProvider{
		chatErr: fmt.Errorf("network timeout"),
	}

	d := NewDecomposer(prov, "test-model")
	_, err := d.Decompose(context.Background(), "Do something")
	if err == nil {
		t.Fatal("expected error when provider fails, got nil")
	}
}
