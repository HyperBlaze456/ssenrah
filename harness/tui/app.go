package tui

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/HyperBlaze456/ssenrah/harness/application"
	"github.com/HyperBlaze456/ssenrah/harness/domain/provider"
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

			// Handle slash commands
			if cmd, ok := a.handleSlashCommand(content); ok {
				return a, cmd
			}

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
		// Use usage from ChatService (estimated or real from provider)
		a.totalTokens += msg.Usage.TotalTokens()
		a.totalCost += msg.Usage.EstimateCost(0.000001, 0.000002)
		a.sessionService.UpdateStatus(a.totalTokens, a.totalCost)
		a.sidebar.SetUsage(a.totalTokens, a.totalCost)
		a.input.SetUsage(a.totalTokens, a.totalCost)
		a.sidebar.AddActivity(ActivityEntry{
			Time:    time.Now().Format("15:04"),
			Message: fmt.Sprintf("done (%d tok)", msg.Usage.TotalTokens()),
		})
		return a, nil

	case ModelsResultMsg:
		if msg.Err != nil {
			a.chat.ShowError(msg.Err)
			return a, nil
		}
		a.showModelList(msg.Models)
		return a, nil

	case ModelSelectedMsg:
		a.chatService.SetModel(msg.Model.ID)
		a.sidebar.SetModelInfo(msg.Model.ID, a.chatService.ProviderName(), msg.Model.ContextWindow)
		a.input.SetModelInfo(msg.Model.ID, a.chatService.ProviderName())
		a.chat.AddUserMessage(shared.NewMessage(shared.RoleSystem,
			fmt.Sprintf("Model switched to %s", msg.Model.ID)))
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

		return StreamDoneMsg{FinalMessage: finalMsg, Usage: svc.LastUsage()}
	}
}

// handleSlashCommand processes /commands. Returns (cmd, true) if handled.
func (a *App) handleSlashCommand(input string) (tea.Cmd, bool) {
	input = strings.TrimSpace(input)
	if !strings.HasPrefix(input, "/") {
		return nil, false
	}

	parts := strings.Fields(input)
	command := strings.ToLower(parts[0])

	switch command {
	case "/model":
		if len(parts) > 1 {
			// Direct model switch: /model <name>
			modelID := parts[1]
			a.chatService.SetModel(modelID)
			a.sidebar.SetModelInfo(modelID, a.chatService.ProviderName(), 0)
			a.input.SetModelInfo(modelID, a.chatService.ProviderName())
			a.chat.AddUserMessage(shared.NewMessage(shared.RoleSystem,
				fmt.Sprintf("Model switched to %s", modelID)))
			return nil, true
		}
		// List available models
		return a.fetchModelsCmd(), true

	case "/provider":
		a.chat.AddUserMessage(shared.NewMessage(shared.RoleSystem,
			fmt.Sprintf("Current provider: %s", a.chatService.ProviderName())))
		return nil, true

	case "/help":
		a.chat.AddUserMessage(shared.NewMessage(shared.RoleSystem,
			"/model [name]  — list or switch models\n/provider       — show current provider\n/clear          — clear chat\n/help           — show this help"))
		return nil, true

	case "/clear":
		a.chat.Clear()
		return nil, true

	default:
		a.chat.AddUserMessage(shared.NewMessage(shared.RoleSystem,
			fmt.Sprintf("Unknown command: %s. Type /help for available commands.", command)))
		return nil, true
	}
}

// fetchModelsCmd fetches available models from the provider.
func (a *App) fetchModelsCmd() tea.Cmd {
	svc := a.chatService
	return func() tea.Msg {
		models, err := svc.Models(context.Background())
		return ModelsResultMsg{Models: models, Err: err}
	}
}

// showModelList renders the model list in the chat.
func (a *App) showModelList(models []provider.ModelInfo) {
	if len(models) == 0 {
		a.chat.AddUserMessage(shared.NewMessage(shared.RoleSystem, "No models available."))
		return
	}
	var sb strings.Builder
	sb.WriteString("**Available Models:**\n\n")
	sb.WriteString("| Model | Context | Input $/1M | Output $/1M |\n")
	sb.WriteString("|-------|---------|------------|-------------|\n")
	for _, m := range models {
		name := m.ID
		if m.Name != "" {
			name = m.Name
		}
		sb.WriteString(fmt.Sprintf("| %s | %dk | $%.2f | $%.2f |\n",
			name, m.ContextWindow/1000,
			m.PricePerInputToken*1_000_000,
			m.PricePerOutputToken*1_000_000))
	}
	sb.WriteString("\nUse `/model <name>` to switch.")
	a.chat.AddUserMessage(shared.NewMessage(shared.RoleSystem, sb.String()))
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

	// Build main column with constrained width
	mainColStyle := lipgloss.NewStyle().Width(layout.ChatWidth)
	mainCol := mainColStyle.Render(lipgloss.JoinVertical(lipgloss.Left,
		chatView,
		inputView,
		statusView,
	))

	if layout.CompactMode || !a.sidebarOpen {
		// Compact: show info in top bar
		info := a.theme.InputInfo.Render(
			fmt.Sprintf(" %s · %s · %d tok · $%.4f",
				a.sidebar.model, a.sidebar.provider, a.sidebar.tokens, a.sidebar.cost),
		)
		return lipgloss.JoinVertical(lipgloss.Left, info, mainCol)
	}

	// Wide: show sidebar alongside main column
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
	// Status bar must match main column width, not full terminal, so JoinHorizontal works
	a.statusBar.SetWidth(layout.ChatWidth)
	a.approval.SetSize(a.width, a.height)
}
