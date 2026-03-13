package logging

import (
	"sync"
	"testing"

	"github.com/HyperBlaze456/ssenrah/harness/domain/event"
	"github.com/HyperBlaze456/ssenrah/harness/domain/policy"
)

// TestMemoryEventLogger_InterfaceSatisfaction verifies the compile-time check.
func TestMemoryEventLogger_InterfaceSatisfaction(t *testing.T) {
	var _ event.EventLogger = (*MemoryEventLogger)(nil)
}

// TestMemoryEventLogger_EmptyEvents returns empty slice initially, not nil.
func TestMemoryEventLogger_EmptyEvents(t *testing.T) {
	l := NewMemoryEventLogger()
	events := l.Events()
	if events == nil {
		t.Fatal("Events() returned nil, want empty slice")
	}
	if len(events) != 0 {
		t.Fatalf("Events() returned %d events, want 0", len(events))
	}
}

// TestMemoryEventLogger_Log logs events and Events() returns them in order.
func TestMemoryEventLogger_Log(t *testing.T) {
	l := NewMemoryEventLogger()

	ev1 := event.Event{ID: "a", Type: event.EventMessage, Data: map[string]any{"text": "hello"}}
	ev2 := event.Event{ID: "b", Type: event.EventToolCall, Data: map[string]any{"tool": "bash"}}

	if err := l.Log(ev1); err != nil {
		t.Fatalf("Log(ev1) error: %v", err)
	}
	if err := l.Log(ev2); err != nil {
		t.Fatalf("Log(ev2) error: %v", err)
	}

	events := l.Events()
	if len(events) != 2 {
		t.Fatalf("got %d events, want 2", len(events))
	}
	if events[0].ID != "a" {
		t.Errorf("events[0].ID = %q, want %q", events[0].ID, "a")
	}
	if events[1].ID != "b" {
		t.Errorf("events[1].ID = %q, want %q", events[1].ID, "b")
	}
}

// TestMemoryEventLogger_Log_AutoFillsIDAndTimestamp verifies that missing ID and
// zero Timestamp are populated automatically.
func TestMemoryEventLogger_Log_AutoFillsIDAndTimestamp(t *testing.T) {
	l := NewMemoryEventLogger()

	ev := event.Event{Type: event.EventError}
	if err := l.Log(ev); err != nil {
		t.Fatalf("Log error: %v", err)
	}

	stored := l.Events()
	if stored[0].ID == "" {
		t.Error("ID was not auto-filled")
	}
	if stored[0].Timestamp.IsZero() {
		t.Error("Timestamp was not auto-filled")
	}
}

// TestMemoryEventLogger_EventsByType filters correctly by EventPolicyEval.
func TestMemoryEventLogger_EventsByType(t *testing.T) {
	l := NewMemoryEventLogger()

	_ = l.Log(event.Event{ID: "1", Type: event.EventMessage})
	_ = l.Log(event.Event{ID: "2", Type: event.EventPolicyEval})
	_ = l.Log(event.Event{ID: "3", Type: event.EventToolCall})
	_ = l.Log(event.Event{ID: "4", Type: event.EventPolicyEval})

	policyEvents := l.EventsByType(event.EventPolicyEval)
	if len(policyEvents) != 2 {
		t.Fatalf("EventsByType(EventPolicyEval) returned %d events, want 2", len(policyEvents))
	}
	for _, ev := range policyEvents {
		if ev.Type != event.EventPolicyEval {
			t.Errorf("got event type %q, want %q", ev.Type, event.EventPolicyEval)
		}
	}

	msgEvents := l.EventsByType(event.EventMessage)
	if len(msgEvents) != 1 {
		t.Fatalf("EventsByType(EventMessage) returned %d events, want 1", len(msgEvents))
	}

	errEvents := l.EventsByType(event.EventError)
	if len(errEvents) != 0 {
		t.Fatalf("EventsByType(EventError) returned %d events, want 0", len(errEvents))
	}
}

// TestMemoryEventLogger_Flush returns nil (no-op).
func TestMemoryEventLogger_Flush(t *testing.T) {
	l := NewMemoryEventLogger()
	if err := l.Flush(); err != nil {
		t.Fatalf("Flush() returned error: %v", err)
	}
}

// TestMemoryEventLogger_ThreadSafe exercises concurrent Log + Events calls.
func TestMemoryEventLogger_ThreadSafe(t *testing.T) {
	l := NewMemoryEventLogger()
	const goroutines = 50
	const eventsPerGoroutine = 20

	var wg sync.WaitGroup
	wg.Add(goroutines * 2)

	// Writers
	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			for j := 0; j < eventsPerGoroutine; j++ {
				_ = l.Log(event.Event{Type: event.EventMessage})
			}
		}()
	}

	// Readers
	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			for j := 0; j < eventsPerGoroutine; j++ {
				_ = l.Events()
			}
		}()
	}

	wg.Wait()

	total := len(l.Events())
	expected := goroutines * eventsPerGoroutine
	if total != expected {
		t.Errorf("after concurrent writes got %d events, want %d", total, expected)
	}
}

// TestNewPolicyEvent creates event with type EventPolicyEval and correct data fields.
func TestNewPolicyEvent(t *testing.T) {
	toolName := "bash"
	decision := policy.Allow
	tierName := "default"
	reason := "allowed by default policy"

	ev := NewPolicyEvent(toolName, decision, tierName, reason)

	if ev.Type != event.EventPolicyEval {
		t.Errorf("Type = %q, want %q", ev.Type, event.EventPolicyEval)
	}
	if ev.ID == "" {
		t.Error("ID is empty")
	}
	if ev.Timestamp.IsZero() {
		t.Error("Timestamp is zero")
	}

	checkField := func(key, want string) {
		t.Helper()
		val, ok := ev.Data[key]
		if !ok {
			t.Errorf("Data[%q] missing", key)
			return
		}
		got, ok := val.(string)
		if !ok {
			t.Errorf("Data[%q] is %T, want string", key, val)
			return
		}
		if got != want {
			t.Errorf("Data[%q] = %q, want %q", key, got, want)
		}
	}

	checkField("tool_name", toolName)
	checkField("decision", decision.String())
	checkField("tier_name", tierName)
	checkField("reason", reason)
}
