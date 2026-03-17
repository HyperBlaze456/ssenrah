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

// setupTestOrchestrator creates an OrchestratorService backed by the dummy provider.
func setupTestOrchestrator(t *testing.T) (*OrchestratorService, *logging.MemoryEventLogger) {
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

	pool := NewWorkerPool(
		cfg.Team.MaxWorkers,
		dummy.NewProvider(),
		fullReg,
		engine,
		profiles,
		agentTypes,
		logger,
		shortTaskTimeout,
	)

	matcher := NewAgentMatcher(cfg.Team.CategoryMap, agentTypes, "default")
	orch := NewOrchestratorService(pool, matcher, logger, nil)

	return orch, logger
}

func TestOrchestratorService_AddTask(t *testing.T) {
	orch, _ := setupTestOrchestrator(t)

	err := orch.AddTask("task-1", "Explore the codebase structure", task.CategoryExplore, nil, 1)
	if err != nil {
		t.Fatalf("AddTask: %v", err)
	}

	stats := orch.Stats()
	if stats.Total != 1 {
		t.Errorf("expected 1 total task, got %d", stats.Total)
	}

	got, ok := orch.Graph().Get("task-1")
	if !ok {
		t.Fatal("task-1 not found in graph")
	}
	if got.AgentType == "" {
		t.Error("expected matcher to assign an agent type")
	}
	if got.Priority != 1 {
		t.Errorf("expected priority 1, got %d", got.Priority)
	}
}

func TestOrchestratorService_AddTasks(t *testing.T) {
	orch, _ := setupTestOrchestrator(t)

	specs := []TaskSpec{
		{ID: "a", Description: "Explore project", Category: task.CategoryExplore, Priority: 1},
		{ID: "b", Description: "Implement feature", Category: task.CategoryImplement, BlockedBy: []string{"a"}, Priority: 2},
		{ID: "c", Description: "Test the feature", Category: task.CategoryTest, BlockedBy: []string{"b"}, Priority: 3},
	}

	if err := orch.AddTasks(specs); err != nil {
		t.Fatalf("AddTasks: %v", err)
	}

	stats := orch.Stats()
	if stats.Total != 3 {
		t.Errorf("expected 3 total tasks, got %d", stats.Total)
	}

	for _, id := range []string{"a", "b", "c"} {
		got, ok := orch.Graph().Get(id)
		if !ok {
			t.Errorf("task %q not found in graph", id)
			continue
		}
		if got.AgentType == "" {
			t.Errorf("task %q: expected agent type to be assigned", id)
		}
	}

	// Verify only "a" is ready (b and c have deps).
	ready := orch.Graph().Ready()
	if len(ready) != 1 {
		t.Fatalf("expected 1 ready task, got %d", len(ready))
	}
	if ready[0].ID != "a" {
		t.Errorf("expected ready task to be 'a', got %q", ready[0].ID)
	}
}

func TestOrchestratorService_AddTask_CycleDetection(t *testing.T) {
	orch, _ := setupTestOrchestrator(t)

	// Add task "a" first (no deps).
	if err := orch.AddTask("a", "First task", task.CategoryGeneric, nil, 0); err != nil {
		t.Fatalf("AddTask a: %v", err)
	}

	// Add task "b" depending on "a".
	if err := orch.AddTask("b", "Second task", task.CategoryGeneric, []string{"a"}, 0); err != nil {
		t.Fatalf("AddTask b: %v", err)
	}

	// Try to add "a" again depending on "b" — should fail (duplicate ID).
	err := orch.AddTask("a", "Cycle task", task.CategoryGeneric, []string{"b"}, 0)
	if err == nil {
		t.Fatal("expected error for duplicate/cycle, got nil")
	}
}

func TestOrchestratorService_Run_SimpleTasks(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping slow integration test")
	}

	orch, logger := setupTestOrchestrator(t)

	if err := orch.AddTask("s1", "Explore the code", task.CategoryExplore, nil, 1); err != nil {
		t.Fatalf("AddTask: %v", err)
	}
	if err := orch.AddTask("s2", "Implement a helper", task.CategoryImplement, nil, 1); err != nil {
		t.Fatalf("AddTask: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	err := orch.Run(ctx)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}

	stats := orch.Stats()
	if stats.Total != 2 {
		t.Errorf("expected 2 total tasks, got %d", stats.Total)
	}
	// All tasks should be terminal (completed or failed due to timeout).
	if stats.Pending+stats.Ready+stats.Running != 0 {
		t.Errorf("expected all tasks terminal, got pending=%d ready=%d running=%d",
			stats.Pending, stats.Ready, stats.Running)
	}

	// Verify events were logged.
	teamStarted := logger.EventsByType(event.EventTeamStarted)
	if len(teamStarted) == 0 {
		t.Error("expected EventTeamStarted to be logged")
	}

	taskCreated := logger.EventsByType(event.EventTaskCreated)
	if len(taskCreated) < 2 {
		t.Errorf("expected at least 2 EventTaskCreated, got %d", len(taskCreated))
	}

	teamCompleted := logger.EventsByType(event.EventTeamCompleted)
	if len(teamCompleted) == 0 {
		t.Error("expected EventTeamCompleted to be logged")
	}
}

func TestOrchestratorService_Run_WithDependencies(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping slow integration test")
	}

	orch, _ := setupTestOrchestrator(t)

	specs := []TaskSpec{
		{ID: "dep-a", Description: "Explore project structure", Category: task.CategoryExplore, Priority: 1},
		{ID: "dep-b", Description: "Implement feature based on exploration", Category: task.CategoryImplement, BlockedBy: []string{"dep-a"}, Priority: 2},
		{ID: "dep-c", Description: "Test the implemented feature", Category: task.CategoryTest, BlockedBy: []string{"dep-b"}, Priority: 3},
	}
	if err := orch.AddTasks(specs); err != nil {
		t.Fatalf("AddTasks: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	err := orch.Run(ctx)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}

	// All tasks should be terminal.
	stats := orch.Stats()
	if stats.Pending+stats.Ready+stats.Running != 0 {
		t.Errorf("expected all tasks terminal, got pending=%d ready=%d running=%d",
			stats.Pending, stats.Ready, stats.Running)
	}

	// Verify execution order: dep-a must complete before dep-b starts,
	// dep-b must complete before dep-c starts.
	a, _ := orch.Graph().Get("dep-a")
	b, _ := orch.Graph().Get("dep-b")
	c, _ := orch.Graph().Get("dep-c")

	// If a failed, b and c should never have run. The orchestrator cancels
	// blocked tasks whose dependencies can no longer be satisfied.
	if a.Status == task.StatusFailed {
		if b.Status != task.StatusCancelled {
			t.Errorf("dep-a failed; expected dep-b cancelled, got %q", b.Status)
		}
		if c.Status != task.StatusCancelled {
			t.Errorf("dep-a failed; expected dep-c cancelled, got %q", c.Status)
		}
		t.Log("dependency chain halted because dep-a failed (expected with short task timeout)")
		return
	}

	// If a completed, verify b started after a completed.
	if a.CompletedAt != nil && b.StartedAt != nil {
		if b.StartedAt.Before(*a.CompletedAt) {
			t.Error("dep-b started before dep-a completed — dependency violated")
		}
	}
	if b.Status == task.StatusCompleted && b.CompletedAt != nil && c.StartedAt != nil {
		if c.StartedAt.Before(*b.CompletedAt) {
			t.Error("dep-c started before dep-b completed — dependency violated")
		}
	}
}

func TestOrchestratorService_Run_Cancellation(t *testing.T) {
	orch, _ := setupTestOrchestrator(t)

	// Add a task so the orchestrator has work to do.
	if err := orch.AddTask("cancel-1", "Long running task", task.CategoryGeneric, nil, 1); err != nil {
		t.Fatalf("AddTask: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())

	errCh := make(chan error, 1)
	go func() {
		errCh <- orch.Run(ctx)
	}()

	// Let it start, then cancel.
	time.Sleep(100 * time.Millisecond)
	cancel()

	select {
	case err := <-errCh:
		if err == nil {
			// May complete before cancellation takes effect — that's OK.
			t.Log("Run completed before cancellation")
		} else if err != context.Canceled {
			t.Errorf("expected context.Canceled, got %v", err)
		}
	case <-time.After(30 * time.Second):
		t.Fatal("Run did not stop after cancellation within 30s")
	}

	if orch.IsRunning() {
		t.Error("expected IsRunning() to be false after Run returns")
	}
}

func TestOrchestratorService_Stats(t *testing.T) {
	orch, _ := setupTestOrchestrator(t)

	// Empty graph.
	stats := orch.Stats()
	if stats.Total != 0 {
		t.Errorf("expected 0 total, got %d", stats.Total)
	}

	// Add tasks.
	if err := orch.AddTask("stat-1", "Task one", task.CategoryGeneric, nil, 1); err != nil {
		t.Fatalf("AddTask: %v", err)
	}
	if err := orch.AddTask("stat-2", "Task two", task.CategoryGeneric, nil, 2); err != nil {
		t.Fatalf("AddTask: %v", err)
	}

	stats = orch.Stats()
	if stats.Total != 2 {
		t.Errorf("expected 2 total, got %d", stats.Total)
	}
	if stats.Pending != 2 {
		t.Errorf("expected 2 pending, got %d", stats.Pending)
	}
}

func TestOrchestratorService_IsRunning(t *testing.T) {
	orch, _ := setupTestOrchestrator(t)

	if orch.IsRunning() {
		t.Error("expected IsRunning() false before Run")
	}
}

func TestOrchestratorService_Graph(t *testing.T) {
	orch, _ := setupTestOrchestrator(t)

	g := orch.Graph()
	if g == nil {
		t.Fatal("Graph() returned nil")
	}

	if err := orch.AddTask("g-1", "Graph test", task.CategoryGeneric, nil, 0); err != nil {
		t.Fatalf("AddTask: %v", err)
	}

	// Graph should reflect the added task.
	_, ok := g.Get("g-1")
	if !ok {
		t.Error("expected task g-1 in Graph()")
	}
}

func TestOrchestratorService_RunWithCallback(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping slow integration test")
	}

	orch, _ := setupTestOrchestrator(t)

	if err := orch.AddTask("cb-1", "Callback task", task.CategoryGeneric, nil, 1); err != nil {
		t.Fatalf("AddTask: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	callbackCalled := false
	err := orch.RunWithCallback(ctx, func(stats task.GraphStats) {
		callbackCalled = true
		if stats.Total != 1 {
			t.Errorf("callback: expected 1 total, got %d", stats.Total)
		}
	})
	if err != nil {
		t.Fatalf("RunWithCallback: %v", err)
	}

	if !callbackCalled {
		t.Error("expected callback to be called at least once")
	}
}

// TestOrchestratorService_AddTask_DuplicateID verifies that adding a task with
// a duplicate ID returns an error.
func TestOrchestratorService_AddTask_DuplicateID(t *testing.T) {
	orch, _ := setupTestOrchestrator(t)

	if err := orch.AddTask("dup", "First", task.CategoryGeneric, nil, 0); err != nil {
		t.Fatalf("first AddTask: %v", err)
	}

	err := orch.AddTask("dup", "Second", task.CategoryGeneric, nil, 0)
	if err == nil {
		t.Fatal("expected error for duplicate ID, got nil")
	}
}

// TestOrchestratorService_AddTasks_DepNotFound verifies that referencing a
// non-existent dependency in AddTasks returns an error.
func TestOrchestratorService_AddTasks_DepNotFound(t *testing.T) {
	orch, _ := setupTestOrchestrator(t)

	specs := []TaskSpec{
		{ID: "x", Description: "Depends on missing", Category: task.CategoryGeneric, BlockedBy: []string{"missing"}},
	}

	err := orch.AddTasks(specs)
	if err == nil {
		t.Fatal("expected error for missing dependency, got nil")
	}
}
