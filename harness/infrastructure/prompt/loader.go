package prompt

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const defaultPrompt = `You are ssenrah, a helpful AI assistant running inside a terminal-based agent harness.
Respond in markdown format. Use code blocks with language tags for code.`

// LoadPrompt reads a system prompt from a file, confined to the given base directory.
// Returns an error if the resolved path escapes baseDir (path traversal prevention).
func LoadPrompt(baseDir, filename string) (string, error) {
	absBase, err := filepath.Abs(baseDir)
	if err != nil {
		return "", fmt.Errorf("resolving base dir: %w", err)
	}
	absPath, err := filepath.Abs(filepath.Join(baseDir, filepath.Clean(filename)))
	if err != nil {
		return "", fmt.Errorf("resolving prompt path: %w", err)
	}
	if !strings.HasPrefix(absPath, absBase+string(filepath.Separator)) && absPath != absBase {
		return "", fmt.Errorf("prompt path escapes allowed directory: %s", filename)
	}
	data, err := os.ReadFile(absPath)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// LoadDefaultPrompt returns the built-in default system prompt.
func LoadDefaultPrompt() string {
	return defaultPrompt
}
