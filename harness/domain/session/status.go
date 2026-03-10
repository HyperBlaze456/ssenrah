package session

// Phase constants represent the current state of the session.
const (
	// PhaseIdle indicates no active operation.
	PhaseIdle = "idle"
	// PhaseStreaming indicates a response is being streamed.
	PhaseStreaming = "streaming"
	// PhaseAwaitingApproval indicates user approval is required.
	PhaseAwaitingApproval = "awaiting approval"
	// PhaseError indicates an error has occurred.
	PhaseError = "error"
)

// StatusData holds runtime status information for the session.
type StatusData struct {
	TokensUsed    int
	EstimatedCost float64
	ActiveTool    string
	Phase         string
}
