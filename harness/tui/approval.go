package tui

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/HyperBlaze456/ssenrah/harness/domain/tool"
)

// Approval renders an inline approval prompt that replaces the input bar.
// The chat remains visible above so the user retains context.
type Approval struct {
	visible bool
	request tool.ApprovalRequest
	theme   theme
	width   int
}

// NewApproval creates an Approval component.
func NewApproval(t theme) Approval {
	return Approval{theme: t}
}

// Show makes the approval prompt visible.
func (a *Approval) Show(req tool.ApprovalRequest) {
	a.visible = true
	a.request = req
}

// Hide closes the approval prompt.
func (a *Approval) Hide() {
	a.visible = false
}

// IsVisible returns whether the prompt is shown.
func (a *Approval) IsVisible() bool {
	return a.visible
}

// SetSize updates the component width. Height is unused (inline, not overlay).
func (a *Approval) SetSize(width, _ int) {
	a.width = width
}

// View renders the inline approval prompt. This replaces the input area
// when visible — the chat viewport stays untouched above.
func (a *Approval) View() string {
	if !a.visible {
		return ""
	}

	w := a.width
	if w < 40 {
		w = 40
	}

	toolStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("3"))
	mutedStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("8"))
	hintStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("8"))

	// Tool name + args summary (single line, truncated)
	argsSummary := formatArgs(a.request.ToolCall.Input, w-len(a.request.ToolCall.ToolName)-10)
	toolLine := toolStyle.Render(a.request.ToolCall.ToolName)
	if argsSummary != "" {
		toolLine += mutedStyle.Render(" " + argsSummary)
	}

	// Keybind hints
	hints := hintStyle.Render("Enter/Y: approve  N: deny  A: always allow")

	// Separator
	sep := lipgloss.NewStyle().
		Foreground(lipgloss.Color("3")).
		Width(w).
		Render(strings.Repeat("─", w))

	return lipgloss.JoinVertical(lipgloss.Left, sep, toolLine, hints)
}

// formatArgs produces a compact one-line summary of tool call arguments.
func formatArgs(input map[string]any, maxLen int) string {
	if len(input) == 0 {
		return ""
	}
	b, err := json.Marshal(input)
	if err != nil {
		return ""
	}
	s := string(b)
	if len(s) > maxLen && maxLen > 3 {
		s = s[:maxLen-3] + "..."
	}
	return fmt.Sprintf("(%s)", s)
}
