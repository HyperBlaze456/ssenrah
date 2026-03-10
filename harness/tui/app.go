package tui

import (
	"context"
	"fmt"
	"time"

	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/HyperBlaze456/ssenrah/harness/application"
	"github.com/HyperBlaze456/ssenrah/harness/domain/session"
	"github.com/HyperBlaze456/ssenrah/harness/domain/shared"
)

// App is the root Bubbletea model that orchestrates all TUI components.
type App struct {
	chatService    *application.ChatService
	sessionService *application.SessionService
	program        *tea.Program

	chat      Chat
	input     Input
	sidebar   Sidebar
	statusBar StatusBar
	approval  Approval

	keys        keyMap
	theme       theme
	width       int
	height      int
	sidebarOpen bool
	streaming   bool
	cancelFn    context.CancelFunc

	totalTokens int
	totalCost   float64
}

// NewApp creates the root App model.
func NewApp(chatSvc *application.ChatService, sessSvc *application.SessionService) *App {
	t := defaultTheme()
	return &App{
		chatService:    chatSvc,
		sessionService: sessSvc,
		keys:           defaultKeyMap(),
		theme:          t,
		sidebarOpen:    true,
		chat:           NewChat(t, 80, 20),
		input:          NewInput(t, 80),
		sidebar:        NewSidebar(t, sidebarWidth, 20),
		statusBar:      NewStatusBar(t, 80),
		approval:       NewApproval(t),
	}
}

// SetProgram wires the tea.Program reference for async Send().
// Must be called after tea.NewProgram() and before p.Run().
func (a *App) SetProgram(p *tea.Program) {
	a.program = p
}

// Init returns initial commands.
func (a *App) Init() tea.Cmd {
	return a.input.Focus()
}

// Update handles all messages.
func (a *App) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		a.width = msg.Width
		a.height = msg.Height
		a.updateLayout()
		return a, nil

	case tea.KeyMsg:
		// Global keys
		switch {
		case key.Matches(msg, a.keys.Quit) || key.Matches(msg, a.keys.QuitAlt):
			if a.streaming && a.cancelFn != nil {
				a.cancelFn()
			}
			return a, tea.Quit

		case key.Matches(msg, a.keys.Tab):
			a.sidebarOpen = !a.sidebarOpen
			a.updateLayout()
			return a, nil

		case key.Matches(msg, a.keys.Cancel):
			if a.streaming && a.cancelFn != nil {
				a.cancelFn()
				a.cancelFn = nil
				a.streaming = false
				a.sessionService.SetPhase(session.PhaseIdle)
				a.statusBar.SetPhase(session.PhaseIdle)
			}
			if a.approval.IsVisible() {
				a.approval.Hide()
			}
			return a, nil

		case key.Matches(msg, a.keys.Send):
			if a.streaming {
				return a, nil // guard: don't double-send
			}
			content := a.input.Value()
			if content == "" {
				return a, nil
			}
			a.input.Reset()
			a.streaming = true
			a.sessionService.SetPhase(session.PhaseStreaming)
			a.statusBar.SetPhase(session.PhaseStreaming)

			// Build user message once — same object goes to both TUI and Conversation
			userMsg := shared.NewMessage(shared.RoleUser, content)
			a.chat.AddUserMessage(userMsg)

			ctx, cancel := context.WithCancel(context.Background())
			a.cancelFn = cancel

			return a, a.sendMessageCmd(ctx, userMsg)

		case key.Matches(msg, a.keys.ClearChat):
			a.chat.Clear()
			return a, nil
		}

	case StreamChunkMsg:
		a.chat.AppendChunk(msg.Chunk)
		return a, nil

	case StreamDoneMsg:
		a.chat.FinalizeMessage(msg.FinalMessage)
		a.streaming = false
		a.cancelFn = nil
		a.sessionService.SetPhase(session.PhaseIdle)
		a.statusBar.SetPhase(session.PhaseIdle)
		// Estimate tokens (rough) — use delta, not cumulative
		deltaTokens := len(msg.FinalMessage.Content) / 4
		a.totalTokens += deltaTokens
		a.totalCost += float64(deltaTokens) * 0.000001
		a.sessionService.UpdateStatus(a.totalTokens, a.totalCost)
		a.sidebar.SetUsage(a.totalTokens, a.totalCost)
		a.input.SetUsage(a.totalTokens, a.totalCost)
		a.sidebar.AddActivity(ActivityEntry{
			Time:    time.Now().Format("15:04"),
			Message: "response complete",
		})
		return a, nil

	case StreamErrorMsg:
		a.chat.ShowError(msg.Err)
		a.streaming = false
		a.cancelFn = nil
		a.sessionService.SetPhase(session.PhaseIdle)
		a.statusBar.SetPhase(session.PhaseIdle)
		return a, nil

	case ApprovalRequestMsg:
		a.approval.Show(msg.Request)
		a.sessionService.SetPhase(session.PhaseAwaitingApproval)
		a.statusBar.SetPhase(session.PhaseAwaitingApproval)
		return a, nil
	}

	// Delegate to input for text editing
	newInput, inputCmd := a.input.Update(msg)
	a.input = newInput
	if inputCmd != nil {
		cmds = append(cmds, inputCmd)
	}

	// Delegate to chat for viewport scrolling
	newChat, chatCmd := a.chat.Update(msg)
	a.chat = newChat
	if chatCmd != nil {
		cmds = append(cmds, chatCmd)
	}

	return a, tea.Batch(cmds...)
}

// sendMessageCmd returns a tea.Cmd that runs SendMessage in a goroutine.
// Captures program and chatService to local vars to avoid data races.
func (a *App) sendMessageCmd(ctx context.Context, userMsg shared.Message) tea.Cmd {
	prog := a.program
	svc := a.chatService
	return func() tea.Msg {
		handler := func(chunk shared.StreamChunk) {
			if prog != nil {
				prog.Send(StreamChunkMsg{Chunk: chunk})
			}
		}

		finalMsg, err := svc.SendMessage(ctx, userMsg, handler)
		if err != nil {
			if ctx.Err() != nil {
				return StreamErrorMsg{Err: shared.ErrStreamCancelled}
			}
			return StreamErrorMsg{Err: err}
		}

		return StreamDoneMsg{FinalMessage: finalMsg}
	}
}

// View composes the full TUI layout.
func (a *App) View() string {
	layout := ComputeLayout(a.width, a.height, a.sidebarOpen)

	if layout.TooSmall {
		return lipgloss.Place(a.width, a.height,
			lipgloss.Center, lipgloss.Center,
			a.theme.Muted.Render("Terminal too small (min 80x24)"),
		)
	}

	// Approval overlay takes priority
	if a.approval.IsVisible() {
		a.approval.SetSize(a.width, a.height)
		return a.approval.View()
	}

	chatView := a.chat.View()
	inputView := a.input.View()
	statusView := a.statusBar.View()

	// Build main column
	mainCol := lipgloss.JoinVertical(lipgloss.Left,
		chatView,
		inputView,
		statusView,
	)

	if layout.CompactMode || !a.sidebarOpen {
		// Compact: show info in top bar
		info := a.theme.InputInfo.Render(
			fmt.Sprintf(" %s \u00b7 %s \u00b7 %d tok \u00b7 $%.4f",
				a.sidebar.model, a.sidebar.provider, a.sidebar.tokens, a.sidebar.cost),
		)
		return lipgloss.JoinVertical(lipgloss.Left, info, mainCol)
	}

	// Wide: show sidebar
	sidebarView := a.sidebar.View()
	return lipgloss.JoinHorizontal(lipgloss.Top, mainCol, sidebarView)
}

func (a *App) updateLayout() {
	layout := ComputeLayout(a.width, a.height, a.sidebarOpen)
	if layout.TooSmall {
		return
	}
	a.chat.SetSize(layout.ChatWidth, layout.ChatHeight)
	a.input.SetSize(layout.ChatWidth)
	a.sidebar.SetSize(layout.SidebarWidth, layout.SidebarHeight)
	a.statusBar.SetWidth(a.width)
	a.approval.SetSize(a.width, a.height)
}
