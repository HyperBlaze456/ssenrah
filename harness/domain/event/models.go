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

	// Team orchestration events
	EventTeamStarted   EventType = "team_started"   // team execution began
	EventTeamCompleted EventType = "team_completed"  // team execution finished
	EventTaskCreated   EventType = "task_created"    // task added to graph
	EventTaskReady     EventType = "task_ready"      // task dependencies satisfied
	EventTaskAssigned  EventType = "task_assigned"   // task assigned to worker
	EventTaskCompleted EventType = "task_completed"  // task verified and done
	EventTaskFailed    EventType = "task_failed"     // task execution failed
	EventWorkerStarted EventType = "worker_started"  // worker began processing
	EventWorkerIdle    EventType = "worker_idle"     // worker detected as idle
	EventWorkerNudged  EventType = "worker_nudged"   // idle worker was nudged
	EventWorkerKilled  EventType = "worker_killed"   // idle worker was killed
)

// Event represents a single recorded harness event.
type Event struct {
	ID        string
	Type      EventType
	Timestamp time.Time
	Data      map[string]any
}
