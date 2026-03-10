// Package conversation provides the Conversation aggregate for managing ordered message history.
package conversation

import (
	"time"

	"github.com/HyperBlaze456/ssenrah/harness/domain/shared"
	"github.com/google/uuid"
)

// MaxMessages is the upper bound on conversation history to prevent unbounded growth.
const MaxMessages = 200

// Conversation is the aggregate root that maintains an ordered sequence of messages.
type Conversation struct {
	ID        string
	messages  []shared.Message
	CreatedAt time.Time
}

// New creates a new Conversation with a generated UUID and the current timestamp.
func New() *Conversation {
	return &Conversation{
		ID:        uuid.New().String(),
		messages:  make([]shared.Message, 0),
		CreatedAt: time.Now(),
	}
}

// Append adds a message to the conversation, evicting the oldest messages
// if the history exceeds MaxMessages.
func (c *Conversation) Append(msg shared.Message) {
	c.messages = append(c.messages, msg)
	if len(c.messages) > MaxMessages {
		c.messages = c.messages[len(c.messages)-MaxMessages:]
	}
}

// History returns a copy of the conversation messages to preserve immutability.
func (c *Conversation) History() []shared.Message {
	cp := make([]shared.Message, len(c.messages))
	copy(cp, c.messages)
	return cp
}

// LastAssistantMessage returns a pointer to the last assistant message, or nil if none exist.
func (c *Conversation) LastAssistantMessage() *shared.Message {
	for i := len(c.messages) - 1; i >= 0; i-- {
		if c.messages[i].Role == shared.RoleAssistant {
			msg := c.messages[i]
			return &msg
		}
	}
	return nil
}

// Len returns the number of messages in the conversation.
func (c *Conversation) Len() int {
	return len(c.messages)
}
