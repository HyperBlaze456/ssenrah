package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
)

// AppConfig holds the harness configuration.
type AppConfig struct {
	Model       string  `json:"model" yaml:"model"`
	Provider    string  `json:"provider" yaml:"provider"`
	Theme       string  `json:"theme" yaml:"theme"`
	SidebarOpen bool    `json:"sidebar_open" yaml:"sidebar_open"`
	MaxTokens   int     `json:"max_tokens,omitempty" yaml:"max_tokens,omitempty"`
	Temperature float64 `json:"temperature,omitempty" yaml:"temperature,omitempty"`
}

// LoadConfig reads configuration from a JSON file, falling back to defaults
// only when the file does not exist.
func LoadConfig(path string) (AppConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return DefaultConfig(), nil
		}
		return AppConfig{}, fmt.Errorf("reading config: %w", err)
	}
	var cfg AppConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return DefaultConfig(), err
	}
	return cfg, nil
}
