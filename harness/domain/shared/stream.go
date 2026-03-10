package shared

// StreamChunk represents a single chunk of a streaming response.
type StreamChunk struct {
	Delta     string
	Done      bool
	MessageID string
}
