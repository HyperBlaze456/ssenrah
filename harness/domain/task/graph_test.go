package task

import (
	"testing"
)

// helpers

func makeTask(id, desc string, priority int, blockedBy ...string) Task {
	t := NewTask(id, desc, CategoryGeneric)
	t.Priority = priority
	t.BlockedBy = blockedBy
	return t
}

// TestAdd_and_Get verifies basic insertion and retrieval.
func TestAdd_and_Get(t *testing.T) {
	g := NewTaskGraph()
	task := makeTask("t1", "do something", 0)
	if err := g.Add(task); err != nil {
		t.Fatalf("Add: unexpected error: %v", err)
	}

	got, ok := g.Get("t1")
	if !ok {
		t.Fatal("Get: expected task to exist")
	}
	if got.ID != "t1" {
		t.Errorf("Get: expected ID %q, got %q", "t1", got.ID)
	}
	if got.Description != "do something" {
		t.Errorf("Get: expected description %q, got %q", "do something", got.Description)
	}
}

// TestAdd_DuplicateID returns an error when adding a task with an existing ID.
func TestAdd_DuplicateID(t *testing.T) {
	g := NewTaskGraph()
	task := makeTask("t1", "first", 0)
	if err := g.Add(task); err != nil {
		t.Fatalf("first Add: %v", err)
	}
	dup := makeTask("t1", "duplicate", 0)
	if err := g.Add(dup); err == nil {
		t.Error("expected error for duplicate ID, got nil")
	}
}

// TestAdd_UnknownDependency returns an error when BlockedBy references a missing task.
func TestAdd_UnknownDependency(t *testing.T) {
	g := NewTaskGraph()
	task := makeTask("t1", "child", 0, "missing")
	if err := g.Add(task); err == nil {
		t.Error("expected error for unknown dependency, got nil")
	}
}

// TestReady_NoDeps returns tasks with no dependencies as ready.
func TestReady_NoDeps(t *testing.T) {
	g := NewTaskGraph()
	if err := g.Add(makeTask("t1", "a", 0)); err != nil {
		t.Fatalf("Add: %v", err)
	}
	if err := g.Add(makeTask("t2", "b", 1)); err != nil {
		t.Fatalf("Add: %v", err)
	}

	ready := g.Ready()
	if len(ready) != 2 {
		t.Errorf("expected 2 ready tasks, got %d", len(ready))
	}
}

// TestReady_WithPendingDep returns only tasks whose deps are completed.
func TestReady_WithPendingDep(t *testing.T) {
	g := NewTaskGraph()
	if err := g.Add(makeTask("t1", "parent", 0)); err != nil {
		t.Fatalf("Add t1: %v", err)
	}
	if err := g.Add(makeTask("t2", "child", 1, "t1")); err != nil {
		t.Fatalf("Add t2: %v", err)
	}

	ready := g.Ready()
	if len(ready) != 1 || ready[0].ID != "t1" {
		t.Errorf("expected only t1 to be ready, got %v", ready)
	}
}

// TestReady_AfterDepCompleted shows t2 becomes ready once t1 is done.
func TestReady_AfterDepCompleted(t *testing.T) {
	g := NewTaskGraph()
	if err := g.Add(makeTask("t1", "parent", 0)); err != nil {
		t.Fatalf("Add t1: %v", err)
	}
	if err := g.Add(makeTask("t2", "child", 1, "t1")); err != nil {
		t.Fatalf("Add t2: %v", err)
	}

	if err := g.Claim("t1", "worker-1"); err != nil {
		t.Fatalf("Claim t1: %v", err)
	}
	if err := g.Complete("t1", TaskResult{Content: "done"}); err != nil {
		t.Fatalf("Complete t1: %v", err)
	}

	ready := g.Ready()
	if len(ready) != 1 || ready[0].ID != "t2" {
		t.Errorf("expected t2 to be ready, got %v", ready)
	}
}

// TestClaim_Transitions verifies Pending → Running and field population.
func TestClaim_Transitions(t *testing.T) {
	g := NewTaskGraph()
	if err := g.Add(makeTask("t1", "work", 0)); err != nil {
		t.Fatalf("Add: %v", err)
	}

	if err := g.Claim("t1", "worker-a"); err != nil {
		t.Fatalf("Claim: %v", err)
	}

	got, _ := g.Get("t1")
	if got.Status != StatusRunning {
		t.Errorf("expected StatusRunning, got %q", got.Status)
	}
	if got.WorkerID != "worker-a" {
		t.Errorf("expected WorkerID %q, got %q", "worker-a", got.WorkerID)
	}
	if got.StartedAt == nil {
		t.Error("expected StartedAt to be set")
	}
}

// TestClaim_NonReady rejects claiming a task whose deps are not completed.
func TestClaim_NonReady(t *testing.T) {
	g := NewTaskGraph()
	if err := g.Add(makeTask("t1", "parent", 0)); err != nil {
		t.Fatalf("Add t1: %v", err)
	}
	if err := g.Add(makeTask("t2", "child", 1, "t1")); err != nil {
		t.Fatalf("Add t2: %v", err)
	}

	if err := g.Claim("t2", "worker-a"); err == nil {
		t.Error("expected error claiming task with unmet deps, got nil")
	}
}

// TestClaim_AlreadyRunning rejects re-claiming a running task.
func TestClaim_AlreadyRunning(t *testing.T) {
	g := NewTaskGraph()
	if err := g.Add(makeTask("t1", "work", 0)); err != nil {
		t.Fatalf("Add: %v", err)
	}
	if err := g.Claim("t1", "worker-a"); err != nil {
		t.Fatalf("first Claim: %v", err)
	}
	if err := g.Claim("t1", "worker-b"); err == nil {
		t.Error("expected error claiming already-running task, got nil")
	}
}

// TestComplete_Transitions verifies Running → Completed.
func TestComplete_Transitions(t *testing.T) {
	g := NewTaskGraph()
	if err := g.Add(makeTask("t1", "work", 0)); err != nil {
		t.Fatalf("Add: %v", err)
	}
	if err := g.Claim("t1", "worker-a"); err != nil {
		t.Fatalf("Claim: %v", err)
	}

	result := TaskResult{Content: "output", Verified: true, VerifiedBy: "verifier"}
	if err := g.Complete("t1", result); err != nil {
		t.Fatalf("Complete: %v", err)
	}

	got, _ := g.Get("t1")
	if got.Status != StatusCompleted {
		t.Errorf("expected StatusCompleted, got %q", got.Status)
	}
	if got.Result == nil {
		t.Fatal("expected Result to be set")
	}
	if got.Result.Content != "output" {
		t.Errorf("expected content %q, got %q", "output", got.Result.Content)
	}
	if got.CompletedAt == nil {
		t.Error("expected CompletedAt to be set")
	}
}

// TestComplete_NonRunning rejects completing a task that is not running.
func TestComplete_NonRunning(t *testing.T) {
	g := NewTaskGraph()
	if err := g.Add(makeTask("t1", "work", 0)); err != nil {
		t.Fatalf("Add: %v", err)
	}
	if err := g.Complete("t1", TaskResult{Content: "output"}); err == nil {
		t.Error("expected error completing non-running task, got nil")
	}
}

// TestFail_Transitions verifies Running → Failed.
func TestFail_Transitions(t *testing.T) {
	g := NewTaskGraph()
	if err := g.Add(makeTask("t1", "work", 0)); err != nil {
		t.Fatalf("Add: %v", err)
	}
	if err := g.Claim("t1", "worker-a"); err != nil {
		t.Fatalf("Claim: %v", err)
	}
	if err := g.Fail("t1", "something exploded"); err != nil {
		t.Fatalf("Fail: %v", err)
	}

	got, _ := g.Get("t1")
	if got.Status != StatusFailed {
		t.Errorf("expected StatusFailed, got %q", got.Status)
	}
	if got.Error != "something exploded" {
		t.Errorf("expected error %q, got %q", "something exploded", got.Error)
	}
	if got.CompletedAt == nil {
		t.Error("expected CompletedAt to be set")
	}
}

// TestFail_NonRunning rejects failing a task that is not running.
func TestFail_NonRunning(t *testing.T) {
	g := NewTaskGraph()
	if err := g.Add(makeTask("t1", "work", 0)); err != nil {
		t.Fatalf("Add: %v", err)
	}
	if err := g.Fail("t1", "oops"); err == nil {
		t.Error("expected error failing non-running task, got nil")
	}
}

// TestCancel_Transitions cancels a pending task.
func TestCancel_Transitions(t *testing.T) {
	g := NewTaskGraph()
	if err := g.Add(makeTask("t1", "work", 0)); err != nil {
		t.Fatalf("Add: %v", err)
	}
	if err := g.Cancel("t1"); err != nil {
		t.Fatalf("Cancel: %v", err)
	}

	got, _ := g.Get("t1")
	if got.Status != StatusCancelled {
		t.Errorf("expected StatusCancelled, got %q", got.Status)
	}
	if got.CompletedAt == nil {
		t.Error("expected CompletedAt to be set")
	}
}

// TestCancel_TerminalState rejects cancelling an already-completed task.
func TestCancel_TerminalState(t *testing.T) {
	g := NewTaskGraph()
	if err := g.Add(makeTask("t1", "work", 0)); err != nil {
		t.Fatalf("Add: %v", err)
	}
	if err := g.Claim("t1", "w"); err != nil {
		t.Fatalf("Claim: %v", err)
	}
	if err := g.Complete("t1", TaskResult{Content: "done"}); err != nil {
		t.Fatalf("Complete: %v", err)
	}
	if err := g.Cancel("t1"); err == nil {
		t.Error("expected error cancelling completed task, got nil")
	}
}

// TestCycleDetection rejects a graph with a circular dependency.
func TestCycleDetection(t *testing.T) {
	g := NewTaskGraph()
	if err := g.Add(makeTask("t1", "a", 0)); err != nil {
		t.Fatalf("Add t1: %v", err)
	}
	if err := g.Add(makeTask("t2", "b", 0, "t1")); err != nil {
		t.Fatalf("Add t2: %v", err)
	}

	// t3 → t2 → t1, and t1 also depends on t3 would form a cycle.
	// We simulate this by manually patching t1's BlockedBy after the fact
	// is not possible (no mutator), so instead test a direct cycle where
	// t3 → t2 and t2 already depends on t1; if t1 depended on t3 we'd
	// need to set it up before adding. Use a fresh graph for a true cycle test.

	g2 := NewTaskGraph()
	// Add t1 with no deps.
	if err := g2.Add(makeTask("t1", "a", 0)); err != nil {
		t.Fatalf("g2 Add t1: %v", err)
	}
	// Add t2 blocked by t1.
	if err := g2.Add(makeTask("t2", "b", 0, "t1")); err != nil {
		t.Fatalf("g2 Add t2: %v", err)
	}
	// Try to add t3 blocked by t2 (chain: t3→t2→t1, no cycle — should succeed).
	if err := g2.Add(makeTask("t3", "c", 0, "t2")); err != nil {
		t.Fatalf("g2 Add t3 (valid chain): %v", err)
	}

	// Now try a self-loop: t4 blocked by itself.
	// Must add t4 first with no deps, then can't re-add, so use a fresh graph.
	g3 := NewTaskGraph()
	selfLoop := makeTask("t4", "self", 0, "t4")
	// "t4" is not in graph yet, so Add should fail on unknown dependency.
	if err := g3.Add(selfLoop); err == nil {
		t.Error("expected error for self-loop dependency, got nil")
	}
}

// TestCycleDetection_TrueCycle verifies that a genuine cycle between three
// tasks is rejected by constructing a scenario where a cycle would form.
func TestCycleDetection_TrueCycle(t *testing.T) {
	// Build: A → B (B blocked by A), then try adding C blocked by B where
	// B was sneakily given a dep on C — not possible without mutation.
	// Instead, we verify that the cycle detector works by using the graph's
	// own internal state via a specially crafted graph.

	// The most direct cycle test we can do without mutation:
	// We can't make A depend on B after B depends on A since A must exist first.
	// So we patch g.tasks directly by accessing the pointer after Add.

	g := NewTaskGraph()
	tA := makeTask("A", "a", 0)
	if err := g.Add(tA); err != nil {
		t.Fatalf("Add A: %v", err)
	}
	tB := makeTask("B", "b", 0, "A")
	if err := g.Add(tB); err != nil {
		t.Fatalf("Add B: %v", err)
	}

	// Manually introduce a cycle: make A depend on B.
	pA, _ := g.Get("A")
	pA.BlockedBy = []string{"B"}

	// Now run detectCycle starting from A — it should find A→B→A cycle.
	if err := g.detectCycle("A"); err == nil {
		t.Error("expected cycle detection to report error, got nil")
	}

	// Restore to avoid polluting other sub-tests.
	pA.BlockedBy = nil
}

// TestIsComplete_AllTerminal returns true when all tasks are in terminal states.
func TestIsComplete_AllTerminal(t *testing.T) {
	g := NewTaskGraph()
	if err := g.Add(makeTask("t1", "a", 0)); err != nil {
		t.Fatalf("Add t1: %v", err)
	}
	if err := g.Add(makeTask("t2", "b", 1)); err != nil {
		t.Fatalf("Add t2: %v", err)
	}

	// Complete t1.
	if err := g.Claim("t1", "w"); err != nil {
		t.Fatalf("Claim t1: %v", err)
	}
	if err := g.Complete("t1", TaskResult{Content: "ok"}); err != nil {
		t.Fatalf("Complete t1: %v", err)
	}
	// Cancel t2.
	if err := g.Cancel("t2"); err != nil {
		t.Fatalf("Cancel t2: %v", err)
	}

	if !g.IsComplete() {
		t.Error("expected IsComplete() == true")
	}
}

// TestIsComplete_NotDone returns false while any task is non-terminal.
func TestIsComplete_NotDone(t *testing.T) {
	g := NewTaskGraph()
	if err := g.Add(makeTask("t1", "a", 0)); err != nil {
		t.Fatalf("Add: %v", err)
	}
	if g.IsComplete() {
		t.Error("expected IsComplete() == false for pending task")
	}
}

// TestStats_Counts verifies per-status counts.
func TestStats_Counts(t *testing.T) {
	g := NewTaskGraph()

	tasks := []Task{
		makeTask("t1", "pending", 0),
		makeTask("t2", "to-run", 1),
		makeTask("t3", "to-fail", 2),
		makeTask("t4", "to-cancel", 3),
	}
	for _, task := range tasks {
		if err := g.Add(task); err != nil {
			t.Fatalf("Add %s: %v", task.ID, err)
		}
	}

	// t2 → Running → Completed
	if err := g.Claim("t2", "w"); err != nil {
		t.Fatalf("Claim t2: %v", err)
	}
	if err := g.Complete("t2", TaskResult{Content: "ok"}); err != nil {
		t.Fatalf("Complete t2: %v", err)
	}

	// t3 → Running → Failed
	if err := g.Claim("t3", "w"); err != nil {
		t.Fatalf("Claim t3: %v", err)
	}
	if err := g.Fail("t3", "err"); err != nil {
		t.Fatalf("Fail t3: %v", err)
	}

	// t4 → Cancelled
	if err := g.Cancel("t4"); err != nil {
		t.Fatalf("Cancel t4: %v", err)
	}

	stats := g.Stats()
	if stats.Total != 4 {
		t.Errorf("Total: expected 4, got %d", stats.Total)
	}
	if stats.Pending != 1 {
		t.Errorf("Pending: expected 1, got %d", stats.Pending)
	}
	if stats.Completed != 1 {
		t.Errorf("Completed: expected 1, got %d", stats.Completed)
	}
	if stats.Failed != 1 {
		t.Errorf("Failed: expected 1, got %d", stats.Failed)
	}
	if stats.Cancelled != 1 {
		t.Errorf("Cancelled: expected 1, got %d", stats.Cancelled)
	}
	if stats.Running != 0 {
		t.Errorf("Running: expected 0, got %d", stats.Running)
	}
}

// TestAll_SortedByPriority verifies All() returns tasks ordered by priority.
func TestAll_SortedByPriority(t *testing.T) {
	g := NewTaskGraph()
	if err := g.Add(makeTask("t3", "c", 3)); err != nil {
		t.Fatalf("Add t3: %v", err)
	}
	if err := g.Add(makeTask("t1", "a", 1)); err != nil {
		t.Fatalf("Add t1: %v", err)
	}
	if err := g.Add(makeTask("t2", "b", 2)); err != nil {
		t.Fatalf("Add t2: %v", err)
	}

	all := g.All()
	if len(all) != 3 {
		t.Fatalf("expected 3 tasks, got %d", len(all))
	}
	priorities := []int{all[0].Priority, all[1].Priority, all[2].Priority}
	if priorities[0] > priorities[1] || priorities[1] > priorities[2] {
		t.Errorf("expected ascending priority order, got %v", priorities)
	}
}

// TestIsValidCategory covers all valid and an invalid category.
func TestIsValidCategory(t *testing.T) {
	cases := []struct {
		input string
		want  bool
	}{
		{"explore", true},
		{"implement", true},
		{"refactor", true},
		{"test", true},
		{"verify", true},
		{"debug", true},
		{"document", true},
		{"generic", true},
		{"unknown", false},
		{"", false},
	}
	for _, c := range cases {
		got := IsValidCategory(c.input)
		if got != c.want {
			t.Errorf("IsValidCategory(%q) = %v, want %v", c.input, got, c.want)
		}
	}
}

// TestNewTask_Fields verifies constructor defaults.
func TestNewTask_Fields(t *testing.T) {
	task := NewTask("id-1", "description", CategoryImplement)
	if task.ID != "id-1" {
		t.Errorf("expected ID %q, got %q", "id-1", task.ID)
	}
	if task.Description != "description" {
		t.Errorf("expected description %q, got %q", "description", task.Description)
	}
	if task.Category != CategoryImplement {
		t.Errorf("expected category %q, got %q", CategoryImplement, task.Category)
	}
	if task.Status != StatusPending {
		t.Errorf("expected StatusPending, got %q", task.Status)
	}
	if task.CreatedAt.IsZero() {
		t.Error("expected non-zero CreatedAt")
	}
	if task.StartedAt != nil {
		t.Error("expected nil StartedAt")
	}
	if task.CompletedAt != nil {
		t.Error("expected nil CompletedAt")
	}
	if task.Result != nil {
		t.Error("expected nil Result")
	}
}

// TestNewTask_GeneratesID verifies that an empty id generates a UUID.
func TestNewTask_GeneratesID(t *testing.T) {
	task := NewTask("", "desc", CategoryGeneric)
	if task.ID == "" {
		t.Error("expected generated UUID, got empty string")
	}
}
