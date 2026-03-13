package application

import (
	"context"
	"sync/atomic"
	"testing"

	agentdomain "github.com/HyperBlaze456/ssenrah/harness/domain/agent"
	"github.com/HyperBlaze456/ssenrah/harness/domain/conversation"
	"github.com/HyperBlaze456/ssenrah/harness/domain/event"
	"github.com/HyperBlaze456/ssenrah/harness/domain/policy"
	"github.com/HyperBlaze456/ssenrah/harness/domain/provider"
	"github.com/HyperBlaze456/ssenrah/harness/domain/shared"
	"github.com/HyperBlaze456/ssenrah/harness/domain/tool"
	"github.com/HyperBlaze456/ssenrah/harness/infrastructure/logging"
)

// --- Integration Test Helpers ---

// makeToolCallProvider creates a provider that returns tool calls on the first turn
// and text on the second turn.
func makeToolCallProvider(toolCalls []shared.ToolCall) *mockProvider {
	var callCount atomic.Int32
	return &mockProvider{
		name: "test",
		streamFn: func(_ context.Context, _ provider.ChatRequest, handler provider.StreamHandler) error {
			n := callCount.Add(1)
			if n == 1 {
				handler(shared.StreamChunk{
					Done:       true,
					StopReason: "tool_use",
					ToolCalls:  toolCalls,
				})
			} else {
				handler(shared.StreamChunk{Delta: "Done."})
				handler(shared.StreamChunk{Done: true, StopReason: "end_turn"})
			}
			return nil
		},
	}
}

// makeRegistryWithTools creates a registry with mock tools that return "ok".
func makeRegistryWithTools(names ...string) *tool.Registry {
	reg := tool.NewRegistry()
	for _, name := range names {
		n := name // capture loop var
		reg.Register(&mockTool{
			name:   n,
			desc:   n + " tool",
			schema: tool.ParameterSchema{},
			execFn: func(_ context.Context, _ map[string]any) (tool.ToolResult, error) {
				return tool.ToolResult{Content: n + " result", IsError: false}, nil
			},
		})
	}
	return reg
}

// --- Integration Tests ---

func TestIntegration_SupervisedTier_AllToolsAsk(t *testing.T) {
	prov := makeToolCallProvider([]shared.ToolCall{
		{ID: "c1", ToolName: "read_file", Input: map[string]any{}},
		{ID: "c2", ToolName: "write_file", Input: map[string]any{}},
		{ID: "c3", ToolName: "bash", Input: map[string]any{}},
	})

	reg := makeRegistryWithTools("read_file", "write_file", "bash")
	engine := policy.NewPolicyEngine()
	profile := policy.PolicyProfile{
		Name:          "supervised",
		Description:   "All tool calls require explicit user approval",
		DefaultAction: policy.AwaitUser,
		ToolRules:     map[string]policy.ToolRule{},
	}
	logger := logging.NewMemoryEventLogger()

	conv := conversation.New()
	agentSvc := NewAgentService(conv, prov, reg, "Test prompt.", engine, profile, logger)

	approvalCount := 0
	userMsg := shared.NewMessage(shared.RoleUser, "Do things")
	events := collectEvents(context.Background(), agentSvc, userMsg, func(ev EventApprovalNeeded) ApprovalResponse {
		approvalCount++
		return ApprovalResponse{Approved: true}
	})

	// All 3 tools should trigger approval
	if approvalCount != 3 {
		t.Errorf("supervised tier: expected 3 approvals, got %d", approvalCount)
	}

	// All 3 should have been executed
	toolResults := countEventType[EventToolResult](events)
	if toolResults != 3 {
		t.Errorf("expected 3 tool results, got %d", toolResults)
	}

	// All 3 should have policy eval events
	policyEvents := logger.EventsByType(event.EventPolicyEval)
	if len(policyEvents) != 3 {
		t.Errorf("expected 3 policy eval events, got %d", len(policyEvents))
	}

	if !hasEventType[EventDone](events) {
		t.Fatal("expected EventDone")
	}
}

func TestIntegration_AutonomousTier_SafeToolsAutoApprove(t *testing.T) {
	prov := makeToolCallProvider([]shared.ToolCall{
		{ID: "c1", ToolName: "read_file", Input: map[string]any{}},
		{ID: "c2", ToolName: "bash", Input: map[string]any{}},
	})

	reg := makeRegistryWithTools("read_file", "bash")
	engine := policy.NewPolicyEngine()
	profile := policy.PolicyProfile{
		Name:          "autonomous",
		Description:   "Most tools auto-approve, only destructive ops require approval",
		DefaultAction: policy.Allow,
		ToolRules: map[string]policy.ToolRule{
			"bash": {Action: policy.AwaitUser, Reason: "Shell commands can have side effects"},
		},
	}
	logger := logging.NewMemoryEventLogger()

	conv := conversation.New()
	agentSvc := NewAgentService(conv, prov, reg, "Test prompt.", engine, profile, logger)

	approvalCount := 0
	userMsg := shared.NewMessage(shared.RoleUser, "Read and run")
	events := collectEvents(context.Background(), agentSvc, userMsg, func(ev EventApprovalNeeded) ApprovalResponse {
		approvalCount++
		return ApprovalResponse{Approved: true}
	})

	// read_file should auto-approve (Allow), bash should trigger approval (AwaitUser)
	if approvalCount != 1 {
		t.Errorf("autonomous tier: expected 1 approval (bash only), got %d", approvalCount)
	}

	// Both tools should execute
	toolResults := countEventType[EventToolResult](events)
	if toolResults != 2 {
		t.Errorf("expected 2 tool results, got %d", toolResults)
	}

	// Verify policy events
	policyEvents := logger.EventsByType(event.EventPolicyEval)
	if len(policyEvents) != 2 {
		t.Errorf("expected 2 policy events, got %d", len(policyEvents))
	}

	if !hasEventType[EventDone](events) {
		t.Fatal("expected EventDone")
	}
}

func TestIntegration_YoloTier_ZeroApprovals(t *testing.T) {
	prov := makeToolCallProvider([]shared.ToolCall{
		{ID: "c1", ToolName: "read_file", Input: map[string]any{}},
		{ID: "c2", ToolName: "write_file", Input: map[string]any{}},
		{ID: "c3", ToolName: "bash", Input: map[string]any{}},
	})

	reg := makeRegistryWithTools("read_file", "write_file", "bash")
	engine := policy.NewPolicyEngine()
	profile := policy.PolicyProfile{
		Name:          "yolo",
		Description:   "All tools auto-approve without user interaction",
		DefaultAction: policy.Allow,
		ToolRules:     map[string]policy.ToolRule{},
	}
	logger := logging.NewMemoryEventLogger()

	conv := conversation.New()
	agentSvc := NewAgentService(conv, prov, reg, "Test prompt.", engine, profile, logger)

	userMsg := shared.NewMessage(shared.RoleUser, "Do everything")
	events := collectEvents(context.Background(), agentSvc, userMsg, nil)

	// Zero approvals
	if hasEventType[EventApprovalNeeded](events) {
		t.Error("yolo tier: should have zero EventApprovalNeeded")
	}

	// All 3 should execute
	toolResults := countEventType[EventToolResult](events)
	if toolResults != 3 {
		t.Errorf("expected 3 tool results, got %d", toolResults)
	}

	// 3 policy events
	policyEvents := logger.EventsByType(event.EventPolicyEval)
	if len(policyEvents) != 3 {
		t.Errorf("expected 3 policy events, got %d", len(policyEvents))
	}

	if !hasEventType[EventDone](events) {
		t.Fatal("expected EventDone")
	}
}

func TestIntegration_RuntimeTierSwitch(t *testing.T) {
	var callCount atomic.Int32

	prov := &mockProvider{
		name: "test",
		streamFn: func(_ context.Context, _ provider.ChatRequest, handler provider.StreamHandler) error {
			n := callCount.Add(1)
			// Odd calls (1st call of each run) return a tool call; even calls return text.
			if n%2 == 1 {
				handler(shared.StreamChunk{
					Done:       true,
					StopReason: "tool_use",
					ToolCalls: []shared.ToolCall{
						{ID: "c1", ToolName: "read_file", Input: map[string]any{}},
					},
				})
			} else {
				handler(shared.StreamChunk{Delta: "Done."})
				handler(shared.StreamChunk{Done: true, StopReason: "end_turn"})
			}
			return nil
		},
	}

	reg := makeRegistryWithTools("read_file")
	engine := policy.NewPolicyEngine()
	supervised := policy.PolicyProfile{
		Name:          "supervised",
		DefaultAction: policy.AwaitUser,
		ToolRules:     map[string]policy.ToolRule{},
	}
	autonomous := policy.PolicyProfile{
		Name:          "autonomous",
		DefaultAction: policy.Allow,
		ToolRules:     map[string]policy.ToolRule{},
	}
	logger := logging.NewMemoryEventLogger()

	conv := conversation.New()
	agentSvc := NewAgentService(conv, prov, reg, "Test prompt.", engine, supervised, logger)

	// Run 1: supervised — should require approval
	approvalCount := 0
	userMsg := shared.NewMessage(shared.RoleUser, "Read")
	_ = collectEvents(context.Background(), agentSvc, userMsg, func(ev EventApprovalNeeded) ApprovalResponse {
		approvalCount++
		return ApprovalResponse{Approved: true}
	})

	if approvalCount != 1 {
		t.Errorf("supervised run: expected 1 approval, got %d", approvalCount)
	}

	// Switch to autonomous (idle — between runs)
	agentSvc.SetPolicyProfile(autonomous)

	// Run 2: autonomous — should auto-approve
	approvalCount = 0
	userMsg2 := shared.NewMessage(shared.RoleUser, "Read again")
	_ = collectEvents(context.Background(), agentSvc, userMsg2, func(ev EventApprovalNeeded) ApprovalResponse {
		approvalCount++
		return ApprovalResponse{Approved: true}
	})

	if approvalCount != 0 {
		t.Errorf("autonomous run: expected 0 approvals, got %d", approvalCount)
	}

	// Verify event log has entries from both tiers
	policyEvents := logger.EventsByType(event.EventPolicyEval)
	if len(policyEvents) != 2 {
		t.Errorf("expected 2 total policy events, got %d", len(policyEvents))
	}
	if policyEvents[0].Data["tier_name"] != "supervised" {
		t.Errorf("first event should be supervised tier, got %v", policyEvents[0].Data["tier_name"])
	}
	if policyEvents[1].Data["tier_name"] != "autonomous" {
		t.Errorf("second event should be autonomous tier, got %v", policyEvents[1].Data["tier_name"])
	}
}

func TestIntegration_AgentTypeSwitch(t *testing.T) {
	prov := &mockProvider{
		name: "test",
		streamFn: func(_ context.Context, _ provider.ChatRequest, handler provider.StreamHandler) error {
			handler(shared.StreamChunk{Delta: "Hello."})
			handler(shared.StreamChunk{Done: true, StopReason: "end_turn"})
			return nil
		},
	}

	reg := makeRegistryWithTools("read_file", "write_file", "bash")
	engine := policy.NewPolicyEngine()
	supervised := policy.PolicyProfile{
		Name:          "supervised",
		DefaultAction: policy.AwaitUser,
		ToolRules:     map[string]policy.ToolRule{},
	}
	balanced := policy.PolicyProfile{
		Name:          "balanced",
		DefaultAction: policy.AwaitUser,
		ToolRules: map[string]policy.ToolRule{
			"read_file": {Action: policy.Allow, Reason: "Read-only access is safe"},
		},
	}
	logger := logging.NewMemoryEventLogger()

	conv := conversation.New()
	agentSvc := NewAgentService(conv, prov, reg, "Default prompt.", engine, supervised, logger)
	agentSvc.SetModel("default-model")

	// Verify initial state
	if agentSvc.ActivePolicyProfile().Name != "supervised" {
		t.Errorf("expected supervised, got %s", agentSvc.ActivePolicyProfile().Name)
	}

	// Create a reader agent type
	readerType := agentdomain.AgentType{
		Name:         "reader",
		Description:  "Read-only agent",
		Model:        "reader-model",
		PolicyTier:   "balanced",
		Tools:        []string{"read_file"},
		SystemPrompt: "You are read-only.",
		MaxTurns:     5,
	}

	// Build filtered registry for reader (only read_file)
	filteredReg := tool.NewRegistry()
	if t2, ok := reg.Get("read_file"); ok {
		filteredReg.Register(t2)
	}

	// Switch agent type
	agentSvc.ApplyAgentType(readerType, balanced, filteredReg)

	// Verify everything changed
	if agentSvc.ActivePolicyProfile().Name != "balanced" {
		t.Errorf("expected balanced after switch, got %s", agentSvc.ActivePolicyProfile().Name)
	}
	activeType := agentSvc.ActiveAgentType()
	if activeType == nil {
		t.Fatal("expected active agent type")
	}
	if activeType.Name != "reader" {
		t.Errorf("expected reader, got %s", activeType.Name)
	}

	// Verify only read_file is in the filtered registry
	if filteredReg.Count() != 1 {
		t.Errorf("expected 1 tool in filtered registry, got %d", filteredReg.Count())
	}
	if _, ok := filteredReg.Get("read_file"); !ok {
		t.Error("expected read_file in filtered registry")
	}
	if _, ok := filteredReg.Get("bash"); ok {
		t.Error("bash should NOT be in filtered registry")
	}
}

func TestIntegration_EventLoggerCapture(t *testing.T) {
	prov := makeToolCallProvider([]shared.ToolCall{
		{ID: "c1", ToolName: "read_file", Input: map[string]any{}},
		{ID: "c2", ToolName: "write_file", Input: map[string]any{}},
	})

	reg := makeRegistryWithTools("read_file", "write_file")
	engine := policy.NewPolicyEngine()
	profile := policy.PolicyProfile{
		Name:          "balanced",
		DefaultAction: policy.AwaitUser,
		ToolRules: map[string]policy.ToolRule{
			"read_file": {Action: policy.Allow, Reason: "Read-only access is safe"},
		},
	}
	logger := logging.NewMemoryEventLogger()

	conv := conversation.New()
	agentSvc := NewAgentService(conv, prov, reg, "Test prompt.", engine, profile, logger)

	userMsg := shared.NewMessage(shared.RoleUser, "Read and write")
	_ = collectEvents(context.Background(), agentSvc, userMsg, func(ev EventApprovalNeeded) ApprovalResponse {
		return ApprovalResponse{Approved: true}
	})

	// Verify event logger captured all policy decisions
	policyEvents := logger.EventsByType(event.EventPolicyEval)
	if len(policyEvents) != 2 {
		t.Fatalf("expected 2 policy events, got %d", len(policyEvents))
	}

	// First event: read_file -> allow
	ev1 := policyEvents[0]
	if ev1.Data["tool_name"] != "read_file" {
		t.Errorf("event 1: expected read_file, got %v", ev1.Data["tool_name"])
	}
	if ev1.Data["decision"] != "allow" {
		t.Errorf("event 1: expected allow, got %v", ev1.Data["decision"])
	}
	if ev1.Data["tier_name"] != "balanced" {
		t.Errorf("event 1: expected balanced tier, got %v", ev1.Data["tier_name"])
	}
	if ev1.Data["reason"] != "Read-only access is safe" {
		t.Errorf("event 1: expected reason from rule, got %v", ev1.Data["reason"])
	}

	// Second event: write_file -> ask (default action)
	ev2 := policyEvents[1]
	if ev2.Data["tool_name"] != "write_file" {
		t.Errorf("event 2: expected write_file, got %v", ev2.Data["tool_name"])
	}
	if ev2.Data["decision"] != "ask" {
		t.Errorf("event 2: expected ask, got %v", ev2.Data["decision"])
	}
	if ev2.Data["tier_name"] != "balanced" {
		t.Errorf("event 2: expected balanced tier, got %v", ev2.Data["tier_name"])
	}

	// Verify all events have IDs and timestamps
	allEvents := logger.Events()
	for i, ev := range allEvents {
		if ev.ID == "" {
			t.Errorf("event %d: missing ID", i)
		}
		if ev.Timestamp.IsZero() {
			t.Errorf("event %d: missing timestamp", i)
		}
	}
}
