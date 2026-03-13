# Plan: ssenrah TUI Agent Harness v0.1 — DDD Architecture & Implementation

## Metadata
- **Plan ID:** p1-tui-harness-v01
- **Created:** 2026-03-10
- **Revised:** 2026-03-10 (R2 — Architect + Critic feedback)
- **Scope:** v0.1 TUI Shell — new Go module under `harness/`
- **Approach:** Top-down (TUI shell first, agent features layered later)
- **Estimated Complexity:** HIGH (new Go module, DDD architecture, Bubbletea TUI, future-proof interfaces)

---

## RALPLAN-DR Summary

### Principles (5)

1. **Hexagonal Architecture (Ports & Adapters)** — Domain logic has zero knowledge of infrastructure. All external concerns (LLM providers, terminal rendering, config files) connect through ports (Go interfaces) defined in the domain layer.

2. **Bounded Context Isolation with Shared Kernel** — Each domain (conversation, rendering, session) owns its models and invariants. Cross-context communication happens through well-defined application services, never direct model access. **Shared Kernel exception:** types that are intrinsically cross-cutting (Message, Role, StreamChunk, ToolCall, Usage) live in `domain/shared/` and may be imported by any domain package. This avoids circular imports while keeping domain purity. The Shared Kernel is intentionally small and grows only by explicit decision.

3. **Interface-First Design** — Every major component is defined as a Go interface before implementation. This enables the 2-tier customization goal: swap providers, tools, policies, agent loops, and TUI components independently.

4. **Progressive Disclosure of Complexity** — v0.1 packages declare ports for v0.2+ features (Provider, Tool, Policy) but implement only dummy/noop adapters. The folder structure accommodates v0.5+ without restructuring. Forward-declared interfaces carry `// UNSTABLE` godoc comments to signal they may change.

5. **Go-Idiomatic DDD** — No Java-esque over-abstraction. Value objects are plain structs. Aggregates are structs with methods. Ports are interfaces in the domain package. Adapters live in infrastructure. No `impl/` folders, no `IService` prefixes.

### Decision Drivers (Top 3)

1. **Extensibility without restructuring** — The folder structure must accommodate providers (v0.2), tools (v0.3), policies (v0.4), multi-agent (v0.5), and GUI integration (v0.6) without moving files or renaming packages.

2. **Clean domain boundaries** — Domain models (Message, Conversation, Session) must be testable in isolation with zero dependencies on Bubbletea, network, or filesystem.

3. **Developer ergonomics** — A new contributor should understand the architecture in 5 minutes by reading the folder tree. Package names should be self-documenting.

### Viable Options

#### Option A: Hexagonal DDD with `domain/` + `application/` + `infrastructure/` + `tui/` (CHOSEN)

```
harness/
  domain/           # Pure domain models, interfaces (ports), domain services
    shared/         # Shared Kernel: cross-cutting types (Message, Role, StreamChunk, etc.)
  application/      # Use cases / application services (orchestrate domain)
  infrastructure/   # Adapters (provider impls, config loaders, event loggers)
  tui/              # Bubbletea presentation layer (views, components)
  prompts/          # No-code: system prompt markdown files
  hooks/            # No-code: hook definitions
```

**Pros:**
- Clear separation: domain has zero imports from other layers
- Ports in domain, adapters in infrastructure — textbook hexagonal
- `tui/` as a distinct layer makes it replaceable (future: GUI integration)
- Scales naturally: v0.2 adds `infrastructure/openrouter/`, v0.3 adds `domain/tool/`
- Go-idiomatic: no deep nesting, packages import inward only
- Shared Kernel (`domain/shared/`) eliminates circular imports between domain contexts

**Cons:**
- More packages upfront than a flat `internal/` approach
- Developers must understand the layer dependency rules
- Slight indirection overhead for a v0.1 that only has dummy responses

#### Option B: Flat `internal/` with feature packages

```
harness/
  internal/
    tui/
    provider/
    agent/
    tool/
    config/
```

**Pros:**
- Simpler initial structure
- Familiar to Go developers who use `internal/` convention
- Less upfront architecture

**Cons:**
- No enforced domain boundary — `tui/` can import `provider/` types directly, creating coupling
- When policies/events/hooks arrive (v0.3-v0.4), the flat structure becomes tangled
- "Feature package" pattern conflates domain models with implementation details
- Refactoring to DDD later means moving files and breaking imports across the codebase
- **INVALIDATION:** This option was rejected because the user explicitly requested strong DDD design ("DDD 디자인 잘 짜고"), and flat `internal/` provides no architectural enforcement of domain boundaries. The cost of restructuring later outweighs the marginal simplicity gained now.

#### Option C: Onion Architecture with `core/` ring

```
harness/
  core/           # Innermost: entities, value objects
  usecases/       # Application ring: use case interactors
  adapters/       # Outer ring: infrastructure + presentation
```

**Pros:**
- Pure onion — dependency arrows always point inward

**Cons:**
- `adapters/` collapses TUI and infrastructure into one package, which is awkward for a TUI-heavy project
- `usecases/` is not idiomatic Go naming
- Less intuitive for Go developers compared to the hexagonal layout
- **INVALIDATION:** Merging TUI presentation with infrastructure adapters violates the principle that the TUI layer should be independently replaceable. Since v0.6 plans GUI integration, the presentation layer must be a first-class boundary.

---

## 1. DDD Domain Analysis

### Bounded Contexts

```
┌─────────────────────────────────────────────────────────────┐
│                     v0.1 Scope                              │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │               Shared Kernel                          │   │
│  │  Message, Role, StreamChunk, ToolCall, Usage         │   │
│  └──────────────────────────────────────────────────────┘   │
│         ▲                 ▲                 ▲                │
│         │                 │                 │                │
│  ┌──────┴───────┐  ┌─────┴────────┐  ┌────┴─────────────┐  │
│  │ Conversation  │  │   Session    │  │   Rendering      │  │
│  │               │  │              │  │                  │  │
│  │ Conversation  │  │ SessionInfo  │  │ (Bubbletea       │  │
│  │ (aggregate)   │  │ StatusData   │  │  components —    │  │
│  │               │  │ KeyBinding   │  │  NOT domain)     │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                 │                    │            │
│         ▼                 ▼                    ▼            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Application Services                    │   │
│  │   ChatService · SessionService                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                   v0.2+ Ports (defined in v0.1)            │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   Provider    │  │    Tool      │  │    Policy        │  │
│  │   (port)      │  │   (port)     │  │    (port)        │  │
│  │               │  │              │  │                  │  │
│  │ LLMProvider   │  │ Tool         │  │ PolicyEngine     │  │
│  │ StreamHandler │  │ ToolResult   │  │ PolicyProfile    │  │
│  │ ModelInfo     │  │ ApprovalReq  │  │ PolicyDecision   │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐                        │
│  │    Agent      │  │    Event     │                        │
│  │   (port)      │  │   (port)     │                        │
│  │               │  │              │                        │
│  │ AgentLoop     │  │ EventLogger  │                        │
│  │ AgentConfig   │  │ Event        │                        │
│  │ TurnResult    │  │              │                        │
│  └──────────────┘  └──────────────┘                        │
└─────────────────────────────────────────────────────────────┘
```

### Domain Models (v0.1)

#### Shared Kernel (`domain/shared/`)

| Type | Kind | Description |
|------|------|-------------|
| `Role` | Value Object | `user` / `assistant` / `system` / `tool` |
| `Message` | Entity | `ID`, `Role`, `Content`, `Timestamp`, `ToolCalls []ToolCall` |
| `StreamChunk` | Value Object | Partial content delta during streaming. `Delta string`, `Done bool`, `MessageID string` |
| `ToolCall` | Value Object | `ID string`, `ToolName string`, `Input map[string]any` |
| `Usage` | Value Object | `InputTokens int`, `OutputTokens int` |

#### Conversation Context

| Type | Kind | Description |
|------|------|-------------|
| `Conversation` | Aggregate Root | Ordered collection of `shared.Message`. Owns append/history invariants. |

#### Session Context

| Type | Kind | Description |
|------|------|-------------|
| `SessionInfo` | Entity | `ID`, `StartTime`, `ModelName`, `ProviderName` |
| `StatusData` | Value Object | `TokensUsed`, `Cost`, `ActiveTool`, `Phase` |
| `KeyBinding` | Value Object | `Key`, `Action`, `Description` |

#### Domain Errors (`domain/shared/errors.go`)

| Error | Description |
|-------|-------------|
| `ErrProviderUnavailable` | Provider could not be reached or returned a non-retryable failure |
| `ErrStreamCancelled` | User or system cancelled an in-flight streaming response |
| `ErrEmptyMessage` | User attempted to send a blank message |
| `ErrContextTooLong` | Message history exceeds provider's context window |

### Ports (Interfaces) — Defined in v0.1, Implemented in v0.2+

All ports reference `shared.*` types to avoid cross-context imports.

```go
// domain/provider/port.go — v0.2 implements OpenRouter, Codex
//
// UNSTABLE: This interface will evolve when real providers are implemented in v0.2.
type LLMProvider interface {
    Name() string
    Chat(ctx context.Context, req ChatRequest) (ChatResponse, error)
    ChatStream(ctx context.Context, req ChatRequest, handler StreamHandler) error
    Models(ctx context.Context) ([]ModelInfo, error)
}

// StreamHandler receives streaming chunks. Called on the goroutine running
// ChatStream — callers that need to forward to another goroutine (e.g. Bubbletea)
// must handle the send themselves.
type StreamHandler func(chunk shared.StreamChunk)

// domain/tool/port.go — v0.3 implements filesystem tools
//
// UNSTABLE: Interface will evolve when tool execution is implemented in v0.3.
type Tool interface {
    Name() string
    Description() string
    Parameters() ParameterSchema
    Execute(ctx context.Context, input map[string]any) (ToolResult, error)
}

// domain/policy/port.go — v0.4 implements policy engine
//
// UNSTABLE: Interface will evolve when policy engine is implemented in v0.4.
type PolicyEngine interface {
    Evaluate(call shared.ToolCall, profile PolicyProfile) PolicyDecision
}

// domain/event/port.go — v0.3+ implements JSONL logger
//
// UNSTABLE: Interface will evolve when event logging is implemented in v0.3.
type EventLogger interface {
    Log(event Event) error
    Flush() error
}

// domain/agent/port.go — v0.3 implements single agent loop
//
// UNSTABLE: Interface will evolve when the agent loop is implemented in v0.3.
type AgentLoop interface {
    Run(ctx context.Context, prompt string, opts RunOptions) (TurnResult, error)
    Cancel()
}
```

### Application Services (v0.1)

| Service | Method | Responsibility |
|---------|--------|---------------|
| `ChatService` | `SendMessage(ctx, content, handler)` | Appends user message to Conversation, calls `provider.ChatStream`, forwards chunks via `StreamHandler` callback, appends final assistant message. Single method owns the full round-trip. |
| `ChatService` | `History()` | Returns conversation message history. |
| `SessionService` | `Start(model, provider)` | Initializes session lifecycle. |
| `SessionService` | `UpdateStatus(tokens, cost)` | Tracks StatusData updates. |
| `SessionService` | `Info()` / `Status()` / `KeyBindings()` | Read accessors. |

**Note:** `StreamResponse` has been removed. `SendMessage` is the single method that handles the full user-message-to-assistant-response lifecycle. The `StreamHandler` callback parameter enables real-time chunk delivery to the TUI without a separate streaming method.

### Adapters

| Adapter | Layer | Version |
|---------|-------|---------|
| `DummyProvider` | infrastructure/dummy | v0.1 — simulates streaming responses |
| `OpenRouterProvider` | infrastructure/openrouter | v0.2 |
| `CodexProvider` | infrastructure/codex | v0.2 |
| `ConfigLoader` | infrastructure/config | v0.1 — loads JSON config |
| `PromptLoader` | infrastructure/prompt | v0.1 — reads `prompts/*.md` |
| `TUI (Bubbletea)` | tui/ | v0.1 — terminal presentation |

---

## 2. Folder Structure

```
harness/
├── go.mod                              # module: github.com/HyperBlaze456/ssenrah/harness
├── go.sum                              # go 1.22 minimum
├── main.go                             # Entrypoint: wires dependencies, starts TUI
│
├── domain/                             # PURE DOMAIN — zero external dependencies
│   ├── shared/                         # Shared Kernel — cross-cutting types
│   │   ├── message.go                  # Message entity, Role value object, ToolCall VO
│   │   ├── stream.go                   # StreamChunk value object
│   │   ├── usage.go                    # Usage value object
│   │   └── errors.go                   # Sentinel domain errors
│   │
│   ├── conversation/                   # Conversation bounded context
│   │   └── conversation.go             # Conversation aggregate root (uses shared.Message)
│   │
│   ├── session/                        # Session bounded context
│   │   ├── session.go                  # SessionInfo entity
│   │   ├── status.go                   # StatusData value object
│   │   └── keybinding.go              # KeyBinding value object + registry
│   │
│   ├── provider/                       # Provider port (interface only)
│   │   ├── port.go                     # LLMProvider, StreamHandler interfaces (refs shared.*)
│   │   └── models.go                   # ChatRequest, ChatResponse, ModelInfo VOs
│   │
│   ├── tool/                           # Tool port (interface only, v0.3+)
│   │   ├── port.go                     # Tool interface  // UNSTABLE
│   │   └── models.go                   # ToolResult, ApprovalRequest, ParameterSchema VOs
│   │
│   ├── policy/                         # Policy port (interface only, v0.4+)
│   │   ├── port.go                     # PolicyEngine interface  // UNSTABLE
│   │   └── models.go                   # PolicyProfile, PolicyDecision, RiskLevel VOs
│   │
│   ├── agent/                          # Agent port (interface only, v0.3+)
│   │   ├── port.go                     # AgentLoop interface  // UNSTABLE
│   │   └── models.go                   # AgentConfig, TurnResult, RunOptions VOs
│   │
│   └── event/                          # Event port (interface only, v0.3+)
│       ├── port.go                     # EventLogger interface  // UNSTABLE
│       └── models.go                   # Event, EventType VOs
│
├── application/                        # APPLICATION SERVICES — orchestrate domain
│   ├── chat.go                         # ChatService: message flow, provider dispatch
│   └── session.go                      # SessionService: lifecycle, status tracking
│
├── infrastructure/                     # ADAPTERS — external world implementations
│   ├── dummy/                          # v0.1 dummy LLM provider
│   │   └── provider.go                 # DummyProvider implements domain/provider.LLMProvider
│   │
│   ├── openrouter/                     # v0.2 (empty package with TODO)
│   │   └── provider.go                 # placeholder
│   │
│   ├── codex/                          # v0.2 (empty package with TODO)
│   │   └── provider.go                 # placeholder
│   │
│   ├── config/                         # Configuration loading
│   │   ├── config.go                   # AppConfig struct, loader (JSON format)
│   │   └── defaults.go                 # Default values
│   │
│   └── prompt/                         # Prompt file loader
│       └── loader.go                   # Reads prompts/*.md into domain models
│
├── tui/                                # PRESENTATION LAYER — Bubbletea components
│   ├── app.go                          # Root tea.Model: orchestrates sub-models, holds *tea.Program
│   ├── chat.go                         # Chat area: message list + markdown rendering
│   ├── input.go                        # Input area: text input + model/provider display
│   ├── sidebar.go                      # Sidebar panel: model, tokens, cost, activity
│   ├── statusbar.go                    # Bottom bar: keybinding hints
│   ├── approval.go                     # Tool approval UI skeleton (v0.1 visual only)
│   ├── layout.go                       # Adaptive layout manager (responsive breakpoints)
│   ├── markdown.go                     # Markdown -> styled terminal output
│   ├── theme.go                        # Color palette, lipgloss styles
│   ├── keys.go                         # Key map definitions
│   └── messages.go                     # Custom tea.Msg types for inter-component comms
│
├── prompts/                            # NO-CODE CUSTOMIZATION: system prompts
│   └── default.md                      # Default system prompt
│
└── hooks/                              # NO-CODE CUSTOMIZATION: hook definitions
    └── README.md                       # Hook documentation and examples
```

### Layer Dependency Rules (ENFORCED)

```
  tui/  ──────────>  application/  ──────────>  domain/
                          |                        ^
  infrastructure/  ───────┘                        |
                          |                  domain/shared/
                    (implements domain/ interfaces)
```

- `domain/shared/` imports NOTHING from this module (only stdlib)
- `domain/*` (conversation, session, provider, etc.) imports only `domain/shared/` and stdlib
- `application/` imports only `domain/` packages
- `infrastructure/` imports `domain/` (to implement interfaces)
- `tui/` imports `application/` and `domain/` (for types). Holds a `*tea.Program` reference for async message sending.
- `main.go` wires everything together (dependency injection)
- `tui/` NEVER imports `infrastructure/` directly

### How This Scales (v0.1 through v0.6)

| Version | What Gets Added | Where |
|---------|----------------|-------|
| v0.1 | TUI shell, dummy provider, conversation/session domains, shared kernel | All layers |
| v0.2 | OpenRouter + Codex providers | `infrastructure/openrouter/`, `infrastructure/codex/` |
| v0.3 | Agent loop, first tools, approval flow | `domain/agent/` models, `domain/tool/` models, `application/agent.go`, `infrastructure/tools/` |
| v0.4 | Policy engine, beholder, intents | `domain/policy/` models, `infrastructure/policy/`, `application/policy.go` |
| v0.5 | Multi-agent orchestration | `domain/team/`, `application/team.go`, `infrastructure/team/` |
| v0.6 | GUI integration, shared config (JSON format aligns with Tauri app) | `infrastructure/bridge/` (IPC to Tauri app) |

---

## 3. Bubbletea Async Integration Pattern

This section documents the concrete pattern for connecting blocking `ChatService` methods to Bubbletea's `tea.Cmd`/`tea.Msg` architecture. **This is critical** — calling blocking methods inside `Update()` would freeze the TUI.

### Architecture

```
┌──────────────────────────────────────────────────────────┐
│  tui/app.go — App struct                                 │
│                                                          │
│  program  *tea.Program     // set via SetProgram() after │
│                            // tea.NewProgram() in main   │
│  cancelFn context.CancelFunc  // cancel in-flight stream │
│  streaming bool               // guard for Esc key       │
└──────────────────────────────────────────────────────────┘
```

### Custom Message Types (`tui/messages.go`)

```go
// StreamChunkMsg carries a single streaming delta to the TUI.
type StreamChunkMsg struct {
    Chunk shared.StreamChunk
}

// StreamDoneMsg signals that streaming has completed successfully.
type StreamDoneMsg struct {
    FinalMessage shared.Message
}

// StreamErrorMsg signals that streaming failed or was cancelled.
type StreamErrorMsg struct {
    Err error
}

// WindowSizeMsg carries terminal resize dimensions.
// (Bubbletea provides tea.WindowSizeMsg natively — alias or use directly.)

// StatusUpdateMsg signals that session status data changed.
type StatusUpdateMsg struct {
    Status session.StatusData
}

// ToggleSidebarMsg toggles the sidebar visibility.
type ToggleSidebarMsg struct{}

// ApprovalRequestMsg shows the tool approval dialog (skeleton).
type ApprovalRequestMsg struct {
    Request tool.ApprovalRequest
}
```

### The `tea.Cmd` Wrapper Pattern

When the user presses Enter to send a message, `Update()` must NOT call `ChatService.SendMessage()` directly. Instead, it returns a `tea.Cmd` that wraps the blocking call:

```go
// tui/app.go

func (a *App) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
    switch msg := msg.(type) {

    case tea.KeyMsg:
        switch {
        case key.Matches(msg, a.keys.Send):
            content := a.input.Value()
            if content == "" {
                return a, nil
            }
            a.input.Reset()
            a.streaming = true

            // Create a cancellable context for this stream
            ctx, cancel := context.WithCancel(context.Background())
            a.cancelFn = cancel

            // Return a tea.Cmd that runs the blocking service call
            // in a separate goroutine (Bubbletea runs Cmds in goroutines)
            return a, a.sendMessageCmd(ctx, content)

        case key.Matches(msg, a.keys.Cancel):
            if a.streaming && a.cancelFn != nil {
                a.cancelFn()    // cancels the context -> ChatStream returns
                a.cancelFn = nil
                a.streaming = false
            }
            return a, nil
        }

    case StreamChunkMsg:
        // Append chunk delta to the in-progress assistant message
        a.chat.AppendChunk(msg.Chunk)
        return a, nil

    case StreamDoneMsg:
        // Finalize the assistant message in chat view
        a.chat.FinalizeMessage(msg.FinalMessage)
        a.streaming = false
        a.cancelFn = nil
        return a, nil

    case StreamErrorMsg:
        // Display error inline in the chat area
        a.chat.ShowError(msg.Err)
        a.streaming = false
        a.cancelFn = nil
        return a, nil
    }

    // ... delegate to sub-models ...
    return a, nil
}
```

### The `sendMessageCmd` factory

```go
// tui/app.go

// sendMessageCmd returns a tea.Cmd that runs the blocking ChatService.SendMessage
// in a goroutine. Streaming chunks are forwarded to the TUI via program.Send().
func (a *App) sendMessageCmd(ctx context.Context, content string) tea.Cmd {
    return func() tea.Msg {
        // The StreamHandler callback is called on the ChatStream goroutine.
        // We use program.Send() to forward each chunk to the Bubbletea event loop.
        handler := func(chunk shared.StreamChunk) {
            a.program.Send(StreamChunkMsg{Chunk: chunk})
        }

        // SendMessage is blocking: it appends user msg, calls provider.ChatStream
        // with our handler, then appends the final assistant msg.
        finalMsg, err := a.chatService.SendMessage(ctx, content, handler)
        if err != nil {
            // If context was cancelled (Esc pressed), return cancellation error
            if ctx.Err() != nil {
                return StreamErrorMsg{Err: shared.ErrStreamCancelled}
            }
            return StreamErrorMsg{Err: err}
        }

        return StreamDoneMsg{FinalMessage: finalMsg}
    }
}
```

### SetProgram Pattern

Since `tea.NewProgram()` returns the program, but the `App` model needs a reference to it for `program.Send()`, we use a setter:

```go
// tui/app.go

func (a *App) SetProgram(p *tea.Program) {
    a.program = p
}

// main.go

app := tui.NewApp(chatSvc, sessSvc)
p := tea.NewProgram(app, tea.WithAltScreen())
app.SetProgram(p)  // wire the program reference before Run()
if _, err := p.Run(); err != nil {
    fmt.Fprintf(os.Stderr, "Error: %v\n", err)
    os.Exit(1)
}
```

### Cancellation Flow

```
User presses Esc
    -> Update() receives tea.KeyMsg{Esc}
    -> calls a.cancelFn()
    -> ctx.Done() fires inside ChatStream
    -> ChatStream returns context.Canceled error
    -> sendMessageCmd goroutine catches ctx.Err()
    -> returns StreamErrorMsg{Err: shared.ErrStreamCancelled}
    -> Update() receives StreamErrorMsg
    -> chat.ShowError() renders "Stream cancelled" inline
    -> a.streaming = false
```

### Graceful Shutdown

```
User presses Ctrl+C
    -> Update() receives tea.KeyMsg{Ctrl+C}
    -> if a.streaming, call a.cancelFn() first to cancel in-flight stream
    -> return tea.Quit
    -> Bubbletea exits cleanly, restores terminal
```

---

## 4. ChatService API (Revised)

The `ChatService` API has been simplified to a single `SendMessage` method that owns the full round-trip. `StreamResponse` has been removed.

```go
// application/chat.go

type ChatService struct {
    conversation *conversation.Conversation
    provider     provider.LLMProvider
    systemPrompt string
}

// SendMessage performs the full round-trip:
// 1. Validates content is non-empty (returns shared.ErrEmptyMessage if blank)
// 2. Appends a user Message to the Conversation
// 3. Calls provider.ChatStream with the full message history
// 4. Forwards each StreamChunk to the handler callback in real-time
// 5. Appends the final assistant Message to the Conversation
// 6. Returns the final assistant Message
//
// This method is BLOCKING. In Bubbletea, wrap the call in a tea.Cmd
// (see Section 3: Bubbletea Async Integration Pattern).
//
// The handler callback is invoked on the calling goroutine. If the caller
// needs to forward chunks to another goroutine (e.g. via tea.Program.Send),
// that forwarding happens inside the handler.
//
// Cancellation: pass a cancellable context. When ctx is cancelled,
// ChatStream returns and SendMessage propagates the error.
func (s *ChatService) SendMessage(
    ctx context.Context,
    content string,
    handler provider.StreamHandler,
) (shared.Message, error)

// History returns a copy of the conversation messages.
func (s *ChatService) History() []shared.Message
```

---

## 5. Implementation Steps

### Step 1: Go Module Bootstrap, Shared Kernel & Domain Models
**Files:**
- `harness/go.mod`
- `harness/domain/shared/message.go`
- `harness/domain/shared/stream.go`
- `harness/domain/shared/usage.go`
- `harness/domain/shared/errors.go`
- `harness/domain/conversation/conversation.go`
- `harness/domain/session/session.go`
- `harness/domain/session/status.go`
- `harness/domain/session/keybinding.go`

**Work:**
1. Initialize Go module: `go mod init github.com/HyperBlaze456/ssenrah/harness` with `go 1.22` directive
2. Create `domain/shared/` (Shared Kernel):
   - `Role` as a string type with constants (`RoleUser`, `RoleAssistant`, `RoleSystem`, `RoleTool`)
   - `Message` entity: `ID string`, `Role Role`, `Content string`, `Timestamp time.Time`, `ToolCalls []ToolCall`
   - `ToolCall` VO: `ID string`, `ToolName string`, `Input map[string]any`
   - `StreamChunk` VO: `Delta string`, `Done bool`, `MessageID string`
   - `Usage` VO: `InputTokens int`, `OutputTokens int`
   - Sentinel errors: `ErrProviderUnavailable`, `ErrStreamCancelled`, `ErrEmptyMessage`, `ErrContextTooLong`
3. Create `domain/conversation/`:
   - `Conversation` aggregate with `Messages []shared.Message`, `ID string`, `CreatedAt time.Time`
   - Methods: `Append(msg shared.Message)`, `History() []shared.Message`, `LastAssistantMessage() *shared.Message`
   - Invariant: Messages are append-only and ordered by timestamp
4. Create `domain/session/`:
   - `SessionInfo` entity: `ID string`, `StartTime time.Time`, `ModelName string`, `ProviderName string`
   - `StatusData` VO: `TokensUsed int`, `EstimatedCost float64`, `ActiveTool string`, `Phase string`
   - `KeyBinding` VO and `KeyBindingRegistry` with `Register()`, `All()`, `ForKey()`

**Acceptance Criteria:**
- [ ] `go build ./...` succeeds with zero errors
- [ ] `domain/shared/` imports only stdlib
- [ ] `domain/conversation/` imports only `domain/shared/` and stdlib
- [ ] `domain/session/` imports only stdlib (no shared dependency needed)
- [ ] `Conversation.Append()` adds messages in order
- [ ] `Conversation.History()` returns a copy (immutability)
- [ ] Sentinel errors are `var` declarations using `errors.New()`
- [ ] Unit tests pass for Conversation aggregate invariants

### Step 2: Port Interfaces (Provider, Tool, Policy, Agent, Event)
**Files:**
- `harness/domain/provider/port.go`
- `harness/domain/provider/models.go`
- `harness/domain/tool/port.go`
- `harness/domain/tool/models.go`
- `harness/domain/policy/port.go`
- `harness/domain/policy/models.go`
- `harness/domain/agent/port.go`
- `harness/domain/agent/models.go`
- `harness/domain/event/port.go`
- `harness/domain/event/models.go`

**Work:**
1. Define `LLMProvider` interface in `domain/provider/port.go`:
   ```go
   // UNSTABLE: This interface will evolve when real providers are implemented in v0.2.
   type LLMProvider interface {
       Name() string
       Chat(ctx context.Context, req ChatRequest) (ChatResponse, error)
       ChatStream(ctx context.Context, req ChatRequest, handler StreamHandler) error
       Models(ctx context.Context) ([]ModelInfo, error)
   }
   type StreamHandler func(chunk shared.StreamChunk)
   ```
   - `Models()` takes `context.Context` and returns `error` because real providers need API calls
2. Define `ChatRequest` VO: `Model string`, `SystemPrompt string`, `Messages []shared.Message`, `MaxTokens int`
3. Define `ChatResponse` VO: `TextContent string`, `ToolCalls []shared.ToolCall`, `StopReason string`, `Usage shared.Usage`
4. Define `ModelInfo` VO: `ID string`, `Name string`, `ContextWindow int`, `PricePerInputToken float64`, `PricePerOutputToken float64`
5. Define `Tool` interface with `// UNSTABLE` godoc: `Name()`, `Description()`, `Parameters()`, `Execute(ctx, input)`
6. Define `ToolResult` VO: `CallID string`, `Content string`, `IsError bool`
7. Define `ApprovalRequest` VO: `ToolCall shared.ToolCall`, `RiskLevel string`, `Reason string`
8. Define `PolicyEngine` interface with `// UNSTABLE` godoc: `Evaluate(call shared.ToolCall, profile PolicyProfile) PolicyDecision`
9. Define `PolicyDecision` as enum type: `Allow`, `AwaitUser`, `Deny`
10. Define `AgentLoop` interface with `// UNSTABLE` godoc: `Run(ctx, prompt, opts) (TurnResult, error)`, `Cancel()`
11. Define `TurnResult` VO: `Status string`, `Messages []shared.Message`, `Usage shared.Usage`
12. Define `EventLogger` interface with `// UNSTABLE` godoc: `Log(event Event) error`, `Flush() error`

**Key Constraint:** All port interfaces reference `shared.*` types (not `conversation.Message` or `conversation.StreamChunk`). This eliminates cross-context coupling. `domain/provider/` imports `domain/shared/`, not `domain/conversation/`.

**Acceptance Criteria:**
- [ ] All port packages compile with zero implementation code
- [ ] `domain/provider/` imports only `domain/shared/` and stdlib (NOT `domain/conversation/`)
- [ ] `domain/agent/` imports only `domain/shared/` and stdlib (NOT `domain/conversation/` or `domain/provider/`)
- [ ] Each interface has a godoc comment explaining its bounded context
- [ ] All v0.2+ interfaces have `// UNSTABLE` godoc markers
- [ ] Value objects are plain structs with no pointer receivers on immutable fields
- [ ] `ToolCall` naming is consistent everywhere (no `ToolCallRef`)

### Step 3: Application Services & Dummy Provider
**Files:**
- `harness/application/chat.go`
- `harness/application/session.go`
- `harness/infrastructure/dummy/provider.go`
- `harness/infrastructure/config/config.go`
- `harness/infrastructure/config/defaults.go`

**Work:**
1. Implement `ChatService`:
   ```go
   type ChatService struct {
       conversation *conversation.Conversation
       provider     provider.LLMProvider
       systemPrompt string
   }

   // SendMessage performs the full round-trip (see Section 4 for detailed contract).
   // This is a BLOCKING call. Wrap in tea.Cmd for Bubbletea integration.
   func (s *ChatService) SendMessage(
       ctx context.Context,
       content string,
       handler provider.StreamHandler,
   ) (shared.Message, error)

   func (s *ChatService) History() []shared.Message
   ```
   - `SendMessage` validates non-empty content (returns `shared.ErrEmptyMessage`)
   - Appends user message to Conversation
   - Builds `ChatRequest` from conversation history + system prompt
   - Calls `provider.ChatStream(ctx, req, handler)` — handler is passed through directly
   - Collects the final content from chunks, constructs assistant `shared.Message`
   - Appends assistant message to Conversation
   - Returns the final assistant message

2. Implement `SessionService`:
   ```go
   type SessionService struct {
       session  *session.SessionInfo
       status   *session.StatusData
       bindings *session.KeyBindingRegistry
   }
   func (s *SessionService) Start(model, provider string) error
   func (s *SessionService) UpdateStatus(tokens int, cost float64) error
   func (s *SessionService) Info() session.SessionInfo
   func (s *SessionService) Status() session.StatusData
   func (s *SessionService) KeyBindings() []session.KeyBinding
   ```

3. Implement `DummyProvider` in `infrastructure/dummy/`:
   - `Name()` returns `"dummy"`
   - `Chat()` returns a canned markdown response
   - `ChatStream()` simulates streaming by splitting the response into character-level chunks with small delays (20-50ms per chunk)
   - Include several canned responses with rich markdown: headers, bold, italic, code blocks (with language tags), tables, bullet lists
   - `Models(ctx context.Context) ([]ModelInfo, error)` returns `[{ID: "dummy-v1", Name: "Dummy Model"}], nil`
   - Compile-time assertion: `var _ provider.LLMProvider = (*DummyProvider)(nil)`

4. Implement `AppConfig` struct and loader:
   - Fields: `Model string`, `Provider string`, `Theme string`, `SidebarOpen bool`
   - `LoadConfig(path string) (AppConfig, error)` — reads **JSON** (aligns with Tauri app's config format for v0.6 sharing), falls back to defaults
   - `DefaultConfig() AppConfig`

**Acceptance Criteria:**
- [ ] `ChatService.SendMessage()` validates input, adds user message, triggers provider call, forwards chunks via handler, appends assistant message
- [ ] `ChatService` has NO `StreamResponse()` method — `SendMessage` is the single entry point
- [ ] `DummyProvider.ChatStream()` sends chunks with visible delays (streaming simulation)
- [ ] `DummyProvider.Models()` accepts `context.Context` and returns `([]ModelInfo, error)`
- [ ] Dummy responses include all markdown elements: `#`, `**bold**`, `*italic*`, `` `code` ``, code blocks, tables
- [ ] `SessionService` correctly tracks token counts and cost
- [ ] `application/` imports only `domain/` packages
- [ ] `infrastructure/dummy/` satisfies the `LLMProvider` interface (compile-time check)
- [ ] Config loader reads JSON format
- [ ] Unit tests pass for ChatService with a mock provider

### Step 4: TUI Shell — Root Model, Layout, Theme, Messages
**Files:**
- `harness/tui/app.go`
- `harness/tui/layout.go`
- `harness/tui/theme.go`
- `harness/tui/keys.go`
- `harness/tui/messages.go`

**Work:**
1. Define root `App` tea.Model in `app.go`:
   ```go
   type App struct {
       chatService    *application.ChatService
       sessionService *application.SessionService
       program        *tea.Program  // set via SetProgram() for async Send()
       chat           Chat          // sub-model
       input          Input         // sub-model
       sidebar        Sidebar       // sub-model
       statusBar      StatusBar     // sub-model
       approval       Approval      // sub-model (skeleton)
       layout         Layout        // layout manager
       width, height  int
       sidebarOpen    bool
       streaming      bool                // true while stream is in-flight
       cancelFn       context.CancelFunc  // cancels current stream
   }

   func (a *App) SetProgram(p *tea.Program)
   ```
   - `Init()` returns initial commands (window size tick)
   - `Update()` routes messages to sub-models, handles global keys (Tab, Ctrl+C, Ctrl+Q, Esc)
   - `Update()` uses the `tea.Cmd` wrapper pattern from Section 3 for `SendMessage` calls
   - Esc during streaming calls `cancelFn()` to cancel the in-flight stream via context
   - Ctrl+C calls `cancelFn()` if streaming, then returns `tea.Quit`
   - `View()` composes sub-model views using the layout manager

2. Implement `Layout` in `layout.go`:
   - Breakpoints: wide (>= 120 cols) shows sidebar; narrow (< 120 cols) collapses sidebar info into top bar
   - `Compute(width, height int, sidebarOpen bool) LayoutMetrics`
   - `LayoutMetrics`: `ChatWidth`, `ChatHeight`, `SidebarWidth`, `SidebarHeight`, `InputHeight`, `StatusBarHeight`, `CompactMode bool`
   - Sidebar width: **33 chars** (fixed) when open — accommodates model names like `claude-3.5-sonnet-20241022`
   - Input area: 3 lines minimum
   - Status bar: 1 line
   - Minimum terminal size: 80x24. Below that, show "terminal too small" message.

3. Define theme in `theme.go`:
   - Use `lipgloss` for styling
   - Color palette: user message (cyan), assistant message (white), code block (gray bg), sidebar (dim), status bar (reverse), error (red), success (green)
   - Styles: `MessageStyle`, `CodeBlockStyle`, `SidebarStyle`, `StatusBarStyle`, `InputStyle`, `HeaderStyle`, `ErrorStyle`

4. Define key map in `keys.go`:
   - `Tab` — toggle sidebar
   - `Enter` — send message
   - `Ctrl+C` / `Ctrl+Q` — quit (with in-flight cancellation)
   - `Esc` — cancel current stream / close approval dialog
   - `Ctrl+L` — clear chat
   - Future-reserved: `Ctrl+K` (command palette), `Ctrl+T` (tool approval)

5. Define custom `tea.Msg` types in `messages.go` (as specified in Section 3):
   - `StreamChunkMsg` — carries `shared.StreamChunk`
   - `StreamDoneMsg` — streaming completed, carries final `shared.Message`
   - `StreamErrorMsg` — carries `error` (handles both provider errors and cancellation)
   - `StatusUpdateMsg` — status data changed
   - `ToggleSidebarMsg`
   - `ApprovalRequestMsg` — tool approval skeleton

**Acceptance Criteria:**
- [ ] `App` compiles as a valid `tea.Model` (implements `Init`, `Update`, `View`)
- [ ] `App` has `program *tea.Program` field and `SetProgram()` method
- [ ] `App` has `cancelFn context.CancelFunc` and `streaming bool` fields
- [ ] `Update()` returns `tea.Cmd` for SendMessage — never calls it directly/blocking
- [ ] Esc during streaming calls `cancelFn()` to cancel the context
- [ ] Ctrl+C cancels in-flight stream then quits
- [ ] Tab key toggles sidebar visibility
- [ ] Layout recomputes on terminal resize
- [ ] Narrow terminals (< 120 cols) trigger compact mode
- [ ] Sidebar width is 33 chars
- [ ] Terminal below 80x24 shows "terminal too small" message
- [ ] `StreamErrorMsg` is defined and handled in `Update()`
- [ ] Theme provides consistent styling including `ErrorStyle`

### Step 5: TUI Components — Chat, Input, Sidebar, StatusBar, Markdown
**Files:**
- `harness/tui/chat.go`
- `harness/tui/input.go`
- `harness/tui/sidebar.go`
- `harness/tui/statusbar.go`
- `harness/tui/markdown.go`
- `harness/tui/approval.go`

**Work:**
1. `Chat` component (`chat.go`):
   - Renders scrollable message list with `viewport` (from Bubbles)
   - Each message: role badge + rendered content
   - User messages: right-aligned or prefixed with `> `
   - Assistant messages: left-aligned, markdown-rendered
   - Streaming: current partial message rendered with cursor blink
   - Scrolls to bottom on new content
   - `AppendChunk(chunk shared.StreamChunk)` — called from `StreamChunkMsg` handler
   - `FinalizeMessage(msg shared.Message)` — called from `StreamDoneMsg` handler
   - `ShowError(err error)` — renders error inline in chat area with `ErrorStyle`
   - Error display: shows error message in red, inline with conversation flow (e.g., "[Error] Stream cancelled" or "[Error] Provider unavailable")

2. `Input` component (`input.go`):
   - Uses `textinput` or `textarea` from Bubbles for multi-line input
   - Displays model name and provider below input area: `[dummy-v1 via dummy]`
   - Shows token count and estimated cost: `tokens: 1,234 | $0.02`
   - Enter submits, Shift+Enter for newline (if textarea)

3. `Sidebar` component (`sidebar.go`):
   - Sections: Model Info, Token Usage, Cost, Activity Log
   - Model Info: model name, provider name, context window
   - Token Usage: input/output tokens, percentage of context used
   - Cost: cumulative session cost
   - Activity Log: last N events (scrollable list)
   - Default state: open
   - Renders within the 33-char width allocated by Layout

4. `StatusBar` component (`statusbar.go`):
   - Single line at bottom
   - Shows key hints: `Tab: sidebar | Enter: send | Ctrl+C: quit | Esc: cancel`
   - Shows current phase: `idle` / `streaming` / `awaiting approval` / `error`
   - Conditional hints based on state (show `Esc: cancel` only during streaming)

5. `Markdown` renderer (`markdown.go`):
   - Use `glamour` (Charm's markdown renderer) for full markdown rendering
   - Support: headers (h1-h6), bold, italic, inline code, code blocks with syntax highlighting, tables, bullet lists, numbered lists, blockquotes, horizontal rules
   - Configure glamour with a custom style matching our theme
   - Fallback: if glamour fails, render raw text

6. `Approval` skeleton (`approval.go`):
   - Modal overlay showing tool call details
   - Buttons: `[Y] Approve` / `[N] Deny` / `[A] Always Allow`
   - No actual tool execution — just the visual UI structure
   - Triggered by `ApprovalRequestMsg` (can be tested with a keyboard shortcut)

**Acceptance Criteria:**
- [ ] Chat area renders messages with role distinction (user vs assistant)
- [ ] Streaming text appears character-by-character in the chat area
- [ ] Chat auto-scrolls to bottom on new content
- [ ] `chat.ShowError()` renders errors inline with red styling
- [ ] Markdown renders: `**bold**`, `*italic*`, `` `inline code` ``, fenced code blocks with syntax highlighting, `| table |`, `# headers`, `- lists`, `> blockquotes`
- [ ] Sidebar shows model name, provider, token count, cost within 33-char width
- [ ] Sidebar toggles with Tab (open/close)
- [ ] Narrow terminal: sidebar info compressed into top line
- [ ] Status bar shows context-sensitive key hints (Esc only during streaming)
- [ ] Approval dialog renders as a modal overlay (visual skeleton only)
- [ ] Input field accepts text and submits on Enter

### Step 6: Wiring, Entry Point & No-Code Customization
**Files:**
- `harness/main.go`
- `harness/prompts/default.md`
- `harness/hooks/README.md`
- `harness/infrastructure/prompt/loader.go`

**Work:**
1. `main.go` — dependency injection, program wiring, and startup:
   ```go
   func main() {
       // Load config
       cfg := config.DefaultConfig()

       // Load system prompt
       systemPrompt := prompt.LoadDefaultPrompt()

       // Create domain objects
       conv := conversation.New()
       sess := session.New("dummy-v1", "dummy")

       // Create infrastructure (adapters)
       prov := dummy.NewProvider()

       // Create application services
       chatSvc := application.NewChatService(conv, prov, systemPrompt)
       sessSvc := application.NewSessionService(sess)

       // Create TUI (presentation)
       app := tui.NewApp(chatSvc, sessSvc)

       // Create program and wire the reference for async Send()
       p := tea.NewProgram(app, tea.WithAltScreen())
       app.SetProgram(p)

       // Run — blocks until quit
       if _, err := p.Run(); err != nil {
           fmt.Fprintf(os.Stderr, "Error: %v\n", err)
           os.Exit(1)
       }
   }
   ```

2. `prompts/default.md`:
   - A default system prompt for the agent harness
   - Includes role definition, behavior guidelines, response format preferences

3. `infrastructure/prompt/loader.go`:
   - `LoadPrompt(path string) (string, error)` — reads markdown file, returns as string
   - `LoadDefaultPrompt() string` — embedded default via `//go:embed`

4. `hooks/README.md`:
   - Documents the hook system design for future implementation
   - Lists hook lifecycle events: `PreToolUse`, `PostToolUse`, `SessionStart`, `SessionEnd`

**Acceptance Criteria:**
- [ ] `go run .` in `harness/` launches the TUI in alt-screen mode
- [ ] `main.go` calls `app.SetProgram(p)` before `p.Run()`
- [ ] User can type a message, press Enter, and see a streaming dummy response
- [ ] Streaming can be cancelled with Esc (context cancellation)
- [ ] Multiple messages create a scrollable conversation history
- [ ] Tab toggles the sidebar
- [ ] Ctrl+C cancels any in-flight stream and exits cleanly
- [ ] Resizing the terminal updates the layout in real-time
- [ ] `prompts/default.md` exists and is loadable
- [ ] The program exits with code 0 on clean shutdown
- [ ] Consider `teatest` package for TUI component testing (optional for v0.1)

---

## 6. Acceptance Criteria (v0.1 Complete)

### Functional
- [ ] TUI launches via `go run .` from `harness/` directory
- [ ] User types messages and receives streaming dummy responses (character-by-character rendering)
- [ ] Streaming can be cancelled with Esc key (context cancellation propagates to provider)
- [ ] Cancelled streams show inline error message ("Stream cancelled")
- [ ] Provider errors display inline in the chat area with error styling
- [ ] Markdown rendering works for: bold, italic, code blocks (with syntax highlight), tables, headers, lists, blockquotes
- [ ] Sidebar displays: model name, provider name, token count, estimated cost, activity log
- [ ] Tab key toggles sidebar open/closed (default: open)
- [ ] Terminal resize triggers real-time layout adaptation
- [ ] Narrow terminal (< 120 cols): sidebar info compresses to top bar
- [ ] Very small terminal (< 80x24): shows "terminal too small" message
- [ ] Tool approval UI skeleton renders as modal overlay (no functional tools yet)
- [ ] Status bar shows context-sensitive keyboard shortcut hints
- [ ] Input area shows current model/provider and token/cost summary
- [ ] Ctrl+C cancels in-flight streams then exits cleanly

### Architectural
- [ ] `domain/shared/` exists with `Message`, `Role`, `StreamChunk`, `ToolCall`, `Usage`, sentinel errors
- [ ] `domain/shared/` imports only stdlib
- [ ] `domain/conversation/` imports only `domain/shared/` and stdlib
- [ ] All port interfaces reference `shared.*` types — no cross-context imports (e.g., `provider/` does NOT import `conversation/`)
- [ ] All port interfaces (LLMProvider, Tool, PolicyEngine, AgentLoop, EventLogger) are defined in `domain/`
- [ ] `LLMProvider.Models()` signature is `Models(ctx context.Context) ([]ModelInfo, error)`
- [ ] `ChatService.SendMessage()` is the single round-trip method (no separate `StreamResponse`)
- [ ] `ChatService.SendMessage()` accepts a `StreamHandler` callback parameter
- [ ] `DummyProvider` satisfies `LLMProvider` interface via compile-time assertion
- [ ] `application/` imports only `domain/`
- [ ] `infrastructure/` implements domain interfaces (adapter pattern)
- [ ] `tui/` is the only package importing Bubbletea/Bubbles/Lipgloss/Glamour
- [ ] `tui/App` holds `*tea.Program` reference for async `Send()`
- [ ] Dependency flow: `main.go` -> `tui/` -> `application/` -> `domain/` (<- `infrastructure/`)
- [ ] `ToolCall` naming is consistent everywhere (no `ToolCallRef`)
- [ ] All v0.2+ port interfaces have `// UNSTABLE` godoc comments

### Quality
- [ ] `go vet ./...` passes
- [ ] `go build ./...` succeeds
- [ ] Unit tests exist for: Conversation aggregate, ChatService (with mock provider), Layout breakpoints
- [ ] No circular imports
- [ ] All exported types have godoc comments
- [ ] go.mod specifies `go 1.22` minimum

---

## 7. Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Glamour rendering conflicts with Bubbletea viewport | Chat area rendering broken | Medium | Test glamour output within viewport early in Step 5. Fallback: use `goldmark` + custom terminal renderer. |
| Bubbletea alt-screen + viewport scrolling complexity | Poor scroll UX | Medium | Use Bubbles `viewport` component which handles this natively. |
| `tea.Program.Send()` from StreamHandler goroutine | Race condition or panic | Low | `tea.Program.Send()` is documented as goroutine-safe. The pattern is well-established in Charm ecosystem examples. |
| Domain model over-engineering for v0.1 | Wasted effort on unused interfaces | Low | Port interfaces in v0.2+ packages are just interface declarations + VOs — minimal code. `// UNSTABLE` markers set expectations. |
| Adaptive layout edge cases (very narrow terminals) | Broken layout on small terminals | Low | Define minimum terminal size (80x24). Below that, show a "terminal too small" message. |
| Go module path mismatch | Import confusion | Low | Use `github.com/HyperBlaze456/ssenrah/harness` matching actual remote. Note in go.mod comment if path needs adjustment. |
| Streaming simulation timing feels unnatural | Poor UX first impression | Low | Tune DummyProvider chunk delay (20-50ms). Add variable timing based on "word" boundaries for natural feel. |
| JSON config vs YAML ecosystem conventions | Developer surprise | Low | JSON chosen deliberately for v0.6 Tauri GUI config sharing. Document the rationale in config.go godoc. |

---

## 8. Key Go Dependencies

| Package | Purpose | Version |
|---------|---------|---------|
| `github.com/charmbracelet/bubbletea` | TUI framework — tea.Model, Program, Cmd | v1.x (latest) |
| `github.com/charmbracelet/bubbles` | Pre-built components: `viewport`, `textinput`, `textarea`, `spinner` | v0.20+ |
| `github.com/charmbracelet/lipgloss` | Terminal styling (colors, borders, padding, alignment) | v1.x |
| `github.com/charmbracelet/glamour` | Markdown rendering with syntax highlighting (uses `goldmark` + `chroma`) | v0.8+ |
| `github.com/charmbracelet/log` | Structured logging (optional, for debug) | v0.4+ |
| `encoding/json` (stdlib) | Config file parsing — JSON format for Tauri GUI alignment | n/a |
| `github.com/google/uuid` | Message and session IDs | v1 |

### Why JSON for Config (not YAML/TOML)
The Tauri configurer app (v0.6 target) uses JSON for all its configuration files. Choosing JSON now means the harness and GUI can share config schemas without format conversion. The stdlib `encoding/json` also eliminates a third-party dependency (`gopkg.in/yaml.v3`).

### Why Glamour for Markdown
Glamour is the Charm ecosystem's markdown renderer. It uses `goldmark` for parsing and `chroma` for syntax highlighting, and outputs `lipgloss`-compatible styled strings. This means:
- Consistent styling with the rest of the TUI (lipgloss)
- Syntax highlighting in code blocks out of the box
- Custom style themes via `glamour.WithStyles()`
- Active maintenance within the Charm ecosystem

### Not Using (and Why)

| Package | Reason for Exclusion |
|---------|---------------------|
| `tview` / `tcell` | Competing TUI framework — we chose Bubbletea (Elm architecture) |
| `goldmark` directly | Glamour wraps goldmark with terminal-friendly output; using goldmark directly would require building a custom terminal renderer |
| `cobra` | CLI framework — v0.1 has no CLI flags/subcommands. Add if needed in v0.2+ |
| `viper` | Config management — overkill for v0.1. Simple JSON loader suffices. |
| `gopkg.in/yaml.v3` | YAML config — JSON chosen instead for Tauri GUI alignment (see above) |
| `teatest` | TUI testing — recommended for consideration in v0.1 but not required. Mention in Step 6 acceptance criteria. |

---

## 9. ADR: Architectural Decision Record

### Decision
Adopt Hexagonal DDD architecture (Option A) with `domain/shared/` (Shared Kernel) + `domain/` bounded contexts + `application/` + `infrastructure/` + `tui/` layer separation for the ssenrah Go TUI harness.

### Drivers
1. User's explicit requirement for strong DDD design and clean folder structure
2. The harness must scale from v0.1 (TUI shell) through v0.5 (multi-agent orchestration) without structural refactoring
3. Interface-based 2-tier customization (no-code + code) requires clean port/adapter boundaries
4. Cross-cutting types (Message, Role, StreamChunk, ToolCall, Usage) must be importable by multiple domain contexts without circular dependencies

### Alternatives Considered
- **Option B (Flat `internal/`):** Rejected — provides no domain boundary enforcement, would require costly refactoring at v0.3+ when safety/policy layers arrive
- **Option C (Onion Architecture):** Rejected — merges TUI and infrastructure into a single `adapters/` ring, violating the need for an independently replaceable presentation layer (critical for v0.6 GUI integration)
- **No Shared Kernel (types duplicated per context):** Rejected — leads to type conversion boilerplate between contexts (e.g., `conversation.Message` vs `provider.Message`) with no safety benefit. A small, stable Shared Kernel is the Go-idiomatic solution.
- **Single `SendMessage` + separate `StreamResponse`:** Rejected — creates ambiguous API (when to call which? what state transitions between them?). A single `SendMessage` with a `StreamHandler` callback is simpler, self-documenting, and eliminates the overlap.

### Why Chosen
Hexagonal DDD with a Shared Kernel and explicit layer directories is the only option that satisfies all four drivers simultaneously. The Shared Kernel (`domain/shared/`) resolves cross-context coupling while keeping each bounded context's aggregate logic isolated. The upfront cost (more packages) is marginal and pays off immediately by making the architecture self-documenting and preventing accidental coupling.

### Consequences
- Developers must understand that imports flow inward: `tui -> application -> domain <- infrastructure`
- `domain/shared/` is the only package importable by all domain contexts — it must remain small and stable
- Port interfaces in `domain/` for v0.2+ features are initially unused (documentation value only, marked `// UNSTABLE`)
- `main.go` becomes the composition root (manual dependency injection, no DI framework)
- `tui/App` holds a `*tea.Program` reference, requiring a `SetProgram()` call before `Run()` — this is a well-established Charm ecosystem pattern but adds a wiring step

### Follow-ups
- v0.2: Implement `infrastructure/openrouter/` and `infrastructure/codex/` adapters against `domain/provider/` port
- v0.3: Implement `application/agent.go` service using `domain/agent/` and `domain/tool/` ports
- v0.6: Evaluate whether `tui/` needs a shared `presentation/` interface for GUI bridge; JSON config sharing with Tauri app
- Consider adding `golangci-lint` with import restriction rules to enforce layer boundaries automatically
- Evaluate `teatest` package for automated TUI component testing

---

## Task Flow Diagram

```
Step 1                    Step 2                    Step 3
Go Module +               Port Interfaces           Application Services +
Shared Kernel +            (Provider, Tool,          Dummy Provider +
Domain Models              Policy, Agent,            Config Loader
(shared, Conversation,     Event) — all use
 Session)                  shared.* types
    |                         |                         |
    └────────────┬────────────┘                         |
                 |                                      |
                 v                                      |
           domain/ complete                             |
                 |                                      |
                 └──────────────────┬───────────────────┘
                                   |
                                   v
                          domain/ + application/ +
                          infrastructure/ complete
                                   |
                    ┌──────────────┴──────────────┐
                    |                             |
                    v                             v
              Step 4                        Step 5
              TUI Shell Root                TUI Components
              (App w/ *tea.Program,         (Chat, Input,
               Layout, Theme, Keys,         Sidebar, StatusBar,
               Messages w/ StreamErrorMsg)  Markdown, Approval)
                    |                             |
                    └──────────────┬──────────────┘
                                   |
                                   v
                              Step 6
                              Wiring + Entry Point
                              (SetProgram pattern,
                               context cancellation)
                              + No-Code Customization
                                   |
                                   v
                              v0.1 COMPLETE
```

---

## Estimated Effort

| Step | Description | Files | Estimated Lines |
|------|-------------|-------|----------------|
| 1 | Shared Kernel + Domain Models | 9 | ~350 |
| 2 | Port Interfaces | 10 | ~250 |
| 3 | App Services + Dummy + Config | 5 | ~400 |
| 4 | TUI Root + Layout + Theme + Messages | 5 | ~500 |
| 5 | TUI Components + Markdown | 6 | ~700 |
| 6 | Wiring + Prompts + Hooks | 4 | ~150 |
| **Total** | | **39 files** | **~2,350 lines** |

---

## Changelog

### R2 (2026-03-10) — Architect + Critic Feedback

#### BLOCKING Fixes
1. **ChatService API Contradiction (Issue #1):** Removed `StreamResponse` method entirely. `SendMessage` is now the single round-trip method that accepts a `StreamHandler` callback parameter for real-time chunk delivery. Updated signature: `SendMessage(ctx, content, handler) (shared.Message, error)`. Added dedicated Section 4 documenting the revised API contract.

2. **Cross-Context Domain Coupling / Shared Kernel (Issue #2):** Created `domain/shared/` package as a Shared Kernel containing cross-cutting types: `Message`, `Role`, `StreamChunk`, `ToolCall`, `Usage`. All port interfaces now reference `shared.*` types instead of `conversation.*`. Updated Principle 2 to "Bounded Context Isolation with Shared Kernel" with explicit rationale. Updated folder structure, bounded context diagram, and all code examples.

3. **Bubbletea Async Integration Pattern (Issue #3):** Added comprehensive Section 3 documenting the concrete integration pattern including: `tea.Cmd` wrapper for `SendMessage`, `StreamHandler` callback using `program.Send()`, `SetProgram()` pattern for wiring `*tea.Program`, `context.WithCancel` for Esc cancellation, `StreamErrorMsg` for error handling, and full cancellation flow diagram. Includes actual Go code for all patterns.

#### MAJOR Fixes
4. **Go Module Path (Issue #4):** Changed from `github.com/ssenrah/harness` to `github.com/HyperBlaze456/ssenrah/harness` matching the actual GitHub remote (`https://github.com/HyperBlaze456/ssenrah.git`).

5. **`Models()` Needs Context (Issue #5):** Changed `LLMProvider.Models()` signature to `Models(ctx context.Context) ([]ModelInfo, error)` throughout all references (port definition, DummyProvider, acceptance criteria).

6. **Missing Domain Error Types (Issue #6):** Added `domain/shared/errors.go` with sentinel errors: `ErrProviderUnavailable`, `ErrStreamCancelled`, `ErrEmptyMessage`, `ErrContextTooLong`. Referenced in ChatService validation and TUI error handling.

7. **ToolCallRef vs ToolCall Naming (Issue #7):** Unified all references to `ToolCall` (removed `ToolCallRef`). `Message.ToolCalls` is now `[]ToolCall`. `ToolCall` lives in `domain/shared/` as a cross-cutting VO.

#### MINOR Fixes
8. **UNSTABLE Markers (Issue #8):** Added `// UNSTABLE` godoc comments to all forward-declared port interfaces (Tool, PolicyEngine, AgentLoop, EventLogger, and LLMProvider). Updated Principle 4 to mention this convention. Added to acceptance criteria in Step 2.

9. **Minimum Go Version (Issue #9):** Specified `go 1.22` in Step 1 work items and added to Quality acceptance criteria.

10. **Config Format (Issue #10):** Changed config format from YAML to JSON. Rationale: aligns with Tauri app's JSON config for v0.6 sharing. Replaced `gopkg.in/yaml.v3` dependency with stdlib `encoding/json`. Added "Why JSON for Config" section.

11. **Error Handling in TUI (Issue #11):** Added `StreamErrorMsg` to custom message types in Section 3 and Step 4. Added `chat.ShowError()` method and inline error rendering in Step 5. Added `ErrorStyle` to theme. Updated StatusBar to show `error` phase.

12. **Graceful Shutdown (Issue #12):** Added Ctrl+C cancellation flow (cancel in-flight stream then quit) in Section 3 and Step 4. Mentioned `teatest` package in Step 6 acceptance criteria and ADR follow-ups.

13. **Sidebar Width (Issue #13):** Changed sidebar width from 30 to 33 chars to accommodate long model names (e.g., `claude-3.5-sonnet-20241022`). Updated all references in Steps 4 and 5.
