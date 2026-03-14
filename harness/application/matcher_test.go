package application

import (
	"testing"

	"github.com/HyperBlaze456/ssenrah/harness/domain/agent"
	"github.com/HyperBlaze456/ssenrah/harness/domain/task"
)

// testMatcher builds a standard AgentMatcher for use in tests.
// agentTypes registry contains: explorer, coder, verifier, reviewer, default.
// categoryMap mirrors defaults.yaml.
func testMatcher() *AgentMatcher {
	agentTypes := map[string]agent.AgentType{
		"explorer": {Name: "explorer", Description: "Explores codebases"},
		"coder":    {Name: "coder", Description: "Writes and refactors code"},
		"verifier": {Name: "verifier", Description: "Runs tests and verifies"},
		"reviewer": {Name: "reviewer", Description: "Reviews and debugs"},
		"default":  {Name: "default", Description: "Generic agent"},
	}
	categoryMap := map[string]string{
		"explore":   "explorer",
		"implement": "coder",
		"refactor":  "coder",
		"test":      "verifier",
		"verify":    "verifier",
		"debug":     "reviewer",
		"document":  "reviewer",
		"generic":   "default",
	}
	return NewAgentMatcher(categoryMap, agentTypes, "default")
}

// --- Match: Manual source ---

func TestAgentMatcher_Match_ManualType(t *testing.T) {
	m := testMatcher()
	tsk := task.Task{
		ID:          "t1",
		Description: "do something",
		AgentType:   "coder",
	}
	r := m.Match(tsk)
	if r.Source != MatchManual {
		t.Errorf("expected MatchManual, got %s", r.Source)
	}
	if r.AgentType != "coder" {
		t.Errorf("expected coder, got %s", r.AgentType)
	}
	if r.Confidence != 1.0 {
		t.Errorf("expected confidence 1.0, got %f", r.Confidence)
	}
	if r.TaskID != "t1" {
		t.Errorf("expected TaskID t1, got %s", r.TaskID)
	}
}

func TestAgentMatcher_Match_ManualType_NotInRegistry(t *testing.T) {
	m := testMatcher()
	// "phantom" is not in the registry — should fall through.
	tsk := task.Task{
		ID:          "t2",
		Description: "explore the codebase",
		AgentType:   "phantom",
		Category:    task.CategoryExplore,
	}
	r := m.Match(tsk)
	// Falls through to category match.
	if r.Source != MatchCategory {
		t.Errorf("expected MatchCategory fallback, got %s", r.Source)
	}
	if r.AgentType != "explorer" {
		t.Errorf("expected explorer, got %s", r.AgentType)
	}
}

// --- Match: Category source ---

func TestAgentMatcher_Match_CategoryMap(t *testing.T) {
	tests := []struct {
		category      task.TaskCategory
		wantAgentType string
	}{
		{task.CategoryExplore, "explorer"},
		{task.CategoryImplement, "coder"},
		{task.CategoryRefactor, "coder"},
		{task.CategoryTest, "verifier"},
		{task.CategoryVerify, "verifier"},
		{task.CategoryDebug, "reviewer"},
		{task.CategoryDocument, "reviewer"},
		{task.CategoryGeneric, "default"},
	}
	m := testMatcher()
	for _, tc := range tests {
		tsk := task.Task{
			ID:          "t-" + string(tc.category),
			Description: "some task",
			Category:    tc.category,
		}
		r := m.Match(tsk)
		if r.Source != MatchCategory {
			t.Errorf("[%s] expected MatchCategory, got %s", tc.category, r.Source)
		}
		if r.AgentType != tc.wantAgentType {
			t.Errorf("[%s] expected %s, got %s", tc.category, tc.wantAgentType, r.AgentType)
		}
		if r.Confidence != 0.9 {
			t.Errorf("[%s] expected confidence 0.9, got %f", tc.category, r.Confidence)
		}
	}
}

// --- Match: Keyword source ---

func TestAgentMatcher_Match_KeywordScoring(t *testing.T) {
	tests := []struct {
		desc          string
		wantCategory  task.TaskCategory
		wantAgentType string
	}{
		{
			desc:          "implement a search feature",
			wantCategory:  task.CategoryImplement,
			wantAgentType: "coder",
		},
		{
			desc:          "explore the codebase structure",
			wantCategory:  task.CategoryExplore,
			wantAgentType: "explorer",
		},
		{
			desc:          "write unit tests for the API",
			wantCategory:  task.CategoryTest,
			wantAgentType: "verifier",
		},
		{
			desc:          "fix bug in login flow",
			wantCategory:  task.CategoryDebug,
			wantAgentType: "reviewer",
		},
		{
			desc:          "document the API endpoints",
			wantCategory:  task.CategoryDocument,
			wantAgentType: "reviewer",
		},
	}
	m := testMatcher()
	for _, tc := range tests {
		tsk := task.Task{ID: "kw", Description: tc.desc}
		r := m.Match(tsk)
		if r.Source != MatchKeyword {
			t.Errorf("[%q] expected MatchKeyword, got %s", tc.desc, r.Source)
		}
		if r.Category != tc.wantCategory {
			t.Errorf("[%q] expected category %s, got %s", tc.desc, tc.wantCategory, r.Category)
		}
		if r.AgentType != tc.wantAgentType {
			t.Errorf("[%q] expected agent type %s, got %s", tc.desc, tc.wantAgentType, r.AgentType)
		}
		if r.Confidence <= 0 {
			t.Errorf("[%q] expected positive confidence, got %f", tc.desc, r.Confidence)
		}
	}
}

func TestAgentMatcher_Match_KeywordConflict(t *testing.T) {
	// "implement" scores 3, "explore" + "find" = 2+2 = 4 — explore should win.
	m := testMatcher()
	tsk := task.Task{
		ID:          "conflict",
		Description: "explore and find areas to implement",
	}
	r := m.Match(tsk)
	if r.Source != MatchKeyword {
		t.Errorf("expected MatchKeyword, got %s", r.Source)
	}
	// explore: find(2) + explore(... not present) vs implement: implement(3)
	// "explore": keyword "explore" present(3) + "find"(2) = 5; "implement": keyword "implement"(3) = 3.
	// explore wins.
	if r.Category != task.CategoryExplore {
		t.Errorf("expected explore to win keyword conflict, got %s", r.Category)
	}
	// Confidence should be less than 1.0 because two categories scored > 0.
	if r.Confidence >= 1.0 {
		t.Errorf("expected confidence < 1.0 on conflict, got %f", r.Confidence)
	}
}

func TestAgentMatcher_Match_NoKeywords(t *testing.T) {
	m := testMatcher()
	// Description contains no known keywords.
	tsk := task.Task{
		ID:          "noop",
		Description: "prepare the quarterly report spreadsheet",
	}
	r := m.Match(tsk)
	if r.Source != MatchFallback {
		t.Errorf("expected MatchFallback, got %s", r.Source)
	}
	if r.AgentType != "default" {
		t.Errorf("expected default fallback agent type, got %s", r.AgentType)
	}
	if r.Confidence != 0.0 {
		t.Errorf("expected confidence 0.0, got %f", r.Confidence)
	}
}

func TestAgentMatcher_Match_Fallback(t *testing.T) {
	m := testMatcher()
	// Completely unrelated description with no matching keywords.
	tsk := task.Task{
		ID:          "fb",
		Description: "schedule a meeting with stakeholders",
	}
	r := m.Match(tsk)
	if r.Source != MatchFallback {
		t.Errorf("expected MatchFallback, got %s", r.Source)
	}
	if r.AgentType != "default" {
		t.Errorf("expected default, got %s", r.AgentType)
	}
}

// --- MatchAll ---

func TestAgentMatcher_MatchAll(t *testing.T) {
	m := testMatcher()
	tasks := []task.Task{
		{ID: "a1", AgentType: "coder"},
		{ID: "a2", Category: task.CategoryVerify},
		{ID: "a3", Description: "fix bug in the parser"},
		{ID: "a4", Description: "unrelated gibberish text"},
	}
	results := m.MatchAll(tasks)
	if len(results) != len(tasks) {
		t.Fatalf("expected %d results, got %d", len(tasks), len(results))
	}
	if results[0].Source != MatchManual {
		t.Errorf("[0] expected MatchManual, got %s", results[0].Source)
	}
	if results[1].Source != MatchCategory {
		t.Errorf("[1] expected MatchCategory, got %s", results[1].Source)
	}
	if results[2].Source != MatchKeyword {
		t.Errorf("[2] expected MatchKeyword, got %s", results[2].Source)
	}
	if results[3].Source != MatchFallback {
		t.Errorf("[3] expected MatchFallback, got %s", results[3].Source)
	}
	// Verify order is preserved.
	for i, r := range results {
		if r.TaskID != tasks[i].ID {
			t.Errorf("[%d] TaskID mismatch: expected %s, got %s", i, tasks[i].ID, r.TaskID)
		}
	}
}

// --- InferCategory ---

func TestAgentMatcher_InferCategory(t *testing.T) {
	m := testMatcher()

	tests := []struct {
		desc         string
		wantCategory task.TaskCategory
		wantPositive bool // true = confidence > 0
	}{
		{"refactor the payment service", task.CategoryRefactor, true},
		{"verify that all edge cases pass", task.CategoryVerify, true},
		{"write documentation for the SDK", task.CategoryDocument, true},
		{"completely unrelated phrase xyz", task.CategoryGeneric, false},
	}

	for _, tc := range tests {
		cat, conf := m.InferCategory(tc.desc)
		if cat != tc.wantCategory {
			t.Errorf("[%q] expected category %s, got %s", tc.desc, tc.wantCategory, cat)
		}
		if tc.wantPositive && conf <= 0 {
			t.Errorf("[%q] expected positive confidence, got %f", tc.desc, conf)
		}
		if !tc.wantPositive && conf != 0.0 {
			t.Errorf("[%q] expected zero confidence, got %f", tc.desc, conf)
		}
	}
}

// --- Case insensitivity ---

func TestAgentMatcher_CaseInsensitive(t *testing.T) {
	m := testMatcher()

	tests := []struct {
		desc     string
		wantCat  task.TaskCategory
	}{
		{"IMPLEMENT a new feature", task.CategoryImplement},
		{"Explore The Codebase", task.CategoryExplore},
		{"Write Unit Tests", task.CategoryTest},
		{"DEBUG the login issue", task.CategoryDebug},
		{"DOCUMENT the API", task.CategoryDocument},
	}

	for _, tc := range tests {
		cat, conf := m.InferCategory(tc.desc)
		if cat != tc.wantCat {
			t.Errorf("[%q] expected %s, got %s", tc.desc, tc.wantCat, cat)
		}
		if conf <= 0 {
			t.Errorf("[%q] expected positive confidence for case-insensitive match, got %f", tc.desc, conf)
		}
	}
}
