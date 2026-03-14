// Package task provides domain types and logic for task management in team execution.
package task

import (
	"time"

	"github.com/google/uuid"
)

// TaskStatus represents the lifecycle state of a task.
type TaskStatus string

const (
	// StatusPending indicates the task is waiting for dependencies or assignment.
	StatusPending TaskStatus = "pending"
	// StatusReady indicates all dependencies are met and the task can be claimed.
	StatusReady TaskStatus = "ready"
	// StatusRunning indicates the task is assigned to a worker.
	StatusRunning TaskStatus = "running"
	// StatusCompleted indicates the orchestrator verified and marked the task done.
	StatusCompleted TaskStatus = "completed"
	// StatusFailed indicates execution or verification failed.
	StatusFailed TaskStatus = "failed"
	// StatusCancelled indicates the task was cancelled by the orchestrator.
	StatusCancelled TaskStatus = "cancelled"
)

// TaskResult holds the outcome submitted by a worker and verification metadata.
// Workers submit results; the orchestrator sets Verified and VerifiedBy.
type TaskResult struct {
	// Content is the worker's output.
	Content string
	// Verified indicates whether the orchestrator has verified this result.
	Verified bool
	// VerifiedBy is the agent type that performed verification (empty if not verified).
	VerifiedBy string
}

// Task represents a unit of work in a team execution.
// It is an immutable template — status transitions are managed by the orchestrator via TaskGraph.
type Task struct {
	ID          string
	Description string
	Category    TaskCategory
	AgentType   string     // resolved agent type name
	Status      TaskStatus
	Priority    int        // lower = higher priority
	BlockedBy   []string   // task IDs this task depends on
	Result      *TaskResult // nil until completed
	Error       string     // non-empty if failed
	WorkerID    string     // assigned worker ID (empty if unassigned)
	CreatedAt   time.Time
	StartedAt   *time.Time  // nil until started
	CompletedAt *time.Time  // nil until completed
}

// NewTask creates a new Task with a generated UUID, the given description and category,
// StatusPending, and the current timestamp.
func NewTask(id, description string, category TaskCategory) Task {
	if id == "" {
		id = uuid.New().String()
	}
	return Task{
		ID:          id,
		Description: description,
		Category:    category,
		Status:      StatusPending,
		CreatedAt:   time.Now(),
	}
}
