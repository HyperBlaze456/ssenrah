package event

import "time"

// EventType categorizes a harness event.
type EventType string

const (
	EventToolCall   EventType = "tool_call"
	EventToolResult EventType = "tool_result"
	EventMessage    EventType = "message"
	EventError      EventType = "error"
	EventPolicyEval EventType = "policy_eval"
)

// Event represents a single recorded harness event.
type Event struct {
	ID        string
	Type      EventType
	Timestamp time.Time
	Data      map[string]any
}
