package tui

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/HyperBlaze456/ssenrah/harness/application"
	"github.com/HyperBlaze456/ssenrah/harness/domain/agent"
	"github.com/HyperBlaze456/ssenrah/harness/domain/policy"
	"github.com/HyperBlaze456/ssenrah/harness/domain/provider"
	"github.com/HyperBlaze456/ssenrah/harness/domain/session"
	"github.com/HyperBlaze456/ssenrah/harness/domain/shared"
	"github.com/HyperBlaze456/ssenrah/harness/domain/task"
	"github.com/HyperBlaze456/ssenrah/harness/domain/tool"
	"github.com/HyperBlaze456/ssenrah/harness/infrastructure"
)

// App is the root Bubbletea model that orchestrates all TUI components.
type App struct {
	agentService   *application.AgentService
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

	// Agent loop state
	agentEventCh       <-chan application.AgentEvent
	approvalResponseCh chan<- application.ApprovalResponse

	// Policy and agent type runtime state
	policyProfiles map[string]policy.PolicyProfile
	agentTypes     map[string]agent.AgentType
	fullRegistry   *tool.Registry

	// Team orchestrator (nil when team mode is not configured)
	orchestrator *application.OrchestratorService
}

// NewApp creates the root App model.
func NewApp(
	agentSvc *application.AgentService,
	sessSvc *application.SessionService,
	profiles map[string]policy.PolicyProfile,
	types map[string]agent.AgentType,
	fullReg *tool.Registry,
	orch *application.OrchestratorService,
) *App {
	t := defaultTheme()
	return &App{
		agentService:   agentSvc,
		sessionService: sessSvc,
		policyProfiles: profiles,
		agentTypes:     types,
		fullRegistry:   fullReg,
		orchestrator:   orch,
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
		// Approval keys take priority when modal is visible
		if a.approval.IsVisible() {
			switch msg.String() {
			case "y", "Y":
				a.approval.Hide()
				if a.approvalResponseCh != nil {
					a.approvalResponseCh <- application.ApprovalResponse{Approved: true}
					a.approvalResponseCh = nil
				}
				a.sessionService.SetPhase(session.PhaseStreaming)
				a.statusBar.SetPhase(session.PhaseStreaming)
				return a, nil
			case "n", "N":
				a.approval.Hide()
				if a.approvalResponseCh != nil {
					a.approvalResponseCh <- application.ApprovalResponse{Approved: false}
					a.approvalResponseCh = nil
				}
				a.sessionService.SetPhase(session.PhaseStreaming)
				a.statusBar.SetPhase(session.PhaseStreaming)
				return a, nil
			case "a", "A":
				a.approval.Hide()
				if a.approvalResponseCh != nil {
					a.approvalResponseCh <- application.ApprovalResponse{Approved: true, AlwaysAllow: true}
					a.approvalResponseCh = nil
				}
				a.sessionService.SetPhase(session.PhaseStreaming)
				a.statusBar.SetPhase(session.PhaseStreaming)
				return a, nil
			}
			// Block all other keys while approval is showing
			return a, nil
		}

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

			return a, a.startAgentCmd(ctx, userMsg)

		case key.Matches(msg, a.keys.ClearChat):
			a.chat.Clear()
			return a, nil
		}

	case agentEventMsg:
		return a.handleAgentEvent(msg.Event)

	case agentChannelClosedMsg:
		// Agent channel closed without EventDone (shouldn't happen normally)
		a.streaming = false
		a.cancelFn = nil
		a.sessionService.SetPhase(session.PhaseIdle)
		a.statusBar.SetPhase(session.PhaseIdle)
		return a, nil

	case ModelsResultMsg:
		if msg.Err != nil {
			a.chat.ShowError(msg.Err)
			return a, nil
		}
		a.showModelList(msg.Models)
		return a, nil

	case ModelSelectedMsg:
		a.agentService.SetModel(msg.Model.ID)
		a.sidebar.SetModelInfo(msg.Model.ID, a.agentService.ProviderName(), msg.Model.ContextWindow)
		a.input.SetModelInfo(msg.Model.ID, a.agentService.ProviderName())
		a.chat.AddUserMessage(shared.NewMessage(shared.RoleSystem,
			fmt.Sprintf("Model switched to %s", msg.Model.ID)))
		return a, nil

	case teamProgressMsg:
		a.sidebar.SetTeamStatus(msg.Tasks, msg.Stats)
		return a, nil

	case teamDoneMsg:
		a.sidebar.ClearTeam()
		if msg.Err != nil {
			a.chat.ShowError(msg.Err)
		} else {
			a.chat.AddUserMessage(shared.NewMessage(shared.RoleSystem,
				fmt.Sprintf("Team completed: %d/%d tasks succeeded", msg.Stats.Completed, msg.Stats.Total)))
		}
		return a, nil

	case teamDecomposeResultMsg:
		if msg.Err != nil {
			a.chat.ShowError(msg.Err)
			return a, nil
		}
		a.chat.AddUserMessage(shared.NewMessage(shared.RoleSystem,
			fmt.Sprintf("Decomposed into %d tasks. Starting execution...", msg.TaskCount)))
		return a, a.startTeamCmd()
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

// startAgentCmd launches the agent loop and starts listening for events.
func (a *App) startAgentCmd(ctx context.Context, userMsg shared.Message) tea.Cmd {
	eventCh := make(chan application.AgentEvent, 16)
	a.agentEventCh = eventCh

	svc := a.agentService // capture to local var for goroutine safety
	go svc.Run(ctx, userMsg, eventCh)

	return listenAgentEvents(eventCh)
}

// listenAgentEvents returns a tea.Cmd that reads the next event from the channel.
func listenAgentEvents(ch <-chan application.AgentEvent) tea.Cmd {
	return func() tea.Msg {
		event, ok := <-ch
		if !ok {
			return agentChannelClosedMsg{}
		}
		return agentEventMsg{Event: event}
	}
}

// handleAgentEvent dispatches a single AgentEvent to the appropriate TUI update.
func (a *App) handleAgentEvent(event application.AgentEvent) (tea.Model, tea.Cmd) {
	switch ev := event.(type) {
	case application.EventStreamChunk:
		a.chat.AppendChunk(ev.Chunk)
		return a, listenAgentEvents(a.agentEventCh)

	case application.EventToolCall:
		a.chat.AddToolCall(ev.Call)
		a.sidebar.AddActivity(ActivityEntry{
			Time:    time.Now().Format("15:04"),
			Message: fmt.Sprintf("tool: %s", ev.Call.ToolName),
		})
		return a, listenAgentEvents(a.agentEventCh)

	case application.EventApprovalNeeded:
		a.approvalResponseCh = ev.ResponseCh
		a.approval.Show(ev.Request)
		a.sessionService.SetPhase(session.PhaseAwaitingApproval)
		a.statusBar.SetPhase(session.PhaseAwaitingApproval)
		return a, listenAgentEvents(a.agentEventCh)

	case application.EventToolResult:
		a.chat.AddToolResult(ev.Call, ev.Result)
		return a, listenAgentEvents(a.agentEventCh)

	case application.EventTurnComplete:
		a.chat.FinalizeMessage(ev.Message)
		a.totalTokens += ev.Usage.TotalTokens()
		a.totalCost += ev.Usage.EstimateCost(0.000001, 0.000002)
		a.sessionService.UpdateStatus(a.totalTokens, a.totalCost)
		a.sidebar.SetUsage(a.totalTokens, a.totalCost)
		a.input.SetUsage(a.totalTokens, a.totalCost)
		return a, listenAgentEvents(a.agentEventCh)

	case application.EventDone:
		a.streaming = false
		a.cancelFn = nil
		a.sessionService.SetPhase(session.PhaseIdle)
		a.statusBar.SetPhase(session.PhaseIdle)
		a.sidebar.AddActivity(ActivityEntry{
			Time:    time.Now().Format("15:04"),
			Message: fmt.Sprintf("done (%d turns, %d tok)", ev.TotalTurns, ev.TotalUsage.TotalTokens()),
		})
		return a, nil // stop listening

	case application.EventError:
		a.chat.ShowError(ev.Err)
		a.streaming = false
		a.cancelFn = nil
		a.sessionService.SetPhase(session.PhaseIdle)
		a.statusBar.SetPhase(session.PhaseIdle)
		return a, nil // stop listening
	}

	return a, listenAgentEvents(a.agentEventCh)
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
			a.agentService.SetModel(modelID)
			a.sidebar.SetModelInfo(modelID, a.agentService.ProviderName(), 0)
			a.input.SetModelInfo(modelID, a.agentService.ProviderName())
			a.chat.AddUserMessage(shared.NewMessage(shared.RoleSystem,
				fmt.Sprintf("Model switched to %s", modelID)))
			return nil, true
		}
		// List available models
		return a.fetchModelsCmd(), true

	case "/provider":
		a.chat.AddUserMessage(shared.NewMessage(shared.RoleSystem,
			fmt.Sprintf("Current provider: %s", a.agentService.ProviderName())))
		return nil, true

	case "/policy":
		if len(parts) > 1 {
			tierName := parts[1]
			if a.streaming {
				a.chat.AddUserMessage(shared.NewMessage(shared.RoleSystem,
					"Cannot switch policy while streaming."))
				return nil, true
			}
			profile, ok := a.policyProfiles[tierName]
			if !ok {
				available := make([]string, 0, len(a.policyProfiles))
				for name := range a.policyProfiles {
					available = append(available, name)
				}
				sort.Strings(available)
				a.chat.AddUserMessage(shared.NewMessage(shared.RoleSystem,
					fmt.Sprintf("Unknown policy tier: %s\nAvailable: %s", tierName, strings.Join(available, ", "))))
				return nil, true
			}
			a.agentService.SetPolicyProfile(profile)
			a.chat.AddUserMessage(shared.NewMessage(shared.RoleSystem,
				fmt.Sprintf("Policy switched to **%s**: %s", profile.Name, profile.Description)))
			return nil, true
		}
		// List tiers
		var sb strings.Builder
		sb.WriteString("**Policy Tiers:**\n\n")
		active := a.agentService.ActivePolicyProfile().Name
		for name, p := range a.policyProfiles {
			marker := "  "
			if name == active {
				marker = "> "
			}
			sb.WriteString(fmt.Sprintf("%s**%s** — %s\n", marker, name, p.Description))
		}
		sb.WriteString("\nUse `/policy <tier>` to switch.")
		a.chat.AddUserMessage(shared.NewMessage(shared.RoleSystem, sb.String()))
		return nil, true

	case "/agent":
		if len(parts) > 1 {
			typeName := parts[1]
			if a.streaming {
				a.chat.AddUserMessage(shared.NewMessage(shared.RoleSystem,
					"Cannot switch agent while streaming."))
				return nil, true
			}
			at, ok := a.agentTypes[typeName]
			if !ok {
				available := make([]string, 0, len(a.agentTypes))
				for name := range a.agentTypes {
					available = append(available, name)
				}
				sort.Strings(available)
				a.chat.AddUserMessage(shared.NewMessage(shared.RoleSystem,
					fmt.Sprintf("Unknown agent type: %s\nAvailable: %s", typeName, strings.Join(available, ", "))))
				return nil, true
			}
			profile, ok := a.policyProfiles[at.PolicyTier]
			if !ok {
				a.chat.AddUserMessage(shared.NewMessage(shared.RoleSystem,
					fmt.Sprintf("Agent type %q references unknown policy tier %q", typeName, at.PolicyTier)))
				return nil, true
			}
			filteredReg := infrastructure.BuildRegistryForAgentType(at, a.fullRegistry)
			a.agentService.ApplyAgentType(at, profile, filteredReg)
			a.sidebar.SetModelInfo(at.Model, a.agentService.ProviderName(), 0)
			a.input.SetModelInfo(at.Model, a.agentService.ProviderName())
			a.chat.AddUserMessage(shared.NewMessage(shared.RoleSystem,
				fmt.Sprintf("Agent switched to **%s** (%s) — policy: %s", at.Name, at.Description, at.PolicyTier)))
			return nil, true
		}
		// List agent types
		var sb strings.Builder
		sb.WriteString("**Agent Types:**\n\n")
		activeType := a.agentService.ActiveAgentType()
		for name, at := range a.agentTypes {
			marker := "  "
			if activeType != nil && name == activeType.Name {
				marker = "> "
			}
			sb.WriteString(fmt.Sprintf("%s**%s** — %s (model: %s, policy: %s)\n", marker, name, at.Description, at.Model, at.PolicyTier))
		}
		sb.WriteString("\nUse `/agent <type>` to switch.")
		a.chat.AddUserMessage(shared.NewMessage(shared.RoleSystem, sb.String()))
		return nil, true

	case "/clear":
		a.chat.Clear()
		return nil, true

	case "/team":
		if a.orchestrator == nil {
			a.chat.AddUserMessage(shared.NewMessage(shared.RoleSystem,
				"Team mode not configured (set team.max_workers > 0 in harness.yaml)"))
			return nil, true
		}
		if len(parts) < 2 {
			a.chat.AddUserMessage(shared.NewMessage(shared.RoleSystem,
				"Usage: /team <goal>  |  /team status  |  /team cancel"))
			return nil, true
		}
		subCmd := strings.ToLower(parts[1])
		switch subCmd {
		case "status":
			stats := a.orchestrator.Stats()
			a.chat.AddUserMessage(shared.NewMessage(shared.RoleSystem,
				fmt.Sprintf("Team status: %d total, %d running, %d completed, %d failed, %d pending",
					stats.Total, stats.Running, stats.Completed, stats.Failed, stats.Pending)))
			return nil, true
		case "cancel":
			a.orchestrator.Cancel()
			a.chat.AddUserMessage(shared.NewMessage(shared.RoleSystem, "Team execution cancelled."))
			return nil, true
		default:
			// /team <goal description> — everything after /team is the goal
			goal := strings.TrimSpace(strings.TrimPrefix(input, parts[0]))
			if a.orchestrator.IsRunning() {
				a.chat.AddUserMessage(shared.NewMessage(shared.RoleSystem, "Team is already running"))
				return nil, true
			}
			a.chat.AddUserMessage(shared.NewMessage(shared.RoleSystem,
				fmt.Sprintf("Starting team for: %s", goal)))
			return func() tea.Msg {
				// Decompose will be implemented by the LLM task decomposition feature.
				// For now, return an error indicating manual task addition is required.
				return teamDecomposeResultMsg{
					Err: fmt.Errorf("Decompose not yet implemented: add tasks manually via orchestrator.AddTask before calling /team"),
				}
			}, true
		}

	case "/help":
		a.chat.AddUserMessage(shared.NewMessage(shared.RoleSystem,
			"/model [name]    — list or switch models\n/provider        — show current provider\n/policy [tier]   — list or switch policy tiers\n/agent [type]    — list or switch agent types\n/team <goal>     — start team execution\n/team status     — show team progress\n/team cancel     — cancel team execution\n/clear           — clear chat\n/help            — show this help"))
		return nil, true

	default:
		a.chat.AddUserMessage(shared.NewMessage(shared.RoleSystem,
			fmt.Sprintf("Unknown command: %s. Type /help for available commands.", command)))
		return nil, true
	}
}

// fetchModelsCmd fetches available models from the provider.
func (a *App) fetchModelsCmd() tea.Cmd {
	svc := a.agentService
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

// startTeamCmd launches team execution in background and returns progress listener.
func (a *App) startTeamCmd() tea.Cmd {
	orch := a.orchestrator
	prog := a.program
	app := a
	return func() tea.Msg {
		ctx := context.Background()
		err := orch.RunWithCallback(ctx, func(stats task.GraphStats) {
			if prog != nil {
				prog.Send(teamProgressMsg{
					Stats: stats,
					Tasks: app.buildTeamEntries(),
				})
			}
		})
		finalStats := orch.Stats()
		if prog != nil {
			prog.Send(teamDoneMsg{Stats: finalStats, Err: err})
		}
		return nil
	}
}

// buildTeamEntries converts all tasks in the orchestrator graph to TeamTaskEntry slice.
func (a *App) buildTeamEntries() []TeamTaskEntry {
	if a.orchestrator == nil {
		return nil
	}
	all := a.orchestrator.Graph().All()
	entries := make([]TeamTaskEntry, 0, len(all))
	for _, t := range all {
		entries = append(entries, TeamTaskEntry{
			ID:        t.ID,
			AgentType: t.AgentType,
			Status:    t.Status,
		})
	}
	return entries
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
