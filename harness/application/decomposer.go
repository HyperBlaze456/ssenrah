package application

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/HyperBlaze456/ssenrah/harness/domain/provider"
	"github.com/HyperBlaze456/ssenrah/harness/domain/shared"
	"github.com/HyperBlaze456/ssenrah/harness/domain/task"
)

const decompositionSystemPrompt = `You are a task decomposition engine for an agent harness. Given a goal, break it down into discrete tasks.

Each task must have:
- id: short kebab-case identifier (e.g., "explore-codebase", "implement-auth")
- description: clear, actionable description of what to do
- category: one of [explore, implement, refactor, test, verify, debug, document, generic]
- blocked_by: list of task IDs this depends on (empty if independent)
- priority: integer (0 = highest priority)

Rules:
- Start with exploration tasks to understand context
- Implementation tasks should depend on exploration
- Testing/verification tasks should depend on implementation
- Keep tasks focused — each should be completable by a single agent
- Use 3-8 tasks for most goals
- Output ONLY valid JSON array, no markdown fences, no explanation

Example output:
[
  {"id": "explore-structure", "description": "Read the project structure and understand the codebase layout", "category": "explore", "blocked_by": [], "priority": 0},
  {"id": "implement-feature", "description": "Implement the new feature based on exploration findings", "category": "implement", "blocked_by": ["explore-structure"], "priority": 1},
  {"id": "verify-feature", "description": "Verify the implementation works correctly", "category": "verify", "blocked_by": ["implement-feature"], "priority": 2}
]`

// decomposedTask is the JSON shape returned by the LLM.
type decomposedTask struct {
	ID          string   `json:"id"`
	Description string   `json:"description"`
	Category    string   `json:"category"`
	BlockedBy   []string `json:"blocked_by"`
	Priority    int      `json:"priority"`
}

// Decomposer uses an LLM to break a goal into a structured task plan.
type Decomposer struct {
	provider provider.LLMProvider
	model    string
}

// NewDecomposer creates a Decomposer backed by the given LLM provider.
func NewDecomposer(prov provider.LLMProvider, model string) *Decomposer {
	return &Decomposer{provider: prov, model: model}
}

// Decompose takes a natural-language goal and returns structured task specs.
// It calls the LLM with a structured prompt, parses the response, and returns
// a list of TaskSpecs that can be fed to OrchestratorService.AddTasks.
func (d *Decomposer) Decompose(ctx context.Context, goal string) ([]TaskSpec, error) {
	req := provider.ChatRequest{
		Model:        d.model,
		SystemPrompt: decompositionSystemPrompt,
		Messages:     []shared.Message{shared.NewMessage(shared.RoleUser, goal)},
		MaxTokens:    2048,
	}

	resp, err := d.provider.Chat(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("llm chat: %w", err)
	}

	raw := stripCodeFences(resp.TextContent)

	var parsed []decomposedTask
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return nil, fmt.Errorf("parse decomposition json: %w", err)
	}

	if len(parsed) == 0 {
		return nil, fmt.Errorf("decomposition produced no tasks")
	}

	// Build a set of valid task IDs for dependency validation.
	idSet := make(map[string]struct{}, len(parsed))
	for _, dt := range parsed {
		if dt.ID != "" {
			idSet[dt.ID] = struct{}{}
		}
	}

	specs := make([]TaskSpec, 0, len(parsed))
	for _, dt := range parsed {
		if dt.ID == "" {
			continue
		}
		if dt.Description == "" {
			continue
		}

		category := task.TaskCategory(dt.Category)
		if !task.IsValidCategory(dt.Category) {
			category = task.CategoryGeneric
		}

		// Drop dependencies that reference non-existent tasks.
		var validDeps []string
		for _, dep := range dt.BlockedBy {
			if _, ok := idSet[dep]; ok && dep != dt.ID {
				validDeps = append(validDeps, dep)
			}
		}

		specs = append(specs, TaskSpec{
			ID:          dt.ID,
			Description: dt.Description,
			Category:    category,
			BlockedBy:   validDeps,
			Priority:    dt.Priority,
		})
	}

	if len(specs) == 0 {
		return nil, fmt.Errorf("decomposition produced no valid tasks")
	}

	return specs, nil
}

// stripCodeFences removes markdown code fences from the LLM response.
func stripCodeFences(s string) string {
	s = strings.TrimSpace(s)

	// Strip leading ```json or ``` line.
	if strings.HasPrefix(s, "```") {
		if idx := strings.Index(s, "\n"); idx >= 0 {
			s = s[idx+1:]
		}
	}

	// Strip trailing ``` line.
	if strings.HasSuffix(s, "```") {
		if idx := strings.LastIndex(s, "\n"); idx >= 0 {
			s = s[:idx]
		} else {
			s = strings.TrimSuffix(s, "```")
		}
	}

	return strings.TrimSpace(s)
}
