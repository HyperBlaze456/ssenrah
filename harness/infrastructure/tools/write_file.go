package tools

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/HyperBlaze456/ssenrah/harness/domain/tool"
)

var _ tool.Tool = (*WriteFile)(nil)

// WriteFile writes content to a file, creating directories as needed.
type WriteFile struct{}

func NewWriteFile() *WriteFile { return &WriteFile{} }

func (t *WriteFile) Name() string { return "write_file" }

func (t *WriteFile) Description() string {
	return "Write content to a file at the given path. Creates parent directories if they don't exist."
}

func (t *WriteFile) Parameters() tool.ParameterSchema {
	return tool.ParameterSchema{
		Properties: map[string]tool.ParameterProperty{
			"path":    {Type: "string", Description: "Absolute or relative path to the file to write"},
			"content": {Type: "string", Description: "Content to write to the file"},
		},
		Required: []string{"path", "content"},
	}
}

func (t *WriteFile) Execute(ctx context.Context, input map[string]any) (tool.ToolResult, error) {
	path, ok := input["path"].(string)
	if !ok || path == "" {
		return tool.ToolResult{IsError: true, Content: "missing required parameter: path"}, nil
	}

	content, ok := input["content"].(string)
	if !ok {
		return tool.ToolResult{IsError: true, Content: "missing required parameter: content"}, nil
	}

	absPath, err := filepath.Abs(path)
	if err != nil {
		return tool.ToolResult{IsError: true, Content: fmt.Sprintf("invalid path: %v", err)}, nil
	}

	select {
	case <-ctx.Done():
		return tool.ToolResult{}, ctx.Err()
	default:
	}

	if err := os.MkdirAll(filepath.Dir(absPath), 0755); err != nil {
		return tool.ToolResult{IsError: true, Content: fmt.Sprintf("failed to create directories: %v", err)}, nil
	}

	if err := os.WriteFile(absPath, []byte(content), 0644); err != nil {
		return tool.ToolResult{IsError: true, Content: fmt.Sprintf("failed to write file: %v", err)}, nil
	}

	return tool.ToolResult{Content: fmt.Sprintf("Successfully wrote %d bytes to %s", len(content), absPath)}, nil
}
