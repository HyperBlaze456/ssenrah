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

// TestNewTeamStartedEvent creates event with type EventTeamStarted and correct data fields.
func TestNewTeamStartedEvent(t *testing.T) {
	goal := "build a web scraper"
	taskCount := 5

	ev := NewTeamStartedEvent(goal, taskCount)

	if ev.Type != event.EventTeamStarted {
		t.Errorf("Type = %q, want %q", ev.Type, event.EventTeamStarted)
	}
	if ev.ID == "" {
		t.Error("ID is empty")
	}
	if ev.Timestamp.IsZero() {
		t.Error("Timestamp is zero")
	}

	checkStringField := func(key, want string) {
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
	checkIntField := func(key string, want int) {
		t.Helper()
		val, ok := ev.Data[key]
		if !ok {
			t.Errorf("Data[%q] missing", key)
			return
		}
		got, ok := val.(int)
		if !ok {
			t.Errorf("Data[%q] is %T, want int", key, val)
			return
		}
		if got != want {
			t.Errorf("Data[%q] = %d, want %d", key, got, want)
		}
	}

	checkStringField("goal_description", goal)
	checkIntField("task_count", taskCount)
}

// TestNewTeamCompletedEvent creates event with type EventTeamCompleted and correct data fields.
func TestNewTeamCompletedEvent(t *testing.T) {
	totalTasks := 10
	completed := 8
	failed := 2

	ev := NewTeamCompletedEvent(totalTasks, completed, failed)

	if ev.Type != event.EventTeamCompleted {
		t.Errorf("Type = %q, want %q", ev.Type, event.EventTeamCompleted)
	}
	if ev.ID == "" {
		t.Error("ID is empty")
	}
	if ev.Timestamp.IsZero() {
		t.Error("Timestamp is zero")
	}

	checkIntField := func(key string, want int) {
		t.Helper()
		val, ok := ev.Data[key]
		if !ok {
			t.Errorf("Data[%q] missing", key)
			return
		}
		got, ok := val.(int)
		if !ok {
			t.Errorf("Data[%q] is %T, want int", key, val)
			return
		}
		if got != want {
			t.Errorf("Data[%q] = %d, want %d", key, got, want)
		}
	}

	checkIntField("total_tasks", totalTasks)
	checkIntField("completed", completed)
	checkIntField("failed", failed)
}

// TestNewTaskEvent creates events for task lifecycle transitions with correct type and data fields.
func TestNewTaskEvent(t *testing.T) {
	taskID := "task-123"
	description := "implement feature X"
	agentType := "executor"

	taskEventTypes := []event.EventType{
		event.EventTaskCreated,
		event.EventTaskReady,
		event.EventTaskAssigned,
		event.EventTaskCompleted,
		event.EventTaskFailed,
	}

	for _, evType := range taskEventTypes {
		t.Run(string(evType), func(t *testing.T) {
			ev := NewTaskEvent(evType, taskID, description, agentType)

			if ev.Type != evType {
				t.Errorf("Type = %q, want %q", ev.Type, evType)
			}
			if ev.ID == "" {
				t.Error("ID is empty")
			}
			if ev.Timestamp.IsZero() {
				t.Error("Timestamp is zero")
			}

			checkStringField := func(key, want string) {
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

			checkStringField("task_id", taskID)
			checkStringField("description", description)
			checkStringField("agent_type", agentType)
		})
	}
}

// TestNewWorkerEvent creates events for worker lifecycle transitions with correct type and data fields.
func TestNewWorkerEvent(t *testing.T) {
	workerID := "worker-abc"
	taskID := "task-456"

	workerEventTypes := []event.EventType{
		event.EventWorkerStarted,
		event.EventWorkerIdle,
		event.EventWorkerNudged,
		event.EventWorkerKilled,
	}

	for _, evType := range workerEventTypes {
		t.Run(string(evType), func(t *testing.T) {
			ev := NewWorkerEvent(evType, workerID, taskID)

			if ev.Type != evType {
				t.Errorf("Type = %q, want %q", ev.Type, evType)
			}
			if ev.ID == "" {
				t.Error("ID is empty")
			}
			if ev.Timestamp.IsZero() {
				t.Error("Timestamp is zero")
			}

			checkStringField := func(key, want string) {
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

			checkStringField("worker_id", workerID)
			checkStringField("task_id", taskID)
		})
	}
}

// TestMemoryEventLogger_TeamEventTypes verifies the logger stores and filters team event types.
func TestMemoryEventLogger_TeamEventTypes(t *testing.T) {
	l := NewMemoryEventLogger()

	_ = l.Log(event.Event{ID: "1", Type: event.EventTeamStarted})
	_ = l.Log(event.Event{ID: "2", Type: event.EventTaskCreated})
	_ = l.Log(event.Event{ID: "3", Type: event.EventTaskAssigned})
	_ = l.Log(event.Event{ID: "4", Type: event.EventWorkerStarted})
	_ = l.Log(event.Event{ID: "5", Type: event.EventTeamCompleted})

	if got := len(l.Events()); got != 5 {
		t.Fatalf("Events() returned %d events, want 5", got)
	}

	teamStarted := l.EventsByType(event.EventTeamStarted)
	if len(teamStarted) != 1 {
		t.Fatalf("EventsByType(EventTeamStarted) = %d, want 1", len(teamStarted))
	}

	taskCreated := l.EventsByType(event.EventTaskCreated)
	if len(taskCreated) != 1 {
		t.Fatalf("EventsByType(EventTaskCreated) = %d, want 1", len(taskCreated))
	}

	workerStarted := l.EventsByType(event.EventWorkerStarted)
	if len(workerStarted) != 1 {
		t.Fatalf("EventsByType(EventWorkerStarted) = %d, want 1", len(workerStarted))
	}

	teamCompleted := l.EventsByType(event.EventTeamCompleted)
	if len(teamCompleted) != 1 {
		t.Fatalf("EventsByType(EventTeamCompleted) = %d, want 1", len(teamCompleted))
	}

	// Unlogged types return empty
	workerKilled := l.EventsByType(event.EventWorkerKilled)
	if len(workerKilled) != 0 {
		t.Fatalf("EventsByType(EventWorkerKilled) = %d, want 0", len(workerKilled))
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
