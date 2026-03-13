package application

import (
	"context"
	"fmt"
	"strings"

	"github.com/HyperBlaze456/ssenrah/harness/domain/agent"
	"github.com/HyperBlaze456/ssenrah/harness/domain/conversation"
	"github.com/HyperBlaze456/ssenrah/harness/domain/event"
	"github.com/HyperBlaze456/ssenrah/harness/domain/policy"
	"github.com/HyperBlaze456/ssenrah/harness/domain/provider"
	"github.com/HyperBlaze456/ssenrah/harness/domain/shared"
	"github.com/HyperBlaze456/ssenrah/harness/domain/tool"
	"github.com/HyperBlaze456/ssenrah/harness/infrastructure/logging"
)

// ApprovalResponse carries the user's decision on a tool call.
type ApprovalResponse struct {
	Approved    bool
	AlwaysAllow bool
}

// AgentEvent represents events the agent loop emits to the TUI.
type AgentEvent interface {
	agentEvent() // marker method
}

// EventStreamChunk carries a streaming text delta.
type EventStreamChunk struct{ Chunk shared.StreamChunk }

func (EventStreamChunk) agentEvent() {}

// EventToolCall signals the LLM wants to call a tool.
type EventToolCall struct{ Call shared.ToolCall }

func (EventToolCall) agentEvent() {}

// EventToolResult carries the result of tool execution.
type EventToolResult struct {
	Call   shared.ToolCall
	Result tool.ToolResult
}

func (EventToolResult) agentEvent() {}

// EventApprovalNeeded requests user approval for a tool call.
type EventApprovalNeeded struct {
	Request    tool.ApprovalRequest
	ResponseCh chan<- ApprovalResponse // TUI sends response here
}

func (EventApprovalNeeded) agentEvent() {}

// EventTurnComplete signals one LLM turn finished.
type EventTurnComplete struct {
	Message shared.Message
	Usage   shared.Usage
	Turn    int
}

func (EventTurnComplete) agentEvent() {}

// EventDone signals the agent loop has finished all turns.
type EventDone struct {
	FinalMessage shared.Message
	TotalUsage   shared.Usage
	TotalTurns   int
}

func (EventDone) agentEvent() {}

// EventError signals the agent loop encountered an error.
type EventError struct{ Err error }

func (EventError) agentEvent() {}

// AgentService orchestrates multi-turn agent execution with tool use.
type AgentService struct {
	conversation *conversation.Conversation
	provider     provider.LLMProvider
	registry     *tool.Registry
	systemPrompt string
	model        string
	maxTurns     int

	// alwaysAllow tracks tool names the user has auto-approved for this session.
	alwaysAllow map[string]bool

	// totalUsage accumulates usage across all turns.
	totalUsage shared.Usage

	// eventCh is the channel for sending events to the TUI.
	eventCh chan<- AgentEvent

	// policyEngine evaluates tool calls against the active policy profile.
	policyEngine policy.PolicyEngine

	// policyProfile is the active policy tier for this session.
	policyProfile policy.PolicyProfile

	// eventLogger records policy decisions and other events for audit.
	eventLogger event.EventLogger

	// agentType is the active agent type template (nil = legacy mode).
	agentType *agent.AgentType
}

// NewAgentService creates a new AgentService.
func NewAgentService(
	conv *conversation.Conversation,
	prov provider.LLMProvider,
	reg *tool.Registry,
	systemPrompt string,
	engine policy.PolicyEngine,
	profile policy.PolicyProfile,
	logger event.EventLogger,
) *AgentService {
	return &AgentService{
		conversation:  conv,
		provider:      prov,
		registry:      reg,
		systemPrompt:  systemPrompt,
		maxTurns:      10,
		alwaysAllow:   make(map[string]bool),
		policyEngine:  engine,
		policyProfile: profile,
		eventLogger:   logger,
	}
}

// SetModel sets the model for requests.
func (a *AgentService) SetModel(model string) { a.model = model }

// SetMaxTurns sets the maximum number of turns per agent run.
func (a *AgentService) SetMaxTurns(max int) { a.maxTurns = max }

// SetProvider switches the provider.
func (a *AgentService) SetProvider(prov provider.LLMProvider) { a.provider = prov }

// SetPolicyProfile switches the active policy tier and clears session approvals.
func (a *AgentService) SetPolicyProfile(p policy.PolicyProfile) {
	a.policyProfile = p
	a.ResetApprovals()
}

// ActivePolicyProfile returns the current policy profile.
func (a *AgentService) ActivePolicyProfile() policy.PolicyProfile {
	return a.policyProfile
}

// ApplyAgentType switches the agent type, updating model, prompt, policy, and registry.
func (a *AgentService) ApplyAgentType(at agent.AgentType, profile policy.PolicyProfile, reg *tool.Registry) {
	a.agentType = &at
	a.model = at.Model
	a.systemPrompt = at.SystemPrompt
	a.maxTurns = at.MaxTurns
	a.registry = reg
	a.policyProfile = profile
	a.ResetApprovals()
}

// ActiveAgentType returns the current agent type, or nil if in legacy mode.
func (a *AgentService) ActiveAgentType() *agent.AgentType {
	return a.agentType
}

// ResetApprovals clears the session-scoped always-allow map.
// Called on every policy/agent switch to prevent stale approvals from defeating tier downgrades.
func (a *AgentService) ResetApprovals() {
	a.alwaysAllow = make(map[string]bool)
}

// ProviderName returns the current provider name.
func (a *AgentService) ProviderName() string { return a.provider.Name() }

// TotalUsage returns accumulated usage.
func (a *AgentService) TotalUsage() shared.Usage { return a.totalUsage }

// Models returns available models.
func (a *AgentService) Models(ctx context.Context) ([]provider.ModelInfo, error) {
	return a.provider.Models(ctx)
}

// History returns conversation history.
func (a *AgentService) History() []shared.Message {
	return a.conversation.History()
}

// Run starts the agent loop. It:
//  1. Appends the user message to conversation
//  2. Sends to LLM with tool definitions
//  3. If LLM responds with tool calls: request approval, execute, loop
//  4. If LLM responds with text only: done
//  5. Repeats up to maxTurns
//
// Events are sent on eventCh. The caller (TUI) reads from eventCh.
// This method BLOCKS until the loop completes -- wrap in a goroutine.
func (a *AgentService) Run(ctx context.Context, userMsg shared.Message, eventCh chan<- AgentEvent) {
	a.eventCh = eventCh
	defer close(eventCh)

	// Validate
	if strings.TrimSpace(userMsg.Content) == "" {
		a.sendEvent(EventError{Err: shared.ErrEmptyMessage})
		return
	}

	// Append user message
	a.conversation.Append(userMsg)

	// Run the multi-turn loop
	for turn := 0; turn < a.maxTurns; turn++ {
		// Check cancellation
		select {
		case <-ctx.Done():
			a.sendEvent(EventError{Err: shared.ErrStreamCancelled})
			return
		default:
		}

		// Build request with tool definitions
		req := a.buildRequest()

		// Stream the response
		assistantMsg, usage, err := a.streamTurn(ctx, req)
		if err != nil {
			a.sendEvent(EventError{Err: err})
			return
		}

		// Accumulate usage
		a.totalUsage.InputTokens += usage.InputTokens
		a.totalUsage.OutputTokens += usage.OutputTokens

		// Append assistant message to conversation
		a.conversation.Append(assistantMsg)

		// Emit turn complete
		a.sendEvent(EventTurnComplete{
			Message: assistantMsg,
			Usage:   usage,
			Turn:    turn + 1,
		})

		// Check for tool calls
		if len(assistantMsg.ToolCalls) == 0 {
			// No tool calls -- agent is done
			a.sendEvent(EventDone{
				FinalMessage: assistantMsg,
				TotalUsage:   a.totalUsage,
				TotalTurns:   turn + 1,
			})
			return
		}

		// Process tool calls
		err = a.processToolCalls(ctx, assistantMsg.ToolCalls)
		if err != nil {
			a.sendEvent(EventError{Err: err})
			return
		}
	}

	// Max turns reached
	var finalMsg shared.Message
	if last := a.conversation.LastAssistantMessage(); last != nil {
		finalMsg = *last
	}
	a.sendEvent(EventDone{
		FinalMessage: finalMsg,
		TotalUsage:   a.totalUsage,
		TotalTurns:   a.maxTurns,
	})
}

// buildRequest constructs a ChatRequest with tool definitions.
func (a *AgentService) buildRequest() provider.ChatRequest {
	req := provider.ChatRequest{
		Model:        a.model,
		SystemPrompt: a.systemPrompt,
		Messages:     a.conversation.History(),
	}

	// Add tool definitions from registry
	tools := a.registry.List()
	if len(tools) > 0 {
		req.Tools = make([]provider.ToolDefinition, len(tools))
		for i, t := range tools {
			req.Tools[i] = provider.ToolDefinition{
				Name:        t.Name(),
				Description: t.Description(),
				Parameters:  toolSchemaToMap(t.Parameters()),
			}
		}
	}

	return req
}

// toolSchemaToMap converts a ParameterSchema to the JSON Schema map format
// expected by LLM providers.
func toolSchemaToMap(schema tool.ParameterSchema) map[string]any {
	properties := make(map[string]any)
	for name, prop := range schema.Properties {
		properties[name] = map[string]any{
			"type":        prop.Type,
			"description": prop.Description,
		}
	}
	return map[string]any{
		"type":       "object",
		"properties": properties,
		"required":   schema.Required,
	}
}

// streamTurn streams one LLM turn and returns the final assistant message.
func (a *AgentService) streamTurn(ctx context.Context, req provider.ChatRequest) (shared.Message, shared.Usage, error) {
	var contentBuf strings.Builder
	var toolCalls []shared.ToolCall

	handler := func(chunk shared.StreamChunk) {
		if chunk.Delta != "" {
			contentBuf.WriteString(chunk.Delta)
			a.sendEvent(EventStreamChunk{Chunk: chunk})
		}
		if chunk.Done {
			toolCalls = chunk.ToolCalls
		}
	}

	err := a.provider.ChatStream(ctx, req, handler)
	if err != nil {
		return shared.Message{}, shared.Usage{}, err
	}

	// Build assistant message
	msg := shared.NewMessage(shared.RoleAssistant, contentBuf.String())
	msg.ToolCalls = toolCalls

	// Estimate usage (providers may include real usage in future versions)
	usage := shared.Usage{
		InputTokens:  estimateTokens(a.systemPrompt) + estimateConversationTokens(a.conversation.History()),
		OutputTokens: estimateTokens(contentBuf.String()),
	}

	return msg, usage, nil
}

// processToolCalls handles each tool call: policy evaluation, approval, execution, result.
func (a *AgentService) processToolCalls(ctx context.Context, calls []shared.ToolCall) error {
	for _, tc := range calls {
		select {
		case <-ctx.Done():
			return shared.ErrStreamCancelled
		default:
		}

		// Evaluate policy
		decision, reason := a.evaluatePolicy(tc)
		a.logPolicyDecision(tc, decision, reason)

		switch decision {
		case policy.Allow:
			// Auto-approved by policy — emit tool call, execute immediately
			a.sendEvent(EventToolCall{Call: tc})
			a.executeTool(ctx, tc)

		case policy.Deny:
			// Denied by policy — skip EventToolCall, send denial directly
			deniedMsg := shared.NewToolResultMessage(tc.ID, "Tool execution denied by policy: "+reason, true)
			a.conversation.Append(deniedMsg)
			a.sendEvent(EventToolResult{
				Call:   tc,
				Result: tool.ToolResult{CallID: tc.ID, Content: "Tool execution denied by policy: " + reason, IsError: true},
			})

		case policy.AwaitUser:
			// Policy says ask — emit tool call, then check alwaysAllow or request approval
			a.sendEvent(EventToolCall{Call: tc})

			approved := a.alwaysAllow[tc.ToolName]
			if !approved {
				responseCh := make(chan ApprovalResponse, 1)
				a.sendEvent(EventApprovalNeeded{
					Request: tool.ApprovalRequest{
						ToolCall:  tc,
						RiskLevel: reason,
						Reason:    fmt.Sprintf("Agent wants to use %s", tc.ToolName),
					},
					ResponseCh: responseCh,
				})

				select {
				case <-ctx.Done():
					return shared.ErrStreamCancelled
				case resp := <-responseCh:
					if resp.AlwaysAllow {
						a.alwaysAllow[tc.ToolName] = true
						approved = true
					} else {
						approved = resp.Approved
					}
				}
			}

			if !approved {
				deniedMsg := shared.NewToolResultMessage(tc.ID, "Tool execution denied by user.", true)
				a.conversation.Append(deniedMsg)
				continue
			}

			a.executeTool(ctx, tc)
		}
	}

	return nil
}

// executeTool runs a tool and handles the result (shared by Allow and AwaitUser paths).
func (a *AgentService) executeTool(ctx context.Context, tc shared.ToolCall) {
	t, exists := a.registry.Get(tc.ToolName)
	if !exists {
		errMsg := shared.NewToolResultMessage(tc.ID, fmt.Sprintf("Unknown tool: %s", tc.ToolName), true)
		a.conversation.Append(errMsg)
		return
	}

	result, err := t.Execute(ctx, tc.Input)
	if err != nil {
		errResult := tool.ToolResult{CallID: tc.ID, Content: err.Error(), IsError: true}
		errMsg := shared.NewToolResultMessage(tc.ID, fmt.Sprintf("Tool execution failed: %v", err), true)
		a.conversation.Append(errMsg)
		a.sendEvent(EventToolResult{Call: tc, Result: errResult})
		return
	}

	result.CallID = tc.ID
	resultMsg := shared.NewToolResultMessage(tc.ID, result.Content, result.IsError)
	a.conversation.Append(resultMsg)
	a.sendEvent(EventToolResult{Call: tc, Result: result})
}

// evaluatePolicy checks the policy engine, falling back to AwaitUser if no engine is configured.
func (a *AgentService) evaluatePolicy(tc shared.ToolCall) (policy.PolicyDecision, string) {
	if a.policyEngine == nil {
		return policy.AwaitUser, "No policy engine configured"
	}
	if engine, ok := a.policyEngine.(*policy.DefaultPolicyEngine); ok {
		return engine.EvaluateWithReason(tc, a.policyProfile)
	}
	return a.policyEngine.Evaluate(tc, a.policyProfile), "Policy evaluation"
}

// logPolicyDecision logs a policy evaluation through the event logger.
func (a *AgentService) logPolicyDecision(tc shared.ToolCall, decision policy.PolicyDecision, reason string) {
	if a.eventLogger != nil {
		a.eventLogger.Log(logging.NewPolicyEvent(
			tc.ToolName, decision, a.policyProfile.Name, reason,
		))
	}
}

// sendEvent sends an event to the TUI.
func (a *AgentService) sendEvent(event AgentEvent) {
	if a.eventCh != nil {
		a.eventCh <- event
	}
}
