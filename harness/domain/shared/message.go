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
	ID        string
	Role      Role
	Content   string
	Timestamp time.Time
	ToolCalls []ToolCall
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
