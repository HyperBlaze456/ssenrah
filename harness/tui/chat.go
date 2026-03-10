package tui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/HyperBlaze456/ssenrah/harness/domain/shared"
)

// Chat renders the scrollable message list with markdown support.
type Chat struct {
	viewport  viewport.Model
	messages  []shared.Message
	streamBuf strings.Builder // accumulates streaming chunks
	streaming bool
	md        *markdownRenderer
	theme     theme
	width     int
	height    int
}

// NewChat creates a Chat component.
func NewChat(t theme, width, height int) Chat {
	vp := viewport.New(width, height)
	vp.SetContent("")
	return Chat{
		viewport: vp,
		messages: nil,
		md:       newMarkdownRenderer(width - 4),
		theme:    t,
		width:    width,
		height:   height,
	}
}

// SetSize updates the chat dimensions.
func (c *Chat) SetSize(width, height int) {
	c.width = width
	c.height = height
	c.viewport.Width = width
	c.viewport.Height = height
	c.md.SetWidth(width - 4)
	c.refreshContent()
}

// AppendChunk adds a streaming delta to the in-progress message.
func (c *Chat) AppendChunk(chunk shared.StreamChunk) {
	c.streaming = true
	c.streamBuf.WriteString(chunk.Delta)
	c.refreshContent()
}

// FinalizeMessage completes the current streaming message and adds it to history.
func (c *Chat) FinalizeMessage(msg shared.Message) {
	c.messages = append(c.messages, msg)
	c.streamBuf.Reset()
	c.streaming = false
	c.refreshContent()
}

// AddUserMessage adds a user message to the display.
func (c *Chat) AddUserMessage(msg shared.Message) {
	c.messages = append(c.messages, msg)
	c.refreshContent()
}

// ShowError displays an error inline in the chat.
func (c *Chat) ShowError(err error) {
	c.streamBuf.Reset()
	c.streaming = false
	errMsg := shared.NewMessage(shared.RoleSystem, fmt.Sprintf("[Error] %s", err.Error()))
	c.messages = append(c.messages, errMsg)
	c.refreshContent()
}

// Clear removes all messages.
func (c *Chat) Clear() {
	c.messages = nil
	c.streamBuf.Reset()
	c.streaming = false
	c.refreshContent()
}

// Update handles viewport scrolling.
func (c *Chat) Update(msg tea.Msg) (Chat, tea.Cmd) {
	var cmd tea.Cmd
	c.viewport, cmd = c.viewport.Update(msg)
	return *c, cmd
}

// View renders the chat area.
func (c *Chat) View() string {
	return c.viewport.View()
}

func (c *Chat) refreshContent() {
	var sb strings.Builder
	for _, msg := range c.messages {
		sb.WriteString(c.renderMessage(msg))
		sb.WriteString("\n")
	}
	// Render streaming content if active
	if c.streaming && c.streamBuf.Len() > 0 {
		sb.WriteString(c.theme.AssistantBadge.String())
		sb.WriteString("\n")
		sb.WriteString(c.md.Render(c.streamBuf.String()))
		sb.WriteString("\u2588") // block cursor indicator
		sb.WriteString("\n")
	}
	c.viewport.SetContent(sb.String())
	c.viewport.GotoBottom()
}

func (c *Chat) renderMessage(msg shared.Message) string {
	var sb strings.Builder
	switch msg.Role {
	case shared.RoleUser:
		sb.WriteString(c.theme.UserBadge.String())
		sb.WriteString("\n")
		sb.WriteString(c.theme.UserMessage.Render(msg.Content))
	case shared.RoleAssistant:
		sb.WriteString(c.theme.AssistantBadge.String())
		sb.WriteString("\n")
		sb.WriteString(c.md.Render(msg.Content))
	case shared.RoleSystem:
		sb.WriteString(c.theme.ErrorMessage.Render(msg.Content))
	default:
		sb.WriteString(msg.Content)
	}
	return sb.String()
}
