package main

import (
	"fmt"
	"os"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/HyperBlaze456/ssenrah/harness/application"
	"github.com/HyperBlaze456/ssenrah/harness/domain/conversation"
	"github.com/HyperBlaze456/ssenrah/harness/domain/session"
	"github.com/HyperBlaze456/ssenrah/harness/infrastructure/dummy"
	"github.com/HyperBlaze456/ssenrah/harness/infrastructure/prompt"
	"github.com/HyperBlaze456/ssenrah/harness/tui"
)

func main() {
	// Load system prompt
	systemPrompt := prompt.LoadDefaultPrompt()

	// Create domain objects
	conv := conversation.New()
	sess := session.New("dummy-v1", "dummy")

	// Create infrastructure (adapters)
	prov := dummy.NewProvider()

	// Create application services
	chatSvc := application.NewChatService(conv, prov, systemPrompt)
	sessSvc := application.NewSessionService(sess)

	// Register default key bindings
	sessSvc.RegisterKeyBinding(session.KeyBinding{Key: "enter", Action: "send", Description: "Send message"})
	sessSvc.RegisterKeyBinding(session.KeyBinding{Key: "tab", Action: "sidebar", Description: "Toggle sidebar"})
	sessSvc.RegisterKeyBinding(session.KeyBinding{Key: "esc", Action: "cancel", Description: "Cancel stream"})
	sessSvc.RegisterKeyBinding(session.KeyBinding{Key: "ctrl+c", Action: "quit", Description: "Quit"})

	// Create TUI
	app := tui.NewApp(chatSvc, sessSvc)

	// Create program and wire reference for async Send()
	p := tea.NewProgram(app, tea.WithAltScreen())
	app.SetProgram(p)

	// Run — blocks until quit
	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
