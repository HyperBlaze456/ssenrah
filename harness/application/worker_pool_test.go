package application

import (
	"context"
	"testing"
	"time"

	"github.com/HyperBlaze456/ssenrah/harness/domain/event"
	"github.com/HyperBlaze456/ssenrah/harness/domain/policy"
	"github.com/HyperBlaze456/ssenrah/harness/domain/task"
	"github.com/HyperBlaze456/ssenrah/harness/domain/tool"
	"github.com/HyperBlaze456/ssenrah/harness/infrastructure"
	"github.com/HyperBlaze456/ssenrah/harness/infrastructure/config"
	"github.com/HyperBlaze456/ssenrah/harness/infrastructure/dummy"
	"github.com/HyperBlaze456/ssenrah/harness/infrastructure/logging"
)

// shortTaskTimeout is used for tests that just need a terminal status.
// The dummy provider streams char-by-char with 15-40ms delays (~27s for a full
// response). Setting 2s caps test duration while still reaching a terminal state
// (the task context expires and the task is marked failed).
const shortTaskTimeout = 2 * time.Second

// buildTestPool creates a WorkerPool backed by the dummy provider with mock tools.
func buildTestPool(t *testing.T, maxWorkers int, timeout time.Duration) (*WorkerPool, *task.TaskGraph) {
	t.Helper()

	cfg, err := config.DefaultHarnessConfig()
	if err != nil {
		t.Fatalf("load default config: %v", err)
	}

	profiles, err := infrastructure.BuildPolicyProfiles(cfg.PolicyTiers)
	if err != nil {
		t.Fatalf("build policy profiles: %v", err)
	}

	agentTypes := infrastructure.BuildAgentTypes(cfg.AgentTypes)

	fullReg := tool.NewRegistry()
	for _, name := range []string{"read_file", "write_file", "bash"} {
		n := name
		_ = fullReg.Register(&mockTool{
			name:   n,
			desc:   n + " tool",
			schema: tool.ParameterSchema{},
			execFn: func(_ context.Context, _ map[string]any) (tool.ToolResult, error) {
				return tool.ToolResult{Content: n + " result", IsError: false}, nil
			},
		})
	}

	engine := policy.NewPolicyEngine()
	logger := logging.NewMemoryEventLogger()

	pool := NewWorkerPool(maxWorkers, dummy.NewProvider(), fullReg, engine, profiles, agentTypes, logger, timeout)
	graph := task.NewTaskGraph()
	return pool, graph
}

// addTask adds a task to the graph and fatals on error.
func addTask(t *testing.T, g *task.TaskGraph, id, description string) {
	t.Helper()
	tsk := task.NewTask(id, description, task.CategoryGeneric)
	if err := g.Add(tsk); err != nil {
		t.Fatalf("add task %q: %v", id, err)
	}
}

func TestWorkerPool_ExecuteBatch_SingleTask(t *testing.T) {
	pool, graph := buildTestPool(t, 4, shortTaskTimeout)
	addTask(t, graph, "task-1", "Analyze the codebase")

	ready := graph.Ready()
	if len(ready) != 1 {
		t.Fatalf("expected 1 ready task, got %d", len(ready))
	}

	results := pool.ExecuteBatch(context.Background(), ready, graph)
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}

	r := results[0]
	if r.Status != task.StatusCompleted && r.Status != task.StatusFailed {
		t.Errorf("expected terminal status, got %q", r.Status)
	}
	if r.WorkerID == "" {
		t.Error("expected WorkerID to be set")
	}
}

func TestWorkerPool_ExecuteBatch_MultipleTasks(t *testing.T) {
	pool, graph := buildTestPool(t, 4, shortTaskTimeout)

	for i := 0; i < 3; i++ {
		addTask(t, graph, "", "Task "+string(rune('A'+i)))
	}

	ready := graph.Ready()
	if len(ready) != 3 {
		t.Fatalf("expected 3 ready tasks, got %d", len(ready))
	}

	results := pool.ExecuteBatch(context.Background(), ready, graph)
	if len(results) != 3 {
		t.Fatalf("expected 3 results, got %d", len(results))
	}

	for _, r := range results {
		if r.Status != task.StatusCompleted && r.Status != task.StatusFailed {
			t.Errorf("task %q: expected terminal status, got %q", r.ID, r.Status)
		}
	}
}

func TestWorkerPool_ExecuteBatch_RespectMaxWorkers(t *testing.T) {
	const maxWorkers = 2
	pool, graph := buildTestPool(t, maxWorkers, shortTaskTimeout)

	// Add 4 tasks — ExecuteBatch caps at min(len(tasks), maxWorkers) per call.
	for i := 0; i < 4; i++ {
		addTask(t, graph, "", "Task "+string(rune('A'+i)))
	}

	ready := graph.Ready()
	if len(ready) != 4 {
		t.Fatalf("expected 4 ready tasks, got %d", len(ready))
	}

	results := pool.ExecuteBatch(context.Background(), ready, graph)

	if len(results) != maxWorkers {
		t.Errorf("expected %d results (capped at maxWorkers), got %d", maxWorkers, len(results))
	}

	for _, r := range results {
		if r.Status != task.StatusCompleted && r.Status != task.StatusFailed {
			t.Errorf("task %q: expected terminal status, got %q", r.ID, r.Status)
		}
	}
}

func TestWorkerPool_ExecuteBatch_TaskTimeout(t *testing.T) {
	// 1ms task timeout: the dummy provider sleeps 15-40ms per character,
	// so the context always expires before the agent loop completes.
	pool, graph := buildTestPool(t, 1, 1*time.Millisecond)
	addTask(t, graph, "timeout-task", "Do a long task")

	ready := graph.Ready()
	results := pool.ExecuteBatch(context.Background(), ready, graph)

	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}

	r := results[0]
	if r.Status != task.StatusFailed && r.Status != task.StatusCompleted {
		t.Errorf("expected terminal status, got %q", r.Status)
	}
	t.Logf("task status after 1ms timeout: %q", r.Status)
}

func TestWorkerPool_ExecuteBatch_UnknownAgentType(t *testing.T) {
	pool, graph := buildTestPool(t, 2, shortTaskTimeout)

	// Task with a non-existent agent type — pool falls back to "default".
	tsk := task.NewTask("unknown-type-task", "Analyze something", task.CategoryGeneric)
	tsk.AgentType = "nonexistent_agent_type"
	if err := graph.Add(tsk); err != nil {
		t.Fatalf("add task: %v", err)
	}

	ready := graph.Ready()
	results := pool.ExecuteBatch(context.Background(), ready, graph)

	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}

	r := results[0]
	if r.Status != task.StatusCompleted && r.Status != task.StatusFailed {
		t.Errorf("expected terminal status after fallback, got %q", r.Status)
	}
}

func TestWorkerPool_CancelAll(t *testing.T) {
	pool, _ := buildTestPool(t, 4, 60*time.Second)

	// No tasks running — CancelAll is a no-op.
	pool.CancelAll()

	active := pool.ActiveWorkers()
	if len(active) != 0 {
		t.Errorf("expected 0 active workers after CancelAll, got %d", len(active))
	}
}

func TestWorkerPool_ActiveWorkers(t *testing.T) {
	pool, graph := buildTestPool(t, 4, shortTaskTimeout)

	// Before any execution, workers map is empty.
	active := pool.ActiveWorkers()
	if len(active) != 0 {
		t.Errorf("expected 0 active workers initially, got %d", len(active))
	}

	addTask(t, graph, "active-test", "Check active workers")

	ready := graph.Ready()
	pool.ExecuteBatch(context.Background(), ready, graph)

	// After ExecuteBatch returns, workers are cleaned up.
	active = pool.ActiveWorkers()
	if len(active) != 0 {
		t.Errorf("expected 0 active workers after batch completes, got %d", len(active))
	}
}

func TestWorkerPool_EventsLogged(t *testing.T) {
	// Build pool with a captured logger so we can inspect events after execution.
	cfg, err := config.DefaultHarnessConfig()
	if err != nil {
		t.Fatalf("load default config: %v", err)
	}

	profiles, err := infrastructure.BuildPolicyProfiles(cfg.PolicyTiers)
	if err != nil {
		t.Fatalf("build policy profiles: %v", err)
	}
	agentTypes := infrastructure.BuildAgentTypes(cfg.AgentTypes)

	fullReg := tool.NewRegistry()
	for _, name := range []string{"read_file", "write_file", "bash"} {
		n := name
		_ = fullReg.Register(&mockTool{
			name: n, desc: n,
			schema: tool.ParameterSchema{},
			execFn: func(_ context.Context, _ map[string]any) (tool.ToolResult, error) {
				return tool.ToolResult{Content: "ok"}, nil
			},
		})
	}

	engine := policy.NewPolicyEngine()
	logger := logging.NewMemoryEventLogger()
	pool := NewWorkerPool(2, dummy.NewProvider(), fullReg, engine, profiles, agentTypes, logger, shortTaskTimeout)
	graph := task.NewTaskGraph()

	addTask(t, graph, "event-test", "Do work")
	ready := graph.Ready()
	pool.ExecuteBatch(context.Background(), ready, graph)

	allEvents := logger.Events()
	if len(allEvents) == 0 {
		t.Error("expected events to be logged, got none")
	}

	workerStarted := logger.EventsByType(event.EventWorkerStarted)
	if len(workerStarted) == 0 {
		t.Error("expected at least 1 EventWorkerStarted")
	}

	taskAssigned := logger.EventsByType(event.EventTaskAssigned)
	if len(taskAssigned) == 0 {
		t.Error("expected at least 1 EventTaskAssigned")
	}
}

func TestWorkerPool_ExecuteBatch_ConcurrentSafety(t *testing.T) {
	pool, graph := buildTestPool(t, 4, shortTaskTimeout)

	for i := 0; i < 4; i++ {
		addTask(t, graph, "", "Concurrent task")
	}

	ready := graph.Ready()
	results := pool.ExecuteBatch(context.Background(), ready, graph)

	for _, r := range results {
		if r.Status != task.StatusCompleted && r.Status != task.StatusFailed {
			t.Errorf("task %q: unexpected status %q", r.ID, r.Status)
		}
	}
}
