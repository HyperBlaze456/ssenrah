package shared

import (
	"strings"
	"testing"
)

func TestNewMessage(t *testing.T) {
	msg := NewMessage(RoleUser, "hello")
	if msg.ID == "" {
		t.Error("expected non-empty ID")
	}
	if msg.Role != RoleUser {
		t.Errorf("expected role %q, got %q", RoleUser, msg.Role)
	}
	if msg.Content != "hello" {
		t.Errorf("expected content %q, got %q", "hello", msg.Content)
	}
	if msg.Timestamp.IsZero() {
		t.Error("expected non-zero Timestamp")
	}
	if msg.ToolCallID != "" {
		t.Errorf("expected empty ToolCallID, got %q", msg.ToolCallID)
	}
}

func TestNewToolResultMessage(t *testing.T) {
	const callID = "call-abc-123"
	const content = "result data"

	msg := NewToolResultMessage(callID, content, false)

	if msg.ID == "" {
		t.Error("expected non-empty ID")
	}
	if msg.Role != RoleTool {
		t.Errorf("expected role %q, got %q", RoleTool, msg.Role)
	}
	if msg.Content != content {
		t.Errorf("expected content %q, got %q", content, msg.Content)
	}
	if msg.ToolCallID != callID {
		t.Errorf("expected ToolCallID %q, got %q", callID, msg.ToolCallID)
	}
	if msg.Timestamp.IsZero() {
		t.Error("expected non-zero Timestamp")
	}
}

func TestNewToolResultMessageError(t *testing.T) {
	const callID = "call-xyz"
	const content = "something went wrong"

	msg := NewToolResultMessage(callID, content, true)

	if msg.Role != RoleTool {
		t.Errorf("expected role %q, got %q", RoleTool, msg.Role)
	}
	if !strings.HasPrefix(msg.Content, "ERROR: ") {
		t.Errorf("expected content to start with 'ERROR: ', got %q", msg.Content)
	}
	if !strings.Contains(msg.Content, content) {
		t.Errorf("expected content to contain %q, got %q", content, msg.Content)
	}
	if msg.ToolCallID != callID {
		t.Errorf("expected ToolCallID %q, got %q", callID, msg.ToolCallID)
	}
}
