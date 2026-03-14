package logging

import (
	"sync"
	"time"

	"github.com/HyperBlaze456/ssenrah/harness/domain/event"
	"github.com/HyperBlaze456/ssenrah/harness/domain/policy"
	"github.com/google/uuid"
)

// Compile-time interface check.
var _ event.EventLogger = (*MemoryEventLogger)(nil)

// MemoryEventLogger is an in-memory EventLogger for v0.4a.
type MemoryEventLogger struct {
	mu     sync.RWMutex
	events []event.Event
}

// NewMemoryEventLogger creates a new MemoryEventLogger.
func NewMemoryEventLogger() *MemoryEventLogger {
	return &MemoryEventLogger{
		events: make([]event.Event, 0),
	}
}

// Log appends an event to the in-memory store.
func (l *MemoryEventLogger) Log(ev event.Event) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if ev.ID == "" {
		ev.ID = uuid.New().String()
	}
	if ev.Timestamp.IsZero() {
		ev.Timestamp = time.Now()
	}
	l.events = append(l.events, ev)
	return nil
}

// Flush is a no-op for the memory implementation.
func (l *MemoryEventLogger) Flush() error {
	return nil
}

// Events returns a copy of all logged events.
func (l *MemoryEventLogger) Events() []event.Event {
	l.mu.RLock()
	defer l.mu.RUnlock()
	result := make([]event.Event, len(l.events))
	copy(result, l.events)
	return result
}

// EventsByType returns events filtered by type.
func (l *MemoryEventLogger) EventsByType(t event.EventType) []event.Event {
	l.mu.RLock()
	defer l.mu.RUnlock()
	var result []event.Event
	for _, ev := range l.events {
		if ev.Type == t {
			result = append(result, ev)
		}
	}
	return result
}

// NewTeamStartedEvent creates an Event for the start of a team execution.
func NewTeamStartedEvent(goalDescription string, taskCount int) event.Event {
	return event.Event{
		ID:        uuid.New().String(),
		Type:      event.EventTeamStarted,
		Timestamp: time.Now(),
		Data: map[string]any{
			"goal_description": goalDescription,
			"task_count":       taskCount,
		},
	}
}

// NewTeamCompletedEvent creates an Event for the completion of a team execution.
func NewTeamCompletedEvent(totalTasks, completed, failed int) event.Event {
	return event.Event{
		ID:        uuid.New().String(),
		Type:      event.EventTeamCompleted,
		Timestamp: time.Now(),
		Data: map[string]any{
			"total_tasks": totalTasks,
			"completed":   completed,
			"failed":      failed,
		},
	}
}

// NewTaskEvent creates an Event for a task lifecycle transition.
func NewTaskEvent(eventType event.EventType, taskID, description, agentType string) event.Event {
	return event.Event{
		ID:        uuid.New().String(),
		Type:      eventType,
		Timestamp: time.Now(),
		Data: map[string]any{
			"task_id":     taskID,
			"description": description,
			"agent_type":  agentType,
		},
	}
}

// NewWorkerEvent creates an Event for a worker lifecycle transition.
func NewWorkerEvent(eventType event.EventType, workerID, taskID string) event.Event {
	return event.Event{
		ID:        uuid.New().String(),
		Type:      eventType,
		Timestamp: time.Now(),
		Data: map[string]any{
			"worker_id": workerID,
			"task_id":   taskID,
		},
	}
}

// NewPolicyEvent creates an Event for a policy evaluation.
func NewPolicyEvent(toolName string, decision policy.PolicyDecision, tierName string, reason string) event.Event {
	return event.Event{
		ID:        uuid.New().String(),
		Type:      event.EventPolicyEval,
		Timestamp: time.Now(),
		Data: map[string]any{
			"tool_name": toolName,
			"decision":  decision.String(),
			"tier_name": tierName,
			"reason":    reason,
		},
	}
}
