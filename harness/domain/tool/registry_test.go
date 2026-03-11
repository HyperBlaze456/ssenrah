package tool

import (
	"context"
	"fmt"
	"sync"
	"testing"
)

// mockTool is a minimal Tool implementation for testing.
type mockTool struct {
	name        string
	description string
}

func (m *mockTool) Name() string        { return m.name }
func (m *mockTool) Description() string { return m.description }
func (m *mockTool) Parameters() ParameterSchema {
	return ParameterSchema{Properties: map[string]ParameterProperty{}, Required: nil}
}
func (m *mockTool) Execute(_ context.Context, _ map[string]any) (ToolResult, error) {
	return ToolResult{Content: "ok"}, nil
}

func newMock(name string) *mockTool { return &mockTool{name: name, description: name + "-desc"} }

func TestRegisterAndGet(t *testing.T) {
	r := NewRegistry()
	tool := newMock("bash")

	if err := r.Register(tool); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	got, ok := r.Get("bash")
	if !ok {
		t.Fatal("expected tool to be found")
	}
	if got.Name() != "bash" {
		t.Errorf("expected name %q, got %q", "bash", got.Name())
	}
}

func TestRegisterDuplicate(t *testing.T) {
	r := NewRegistry()
	if err := r.Register(newMock("grep")); err != nil {
		t.Fatalf("first register failed: %v", err)
	}
	err := r.Register(newMock("grep"))
	if err == nil {
		t.Fatal("expected error on duplicate registration, got nil")
	}
}

func TestList(t *testing.T) {
	r := NewRegistry()
	names := []string{"zebra", "apple", "mango"}
	for _, n := range names {
		if err := r.Register(newMock(n)); err != nil {
			t.Fatalf("register %q: %v", n, err)
		}
	}

	list := r.List()
	if len(list) != 3 {
		t.Fatalf("expected 3 tools, got %d", len(list))
	}
	// Expect alphabetical order.
	expected := []string{"apple", "mango", "zebra"}
	for i, want := range expected {
		if list[i].Name() != want {
			t.Errorf("index %d: expected %q, got %q", i, want, list[i].Name())
		}
	}
}

func TestCount(t *testing.T) {
	r := NewRegistry()
	if r.Count() != 0 {
		t.Errorf("expected 0, got %d", r.Count())
	}
	_ = r.Register(newMock("a"))
	_ = r.Register(newMock("b"))
	if r.Count() != 2 {
		t.Errorf("expected 2, got %d", r.Count())
	}
}

func TestConcurrentAccess(t *testing.T) {
	r := NewRegistry()
	var wg sync.WaitGroup
	const goroutines = 50

	// Half goroutines register unique tools; half read.
	for i := 0; i < goroutines; i++ {
		i := i
		wg.Add(1)
		go func() {
			defer wg.Done()
			name := fmt.Sprintf("tool-%d", i)
			_ = r.Register(newMock(name))
			_, _ = r.Get(name)
			_ = r.List()
			_ = r.Count()
		}()
	}
	wg.Wait()
}
