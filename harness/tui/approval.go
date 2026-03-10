package tui

import (
	"fmt"

	"github.com/charmbracelet/lipgloss"
	"github.com/HyperBlaze456/ssenrah/harness/domain/tool"
)

// Approval renders a modal overlay for tool approval (visual skeleton only in v0.1).
type Approval struct {
	visible bool
	request tool.ApprovalRequest
	theme   theme
	width   int
	height  int
}

// NewApproval creates an Approval component.
func NewApproval(t theme) Approval {
	return Approval{theme: t}
}

// Show makes the approval dialog visible.
func (a *Approval) Show(req tool.ApprovalRequest) {
	a.visible = true
	a.request = req
}

// Hide closes the approval dialog.
func (a *Approval) Hide() {
	a.visible = false
}

// IsVisible returns whether the dialog is shown.
func (a *Approval) IsVisible() bool {
	return a.visible
}

// SetSize updates the overlay dimensions.
func (a *Approval) SetSize(width, height int) {
	a.width = width
	a.height = height
}

// View renders the approval modal overlay.
func (a *Approval) View() string {
	if !a.visible {
		return ""
	}

	modalWidth := 50
	if a.width < 60 {
		modalWidth = a.width - 10
	}

	title := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("3")).Render("Tool Call")
	toolName := fmt.Sprintf("Tool: %s", a.request.ToolCall.ToolName)
	risk := fmt.Sprintf("Risk: %s", a.request.RiskLevel)
	reason := a.request.Reason
	buttons := "[Y] Approve  [N] Deny  [A] Always Allow"

	content := lipgloss.JoinVertical(lipgloss.Left,
		title, "", toolName, risk, "", reason, "", buttons,
	)

	modal := lipgloss.NewStyle().
		Width(modalWidth).
		Padding(1, 2).
		BorderStyle(lipgloss.DoubleBorder()).
		BorderForeground(lipgloss.Color("3")).
		Render(content)

	return lipgloss.Place(a.width, a.height,
		lipgloss.Center, lipgloss.Center,
		modal,
	)
}
