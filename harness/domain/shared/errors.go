package shared

import "errors"

// Sentinel errors for common harness failure conditions.
var (
	// ErrProviderUnavailable indicates the selected provider cannot be reached.
	ErrProviderUnavailable = errors.New("provider unavailable")
	// ErrStreamCancelled indicates the streaming response was cancelled.
	ErrStreamCancelled = errors.New("stream cancelled")
	// ErrEmptyMessage indicates an attempt to send an empty message.
	ErrEmptyMessage = errors.New("empty message")
	// ErrContextTooLong indicates the conversation context exceeds the model limit.
	ErrContextTooLong = errors.New("context too long")
)
