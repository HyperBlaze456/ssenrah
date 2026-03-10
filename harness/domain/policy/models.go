package policy

// PolicyDecision represents the outcome of a policy evaluation.
type PolicyDecision int

const (
	Allow     PolicyDecision = iota
	AwaitUser
	Deny
)

// PolicyProfile defines a named set of policy rules.
type PolicyProfile struct {
	Name      string
	AllowList []string
	DenyList  []string
}

// RiskLevel categorizes the risk of a tool invocation.
type RiskLevel int

const (
	RiskLow    RiskLevel = iota
	RiskMedium
	RiskHigh
)
