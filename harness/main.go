package main

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/HyperBlaze456/ssenrah/harness/application"
	"github.com/HyperBlaze456/ssenrah/harness/domain/conversation"
	"github.com/HyperBlaze456/ssenrah/harness/domain/policy"
	"github.com/HyperBlaze456/ssenrah/harness/domain/session"
	"github.com/HyperBlaze456/ssenrah/harness/domain/tool"
	"github.com/HyperBlaze456/ssenrah/harness/infrastructure"
	"github.com/HyperBlaze456/ssenrah/harness/infrastructure/config"
	"github.com/HyperBlaze456/ssenrah/harness/infrastructure/logging"
	"github.com/HyperBlaze456/ssenrah/harness/infrastructure/prompt"
	"github.com/HyperBlaze456/ssenrah/harness/infrastructure/tools"
	"github.com/HyperBlaze456/ssenrah/harness/tui"
)

func main() {
	// Load YAML config (falls back to embedded defaults if no file exists)
	harnessCfg, err := config.LoadHarnessConfig(filepath.Join(".", "harness.yaml"))
	if err != nil {
		// Try legacy JSON config for backward compatibility
		cfgPath := filepath.Join(".", "harness.json")
		legacyCfg, legacyErr := config.LoadConfig(cfgPath)
		if legacyErr != nil {
			// Use embedded YAML defaults
			harnessCfg, err = config.DefaultHarnessConfig()
			if err != nil {
				fmt.Fprintf(os.Stderr, "Config error: %v\n", err)
				os.Exit(1)
			}
		} else {
			// Legacy JSON loaded — wrap in HarnessConfig with supervised defaults
			harnessCfg, err = config.DefaultHarnessConfig()
			if err != nil {
				fmt.Fprintf(os.Stderr, "Config error: %v\n", err)
				os.Exit(1)
			}
			harnessCfg.App = legacyCfg
		}
	}

	// Load system prompt
	systemPrompt := prompt.LoadDefaultPrompt()

	// Create provider from config
	prov, err := infrastructure.NewProvider(harnessCfg.App)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Provider error: %v\n", err)
		os.Exit(1)
	}

	// Resolve model name
	modelName := harnessCfg.App.Model
	if modelName == "" {
		modelName = "default"
	}

	// Create full tool registry with all built-in tools
	fullRegistry := tool.NewRegistry()
	cwd, _ := os.Getwd()
	fullRegistry.Register(tools.NewReadFile())
	fullRegistry.Register(tools.NewWriteFile())
	fullRegistry.Register(tools.NewBash(cwd))

	// Build policy profiles from YAML config
	policyProfiles, err := infrastructure.BuildPolicyProfiles(harnessCfg.PolicyTiers)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Policy config error: %v\n", err)
		os.Exit(1)
	}

	// Build agent types from YAML config
	agentTypes := infrastructure.BuildAgentTypes(harnessCfg.AgentTypes)

	// Look up default agent type and its policy tier
	defaultAgentType, ok := agentTypes["default"]
	if !ok {
		fmt.Fprintf(os.Stderr, "Config error: no 'default' agent type defined\n")
		os.Exit(1)
	}

	defaultProfile, ok := policyProfiles[defaultAgentType.PolicyTier]
	if !ok {
		fmt.Fprintf(os.Stderr, "Config error: default agent type references unknown policy tier %q\n", defaultAgentType.PolicyTier)
		os.Exit(1)
	}

	// Build filtered registry for the default agent type
	registry := infrastructure.BuildRegistryForAgentType(defaultAgentType, fullRegistry)

	// Create domain objects
	conv := conversation.New()
	sess := session.New(modelName, prov.Name())
	policyEngine := policy.NewPolicyEngine()
	eventLogger := logging.NewMemoryEventLogger()

	// Create application services
	agentSvc := application.NewAgentService(conv, prov, registry, systemPrompt, policyEngine, defaultProfile, eventLogger)
	agentSvc.SetModel(modelName)
	agentSvc.ApplyAgentType(defaultAgentType, defaultProfile, registry)
	sessSvc := application.NewSessionService(sess)

	// Register default key bindings
	sessSvc.RegisterKeyBinding(session.KeyBinding{Key: "enter", Action: "send", Description: "Send message"})
	sessSvc.RegisterKeyBinding(session.KeyBinding{Key: "tab", Action: "sidebar", Description: "Toggle sidebar"})
	sessSvc.RegisterKeyBinding(session.KeyBinding{Key: "esc", Action: "cancel", Description: "Cancel stream"})
	sessSvc.RegisterKeyBinding(session.KeyBinding{Key: "ctrl+c", Action: "quit", Description: "Quit"})
	sessSvc.RegisterKeyBinding(session.KeyBinding{Key: "y/n/a", Action: "approve", Description: "Approve/Deny/Always"})

	// Build team orchestrator (available for team mode)
	var orchestrator *application.OrchestratorService
	if harnessCfg.Team.MaxWorkers > 0 {
		taskTimeout := time.Duration(harnessCfg.Team.TaskTimeoutSeconds) * time.Second

		workerPool := application.NewWorkerPool(
			harnessCfg.Team.MaxWorkers,
			prov,
			fullRegistry,
			policyEngine,
			policyProfiles,
			agentTypes,
			eventLogger,
			taskTimeout,
		)

		matcher := application.NewAgentMatcher(
			harnessCfg.Team.CategoryMap,
			agentTypes,
			"default",
		)

		orchestrator = application.NewOrchestratorService(workerPool, matcher, eventLogger)
	}

	// Create TUI with policy profiles, agent types, and full registry for runtime switching
	app := tui.NewApp(agentSvc, sessSvc, policyProfiles, agentTypes, fullRegistry, orchestrator)

	// Create program and wire reference for async Send()
	p := tea.NewProgram(app, tea.WithAltScreen())
	app.SetProgram(p)

	// Run
	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
