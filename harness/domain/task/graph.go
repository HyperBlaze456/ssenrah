package task

import (
	"fmt"
	"sort"
	"time"
)

// GraphStats holds per-status counts for all tasks in a TaskGraph.
type GraphStats struct {
	Total     int
	Pending   int
	Ready     int
	Running   int
	Completed int
	Failed    int
	Cancelled int
}

// TaskGraph is a directed acyclic graph (DAG) of tasks that provides
// dependency-aware scheduling. All state transitions are orchestrator-driven.
type TaskGraph struct {
	tasks map[string]*Task
}

// NewTaskGraph returns an empty TaskGraph.
func NewTaskGraph() *TaskGraph {
	return &TaskGraph{
		tasks: make(map[string]*Task),
	}
}

// Add inserts task into the graph. It returns an error if a task with the same
// ID already exists or if adding the task would create a circular dependency.
func (g *TaskGraph) Add(task Task) error {
	if _, exists := g.tasks[task.ID]; exists {
		return fmt.Errorf("task %q already exists in graph", task.ID)
	}
	// Validate all declared dependencies exist.
	for _, depID := range task.BlockedBy {
		if _, ok := g.tasks[depID]; !ok {
			return fmt.Errorf("dependency %q not found for task %q", depID, task.ID)
		}
	}
	// Temporarily insert so cycle detection can traverse through this node.
	g.tasks[task.ID] = &task
	if err := g.detectCycle(task.ID); err != nil {
		delete(g.tasks, task.ID)
		return err
	}
	return nil
}

// detectCycle performs a DFS from startID and returns an error if a cycle is found.
func (g *TaskGraph) detectCycle(startID string) error {
	visited := make(map[string]bool)
	inStack := make(map[string]bool)

	var dfs func(id string) error
	dfs = func(id string) error {
		visited[id] = true
		inStack[id] = true

		task, ok := g.tasks[id]
		if !ok {
			return nil
		}
		for _, depID := range task.BlockedBy {
			if !visited[depID] {
				if err := dfs(depID); err != nil {
					return err
				}
			} else if inStack[depID] {
				return fmt.Errorf("circular dependency detected involving task %q", depID)
			}
		}

		inStack[id] = false
		return nil
	}

	return dfs(startID)
}

// Get returns the task with the given ID, or false if not found.
func (g *TaskGraph) Get(id string) (*Task, bool) {
	t, ok := g.tasks[id]
	return t, ok
}

// All returns a copy of all tasks sorted by priority (ascending), then by ID for stability.
func (g *TaskGraph) All() []Task {
	out := make([]Task, 0, len(g.tasks))
	for _, t := range g.tasks {
		out = append(out, *t)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Priority != out[j].Priority {
			return out[i].Priority < out[j].Priority
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// Ready returns all tasks that are in StatusPending and whose every dependency
// is in a terminal state (StatusCompleted). The returned slice is sorted by
// priority ascending, then ID for stability.
func (g *TaskGraph) Ready() []Task {
	var out []Task
	for _, t := range g.tasks {
		if t.Status != StatusPending {
			continue
		}
		if g.depsCompleted(t.BlockedBy) {
			out = append(out, *t)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Priority != out[j].Priority {
			return out[i].Priority < out[j].Priority
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// depsCompleted reports whether all tasks in ids are in StatusCompleted.
func (g *TaskGraph) depsCompleted(ids []string) bool {
	for _, id := range ids {
		dep, ok := g.tasks[id]
		if !ok || dep.Status != StatusCompleted {
			return false
		}
	}
	return true
}

// Claim transitions a task from StatusPending or StatusReady to StatusRunning
// and assigns workerID. It returns an error if the task does not exist, is not
// in a claimable state, or its dependencies are not yet completed.
func (g *TaskGraph) Claim(id string, workerID string) error {
	t, ok := g.tasks[id]
	if !ok {
		return fmt.Errorf("task %q not found", id)
	}
	if t.Status != StatusPending && t.Status != StatusReady {
		return fmt.Errorf("task %q cannot be claimed: status is %q", id, t.Status)
	}
	if !g.depsCompleted(t.BlockedBy) {
		return fmt.Errorf("task %q cannot be claimed: dependencies not completed", id)
	}
	now := time.Now()
	t.Status = StatusRunning
	t.WorkerID = workerID
	t.StartedAt = &now
	return nil
}

// Complete transitions a task from StatusRunning to StatusCompleted and records
// the result. Only the orchestrator should call this after verifying the work.
func (g *TaskGraph) Complete(id string, result TaskResult) error {
	t, ok := g.tasks[id]
	if !ok {
		return fmt.Errorf("task %q not found", id)
	}
	if t.Status != StatusRunning {
		return fmt.Errorf("task %q cannot be completed: status is %q", id, t.Status)
	}
	now := time.Now()
	t.Status = StatusCompleted
	t.Result = &result
	t.CompletedAt = &now
	return nil
}

// Fail transitions a task from StatusRunning to StatusFailed and records errMsg.
func (g *TaskGraph) Fail(id string, errMsg string) error {
	t, ok := g.tasks[id]
	if !ok {
		return fmt.Errorf("task %q not found", id)
	}
	if t.Status != StatusRunning {
		return fmt.Errorf("task %q cannot be failed: status is %q", id, t.Status)
	}
	now := time.Now()
	t.Status = StatusFailed
	t.Error = errMsg
	t.CompletedAt = &now
	return nil
}

// Cancel transitions a task to StatusCancelled from any non-terminal state.
// It returns an error if the task is already in a terminal state.
func (g *TaskGraph) Cancel(id string) error {
	t, ok := g.tasks[id]
	if !ok {
		return fmt.Errorf("task %q not found", id)
	}
	switch t.Status {
	case StatusCompleted, StatusFailed, StatusCancelled:
		return fmt.Errorf("task %q cannot be cancelled: status is %q", id, t.Status)
	}
	now := time.Now()
	t.Status = StatusCancelled
	t.CompletedAt = &now
	return nil
}

// IsComplete reports whether every task in the graph is in a terminal state
// (StatusCompleted, StatusFailed, or StatusCancelled).
func (g *TaskGraph) IsComplete() bool {
	for _, t := range g.tasks {
		switch t.Status {
		case StatusCompleted, StatusFailed, StatusCancelled:
			// terminal — continue
		default:
			return false
		}
	}
	return true
}

// Stats returns per-status counts for all tasks in the graph.
func (g *TaskGraph) Stats() GraphStats {
	s := GraphStats{Total: len(g.tasks)}
	for _, t := range g.tasks {
		switch t.Status {
		case StatusPending:
			s.Pending++
		case StatusReady:
			s.Ready++
		case StatusRunning:
			s.Running++
		case StatusCompleted:
			s.Completed++
		case StatusFailed:
			s.Failed++
		case StatusCancelled:
			s.Cancelled++
		}
	}
	return s
}
