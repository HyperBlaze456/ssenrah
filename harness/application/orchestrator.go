package application

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/HyperBlaze456/ssenrah/harness/domain/event"
	"github.com/HyperBlaze456/ssenrah/harness/domain/task"
	"github.com/HyperBlaze456/ssenrah/harness/infrastructure/logging"
)

// TaskSpec describes a task to be added to the orchestrator.
type TaskSpec struct {
	ID          string
	Description string
	Category    task.TaskCategory
	BlockedBy   []string
	Priority    int
}

// OrchestratorService coordinates team execution.
// It decomposes goals into task DAGs, assigns agent types via the matcher,
// runs batches through the worker pool, and owns task completion verification.
type OrchestratorService struct {
	pool        *WorkerPool
	matcher     *AgentMatcher
	eventLogger event.EventLogger
	graph       *task.TaskGraph

	mu      sync.Mutex
	cancel  context.CancelFunc
	done    chan struct{}
	running bool
}

// NewOrchestratorService creates an OrchestratorService.
func NewOrchestratorService(
	pool *WorkerPool,
	matcher *AgentMatcher,
	logger event.EventLogger,
) *OrchestratorService {
	return &OrchestratorService{
		pool:        pool,
		matcher:     matcher,
		eventLogger: logger,
		graph:       task.NewTaskGraph(),
	}
}

// AddTask creates a task, assigns an agent type via the matcher, and adds it to the graph.
func (o *OrchestratorService) AddTask(id, description string, category task.TaskCategory, blockedBy []string, priority int) error {
	t := task.NewTask(id, description, category)
	t.BlockedBy = blockedBy
	t.Priority = priority

	// Match agent type.
	match := o.matcher.Match(t)
	t.AgentType = match.AgentType

	if err := o.graph.Add(t); err != nil {
		return fmt.Errorf("add task %q: %w", id, err)
	}

	o.logEvent(logging.NewTaskEvent(event.EventTaskCreated, t.ID, t.Description, t.AgentType))
	return nil
}

// AddTasks is a batch version of AddTask. All tasks are added first, then agent
// types are matched in bulk via MatchAll and applied to the graph.
func (o *OrchestratorService) AddTasks(specs []TaskSpec) error {
	tasks := make([]task.Task, 0, len(specs))
	for _, s := range specs {
		t := task.NewTask(s.ID, s.Description, s.Category)
		t.BlockedBy = s.BlockedBy
		t.Priority = s.Priority
		tasks = append(tasks, t)
	}

	// Add all tasks to graph first (validates deps, detects cycles).
	for _, t := range tasks {
		if err := o.graph.Add(t); err != nil {
			return fmt.Errorf("add task %q: %w", t.ID, err)
		}
	}

	// Match all tasks and update agent types in the graph.
	matches := o.matcher.MatchAll(tasks)
	for i, m := range matches {
		if gt, ok := o.graph.Get(tasks[i].ID); ok {
			gt.AgentType = m.AgentType
		}
		o.logEvent(logging.NewTaskEvent(event.EventTaskCreated, tasks[i].ID, tasks[i].Description, m.AgentType))
	}

	return nil
}

// Run executes the task graph to completion. It logs team lifecycle events and
// drives batches through the worker pool. Returns error only on context cancellation.
func (o *OrchestratorService) Run(ctx context.Context) error {
	return o.RunWithCallback(ctx, nil)
}

// RunWithCallback is like Run but calls onBatch after each batch completes,
// providing current graph stats for progress reporting (e.g. TUI updates).
func (o *OrchestratorService) RunWithCallback(ctx context.Context, onBatch func(stats task.GraphStats)) error {
	ctx, cancel := context.WithCancel(ctx)

	o.mu.Lock()
	o.cancel = cancel
	o.done = make(chan struct{})
	o.running = true
	o.mu.Unlock()

	defer func() {
		cancel()
		o.mu.Lock()
		o.running = false
		o.cancel = nil
		close(o.done)
		o.mu.Unlock()
	}()

	stats := o.graph.Stats()
	o.logEvent(logging.NewTeamStartedEvent("team execution", stats.Total))

	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for {
		// Check cancellation first.
		select {
		case <-ctx.Done():
			o.pool.CancelAll()
			finalStats := o.graph.Stats()
			o.logEvent(logging.NewTeamCompletedEvent(finalStats.Total, finalStats.Completed, finalStats.Failed))
			return ctx.Err()
		default:
		}

		if o.graph.IsComplete() {
			break
		}

		ready := o.graph.Ready()
		if len(ready) == 0 {
			currentStats := o.graph.Stats()
			if currentStats.Running == 0 {
				// No tasks ready, none running, graph not complete — blocked tasks
				// have unsatisfiable dependencies (predecessor failed/cancelled).
				// Cancel all remaining pending tasks to unblock completion.
				for _, t := range o.graph.All() {
					if t.Status == task.StatusPending {
						_ = o.graph.Cancel(t.ID)
					}
				}
				break
			}
			// Tasks are still running; wait for next tick.
			select {
			case <-ctx.Done():
				o.pool.CancelAll()
				finalStats := o.graph.Stats()
				o.logEvent(logging.NewTeamCompletedEvent(finalStats.Total, finalStats.Completed, finalStats.Failed))
				return ctx.Err()
			case <-ticker.C:
				continue
			}
		}

		// Log ready tasks.
		for _, t := range ready {
			o.logEvent(logging.NewTaskEvent(event.EventTaskReady, t.ID, t.Description, t.AgentType))
		}

		// Execute batch — blocks until this batch completes.
		o.pool.ExecuteBatch(ctx, ready, o.graph)

		if onBatch != nil {
			onBatch(o.graph.Stats())
		}
	}

	finalStats := o.graph.Stats()
	o.logEvent(logging.NewTeamCompletedEvent(finalStats.Total, finalStats.Completed, finalStats.Failed))
	return nil
}

// Graph returns the internal task graph (for TUI status display).
func (o *OrchestratorService) Graph() *task.TaskGraph {
	return o.graph
}

// Stats returns current graph statistics.
func (o *OrchestratorService) Stats() task.GraphStats {
	return o.graph.Stats()
}

// Cancel cancels a running execution.
func (o *OrchestratorService) Cancel() {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.cancel != nil {
		o.cancel()
	}
}

// IsRunning reports whether Run is currently active.
func (o *OrchestratorService) IsRunning() bool {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.running
}

// logEvent logs an event, silently ignoring errors.
func (o *OrchestratorService) logEvent(ev event.Event) {
	if o.eventLogger != nil {
		_ = o.eventLogger.Log(ev)
	}
}
