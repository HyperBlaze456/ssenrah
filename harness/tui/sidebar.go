package tui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// ActivityEntry represents a single activity log entry.
type ActivityEntry struct {
	Time    string
	Message string
}

// Sidebar shows model info, tokens, cost, and activity log.
type Sidebar struct {
	model     string
	provider  string
	tokens    int
	cost      float64
	ctxWindow int
	activity  []ActivityEntry
	theme     theme
	width     int
	height    int
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
	}
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
