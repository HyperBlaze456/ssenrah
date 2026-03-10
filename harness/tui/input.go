package tui

import (
	"fmt"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// Input handles user text entry with model/cost display.
type Input struct {
	textInput textinput.Model
	model     string
	provider  string
	tokens    int
	cost      float64
	theme     theme
	width     int
}

// NewInput creates an Input component.
func NewInput(t theme, width int) Input {
	ti := textinput.New()
	ti.Placeholder = "Type a message..."
	ti.Focus()
	ti.CharLimit = 4096
	ti.Width = width - 4
	return Input{
		textInput: ti,
		model:     "dummy-v1",
		provider:  "dummy",
		theme:     t,
		width:     width,
	}
}

// SetSize updates the input width.
func (i *Input) SetSize(width int) {
	i.width = width
	i.textInput.Width = width - 4
}

// SetModelInfo updates the displayed model information.
func (i *Input) SetModelInfo(model, provider string) {
	i.model = model
	i.provider = provider
}

// SetUsage updates token and cost display.
func (i *Input) SetUsage(tokens int, cost float64) {
	i.tokens = tokens
	i.cost = cost
}

// Value returns the current input text.
func (i *Input) Value() string {
	return i.textInput.Value()
}

// Reset clears the input.
func (i *Input) Reset() {
	i.textInput.Reset()
}

// Focus sets focus on the input.
func (i *Input) Focus() tea.Cmd {
	return i.textInput.Focus()
}

// Update handles input events.
func (i *Input) Update(msg tea.Msg) (Input, tea.Cmd) {
	var cmd tea.Cmd
	i.textInput, cmd = i.textInput.Update(msg)
	return *i, cmd
}

// View renders the input area with model info.
func (i *Input) View() string {
	info := i.theme.InputInfo.Render(
		fmt.Sprintf("%s \u00b7 %s    tokens: %d | $%.4f", i.model, i.provider, i.tokens, i.cost),
	)
	inputLine := i.textInput.View()

	return lipgloss.JoinVertical(lipgloss.Left, info, inputLine)
}
