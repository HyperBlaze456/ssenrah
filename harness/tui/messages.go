package tui

import (
	"github.com/HyperBlaze456/ssenrah/harness/domain/shared"
	"github.com/HyperBlaze456/ssenrah/harness/domain/tool"
)

// StreamChunkMsg carries a streaming delta to the TUI.
type StreamChunkMsg struct{ Chunk shared.StreamChunk }

// StreamDoneMsg signals streaming completed successfully.
type StreamDoneMsg struct{ FinalMessage shared.Message }

// StreamErrorMsg signals streaming failed or was cancelled.
type StreamErrorMsg struct{ Err error }

// ApprovalRequestMsg shows the tool approval dialog skeleton.
type ApprovalRequestMsg struct{ Request tool.ApprovalRequest }
