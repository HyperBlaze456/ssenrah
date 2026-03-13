package infrastructure

import (
	"fmt"
	"os"

	"github.com/HyperBlaze456/ssenrah/harness/domain/agent"
	"github.com/HyperBlaze456/ssenrah/harness/domain/policy"
	"github.com/HyperBlaze456/ssenrah/harness/domain/provider"
	"github.com/HyperBlaze456/ssenrah/harness/domain/tool"
	"github.com/HyperBlaze456/ssenrah/harness/infrastructure/codex"
	"github.com/HyperBlaze456/ssenrah/harness/infrastructure/config"
	"github.com/HyperBlaze456/ssenrah/harness/infrastructure/dummy"
	"github.com/HyperBlaze456/ssenrah/harness/infrastructure/openrouter"
)

// NewProvider creates an LLMProvider based on the given configuration.
// API keys are read from environment variables:
//   - OPENROUTER_API_KEY for the openrouter provider
//   - CODEX_API_KEY for the codex provider
func NewProvider(cfg config.AppConfig) (provider.LLMProvider, error) {
	switch cfg.Provider {
	case "dummy":
		return dummy.NewProvider(), nil
	case "openrouter":
		key := os.Getenv("OPENROUTER_API_KEY")
		if key == "" {
			return nil, fmt.Errorf("OPENROUTER_API_KEY environment variable is required for openrouter provider")
		}
		return openrouter.NewProvider(key), nil
	case "codex":
		key := os.Getenv("CODEX_API_KEY")
		if key == "" {
			return nil, fmt.Errorf("CODEX_API_KEY environment variable is required for codex provider")
		}
		return codex.NewProvider(key), nil
	default:
		return nil, fmt.Errorf("unknown provider: %s (available: dummy, openrouter, codex)", cfg.Provider)
	}
}

// BuildPolicyProfiles converts YAML tier configs to domain PolicyProfiles.
func BuildPolicyProfiles(tiers map[string]config.PolicyTierConfig) (map[string]policy.PolicyProfile, error) {
	profiles := make(map[string]policy.PolicyProfile, len(tiers))
	for name, tier := range tiers {
		defaultAction, err := parsePolicyAction(tier.DefaultAction)
		if err != nil {
			return nil, fmt.Errorf("tier %q: %w", name, err)
		}
		rules := make(map[string]policy.ToolRule, len(tier.ToolRules))
		for toolName, rule := range tier.ToolRules {
			action, err := parsePolicyAction(rule.Action)
			if err != nil {
				return nil, fmt.Errorf("tier %q, tool %q: %w", name, toolName, err)
			}
			rules[toolName] = policy.ToolRule{Action: action, Reason: rule.Reason}
		}
		profiles[name] = policy.PolicyProfile{
			Name:          name,
			Description:   tier.Description,
			DefaultAction: defaultAction,
			ToolRules:     rules,
		}
	}
	return profiles, nil
}

// BuildAgentTypes converts YAML agent type configs to domain AgentTypes.
func BuildAgentTypes(types map[string]config.AgentTypeConfig) map[string]agent.AgentType {
	result := make(map[string]agent.AgentType, len(types))
	for name, at := range types {
		result[name] = agent.AgentType{
			Name:         name,
			Description:  at.Description,
			Model:        at.Model,
			PolicyTier:   at.PolicyTier,
			Tools:        at.Tools,
			SystemPrompt: at.SystemPrompt,
			MaxTurns:     at.MaxTurns,
		}
	}
	return result
}

// BuildRegistryForAgentType creates a filtered Registry containing only the tools
// an agent type is allowed to use.
func BuildRegistryForAgentType(at agent.AgentType, fullRegistry *tool.Registry) *tool.Registry {
	filtered := tool.NewRegistry()
	for _, toolName := range at.Tools {
		if t, ok := fullRegistry.Get(toolName); ok {
			filtered.Register(t)
		}
	}
	return filtered
}

// parsePolicyAction converts a string action to a PolicyDecision.
func parsePolicyAction(action string) (policy.PolicyDecision, error) {
	switch action {
	case "allow":
		return policy.Allow, nil
	case "deny":
		return policy.Deny, nil
	case "ask":
		return policy.AwaitUser, nil
	default:
		return policy.Allow, fmt.Errorf("invalid action %q (must be allow/deny/ask)", action)
	}
}
