package tui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/HyperBlaze456/ssenrah/harness/domain/task"
)

// ActivityEntry represents a single activity log entry.
type ActivityEntry struct {
	Time    string
	Message string
}

// TeamTaskEntry holds display data for a single task in the team panel.
type TeamTaskEntry struct {
	ID        string
	AgentType string
	Status    task.TaskStatus
}

// Sidebar shows model info, tokens, cost, and activity log.
type Sidebar struct {
	model      string
	provider   string
	tokens     int
	cost       float64
	ctxWindow  int
	activity   []ActivityEntry
	agentType  string
	policyTier string
	theme      theme
	width      int
	height     int

	// Team section state.
	teamTasks []TeamTaskEntry
	teamStats task.GraphStats
	teamIdle  bool
}

// NewSidebar creates a Sidebar component.
func NewSidebar(t theme, width, height int) Sidebar {
	return Sidebar{
		model:     "dummy-v1",
		provider:  "dummy",
		ctxWindow: 128000,
		theme:     t,
		width:     width,
		height:    height,
		teamIdle:  true,
	}
}

// SetTeamStatus updates the team section with current task states.
func (s *Sidebar) SetTeamStatus(tasks []TeamTaskEntry, stats task.GraphStats) {
	s.teamTasks = tasks
	s.teamStats = stats
	s.teamIdle = false
}

// ClearTeam resets the team section to idle.
func (s *Sidebar) ClearTeam() {
	s.teamTasks = nil
	s.teamStats = task.GraphStats{}
	s.teamIdle = true
}

// SetSize updates dimensions.
func (s *Sidebar) SetSize(width, height int) {
	s.width = width
	s.height = height
}

// SetModelInfo updates displayed model info.
func (s *Sidebar) SetModelInfo(model, provider string, ctxWindow int) {
	s.model = model
	s.provider = provider
	s.ctxWindow = ctxWindow
}

// SetUsage updates token and cost display.
func (s *Sidebar) SetUsage(tokens int, cost float64) {
	s.tokens = tokens
	s.cost = cost
}

// SetAgentInfo updates the displayed agent type and policy tier.
func (s *Sidebar) SetAgentInfo(agentType, policyTier string) {
	s.agentType = agentType
	s.policyTier = policyTier
}

// AddActivity adds an entry to the activity log.
func (s *Sidebar) AddActivity(entry ActivityEntry) {
	s.activity = append(s.activity, entry)
	// Keep last 20
	if len(s.activity) > 20 {
		s.activity = s.activity[len(s.activity)-20:]
	}
}

// View renders the sidebar.
func (s *Sidebar) View() string {
	if s.width <= 0 {
		return ""
	}

	w := s.width - 2 // padding

	var sb strings.Builder

	// Model section
	sb.WriteString(s.theme.SidebarTitle.Render(" Model"))
	sb.WriteString("\n")
	sb.WriteString(fmt.Sprintf("  %s\n", truncate(s.model, w-2)))
	sb.WriteString(fmt.Sprintf("  %s\n", s.provider))
	sb.WriteString("\n")

	// Agent section
	if s.agentType != "" {
		sb.WriteString(s.theme.SidebarTitle.Render(" Agent"))
		sb.WriteString("\n")
		sb.WriteString(fmt.Sprintf("  %s\n", s.agentType))
		sb.WriteString(fmt.Sprintf("  policy: %s\n", s.policyTier))
		sb.WriteString("\n")
	}

	// Team section
	if s.teamIdle {
		sb.WriteString(s.theme.SidebarTitle.Render(" Team"))
		sb.WriteString("\n")
		sb.WriteString(s.theme.Muted.Render("  (idle)"))
		sb.WriteString("\n\n")
	} else {
		header := fmt.Sprintf(" Team  [%d/%d done]", s.teamStats.Completed, s.teamStats.Total)
		sb.WriteString(s.theme.SidebarTitle.Render(header))
		sb.WriteString("\n")
		display := s.teamTasks
		overflow := 0
		if len(display) > 10 {
			overflow = len(display) - 10
			display = display[:10]
		}
		for _, t := range display {
			icon, color := teamStatusIcon(t.Status)
			agentStr := truncate(t.AgentType, 10)
			idStr := truncate(t.ID, 8)
			line := fmt.Sprintf("  %s %-8s  %-10s  %s", icon, idStr, agentStr, string(t.Status))
			sb.WriteString(lipgloss.NewStyle().Foreground(lipgloss.Color(color)).Render(line))
			sb.WriteString("\n")
		}
		if overflow > 0 {
			sb.WriteString(s.theme.Muted.Render(fmt.Sprintf("  ... and %d more", overflow)))
			sb.WriteString("\n")
		}
		sb.WriteString("\n")
	}

	// Tokens section
	sb.WriteString(s.theme.SidebarTitle.Render(" Tokens"))
	sb.WriteString("\n")
	pct := float64(0)
	if s.ctxWindow > 0 {
		pct = float64(s.tokens) / float64(s.ctxWindow) * 100
	}
	sb.WriteString(fmt.Sprintf("  %d / %dk (%.1f%%)\n", s.tokens, s.ctxWindow/1000, pct))
	sb.WriteString("\n")

	// Cost section
	sb.WriteString(s.theme.SidebarTitle.Render(" Cost"))
	sb.WriteString("\n")
	sb.WriteString(fmt.Sprintf("  $%.4f\n", s.cost))
	sb.WriteString("\n")

	// Activity section
	sb.WriteString(s.theme.SidebarTitle.Render(" Activity"))
	sb.WriteString("\n")
	if len(s.activity) == 0 {
		sb.WriteString(s.theme.Muted.Render("  (none)"))
		sb.WriteString("\n")
	} else {
		for _, a := range s.activity {
			line := fmt.Sprintf("  %s %s", a.Time, a.Message)
			sb.WriteString(s.theme.Muted.Render(truncate(line, w)))
			sb.WriteString("\n")
		}
	}

	content := sb.String()

	return lipgloss.NewStyle().
		Width(s.width).
		Height(s.height).
		BorderStyle(lipgloss.NormalBorder()).
		BorderLeft(true).
		BorderForeground(lipgloss.Color("8")).
		Render(content)
}

// teamStatusIcon returns the display icon and terminal color code for a task status.
func teamStatusIcon(status task.TaskStatus) (icon, color string) {
	switch status {
	case task.StatusRunning:
		return "●", "3" // yellow
	case task.StatusCompleted:
		return "✓", "2" // green
	case task.StatusFailed:
		return "✗", "1" // red
	case task.StatusCancelled:
		return "⊘", "8" // gray
	default: // pending, ready, unknown
		return "○", "8" // gray
	}
}

func truncate(s string, maxLen int) string {
	runes := []rune(s)
	if len(runes) <= maxLen {
		return s
	}
	if maxLen <= 3 {
		return string(runes[:maxLen])
	}
	return string(runes[:maxLen-3]) + "..."
}
