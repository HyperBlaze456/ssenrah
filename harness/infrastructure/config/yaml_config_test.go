package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDefaultHarnessConfig(t *testing.T) {
	cfg, err := DefaultHarnessConfig()
	if err != nil {
		t.Fatalf("DefaultHarnessConfig() error = %v", err)
	}
	if len(cfg.PolicyTiers) != 4 {
		t.Errorf("expected 4 policy tiers, got %d", len(cfg.PolicyTiers))
	}
	if len(cfg.AgentTypes) != 6 {
		t.Errorf("expected 6 agent types, got %d", len(cfg.AgentTypes))
	}
}

func TestDefaultHarnessConfig_Tiers(t *testing.T) {
	cfg, err := DefaultHarnessConfig()
	if err != nil {
		t.Fatalf("DefaultHarnessConfig() error = %v", err)
	}

	want := map[string]string{
		"supervised": "ask",
		"balanced":   "ask",
		"autonomous": "allow",
		"yolo":       "allow",
	}
	for tier, action := range want {
		got, ok := cfg.PolicyTiers[tier]
		if !ok {
			t.Errorf("missing policy tier %q", tier)
			continue
		}
		if got.DefaultAction != action {
			t.Errorf("tier %q: default_action = %q, want %q", tier, got.DefaultAction, action)
		}
	}
}

func TestLoadHarnessConfig_FileNotExists(t *testing.T) {
	cfg, err := LoadHarnessConfig("/tmp/nonexistent-harness-config-xyz.yaml")
	if err != nil {
		t.Fatalf("LoadHarnessConfig() with missing file error = %v", err)
	}
	// Should fall back to embedded defaults.
	if len(cfg.PolicyTiers) != 4 {
		t.Errorf("expected 4 policy tiers from fallback, got %d", len(cfg.PolicyTiers))
	}
}

func TestLoadHarnessConfig_ValidFile(t *testing.T) {
	content := `
app:
  model: "test-model"
  provider: "test-provider"
  theme: "light"
  sidebar_open: false

policy_tiers:
  supervised:
    description: "Test tier"
    default_action: "ask"
    tool_rules: {}

agent_types:
  default:
    description: "Test agent"
    model: "test-model"
    policy_tier: "supervised"
    tools: ["read_file"]
    system_prompt: "Test prompt"
    max_turns: 5
`
	tmp := filepath.Join(t.TempDir(), "harness.yaml")
	if err := os.WriteFile(tmp, []byte(content), 0o644); err != nil {
		t.Fatalf("writing temp file: %v", err)
	}

	cfg, err := LoadHarnessConfig(tmp)
	if err != nil {
		t.Fatalf("LoadHarnessConfig() error = %v", err)
	}
	if cfg.App.Model != "test-model" {
		t.Errorf("App.Model = %q, want %q", cfg.App.Model, "test-model")
	}
	if cfg.App.Theme != "light" {
		t.Errorf("App.Theme = %q, want %q", cfg.App.Theme, "light")
	}
	if len(cfg.PolicyTiers) != 1 {
		t.Errorf("expected 1 policy tier, got %d", len(cfg.PolicyTiers))
	}
	if len(cfg.AgentTypes) != 1 {
		t.Errorf("expected 1 agent type, got %d", len(cfg.AgentTypes))
	}
}

func TestValidate_InvalidDefaultAction(t *testing.T) {
	cfg := HarnessConfig{
		PolicyTiers: map[string]PolicyTierConfig{
			"bad": {DefaultAction: "maybe", ToolRules: map[string]ToolRuleConfig{}},
		},
		AgentTypes: map[string]AgentTypeConfig{},
	}
	if err := cfg.Validate(); err == nil {
		t.Error("expected error for invalid default_action, got nil")
	}
}

func TestValidate_InvalidToolRuleAction(t *testing.T) {
	cfg := HarnessConfig{
		PolicyTiers: map[string]PolicyTierConfig{
			"ok": {
				DefaultAction: "ask",
				ToolRules: map[string]ToolRuleConfig{
					"bash": {Action: "yeet"},
				},
			},
		},
		AgentTypes: map[string]AgentTypeConfig{},
	}
	if err := cfg.Validate(); err == nil {
		t.Error("expected error for invalid tool rule action, got nil")
	}
}

func TestValidate_InvalidPolicyTierRef(t *testing.T) {
	cfg := HarnessConfig{
		PolicyTiers: map[string]PolicyTierConfig{
			"supervised": {DefaultAction: "ask", ToolRules: map[string]ToolRuleConfig{}},
		},
		AgentTypes: map[string]AgentTypeConfig{
			"myagent": {PolicyTier: "nonexistent"},
		},
	}
	if err := cfg.Validate(); err == nil {
		t.Error("expected error for nonexistent policy tier ref, got nil")
	}
}

func TestValidate_Valid(t *testing.T) {
	cfg := HarnessConfig{
		PolicyTiers: map[string]PolicyTierConfig{
			"supervised": {
				DefaultAction: "ask",
				ToolRules: map[string]ToolRuleConfig{
					"bash": {Action: "allow", Reason: "safe"},
				},
			},
		},
		AgentTypes: map[string]AgentTypeConfig{
			"default": {PolicyTier: "supervised"},
		},
	}
	if err := cfg.Validate(); err != nil {
		t.Errorf("Validate() unexpected error = %v", err)
	}
}

func TestDefaultHarnessConfig_TeamSection(t *testing.T) {
	cfg, err := DefaultHarnessConfig()
	if err != nil {
		t.Fatalf("DefaultHarnessConfig() error = %v", err)
	}
	tm := cfg.Team
	if tm.MaxWorkers != 4 {
		t.Errorf("Team.MaxWorkers = %d, want 4", tm.MaxWorkers)
	}
	if tm.TaskTimeoutSeconds != 120 {
		t.Errorf("Team.TaskTimeoutSeconds = %d, want 120", tm.TaskTimeoutSeconds)
	}
	if tm.HeartbeatIntervalSeconds != 5 {
		t.Errorf("Team.HeartbeatIntervalSeconds = %d, want 5", tm.HeartbeatIntervalSeconds)
	}
	if tm.IdleThresholdSeconds != 30 {
		t.Errorf("Team.IdleThresholdSeconds = %d, want 30", tm.IdleThresholdSeconds)
	}
	if tm.MaxNudges != 3 {
		t.Errorf("Team.MaxNudges = %d, want 3", tm.MaxNudges)
	}
	if len(tm.CategoryMap) == 0 {
		t.Error("Team.CategoryMap is empty, expected entries")
	}
	wantCategories := map[string]string{
		"explore":   "explorer",
		"implement": "coder",
		"refactor":  "coder",
		"test":      "verifier",
		"verify":    "verifier",
		"debug":     "reviewer",
		"document":  "reviewer",
		"generic":   "default",
	}
	for cat, want := range wantCategories {
		got, ok := tm.CategoryMap[cat]
		if !ok {
			t.Errorf("CategoryMap missing key %q", cat)
			continue
		}
		if got != want {
			t.Errorf("CategoryMap[%q] = %q, want %q", cat, got, want)
		}
	}
}

func TestValidate_TeamConfig_InvalidMaxWorkers(t *testing.T) {
	cfg := HarnessConfig{
		PolicyTiers: map[string]PolicyTierConfig{
			"supervised": {DefaultAction: "ask", ToolRules: map[string]ToolRuleConfig{}},
		},
		AgentTypes: map[string]AgentTypeConfig{},
		Team: TeamConfig{
			MaxWorkers:               0,
			TaskTimeoutSeconds:       120,
			HeartbeatIntervalSeconds: 5,
			IdleThresholdSeconds:     30,
		},
	}
	// MaxWorkers == 0 means team section absent; should pass.
	if err := cfg.Validate(); err != nil {
		t.Errorf("Validate() unexpected error for MaxWorkers=0 (absent team): %v", err)
	}

	cfg.Team.MaxWorkers = -1
	if err := cfg.Validate(); err == nil {
		t.Error("expected error for MaxWorkers=-1, got nil")
	}
}

func TestValidate_TeamConfig_InvalidTaskTimeout(t *testing.T) {
	cfg := HarnessConfig{
		PolicyTiers: map[string]PolicyTierConfig{
			"supervised": {DefaultAction: "ask", ToolRules: map[string]ToolRuleConfig{}},
		},
		AgentTypes: map[string]AgentTypeConfig{},
		Team: TeamConfig{
			MaxWorkers:               4,
			TaskTimeoutSeconds:       0,
			HeartbeatIntervalSeconds: 5,
			IdleThresholdSeconds:     30,
		},
	}
	if err := cfg.Validate(); err == nil {
		t.Error("expected error for task_timeout_seconds=0, got nil")
	}
}

func TestValidate_TeamConfig_HeartbeatGeqIdle(t *testing.T) {
	cfg := HarnessConfig{
		PolicyTiers: map[string]PolicyTierConfig{
			"supervised": {DefaultAction: "ask", ToolRules: map[string]ToolRuleConfig{}},
		},
		AgentTypes: map[string]AgentTypeConfig{},
		Team: TeamConfig{
			MaxWorkers:               4,
			TaskTimeoutSeconds:       120,
			HeartbeatIntervalSeconds: 30,
			IdleThresholdSeconds:     30,
		},
	}
	if err := cfg.Validate(); err == nil {
		t.Error("expected error when heartbeat_interval_seconds >= idle_threshold_seconds, got nil")
	}
}

func TestValidate_TeamConfig_CategoryMapBadRef(t *testing.T) {
	cfg := HarnessConfig{
		PolicyTiers: map[string]PolicyTierConfig{
			"supervised": {DefaultAction: "ask", ToolRules: map[string]ToolRuleConfig{}},
		},
		AgentTypes: map[string]AgentTypeConfig{
			"default": {PolicyTier: "supervised"},
		},
		Team: TeamConfig{
			MaxWorkers:               4,
			TaskTimeoutSeconds:       120,
			HeartbeatIntervalSeconds: 5,
			IdleThresholdSeconds:     30,
			CategoryMap: map[string]string{
				"explore": "nonexistent-agent",
			},
		},
	}
	if err := cfg.Validate(); err == nil {
		t.Error("expected error for category_map referencing nonexistent agent type, got nil")
	}
}

func TestValidate_TeamConfig_Valid(t *testing.T) {
	cfg := HarnessConfig{
		PolicyTiers: map[string]PolicyTierConfig{
			"supervised": {DefaultAction: "ask", ToolRules: map[string]ToolRuleConfig{}},
		},
		AgentTypes: map[string]AgentTypeConfig{
			"default": {PolicyTier: "supervised"},
			"coder":   {PolicyTier: "supervised"},
		},
		Team: TeamConfig{
			MaxWorkers:               2,
			TaskTimeoutSeconds:       60,
			HeartbeatIntervalSeconds: 5,
			IdleThresholdSeconds:     30,
			MaxNudges:                3,
			CategoryMap: map[string]string{
				"implement": "coder",
				"generic":   "default",
			},
		},
	}
	if err := cfg.Validate(); err != nil {
		t.Errorf("Validate() unexpected error = %v", err)
	}
}
