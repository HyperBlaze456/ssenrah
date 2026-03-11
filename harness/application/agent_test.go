package application

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/HyperBlaze456/ssenrah/harness/domain/conversation"
	"github.com/HyperBlaze456/ssenrah/harness/domain/provider"
	"github.com/HyperBlaze456/ssenrah/harness/domain/shared"
	"github.com/HyperBlaze456/ssenrah/harness/domain/tool"
)

// --- Test Helpers ---

type mockProvider struct {
	name     string
	streamFn func(ctx context.Context, req provider.ChatRequest, handler provider.StreamHandler) error
	chatFn   func(ctx context.Context, req provider.ChatRequest) (provider.ChatResponse, error)
	modelsFn func(ctx context.Context) ([]provider.ModelInfo, error)
}

func (m *mockProvider) Name() string { return m.name }
func (m *mockProvider) Chat(ctx context.Context, req provider.ChatRequest) (provider.ChatResponse, error) {
	if m.chatFn != nil {
		return m.chatFn(ctx, req)
	}
	return provider.ChatResponse{}, nil
}
func (m *mockProvider) ChatStream(ctx context.Context, req provider.ChatRequest, handler provider.StreamHandler) error {
	if m.streamFn != nil {
		return m.streamFn(ctx, req, handler)
	}
	return nil
}
func (m *mockProvider) Models(ctx context.Context) ([]provider.ModelInfo, error) {
	if m.modelsFn != nil {
		return m.modelsFn(ctx)
	}
	return nil, nil
}

type mockTool struct {
	name   string
	desc   string
	schema tool.ParameterSchema
	execFn func(ctx context.Context, input map[string]any) (tool.ToolResult, error)
}

func (m *mockTool) Name() string                  { return m.name }
func (m *mockTool) Description() string            { return m.desc }
func (m *mockTool) Parameters() tool.ParameterSchema { return m.schema }
func (m *mockTool) Execute(ctx context.Context, input map[string]any) (tool.ToolResult, error) {
	return m.execFn(ctx, input)
}

// collectEvents runs the agent in a goroutine and collects all events.
// approvalFn is called for each EventApprovalNeeded to provide a response.
// If approvalFn is nil, all approvals are granted.
func collectEvents(
	ctx context.Context,
	agent *AgentService,
	userMsg shared.Message,
	approvalFn func(EventApprovalNeeded) ApprovalResponse,
) []AgentEvent {
	eventCh := make(chan AgentEvent, 64)

	var events []AgentEvent
	var mu sync.Mutex
	var wg sync.WaitGroup

	wg.Add(1)
	go func() {
		defer wg.Done()
		for ev := range eventCh {
			mu.Lock()
			events = append(events, ev)
			mu.Unlock()

			if approvalEv, ok := ev.(EventApprovalNeeded); ok {
				resp := ApprovalResponse{Approved: true}
				if approvalFn != nil {
					resp = approvalFn(approvalEv)
				}
				approvalEv.ResponseCh <- resp
			}
		}
	}()

	agent.Run(ctx, userMsg, eventCh)
	wg.Wait()

	mu.Lock()
	defer mu.Unlock()
	return events
}

// hasEventType checks if the events slice contains an event of the given type.
func hasEventType[T AgentEvent](events []AgentEvent) bool {
	for _, ev := range events {
		if _, ok := ev.(T); ok {
			return true
		}
	}
	return false
}

// getEvent returns the first event of the given type, or the zero value and false.
func getEvent[T AgentEvent](events []AgentEvent) (T, bool) {
	for _, ev := range events {
		if typed, ok := ev.(T); ok {
			return typed, true
		}
	}
	var zero T
	return zero, false
}

// countEventType counts how many events match the given type.
func countEventType[T AgentEvent](events []AgentEvent) int {
	count := 0
	for _, ev := range events {
		if _, ok := ev.(T); ok {
			count++
		}
	}
	return count
}

// --- Tests ---

func TestAgentService_SingleTurn(t *testing.T) {
	prov := &mockProvider{
		name: "test",
		streamFn: func(_ context.Context, _ provider.ChatRequest, handler provider.StreamHandler) error {
			handler(shared.StreamChunk{Delta: "Hello "})
			handler(shared.StreamChunk{Delta: "world!"})
			handler(shared.StreamChunk{Done: true, StopReason: "end_turn"})
			return nil
		},
	}

	conv := conversation.New()
	reg := tool.NewRegistry()
	agent := NewAgentService(conv, prov, reg, "You are helpful.")
	agent.SetModel("test-model")

	userMsg := shared.NewMessage(shared.RoleUser, "Hi there")
	events := collectEvents(context.Background(), agent, userMsg, nil)

	// Should have stream chunks
	chunkCount := countEventType[EventStreamChunk](events)
	if chunkCount != 2 {
		t.Errorf("expected 2 stream chunks, got %d", chunkCount)
	}

	// Should have turn complete
	tc, ok := getEvent[EventTurnComplete](events)
	if !ok {
		t.Fatal("expected EventTurnComplete")
	}
	if tc.Turn != 1 {
		t.Errorf("expected turn 1, got %d", tc.Turn)
	}
	if tc.Message.Content != "Hello world!" {
		t.Errorf("expected 'Hello world!', got %q", tc.Message.Content)
	}

	// Should have done
	done, ok := getEvent[EventDone](events)
	if !ok {
		t.Fatal("expected EventDone")
	}
	if done.TotalTurns != 1 {
		t.Errorf("expected 1 total turn, got %d", done.TotalTurns)
	}
	if done.FinalMessage.Content != "Hello world!" {
		t.Errorf("expected 'Hello world!', got %q", done.FinalMessage.Content)
	}

	// No errors
	if hasEventType[EventError](events) {
		t.Error("unexpected EventError")
	}
}

func TestAgentService_ToolCall_Approved(t *testing.T) {
	var callCount atomic.Int32

	prov := &mockProvider{
		name: "test",
		streamFn: func(_ context.Context, _ provider.ChatRequest, handler provider.StreamHandler) error {
			n := callCount.Add(1)
			if n == 1 {
				// Turn 1: return a tool call
				handler(shared.StreamChunk{Delta: "Let me check."})
				handler(shared.StreamChunk{
					Done:       true,
					StopReason: "tool_use",
					ToolCalls: []shared.ToolCall{
						{ID: "call-1", ToolName: "read_file", Input: map[string]any{"path": "/tmp/test"}},
					},
				})
			} else {
				// Turn 2: return text
				handler(shared.StreamChunk{Delta: "The file contains data."})
				handler(shared.StreamChunk{Done: true, StopReason: "end_turn"})
			}
			return nil
		},
	}

	reg := tool.NewRegistry()
	_ = reg.Register(&mockTool{
		name: "read_file",
		desc: "Reads a file",
		schema: tool.ParameterSchema{
			Properties: map[string]tool.ParameterProperty{
				"path": {Type: "string", Description: "File path"},
			},
			Required: []string{"path"},
		},
		execFn: func(_ context.Context, input map[string]any) (tool.ToolResult, error) {
			return tool.ToolResult{Content: "file contents here", IsError: false}, nil
		},
	})

	conv := conversation.New()
	agent := NewAgentService(conv, prov, reg, "You are helpful.")

	userMsg := shared.NewMessage(shared.RoleUser, "Read my file")
	events := collectEvents(context.Background(), agent, userMsg, func(ev EventApprovalNeeded) ApprovalResponse {
		return ApprovalResponse{Approved: true}
	})

	// Verify event sequence: should have tool call, approval, tool result, two turn completes, done
	if !hasEventType[EventToolCall](events) {
		t.Error("expected EventToolCall")
	}
	if !hasEventType[EventApprovalNeeded](events) {
		t.Error("expected EventApprovalNeeded")
	}
	if !hasEventType[EventToolResult](events) {
		t.Error("expected EventToolResult")
	}

	turnCompletes := countEventType[EventTurnComplete](events)
	if turnCompletes != 2 {
		t.Errorf("expected 2 turn completes, got %d", turnCompletes)
	}

	done, ok := getEvent[EventDone](events)
	if !ok {
		t.Fatal("expected EventDone")
	}
	if done.TotalTurns != 2 {
		t.Errorf("expected 2 total turns, got %d", done.TotalTurns)
	}

	// Verify tool result content
	tr, _ := getEvent[EventToolResult](events)
	if tr.Result.Content != "file contents here" {
		t.Errorf("expected 'file contents here', got %q", tr.Result.Content)
	}

	// No errors
	if hasEventType[EventError](events) {
		t.Error("unexpected EventError")
	}
}

func TestAgentService_ToolCall_Denied(t *testing.T) {
	var callCount atomic.Int32

	prov := &mockProvider{
		name: "test",
		streamFn: func(_ context.Context, req provider.ChatRequest, handler provider.StreamHandler) error {
			n := callCount.Add(1)
			if n == 1 {
				// Turn 1: request tool call
				handler(shared.StreamChunk{
					Done:       true,
					StopReason: "tool_use",
					ToolCalls: []shared.ToolCall{
						{ID: "call-1", ToolName: "bash", Input: map[string]any{"cmd": "rm -rf /"}},
					},
				})
			} else {
				// Turn 2: LLM sees denial, responds with text
				handler(shared.StreamChunk{Delta: "I understand, I cannot run that command."})
				handler(shared.StreamChunk{Done: true, StopReason: "end_turn"})
			}
			return nil
		},
	}

	reg := tool.NewRegistry()
	_ = reg.Register(&mockTool{
		name:   "bash",
		desc:   "Execute a bash command",
		schema: tool.ParameterSchema{},
		execFn: func(_ context.Context, _ map[string]any) (tool.ToolResult, error) {
			t.Fatal("tool should not have been executed")
			return tool.ToolResult{}, nil
		},
	})

	conv := conversation.New()
	agent := NewAgentService(conv, prov, reg, "You are helpful.")

	userMsg := shared.NewMessage(shared.RoleUser, "Delete everything")
	events := collectEvents(context.Background(), agent, userMsg, func(ev EventApprovalNeeded) ApprovalResponse {
		return ApprovalResponse{Approved: false}
	})

	// Should complete without errors
	done, ok := getEvent[EventDone](events)
	if !ok {
		t.Fatal("expected EventDone")
	}
	if done.TotalTurns != 2 {
		t.Errorf("expected 2 total turns, got %d", done.TotalTurns)
	}

	// Verify denial message was appended to conversation
	history := conv.History()
	foundDenial := false
	for _, msg := range history {
		if msg.Role == shared.RoleTool && msg.ToolCallID == "call-1" {
			foundDenial = true
			if !containsStr(msg.Content, "denied") {
				t.Errorf("expected denial message, got %q", msg.Content)
			}
		}
	}
	if !foundDenial {
		t.Error("expected denial tool result message in conversation history")
	}

	// No errors
	if hasEventType[EventError](events) {
		t.Error("unexpected EventError")
	}
}

func TestAgentService_AlwaysAllow(t *testing.T) {
	var callCount atomic.Int32

	prov := &mockProvider{
		name: "test",
		streamFn: func(_ context.Context, _ provider.ChatRequest, handler provider.StreamHandler) error {
			n := callCount.Add(1)
			switch n {
			case 1:
				// Turn 1: first tool call
				handler(shared.StreamChunk{
					Done:       true,
					StopReason: "tool_use",
					ToolCalls: []shared.ToolCall{
						{ID: "call-1", ToolName: "read_file", Input: map[string]any{"path": "/a"}},
					},
				})
			case 2:
				// Turn 2: same tool again
				handler(shared.StreamChunk{
					Done:       true,
					StopReason: "tool_use",
					ToolCalls: []shared.ToolCall{
						{ID: "call-2", ToolName: "read_file", Input: map[string]any{"path": "/b"}},
					},
				})
			default:
				// Turn 3: done
				handler(shared.StreamChunk{Delta: "Done reading files."})
				handler(shared.StreamChunk{Done: true, StopReason: "end_turn"})
			}
			return nil
		},
	}

	reg := tool.NewRegistry()
	_ = reg.Register(&mockTool{
		name:   "read_file",
		desc:   "Reads a file",
		schema: tool.ParameterSchema{},
		execFn: func(_ context.Context, _ map[string]any) (tool.ToolResult, error) {
			return tool.ToolResult{Content: "data", IsError: false}, nil
		},
	})

	conv := conversation.New()
	agent := NewAgentService(conv, prov, reg, "You are helpful.")

	userMsg := shared.NewMessage(shared.RoleUser, "Read two files")
	approvalCount := 0
	events := collectEvents(context.Background(), agent, userMsg, func(ev EventApprovalNeeded) ApprovalResponse {
		approvalCount++
		// First time: always allow
		return ApprovalResponse{Approved: true, AlwaysAllow: true}
	})

	// Should only be asked once (second time is auto-approved)
	if approvalCount != 1 {
		t.Errorf("expected 1 approval request, got %d", approvalCount)
	}

	// Should have completed successfully
	done, ok := getEvent[EventDone](events)
	if !ok {
		t.Fatal("expected EventDone")
	}
	if done.TotalTurns != 3 {
		t.Errorf("expected 3 total turns, got %d", done.TotalTurns)
	}

	// No errors
	if hasEventType[EventError](events) {
		t.Error("unexpected EventError")
	}
}

func TestAgentService_MaxTurns(t *testing.T) {
	prov := &mockProvider{
		name: "test",
		streamFn: func(_ context.Context, _ provider.ChatRequest, handler provider.StreamHandler) error {
			// Always return a tool call to keep the loop going
			handler(shared.StreamChunk{
				Done:       true,
				StopReason: "tool_use",
				ToolCalls: []shared.ToolCall{
					{ID: "call-x", ToolName: "read_file", Input: map[string]any{}},
				},
			})
			return nil
		},
	}

	reg := tool.NewRegistry()
	_ = reg.Register(&mockTool{
		name:   "read_file",
		desc:   "Reads a file",
		schema: tool.ParameterSchema{},
		execFn: func(_ context.Context, _ map[string]any) (tool.ToolResult, error) {
			return tool.ToolResult{Content: "ok", IsError: false}, nil
		},
	})

	conv := conversation.New()
	agent := NewAgentService(conv, prov, reg, "You are helpful.")
	agent.SetMaxTurns(2)

	userMsg := shared.NewMessage(shared.RoleUser, "Keep going")
	events := collectEvents(context.Background(), agent, userMsg, func(ev EventApprovalNeeded) ApprovalResponse {
		return ApprovalResponse{Approved: true}
	})

	done, ok := getEvent[EventDone](events)
	if !ok {
		t.Fatal("expected EventDone")
	}
	if done.TotalTurns != 2 {
		t.Errorf("expected 2 total turns (max), got %d", done.TotalTurns)
	}

	turnCompletes := countEventType[EventTurnComplete](events)
	if turnCompletes != 2 {
		t.Errorf("expected 2 turn completes, got %d", turnCompletes)
	}

	// No errors
	if hasEventType[EventError](events) {
		t.Error("unexpected EventError")
	}
}

func TestAgentService_EmptyMessage(t *testing.T) {
	prov := &mockProvider{name: "test"}
	conv := conversation.New()
	reg := tool.NewRegistry()
	agent := NewAgentService(conv, prov, reg, "You are helpful.")

	userMsg := shared.NewMessage(shared.RoleUser, "   ")
	events := collectEvents(context.Background(), agent, userMsg, nil)

	errEv, ok := getEvent[EventError](events)
	if !ok {
		t.Fatal("expected EventError")
	}
	if !errors.Is(errEv.Err, shared.ErrEmptyMessage) {
		t.Errorf("expected ErrEmptyMessage, got %v", errEv.Err)
	}

	// Should not have any other events
	if hasEventType[EventDone](events) {
		t.Error("unexpected EventDone for empty message")
	}
}

func TestAgentService_ContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())

	prov := &mockProvider{
		name: "test",
		streamFn: func(_ context.Context, _ provider.ChatRequest, handler provider.StreamHandler) error {
			// Return a tool call, then context will be cancelled during processing
			handler(shared.StreamChunk{
				Done:       true,
				StopReason: "tool_use",
				ToolCalls: []shared.ToolCall{
					{ID: "call-1", ToolName: "slow_tool", Input: map[string]any{}},
				},
			})
			return nil
		},
	}

	reg := tool.NewRegistry()
	_ = reg.Register(&mockTool{
		name:   "slow_tool",
		desc:   "A slow tool",
		schema: tool.ParameterSchema{},
		execFn: func(_ context.Context, _ map[string]any) (tool.ToolResult, error) {
			return tool.ToolResult{Content: "ok"}, nil
		},
	})

	conv := conversation.New()
	agent := NewAgentService(conv, prov, reg, "You are helpful.")

	userMsg := shared.NewMessage(shared.RoleUser, "Do something")

	// Cancel context when approval is requested
	events := collectEvents(ctx, agent, userMsg, func(ev EventApprovalNeeded) ApprovalResponse {
		cancel()
		// Send a response to unblock, but context is already cancelled
		return ApprovalResponse{Approved: true}
	})

	// Should have an error event (either from cancellation check or from the loop)
	// The agent should terminate. We verify it did not hang.
	_ = events // Test passes if it completes without hanging
}

func TestAgentService_UnknownTool(t *testing.T) {
	var callCount atomic.Int32

	prov := &mockProvider{
		name: "test",
		streamFn: func(_ context.Context, _ provider.ChatRequest, handler provider.StreamHandler) error {
			n := callCount.Add(1)
			if n == 1 {
				handler(shared.StreamChunk{
					Done:       true,
					StopReason: "tool_use",
					ToolCalls: []shared.ToolCall{
						{ID: "call-1", ToolName: "nonexistent_tool", Input: map[string]any{}},
					},
				})
			} else {
				handler(shared.StreamChunk{Delta: "OK."})
				handler(shared.StreamChunk{Done: true, StopReason: "end_turn"})
			}
			return nil
		},
	}

	// Empty registry -- no tools registered
	reg := tool.NewRegistry()
	conv := conversation.New()
	agent := NewAgentService(conv, prov, reg, "You are helpful.")

	userMsg := shared.NewMessage(shared.RoleUser, "Use a tool")
	events := collectEvents(context.Background(), agent, userMsg, func(ev EventApprovalNeeded) ApprovalResponse {
		return ApprovalResponse{Approved: true}
	})

	// Should complete (unknown tool is handled gracefully, error message sent to LLM)
	done, ok := getEvent[EventDone](events)
	if !ok {
		t.Fatal("expected EventDone")
	}
	if done.TotalTurns != 2 {
		t.Errorf("expected 2 turns, got %d", done.TotalTurns)
	}

	// Verify unknown tool error was added to conversation
	history := conv.History()
	foundErr := false
	for _, msg := range history {
		if msg.Role == shared.RoleTool && containsStr(msg.Content, "Unknown tool") {
			foundErr = true
		}
	}
	if !foundErr {
		t.Error("expected unknown tool error message in conversation history")
	}
}

func TestAgentService_ToolExecutionError(t *testing.T) {
	var callCount atomic.Int32

	prov := &mockProvider{
		name: "test",
		streamFn: func(_ context.Context, _ provider.ChatRequest, handler provider.StreamHandler) error {
			n := callCount.Add(1)
			if n == 1 {
				handler(shared.StreamChunk{
					Done:       true,
					StopReason: "tool_use",
					ToolCalls: []shared.ToolCall{
						{ID: "call-1", ToolName: "failing_tool", Input: map[string]any{}},
					},
				})
			} else {
				handler(shared.StreamChunk{Delta: "I see the error."})
				handler(shared.StreamChunk{Done: true, StopReason: "end_turn"})
			}
			return nil
		},
	}

	reg := tool.NewRegistry()
	_ = reg.Register(&mockTool{
		name:   "failing_tool",
		desc:   "A tool that fails",
		schema: tool.ParameterSchema{},
		execFn: func(_ context.Context, _ map[string]any) (tool.ToolResult, error) {
			return tool.ToolResult{}, errors.New("disk full")
		},
	})

	conv := conversation.New()
	agent := NewAgentService(conv, prov, reg, "You are helpful.")

	userMsg := shared.NewMessage(shared.RoleUser, "Run the tool")
	events := collectEvents(context.Background(), agent, userMsg, func(ev EventApprovalNeeded) ApprovalResponse {
		return ApprovalResponse{Approved: true}
	})

	// Should complete without agent-level error (tool error is handled gracefully)
	done, ok := getEvent[EventDone](events)
	if !ok {
		t.Fatal("expected EventDone")
	}
	if done.TotalTurns != 2 {
		t.Errorf("expected 2 turns, got %d", done.TotalTurns)
	}

	// Verify error tool result event was emitted
	tr, ok := getEvent[EventToolResult](events)
	if !ok {
		t.Fatal("expected EventToolResult")
	}
	if !tr.Result.IsError {
		t.Error("expected tool result to be an error")
	}

	// Verify error was added to conversation
	history := conv.History()
	foundErr := false
	for _, msg := range history {
		if msg.Role == shared.RoleTool && containsStr(msg.Content, "Tool execution failed") {
			foundErr = true
		}
	}
	if !foundErr {
		t.Error("expected tool execution error in conversation history")
	}
}

// containsStr is a helper for substring checks in tests.
func containsStr(s, substr string) bool {
	return len(s) >= len(substr) && searchStr(s, substr)
}

func searchStr(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
