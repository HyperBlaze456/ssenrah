package shared

// StreamChunk represents a single chunk of a streaming response.
type StreamChunk struct {
	Delta      string
	Done       bool
	MessageID  string
	ToolCalls  []ToolCall // populated on final chunk when LLM requests tool use
	StopReason string     // "end_turn", "tool_use", etc.
}
