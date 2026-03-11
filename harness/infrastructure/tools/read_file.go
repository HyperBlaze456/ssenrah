package tools

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/HyperBlaze456/ssenrah/harness/domain/tool"
)

var _ tool.Tool = (*ReadFile)(nil)

// ReadFile reads a file from disk and returns its contents.
type ReadFile struct{}

func NewReadFile() *ReadFile { return &ReadFile{} }

func (t *ReadFile) Name() string { return "read_file" }

func (t *ReadFile) Description() string {
	return "Read the contents of a file at the given path. Returns the file content as text."
}

func (t *ReadFile) Parameters() tool.ParameterSchema {
	return tool.ParameterSchema{
		Properties: map[string]tool.ParameterProperty{
			"path": {Type: "string", Description: "Absolute or relative path to the file to read"},
		},
		Required: []string{"path"},
	}
}

func (t *ReadFile) Execute(ctx context.Context, input map[string]any) (tool.ToolResult, error) {
	path, ok := input["path"].(string)
	if !ok || path == "" {
		return tool.ToolResult{IsError: true, Content: "missing required parameter: path"}, nil
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

	data, err := os.ReadFile(absPath)
	if err != nil {
		return tool.ToolResult{IsError: true, Content: fmt.Sprintf("failed to read file: %v", err)}, nil
	}

	return tool.ToolResult{Content: string(data)}, nil
}
