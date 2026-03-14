package task

// TaskCategory classifies the kind of work a task represents.
type TaskCategory string

const (
	// CategoryExplore is for codebase exploration tasks.
	CategoryExplore TaskCategory = "explore"
	// CategoryImplement is for new feature implementation tasks.
	CategoryImplement TaskCategory = "implement"
	// CategoryRefactor is for code improvement tasks.
	CategoryRefactor TaskCategory = "refactor"
	// CategoryTest is for test writing and execution tasks.
	CategoryTest TaskCategory = "test"
	// CategoryVerify is for result verification tasks.
	CategoryVerify TaskCategory = "verify"
	// CategoryDebug is for bug analysis tasks.
	CategoryDebug TaskCategory = "debug"
	// CategoryDocument is for documentation tasks.
	CategoryDocument TaskCategory = "document"
	// CategoryGeneric is the fallback for unclassified tasks.
	CategoryGeneric TaskCategory = "generic"
)

// ValidCategories lists all recognised TaskCategory values.
var ValidCategories = []TaskCategory{
	CategoryExplore,
	CategoryImplement,
	CategoryRefactor,
	CategoryTest,
	CategoryVerify,
	CategoryDebug,
	CategoryDocument,
	CategoryGeneric,
}

// IsValidCategory reports whether s is a recognised TaskCategory value.
func IsValidCategory(s string) bool {
	for _, c := range ValidCategories {
		if string(c) == s {
			return true
		}
	}
	return false
}
