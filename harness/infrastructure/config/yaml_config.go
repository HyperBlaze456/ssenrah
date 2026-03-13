package config

import (
	_ "embed"
	"errors"
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

//go:embed defaults.yaml
var defaultsYAML []byte

// HarnessConfig is the top-level YAML config.
type HarnessConfig struct {
	App         AppConfig                   `yaml:"app"`
	PolicyTiers map[string]PolicyTierConfig `yaml:"policy_tiers"`
	AgentTypes  map[string]AgentTypeConfig  `yaml:"agent_types"`
}

// PolicyTierConfig defines a single policy tier.
type PolicyTierConfig struct {
	Description   string                    `yaml:"description"`
	DefaultAction string                    `yaml:"default_action"` // "ask", "allow", "deny"
	ToolRules     map[string]ToolRuleConfig `yaml:"tool_rules"`
}

// ToolRuleConfig defines per-tool policy within a tier.
type ToolRuleConfig struct {
	Action string `yaml:"action"` // "allow", "deny", "ask"
	Reason string `yaml:"reason"`
}

// AgentTypeConfig defines an agent type template.
type AgentTypeConfig struct {
	Description  string   `yaml:"description"`
	Model        string   `yaml:"model"`
	PolicyTier   string   `yaml:"policy_tier"`
	Tools        []string `yaml:"tools"`
	SystemPrompt string   `yaml:"system_prompt"`
	MaxTurns     int      `yaml:"max_turns"`
}

// DefaultHarnessConfig parses the embedded defaults.yaml.
func DefaultHarnessConfig() (HarnessConfig, error) {
	var cfg HarnessConfig
	if err := yaml.Unmarshal(defaultsYAML, &cfg); err != nil {
		return HarnessConfig{}, fmt.Errorf("parsing embedded defaults: %w", err)
	}
	return cfg, nil
}

// LoadHarnessConfig loads config from a YAML file.
// Full-file replacement: if the file exists, it replaces all embedded defaults.
// If the file does not exist, returns embedded defaults.
func LoadHarnessConfig(path string) (HarnessConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return DefaultHarnessConfig()
		}
		return HarnessConfig{}, fmt.Errorf("reading config: %w", err)
	}
	var cfg HarnessConfig
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return HarnessConfig{}, fmt.Errorf("parsing %s: %w", path, err)
	}
	if err := cfg.Validate(); err != nil {
		return HarnessConfig{}, fmt.Errorf("validating %s: %w", path, err)
	}
	return cfg, nil
}

// Validate checks config consistency.
func (c HarnessConfig) Validate() error {
	validActions := map[string]bool{"allow": true, "deny": true, "ask": true}

	for name, tier := range c.PolicyTiers {
		if !validActions[tier.DefaultAction] {
			return fmt.Errorf("policy tier %q: invalid default_action %q (must be allow/deny/ask)", name, tier.DefaultAction)
		}
		for toolName, rule := range tier.ToolRules {
			if !validActions[rule.Action] {
				return fmt.Errorf("policy tier %q, tool %q: invalid action %q", name, toolName, rule.Action)
			}
		}
	}

	for name, at := range c.AgentTypes {
		if _, ok := c.PolicyTiers[at.PolicyTier]; !ok {
			return fmt.Errorf("agent type %q: references nonexistent policy tier %q", name, at.PolicyTier)
		}
	}

	return nil
}
