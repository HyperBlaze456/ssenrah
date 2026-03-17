package tui

import (
	"github.com/HyperBlaze456/ssenrah/harness/application"
	"github.com/HyperBlaze456/ssenrah/harness/domain/provider"
	"github.com/HyperBlaze456/ssenrah/harness/domain/shared"
	"github.com/HyperBlaze456/ssenrah/harness/domain/task"
	"github.com/HyperBlaze456/ssenrah/harness/domain/tool"
)

// StreamChunkMsg carries a streaming delta to the TUI.
type StreamChunkMsg struct{ Chunk shared.StreamChunk }

// StreamDoneMsg signals streaming completed successfully.
type StreamDoneMsg struct {
	FinalMessage shared.Message
	Usage        shared.Usage
}

// StreamErrorMsg signals streaming failed or was cancelled.
type StreamErrorMsg struct{ Err error }

// ModelsResultMsg carries the list of available models from the provider.
type ModelsResultMsg struct {
	Models []provider.ModelInfo
	Err    error
}

// ModelSelectedMsg signals the user selected a model from the list.
type ModelSelectedMsg struct{ Model provider.ModelInfo }

// ApprovalRequestMsg shows the tool approval dialog skeleton.
type ApprovalRequestMsg struct{ Request tool.ApprovalRequest }

// agentEventMsg wraps an AgentEvent from the event channel into a tea.Msg.
type agentEventMsg struct{ Event application.AgentEvent }

// agentChannelClosedMsg signals the agent event channel was closed.
type agentChannelClosedMsg struct{}

// teamProgressMsg carries updated team stats for the sidebar.
type teamProgressMsg struct {
	Stats task.GraphStats
	Tasks []TeamTaskEntry
}

// teamDoneMsg signals team execution completed.
type teamDoneMsg struct {
	Stats task.GraphStats
	Err   error
}

// teamDecomposeResultMsg carries the result of LLM task decomposition.
type teamDecomposeResultMsg struct {
	TaskCount int
	Err       error
}
