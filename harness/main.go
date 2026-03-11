package main

import (
	"fmt"
	"os"
	"path/filepath"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/HyperBlaze456/ssenrah/harness/application"
	"github.com/HyperBlaze456/ssenrah/harness/domain/conversation"
	"github.com/HyperBlaze456/ssenrah/harness/domain/session"
	"github.com/HyperBlaze456/ssenrah/harness/domain/tool"
	"github.com/HyperBlaze456/ssenrah/harness/infrastructure"
	"github.com/HyperBlaze456/ssenrah/harness/infrastructure/config"
	"github.com/HyperBlaze456/ssenrah/harness/infrastructure/prompt"
	"github.com/HyperBlaze456/ssenrah/harness/infrastructure/tools"
	"github.com/HyperBlaze456/ssenrah/harness/tui"
)

func main() {
	// Load configuration
	cfgPath := filepath.Join(".", "harness.json")
	cfg, err := config.LoadConfig(cfgPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Config error: %v\n", err)
		os.Exit(1)
	}

	// Load system prompt
	systemPrompt := prompt.LoadDefaultPrompt()

	// Create provider from config
	prov, err := infrastructure.NewProvider(cfg)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Provider error: %v\n", err)
		os.Exit(1)
	}

	// Resolve model name
	modelName := cfg.Model
	if modelName == "" {
		modelName = "default"
	}

	// Create tool registry with built-in tools
	registry := tool.NewRegistry()
	cwd, _ := os.Getwd()
	registry.Register(tools.NewReadFile())
	registry.Register(tools.NewWriteFile())
	registry.Register(tools.NewBash(cwd))

	// Create domain objects
	conv := conversation.New()
	sess := session.New(modelName, prov.Name())

	// Create application services
	agentSvc := application.NewAgentService(conv, prov, registry, systemPrompt)
	agentSvc.SetModel(modelName)
	sessSvc := application.NewSessionService(sess)

	// Register default key bindings
	sessSvc.RegisterKeyBinding(session.KeyBinding{Key: "enter", Action: "send", Description: "Send message"})
	sessSvc.RegisterKeyBinding(session.KeyBinding{Key: "tab", Action: "sidebar", Description: "Toggle sidebar"})
	sessSvc.RegisterKeyBinding(session.KeyBinding{Key: "esc", Action: "cancel", Description: "Cancel stream"})
	sessSvc.RegisterKeyBinding(session.KeyBinding{Key: "ctrl+c", Action: "quit", Description: "Quit"})
	sessSvc.RegisterKeyBinding(session.KeyBinding{Key: "y/n/a", Action: "approve", Description: "Approve/Deny/Always"})

	// Create TUI
	app := tui.NewApp(agentSvc, sessSvc)

	// Create program and wire reference for async Send()
	p := tea.NewProgram(app, tea.WithAltScreen())
	app.SetProgram(p)

	// Run
	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
