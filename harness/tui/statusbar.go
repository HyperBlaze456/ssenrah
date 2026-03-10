package tui

import (
	"github.com/charmbracelet/lipgloss"
)

// StatusBar renders the bottom status line with key hints.
type StatusBar struct {
	phase string
	theme theme
	width int
}

// NewStatusBar creates a StatusBar.
func NewStatusBar(t theme, width int) StatusBar {
	return StatusBar{phase: "idle", theme: t, width: width}
}

// SetWidth updates the width.
func (s *StatusBar) SetWidth(width int) { s.width = width }

// SetPhase updates the current phase.
func (s *StatusBar) SetPhase(phase string) { s.phase = phase }

// View renders the status bar.
func (s *StatusBar) View() string {
	var hints string
	switch s.phase {
	case "streaming":
		hints = "Esc: cancel | Tab: sidebar | Ctrl+C: quit"
	case "awaiting approval":
		hints = "Y: approve | N: deny | A: always | Tab: sidebar"
	default:
		hints = "Enter: send | Tab: sidebar | Ctrl+C: quit"
	}

	left := s.theme.StatusBar.Render(" ssenrah ")
	right := lipgloss.NewStyle().Foreground(lipgloss.Color("8")).Render(hints)

	gap := s.width - lipgloss.Width(left) - lipgloss.Width(right)
	if gap < 0 {
		gap = 0
	}

	spacer := lipgloss.NewStyle().Width(gap).Render("")

	return lipgloss.JoinHorizontal(lipgloss.Top, left, spacer, right)
}
