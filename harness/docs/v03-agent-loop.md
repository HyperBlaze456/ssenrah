# v0.3 — Agent Loop & Tools

v0.3 introduces a multi-turn agent loop with LLM tool use capabilities. The agent can request to invoke tools, the user approves or denies each request, and results feed back into the conversation for the next turn. This enables agents to read files, execute bash commands, and extend with custom tools.

## Architecture

### Agent Loop Flow

The `AgentService` orchestrates multi-turn conversation with the following loop:

```
┌─────────────────────────────────────────────────────────────┐
│ User sends message → Append to conversation                 │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ For each turn (up to maxTurns):                             │
│  1. Build ChatRequest with tool definitions                │
│  2. Stream response from LLM                                │
│  3. Emit EventTurnComplete                                  │
│  4. Check for tool calls in response                        │
│     - If none: Emit EventDone and exit                      │
│     - If found: Process each tool call                      │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ For each tool call:                                         │
│  1. Emit EventToolCall                                      │
│  2. Check if tool is in alwaysAllow list                    │
│     - If approved: Execute tool                             │
│     - If not: Request approval via EventApprovalNeeded      │
│  3. Execute tool or record denial                           │
│  4. Emit EventToolResult                                    │
│  5. Append result to conversation                           │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ Loop continues (next turn uses conversation with results)   │
│ Exit when: No tool calls, maxTurns reached, or error        │
└─────────────────────────────────────────────────────────────┘
```

### Event-Driven Communication

The agent loop sends events to the TUI via a channel. The TUI reads events and updates the UI or prompts the user for approval:

- **EventStreamChunk** — Text delta during streaming
- **EventToolCall** — LLM wants to invoke a tool
- **EventApprovalNeeded** — User decision required (includes response channel)
- **EventToolResult** — Tool execution result
- **EventTurnComplete** — One turn finished
- **EventDone** — Agent completed all turns
- **EventError** — An error occurred

The TUI responds to `EventApprovalNeeded` by sending an `ApprovalResponse` on the provided channel. The agent loop blocks until a response arrives.

### Max Turns Guard

`AgentService.maxTurns` (default 10) prevents infinite loops. After maxTurns are executed, the loop exits with `EventDone`, even if the agent wants to continue.

Set via `AgentService.SetMaxTurns(n)`.

### Context Cancellation

The agent loop respects `context.Context`. If the context is cancelled:
- The loop exits immediately
- An `EventError` is emitted with `shared.ErrStreamCancelled`
- In-flight tool execution may be interrupted (tools check `ctx.Done()`)

## Tool System

### Tool Interface

A tool implements `tool.Tool` from `harness/domain/tool/port.go`:

```go
type Tool interface {
	Name() string                                              // Unique tool name
	Description() string                                       // LLM sees this in tool definitions
	Parameters() ParameterSchema                               // Input schema
	Execute(ctx context.Context, input map[string]any) (ToolResult, error)  // Execute the tool
}
```

### Tool Registry

`tool.Registry` (`harness/domain/tool/registry.go`) is a thread-safe map of tools:

- **NewRegistry()** — Create an empty registry
- **Register(t Tool)** — Add a tool; returns error if name already exists
- **Get(name string)** — Retrieve tool by name
- **List()** — Return all tools sorted by name
- **Count()** — Return number of registered tools

The registry is passed to `AgentService` at construction. The service uses it to:
1. Extract tool definitions for the LLM (via `buildRequest()`)
2. Look up and execute tools when called by the LLM

### Parameter Schema

Tools declare input parameters via `ParameterSchema`:

```go
type ParameterSchema struct {
	Properties map[string]ParameterProperty  // {param_name → property info}
	Required   []string                       // Required parameter names
}

type ParameterProperty struct {
	Type        string  // "string", "number", "boolean", etc.
	Description string  // LLM sees this
}
```

The agent loop converts `ParameterSchema` to JSON Schema for the LLM:

```json
{
  "type": "object",
  "properties": {
    "command": {"type": "string", "description": "The bash command to execute"},
    "timeout": {"type": "number", "description": "Timeout in seconds (default 30, max 120)"}
  },
  "required": ["command"]
}
```

### Tool Result Model

Tools return `tool.ToolResult`:

```go
type ToolResult struct {
	CallID  string  // Set by agent loop before appending to conversation
	Content string  // The output or error message
	IsError bool    // True if the execution failed
}
```

## Approval Flow

### User Approval

Before executing a tool, the agent loop requests user approval via `EventApprovalNeeded`. The event carries:

```go
type EventApprovalNeeded struct {
	Request    tool.ApprovalRequest  // Details about what the LLM wants to do
	ResponseCh chan<- ApprovalResponse  // TUI sends approval here
}

type ApprovalRequest struct {
	ToolCall  shared.ToolCall  // The tool call the agent made
	RiskLevel string           // "high", "medium", or "low"
	Reason    string           // Human-readable reason (e.g., "Agent wants to use bash")
}

type ApprovalResponse struct {
	Approved    bool  // User approved this specific call
	AlwaysAllow bool  // User approved this tool for all future calls this session
}
```

### Risk Classification

Tools are classified by risk level in `classifyRisk()`:

- **high** — `bash` (arbitrary command execution)
- **medium** — `write_file` (filesystem modification)
- **low** — everything else

The TUI can display different prompts or styling based on risk level.

### Auto-Approval

Once a user selects "Always Allow" for a tool, the agent loop stores the tool name in `alwaysAllow` map. Future calls to that tool skip approval.

If the user denies a tool call, the agent receives a tool result message: `"Tool execution denied by user."` with `IsError=true`. The agent may retry, try a different approach, or give up depending on its logic.

## Built-in Tools

### read_file

Location: `harness/infrastructure/tools/read_file.go`

Read the contents of a file from disk.

**Parameters:**
- `path` (string, required) — Absolute or relative path to the file

**Returns:**
- Success: File contents as string
- Error: File not found, permission denied, or other I/O error

**Behavior:**
- Converts path to absolute via `filepath.Abs()`
- Returns `IsError=true` if the file cannot be read

### write_file

Location: `harness/infrastructure/tools/write_file.go`

Write content to a file, creating parent directories if needed.

**Parameters:**
- `path` (string, required) — Absolute or relative path to the file
- `content` (string, required) — Content to write

**Returns:**
- Success: `"Successfully wrote N bytes to /absolute/path"`
- Error: Directory creation failed, permission denied, or write failed

**Behavior:**
- Converts path to absolute via `filepath.Abs()`
- Creates parent directories with `os.MkdirAll(dir, 0755)`
- Writes file with mode `0644`
- Returns `IsError=true` if the operation fails

### bash

Location: `harness/infrastructure/tools/bash.go`

Execute a bash command and return combined stdout + stderr.

**Parameters:**
- `command` (string, required) — The bash command to execute
- `timeout` (number, optional) — Timeout in seconds (default 30, max 120, clamped)

**Returns:**
- Success: Combined stdout + stderr output (truncated to 100KB)
- Error: Command failed, timed out, or failed to execute

**Behavior:**
- Runs command via `exec.CommandContext()` with the specified timeout
- If timeout is missing or invalid, defaults to 30 seconds
- Max timeout is 120 seconds (user cannot exceed this)
- Truncates output to 100KB to prevent memory issues
- Captures exit code on failure: `"exit code N: <output>"`
- Returns `IsError=true` if the command fails or times out

## Domain Model Changes

### StreamChunk

`harness/domain/shared/stream.go` — streaming response chunk:

```go
type StreamChunk struct {
	Delta      string      // Text delta from this chunk
	Done       bool        // True on final chunk
	MessageID  string      // ID of the message being built
	ToolCalls  []ToolCall  // Populated on final chunk if LLM requests tool use
	StopReason string      // "end_turn", "tool_use", etc.
}
```

New fields: `ToolCalls`, `StopReason`. The provider populates these when the LLM signals it wants to invoke tools.

### Message

`harness/domain/shared/message.go` — conversation message:

```go
type Message struct {
	ID         string      // UUID
	Role       Role        // "user", "assistant", "system", "tool"
	Content    string      // Text content
	Timestamp  time.Time
	ToolCalls  []ToolCall  // If Role=assistant, LLM's tool requests
	ToolCallID string      // If Role=tool, correlates with ToolCall.ID
}

type ToolCall struct {
	ID       string         // UUID for this tool invocation
	ToolName string         // Name of the tool to invoke
	Input    map[string]any // Input parameters
}
```

New fields:
- **ToolCalls** — Assistant messages that request tool use include a list of tool calls
- **ToolCallID** — Tool result messages reference the tool call they're responding to

Helper: `NewToolResultMessage(toolCallID, content, isError)` creates a RoleTool message with error prefix if needed.

### ChatRequest

`harness/domain/provider/models.go` — LLM request:

```go
type ChatRequest struct {
	Model        string
	SystemPrompt string
	Messages     []shared.Message
	MaxTokens    int
	Options      ChatOptions
	Tools        []ToolDefinition  // NEW: Tool definitions for the LLM
}

type ToolDefinition struct {
	Name        string         // Tool name
	Description string         // What the tool does
	Parameters  map[string]any // JSON Schema of inputs
}
```

## Provider Updates

### OpenRouter

The OpenRouter provider now:
1. Converts `ChatRequest.Tools` to OpenRouter's tool definition format
2. Includes tool definitions in the API request
3. Streams tool calls from the response
4. Accumulates tool call data across chunks
5. Returns complete `ToolCall` objects in the final `StreamChunk`

### Codex

Same behavior as OpenRouter. Both providers follow the same integration pattern.

## Adding Custom Tools

### Step 1: Implement the Tool Interface

Create a new file, e.g., `harness/infrastructure/tools/my_tool.go`:

```go
package tools

import (
	"context"
	"github.com/HyperBlaze456/ssenrah/harness/domain/tool"
)

type MyTool struct {
	// Add any configuration fields here
}

func NewMyTool() *MyTool {
	return &MyTool{}
}

func (t *MyTool) Name() string {
	return "my_tool"
}

func (t *MyTool) Description() string {
	return "A brief description of what my_tool does."
}

func (t *MyTool) Parameters() tool.ParameterSchema {
	return tool.ParameterSchema{
		Properties: map[string]tool.ParameterProperty{
			"input_param": {
				Type:        "string",
				Description: "What this parameter does",
			},
		},
		Required: []string{"input_param"},
	}
}

func (t *MyTool) Execute(ctx context.Context, input map[string]any) (tool.ToolResult, error) {
	param, ok := input["input_param"].(string)
	if !ok || param == "" {
		return tool.ToolResult{
			IsError: true,
			Content: "missing required parameter: input_param",
		}, nil
	}

	// Your logic here
	result := "Success"

	return tool.ToolResult{
		Content: result,
		IsError: false,
	}, nil
}
```

### Step 2: Register in main.go

Modify `harness/main.go` to create and register your tool:

```go
import (
	// ... other imports ...
	"github.com/HyperBlaze456/ssenrah/harness/infrastructure/tools"
	"github.com/HyperBlaze456/ssenrah/harness/domain/tool"
)

func main() {
	// ... existing setup ...

	// Create tool registry and register tools
	registry := tool.NewRegistry()
	registry.Register(tools.NewMyTool())
	registry.Register(tools.NewReadFile())
	registry.Register(tools.NewWriteFile())
	registry.Register(tools.NewBash("."))

	// Create agent service
	agentSvc := application.NewAgentService(conv, prov, registry, systemPrompt)

	// ... rest of main ...
}
```

### Step 3: Automatic Integration

Once registered, the agent loop automatically:
1. Includes your tool in LLM requests
2. Handles approval and execution
3. Returns results to the conversation

No additional wiring needed.

## Event Types Reference

| Event Type | Fields | Meaning |
|---|---|---|
| `EventStreamChunk` | `Chunk: StreamChunk` | Text delta during streaming |
| `EventToolCall` | `Call: ToolCall` | LLM wants to invoke a tool |
| `EventApprovalNeeded` | `Request: ApprovalRequest`, `ResponseCh: chan ApprovalResponse` | Wait for user decision on tool call |
| `EventToolResult` | `Call: ToolCall`, `Result: ToolResult` | Tool execution completed |
| `EventTurnComplete` | `Message: Message`, `Usage: Usage`, `Turn: int` | One LLM turn finished |
| `EventDone` | `FinalMessage: Message`, `TotalUsage: Usage`, `TotalTurns: int` | Agent loop completed all turns |
| `EventError` | `Err: error` | An error occurred; loop will exit |

## Configuration

### Max Turns

Set the maximum number of turns (default 10):

```go
agentSvc := application.NewAgentService(conv, prov, registry, systemPrompt)
agentSvc.SetMaxTurns(20)  // Allow up to 20 turns
```

### Tool Registration

In `main.go`:

```go
registry := tool.NewRegistry()
registry.Register(tools.NewReadFile())
registry.Register(tools.NewWriteFile())
registry.Register(tools.NewBash(workDir))
// Add custom tools here
```

The registry is thread-safe; tools can be registered before or after the agent loop starts, but registration after the first request should be avoided.

### System Prompt

The system prompt should guide the agent to use tools effectively. Example enhancement:

```
You are a helpful assistant with access to the following tools:
- read_file: Read file contents
- write_file: Write to files
- bash: Execute shell commands

Use tools to explore the filesystem, understand code, and make changes.
Always ask for user confirmation before making major modifications.
```

Update the system prompt via `harness/prompts/default.md` or load a custom prompt in `main.go`.

## Testing

The test file `harness/application/agent_test.go` demonstrates how to:
- Mock the LLM provider
- Mock tools
- Create a registry with test tools
- Run the agent loop in a test
- Collect and inspect events
- Simulate user approval responses

Example test structure:

```go
func TestAgentWithToolCalls(t *testing.T) {
	reg := tool.NewRegistry()
	reg.Register(&mockTool{
		name: "test_tool",
		execFn: func(ctx context.Context, input map[string]any) (tool.ToolResult, error) {
			return tool.ToolResult{Content: "success"}, nil
		},
	})

	agent := application.NewAgentService(conv, mockProvider, reg, "system prompt")

	// Approval function: auto-approve
	events := collectEvents(context.Background(), agent, userMsg, nil)

	// Check events
	// ...
}
```

See `harness/application/agent_test.go` for full examples.
