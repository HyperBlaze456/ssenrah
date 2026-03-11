// Package shared provides core value objects and entities used across the harness domain.
package shared

import (
	"time"

	"github.com/google/uuid"
)

// Role represents the role of a message sender in a conversation.
type Role string

const (
	// RoleUser identifies messages sent by the user.
	RoleUser Role = "user"
	// RoleAssistant identifies messages sent by the assistant.
	RoleAssistant Role = "assistant"
	// RoleSystem identifies system-level messages.
	RoleSystem Role = "system"
	// RoleTool identifies messages produced by tool invocations.
	RoleTool Role = "tool"
)

// Message represents a single message in a conversation.
type Message struct {
	ID         string
	Role       Role
	Content    string
	Timestamp  time.Time
	ToolCalls  []ToolCall
	ToolCallID string // for RoleTool messages: correlates with ToolCall.ID
}

// ToolCall represents a request to invoke a tool.
type ToolCall struct {
	ID       string
	ToolName string
	Input    map[string]any
}

// NewMessage creates a new Message with a generated UUID and the current timestamp.
func NewMessage(role Role, content string) Message {
	return Message{
		ID:        uuid.New().String(),
		Role:      role,
		Content:   content,
		Timestamp: time.Now(),
	}
}

// NewToolResultMessage creates a RoleTool message carrying the result of a tool invocation.
// toolCallID correlates with the ToolCall.ID that triggered the execution.
// If isError is true, the content is prefixed with "ERROR: ".
func NewToolResultMessage(toolCallID string, content string, isError bool) Message {
	c := content
	if isError {
		c = "ERROR: " + content
	}
	return Message{
		ID:         uuid.New().String(),
		Role:       RoleTool,
		Content:    c,
		Timestamp:  time.Now(),
		ToolCallID: toolCallID,
	}
}
