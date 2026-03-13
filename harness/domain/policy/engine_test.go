package policy

import (
	"testing"

	"github.com/HyperBlaze456/ssenrah/harness/domain/shared"
)

func makeCall(toolName string) shared.ToolCall {
	return shared.ToolCall{
		ID:       "test-id",
		ToolName: toolName,
		Input:    map[string]any{},
	}
}

func TestPolicyEngine_AllowRule(t *testing.T) {
	engine := NewPolicyEngine()
	profile := PolicyProfile{
		Name:          "test",
		DefaultAction: Deny,
		ToolRules: map[string]ToolRule{
			"read_file": {Action: Allow, Reason: "safe read"},
		},
	}
	got := engine.Evaluate(makeCall("read_file"), profile)
	if got != Allow {
		t.Errorf("expected Allow, got %s", got)
	}
}

func TestPolicyEngine_DenyRule(t *testing.T) {
	engine := NewPolicyEngine()
	profile := PolicyProfile{
		Name:          "test",
		DefaultAction: Allow,
		ToolRules: map[string]ToolRule{
			"delete_file": {Action: Deny, Reason: "destructive"},
		},
	}
	got := engine.Evaluate(makeCall("delete_file"), profile)
	if got != Deny {
		t.Errorf("expected Deny, got %s", got)
	}
}

func TestPolicyEngine_AskRule(t *testing.T) {
	engine := NewPolicyEngine()
	profile := PolicyProfile{
		Name:          "test",
		DefaultAction: Allow,
		ToolRules: map[string]ToolRule{
			"write_file": {Action: AwaitUser, Reason: "needs review"},
		},
	}
	got := engine.Evaluate(makeCall("write_file"), profile)
	if got != AwaitUser {
		t.Errorf("expected AwaitUser, got %s", got)
	}
}

func TestPolicyEngine_DefaultAction_Allow(t *testing.T) {
	engine := NewPolicyEngine()
	profile := PolicyProfile{
		Name:          "yolo",
		DefaultAction: Allow,
		ToolRules:     map[string]ToolRule{},
	}
	got := engine.Evaluate(makeCall("unknown_tool"), profile)
	if got != Allow {
		t.Errorf("expected Allow, got %s", got)
	}
}

func TestPolicyEngine_DefaultAction_AwaitUser(t *testing.T) {
	engine := NewPolicyEngine()
	profile := PolicyProfile{
		Name:          "supervised",
		DefaultAction: AwaitUser,
		ToolRules:     map[string]ToolRule{},
	}
	got := engine.Evaluate(makeCall("unknown_tool"), profile)
	if got != AwaitUser {
		t.Errorf("expected AwaitUser, got %s", got)
	}
}

func TestPolicyEngine_DefaultAction_Deny(t *testing.T) {
	engine := NewPolicyEngine()
	profile := PolicyProfile{
		Name:          "strict",
		DefaultAction: Deny,
		ToolRules:     map[string]ToolRule{},
	}
	got := engine.Evaluate(makeCall("unknown_tool"), profile)
	if got != Deny {
		t.Errorf("expected Deny, got %s", got)
	}
}

func TestPolicyEngine_EmptyRules(t *testing.T) {
	engine := NewPolicyEngine()
	profile := PolicyProfile{
		Name:          "empty",
		DefaultAction: AwaitUser,
	}
	got := engine.Evaluate(makeCall("any_tool"), profile)
	if got != AwaitUser {
		t.Errorf("expected AwaitUser, got %s", got)
	}
}

func TestPolicyEngine_InterfaceSatisfaction(t *testing.T) {
	var _ PolicyEngine = NewPolicyEngine()
}

func TestPolicyEngine_EvaluateWithReason(t *testing.T) {
	engine := NewPolicyEngine()

	t.Run("rule reason", func(t *testing.T) {
		profile := PolicyProfile{
			Name:          "test",
			DefaultAction: Allow,
			ToolRules: map[string]ToolRule{
				"bash": {Action: Deny, Reason: "shell access prohibited"},
			},
		}
		decision, reason := engine.EvaluateWithReason(makeCall("bash"), profile)
		if decision != Deny {
			t.Errorf("expected Deny, got %s", decision)
		}
		if reason != "shell access prohibited" {
			t.Errorf("expected rule reason, got %q", reason)
		}
	})

	t.Run("default reason", func(t *testing.T) {
		profile := PolicyProfile{
			Name:          "test",
			DefaultAction: Allow,
			ToolRules:     map[string]ToolRule{},
		}
		decision, reason := engine.EvaluateWithReason(makeCall("unknown_tool"), profile)
		if decision != Allow {
			t.Errorf("expected Allow, got %s", decision)
		}
		want := "Default policy: allow"
		if reason != want {
			t.Errorf("expected %q, got %q", want, reason)
		}
	})
}

func TestPolicyDecision_String(t *testing.T) {
	cases := []struct {
		decision PolicyDecision
		want     string
	}{
		{Allow, "allow"},
		{AwaitUser, "ask"},
		{Deny, "deny"},
	}
	for _, c := range cases {
		got := c.decision.String()
		if got != c.want {
			t.Errorf("PolicyDecision(%d).String() = %q, want %q", c.decision, got, c.want)
		}
	}
}
