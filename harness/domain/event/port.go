package event

// Package event defines the event logging port for the agent harness.
//
// UNSTABLE: This interface will evolve when event logging is implemented in v0.3.

// EventLogger records harness events for audit and debugging.
type EventLogger interface {
	Log(event Event) error
	Flush() error
}
