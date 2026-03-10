package application

import (
	"github.com/HyperBlaze456/ssenrah/harness/domain/session"
)

// SessionService manages session lifecycle and status tracking.
type SessionService struct {
	session  *session.SessionInfo
	status   session.StatusData
	bindings *session.KeyBindingRegistry
}

// NewSessionService creates a SessionService.
func NewSessionService(sess *session.SessionInfo) *SessionService {
	return &SessionService{
		session:  sess,
		status:   session.StatusData{Phase: session.PhaseIdle},
		bindings: session.NewKeyBindingRegistry(),
	}
}

// Start initializes the session with model and provider names.
func (s *SessionService) Start(model, providerName string) {
	s.session.ModelName = model
	s.session.ProviderName = providerName
}

// UpdateStatus updates token count and cost.
func (s *SessionService) UpdateStatus(tokens int, cost float64) {
	s.status.TokensUsed = tokens
	s.status.EstimatedCost = cost
}

// SetPhase updates the current phase.
func (s *SessionService) SetPhase(phase string) {
	s.status.Phase = phase
}

// Info returns session info.
func (s *SessionService) Info() session.SessionInfo {
	return *s.session
}

// Status returns current status data.
func (s *SessionService) Status() session.StatusData {
	return s.status
}

// KeyBindings returns all registered key bindings.
func (s *SessionService) KeyBindings() []session.KeyBinding {
	return s.bindings.All()
}

// RegisterKeyBinding adds a key binding.
func (s *SessionService) RegisterKeyBinding(kb session.KeyBinding) {
	s.bindings.Register(kb)
}
