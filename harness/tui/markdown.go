package tui

import (
	"github.com/charmbracelet/glamour"
)

// markdownRenderer wraps glamour for consistent markdown rendering.
type markdownRenderer struct {
	renderer *glamour.TermRenderer
}

// newMarkdownRenderer creates a renderer configured for dark terminal backgrounds.
func newMarkdownRenderer(width int) *markdownRenderer {
	r, err := glamour.NewTermRenderer(
		glamour.WithAutoStyle(),
		glamour.WithWordWrap(width),
	)
	if err != nil {
		// Fallback: no renderer, will return raw text
		return &markdownRenderer{}
	}
	return &markdownRenderer{renderer: r}
}

// Render converts markdown to styled terminal output.
func (m *markdownRenderer) Render(content string) string {
	if m.renderer == nil {
		return content
	}
	out, err := m.renderer.Render(content)
	if err != nil {
		return content // fallback to raw
	}
	return out
}

// SetWidth updates the word wrap width.
func (m *markdownRenderer) SetWidth(width int) {
	r, err := glamour.NewTermRenderer(
		glamour.WithAutoStyle(),
		glamour.WithWordWrap(width),
	)
	if err == nil {
		m.renderer = r
	}
}
