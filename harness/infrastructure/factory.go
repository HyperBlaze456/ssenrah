package infrastructure

import (
	"fmt"
	"os"

	"github.com/HyperBlaze456/ssenrah/harness/domain/provider"
	"github.com/HyperBlaze456/ssenrah/harness/infrastructure/codex"
	"github.com/HyperBlaze456/ssenrah/harness/infrastructure/config"
	"github.com/HyperBlaze456/ssenrah/harness/infrastructure/dummy"
	"github.com/HyperBlaze456/ssenrah/harness/infrastructure/openrouter"
)

// NewProvider creates an LLMProvider based on the given configuration.
// API keys are read from environment variables:
//   - OPENROUTER_API_KEY for the openrouter provider
//   - CODEX_API_KEY for the codex provider
func NewProvider(cfg config.AppConfig) (provider.LLMProvider, error) {
	switch cfg.Provider {
	case "dummy":
		return dummy.NewProvider(), nil
	case "openrouter":
		key := os.Getenv("OPENROUTER_API_KEY")
		if key == "" {
			return nil, fmt.Errorf("OPENROUTER_API_KEY environment variable is required for openrouter provider")
		}
		return openrouter.NewProvider(key), nil
	case "codex":
		key := os.Getenv("CODEX_API_KEY")
		if key == "" {
			return nil, fmt.Errorf("CODEX_API_KEY environment variable is required for codex provider")
		}
		return codex.NewProvider(key), nil
	default:
		return nil, fmt.Errorf("unknown provider: %s (available: dummy, openrouter, codex)", cfg.Provider)
	}
}
