package policy

// PolicyDecision represents the outcome of a policy evaluation.
type PolicyDecision int

const (
	Allow     PolicyDecision = iota
	AwaitUser
	Deny
)

// String returns a human-readable representation of the decision.
func (d PolicyDecision) String() string {
	switch d {
	case Allow:
		return "allow"
	case AwaitUser:
		return "ask"
	case Deny:
		return "deny"
	default:
		return "unknown"
	}
}

// ToolRule defines the policy action for a specific tool.
type ToolRule struct {
	Action PolicyDecision
	Reason string
}

// PolicyProfile defines a named set of policy rules.
type PolicyProfile struct {
	Name          string
	Description   string
	DefaultAction PolicyDecision             // what to do for tools not in ToolRules
	ToolRules     map[string]ToolRule         // key: tool name
}

// RiskLevel categorizes the risk of a tool invocation.
type RiskLevel int

const (
	RiskLow    RiskLevel = iota
	RiskMedium
	RiskHigh
)
