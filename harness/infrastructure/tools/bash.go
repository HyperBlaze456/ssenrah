package tools

import (
	"context"
	"fmt"
	"os/exec"
	"time"

	"github.com/HyperBlaze456/ssenrah/harness/domain/tool"
)

var _ tool.Tool = (*Bash)(nil)

const (
	bashDefaultTimeout = 30
	bashMaxTimeout     = 120
	bashMaxOutputBytes = 100 * 1024 // 100KB
)

// Bash executes shell commands and returns combined stdout+stderr.
type Bash struct {
	workDir string
}

func NewBash(workDir string) *Bash { return &Bash{workDir: workDir} }

func (t *Bash) Name() string { return "bash" }

func (t *Bash) Description() string {
	return "Execute a bash command and return the output (stdout and stderr combined)."
}

func (t *Bash) Parameters() tool.ParameterSchema {
	return tool.ParameterSchema{
		Properties: map[string]tool.ParameterProperty{
			"command": {Type: "string", Description: "The bash command to execute"},
			"timeout": {Type: "number", Description: "Timeout in seconds (default 30, max 120)"},
		},
		Required: []string{"command"},
	}
}

func (t *Bash) Execute(ctx context.Context, input map[string]any) (tool.ToolResult, error) {
	command, ok := input["command"].(string)
	if !ok || command == "" {
		return tool.ToolResult{IsError: true, Content: "missing required parameter: command"}, nil
	}

	timeoutSec := bashDefaultTimeout
	if raw, exists := input["timeout"]; exists {
		switch v := raw.(type) {
		case float64:
			timeoutSec = int(v)
		case int:
			timeoutSec = v
		}
	}
	if timeoutSec <= 0 {
		timeoutSec = bashDefaultTimeout
	}
	if timeoutSec > bashMaxTimeout {
		timeoutSec = bashMaxTimeout
	}

	select {
	case <-ctx.Done():
		return tool.ToolResult{}, ctx.Err()
	default:
	}

	cmdCtx, cancel := context.WithTimeout(ctx, time.Duration(timeoutSec)*time.Second)
	defer cancel()

	cmd := exec.CommandContext(cmdCtx, "bash", "-c", command)
	if t.workDir != "" {
		cmd.Dir = t.workDir
	}

	output, err := cmd.CombinedOutput()

	// Truncate output to prevent memory issues
	truncated := output
	if len(truncated) > bashMaxOutputBytes {
		truncated = truncated[:bashMaxOutputBytes]
	}
	outputStr := string(truncated)

	if cmdCtx.Err() == context.DeadlineExceeded {
		return tool.ToolResult{IsError: true, Content: fmt.Sprintf("command timed out after %ds", timeoutSec)}, nil
	}

	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return tool.ToolResult{IsError: true, Content: fmt.Sprintf("exit code %d: %s", exitErr.ExitCode(), outputStr)}, nil
		}
		return tool.ToolResult{IsError: true, Content: fmt.Sprintf("failed to execute command: %v", err)}, nil
	}

	return tool.ToolResult{Content: outputStr}, nil
}
