package tools

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// --- ReadFile tests ---

func TestReadFile_Success(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "hello.txt")
	if err := os.WriteFile(path, []byte("hello world"), 0644); err != nil {
		t.Fatal(err)
	}

	rf := NewReadFile()
	result, err := rf.Execute(context.Background(), map[string]any{"path": path})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.IsError {
		t.Fatalf("unexpected error result: %s", result.Content)
	}
	if result.Content != "hello world" {
		t.Fatalf("expected %q, got %q", "hello world", result.Content)
	}
}

func TestReadFile_NotFound(t *testing.T) {
	rf := NewReadFile()
	result, err := rf.Execute(context.Background(), map[string]any{"path": "/nonexistent/path/file.txt"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.IsError {
		t.Fatal("expected IsError=true for missing file")
	}
}

func TestReadFile_MissingPath(t *testing.T) {
	rf := NewReadFile()
	result, err := rf.Execute(context.Background(), map[string]any{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.IsError {
		t.Fatal("expected IsError=true for missing path param")
	}
	if !strings.Contains(result.Content, "missing required parameter: path") {
		t.Fatalf("unexpected message: %s", result.Content)
	}
}

// --- WriteFile tests ---

func TestWriteFile_Success(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "out.txt")

	wf := NewWriteFile()
	result, err := wf.Execute(context.Background(), map[string]any{
		"path":    path,
		"content": "test content",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.IsError {
		t.Fatalf("unexpected error result: %s", result.Content)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("file not created: %v", err)
	}
	if string(data) != "test content" {
		t.Fatalf("expected %q, got %q", "test content", string(data))
	}
}

func TestWriteFile_CreatesDirectories(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "a", "b", "c", "file.txt")

	wf := NewWriteFile()
	result, err := wf.Execute(context.Background(), map[string]any{
		"path":    path,
		"content": "nested",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.IsError {
		t.Fatalf("unexpected error result: %s", result.Content)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("file not created: %v", err)
	}
	if string(data) != "nested" {
		t.Fatalf("expected %q, got %q", "nested", string(data))
	}
}

func TestWriteFile_MissingParams(t *testing.T) {
	wf := NewWriteFile()

	// missing path
	result, err := wf.Execute(context.Background(), map[string]any{"content": "data"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.IsError {
		t.Fatal("expected IsError=true for missing path")
	}

	// missing content (content key absent — not a string)
	result, err = wf.Execute(context.Background(), map[string]any{"path": "/tmp/x.txt"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.IsError {
		t.Fatal("expected IsError=true for missing content")
	}
}

// --- Bash tests ---

func TestBash_Success(t *testing.T) {
	b := NewBash("")
	result, err := b.Execute(context.Background(), map[string]any{"command": "echo hello"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.IsError {
		t.Fatalf("unexpected error result: %s", result.Content)
	}
	if !strings.Contains(result.Content, "hello") {
		t.Fatalf("expected output to contain 'hello', got %q", result.Content)
	}
}

func TestBash_NonZeroExit(t *testing.T) {
	b := NewBash("")
	result, err := b.Execute(context.Background(), map[string]any{"command": "exit 1"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.IsError {
		t.Fatal("expected IsError=true for non-zero exit")
	}
	if !strings.Contains(result.Content, "exit code 1") {
		t.Fatalf("expected 'exit code 1' in output, got %q", result.Content)
	}
}

func TestBash_Timeout(t *testing.T) {
	b := NewBash("")
	result, err := b.Execute(context.Background(), map[string]any{
		"command": "sleep 10",
		"timeout": float64(1),
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.IsError {
		t.Fatal("expected IsError=true for timeout")
	}
	if !strings.Contains(result.Content, "timed out") {
		t.Fatalf("expected timeout message, got %q", result.Content)
	}
}

func TestBash_MissingCommand(t *testing.T) {
	b := NewBash("")
	result, err := b.Execute(context.Background(), map[string]any{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.IsError {
		t.Fatal("expected IsError=true for missing command")
	}
	if !strings.Contains(result.Content, "missing required parameter: command") {
		t.Fatalf("unexpected message: %s", result.Content)
	}
}
