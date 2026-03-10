// Package session provides session management entities and value objects.
package session

import (
	"time"

	"github.com/google/uuid"
)

// SessionInfo holds metadata about an active harness session.
type SessionInfo struct {
	ID           string
	StartTime    time.Time
	ModelName    string
	ProviderName string
}

// New creates a new SessionInfo with a generated UUID and the current timestamp.
func New(modelName, providerName string) *SessionInfo {
	return &SessionInfo{
		ID:           uuid.New().String(),
		StartTime:    time.Now(),
		ModelName:    modelName,
		ProviderName: providerName,
	}
}
