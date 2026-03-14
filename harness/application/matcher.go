package application

import (
	"strings"

	"github.com/HyperBlaze456/ssenrah/harness/domain/agent"
	"github.com/HyperBlaze456/ssenrah/harness/domain/task"
)

// MatchSource identifies how an agent type was selected for a task.
type MatchSource string

const (
	// MatchManual indicates task.AgentType was pre-set by the caller.
	MatchManual MatchSource = "manual"
	// MatchCategory indicates the agent type was resolved via the category map.
	MatchCategory MatchSource = "category"
	// MatchKeyword indicates the agent type was inferred from description keywords.
	MatchKeyword MatchSource = "keyword"
	// MatchFallback indicates no match was found and the fallback type was used.
	MatchFallback MatchSource = "fallback"
)

// MatchResult represents the outcome of matching a task to an agent type.
type MatchResult struct {
	TaskID    string
	Category  task.TaskCategory
	AgentType string
	// Confidence is a 0.0–1.0 score indicating how certain the match is.
	Confidence float64
	Source     MatchSource
}

// keywordWeight pairs a keyword string with a scoring weight.
type keywordWeight struct {
	Keyword string
	Weight  int
}

// AgentMatcher maps tasks to appropriate agent types.
type AgentMatcher struct {
	categoryMap  map[string]string          // category → agent type name
	agentTypes   map[string]agent.AgentType // registered agent types
	fallbackType string
	keywords     map[task.TaskCategory][]keywordWeight
}

// NewAgentMatcher creates an AgentMatcher with the supplied category map and
// agent type registry. fallbackType is used when no other match is found.
func NewAgentMatcher(
	categoryMap map[string]string,
	agentTypes map[string]agent.AgentType,
	fallbackType string,
) *AgentMatcher {
	m := &AgentMatcher{
		categoryMap:  categoryMap,
		agentTypes:   agentTypes,
		fallbackType: fallbackType,
		keywords: map[task.TaskCategory][]keywordWeight{
			task.CategoryExplore: {
				{"explore", 3}, {"find", 2}, {"search", 2}, {"list", 1},
				{"structure", 2}, {"understand", 2}, {"analyze", 2},
			},
			task.CategoryImplement: {
				{"implement", 3}, {"create", 3}, {"build", 3}, {"add", 2},
				{"write code", 3}, {"new feature", 3}, {"develop", 2},
			},
			task.CategoryRefactor: {
				{"refactor", 3}, {"improve", 2}, {"optimize", 2},
				{"clean up", 2}, {"simplify", 2}, {"restructure", 3},
			},
			task.CategoryTest: {
				{"test", 3}, {"spec", 3}, {"assert", 3}, {"coverage", 2},
				{"unit test", 3}, {"integration test", 3},
			},
			task.CategoryVerify: {
				{"verify", 3}, {"validate", 3}, {"check", 2},
				{"confirm", 2}, {"ensure", 2},
			},
			task.CategoryDebug: {
				{"debug", 3}, {"fix bug", 3}, {"investigate", 2},
				{"trace", 2}, {"diagnose", 2}, {"troubleshoot", 3},
			},
			task.CategoryDocument: {
				{"document", 3}, {"readme", 3}, {"comment", 2},
				{"explain", 2}, {"docs", 3}, {"documentation", 3},
			},
			task.CategoryGeneric: {}, // pure fallback — no keywords
		},
	}
	return m
}

// Match resolves the most appropriate agent type for t, following this priority:
//  1. t.AgentType pre-set and present in the registry → Manual, confidence 1.0
//  2. t.Category set and present in categoryMap → Category, confidence 0.9
//  3. Keyword analysis of t.Description → Keyword, confidence score-based
//  4. Nothing matched → Fallback, confidence 0.0
func (m *AgentMatcher) Match(t task.Task) MatchResult {
	// 1. Manual: caller already chose an agent type.
	if t.AgentType != "" {
		if _, ok := m.agentTypes[t.AgentType]; ok {
			return MatchResult{
				TaskID:     t.ID,
				Category:   t.Category,
				AgentType:  t.AgentType,
				Confidence: 1.0,
				Source:     MatchManual,
			}
		}
		// Pre-set type not in registry — fall through to other strategies.
	}

	// 2. Category map.
	if t.Category != "" {
		if agentTypeName, ok := m.categoryMap[string(t.Category)]; ok {
			return MatchResult{
				TaskID:     t.ID,
				Category:   t.Category,
				AgentType:  agentTypeName,
				Confidence: 0.9,
				Source:     MatchCategory,
			}
		}
	}

	// 3. Keyword scoring on description.
	cat, confidence := m.InferCategory(t.Description)
	if confidence > 0 {
		agentTypeName := m.resolveCategory(cat)
		return MatchResult{
			TaskID:     t.ID,
			Category:   cat,
			AgentType:  agentTypeName,
			Confidence: confidence,
			Source:     MatchKeyword,
		}
	}

	// 4. Fallback.
	return MatchResult{
		TaskID:     t.ID,
		Category:   task.CategoryGeneric,
		AgentType:  m.fallbackType,
		Confidence: 0.0,
		Source:     MatchFallback,
	}
}

// MatchAll batch-matches tasks, returning results in the same order as input.
func (m *AgentMatcher) MatchAll(tasks []task.Task) []MatchResult {
	results := make([]MatchResult, len(tasks))
	for i, t := range tasks {
		results[i] = m.Match(t)
	}
	return results
}

// InferCategory scores every category against the lowercased description and
// returns the best-matching category together with a confidence value in [0,1].
// Confidence = highest / (highest + second) when two categories score > 0;
// 0.8 when only one category scores > 0; 0.0 when no category scores.
func (m *AgentMatcher) InferCategory(description string) (task.TaskCategory, float64) {
	lower := strings.ToLower(description)

	type scored struct {
		cat   task.TaskCategory
		score int
	}

	var results []scored
	for cat, kws := range m.keywords {
		if len(kws) == 0 {
			continue
		}
		total := 0
		for _, kw := range kws {
			if strings.Contains(lower, kw.Keyword) {
				total += kw.Weight
			}
		}
		if total > 0 {
			results = append(results, scored{cat, total})
		}
	}

	if len(results) == 0 {
		return task.CategoryGeneric, 0.0
	}

	// Sort descending by score (insertion-sort is fine for ≤8 categories).
	for i := 1; i < len(results); i++ {
		for j := i; j > 0 && results[j].score > results[j-1].score; j-- {
			results[j], results[j-1] = results[j-1], results[j]
		}
	}

	best := results[0]
	if len(results) == 1 {
		return best.cat, 0.8
	}

	second := results[1]
	confidence := float64(best.score) / float64(best.score+second.score)
	return best.cat, confidence
}

// resolveCategory maps a TaskCategory to an agent type name via categoryMap,
// falling back to fallbackType if no mapping exists.
func (m *AgentMatcher) resolveCategory(cat task.TaskCategory) string {
	if name, ok := m.categoryMap[string(cat)]; ok {
		return name
	}
	return m.fallbackType
}
