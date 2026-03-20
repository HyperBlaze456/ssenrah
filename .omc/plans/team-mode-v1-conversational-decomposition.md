# Team Mode v1: Conversational Decomposition

**Date:** 2026-03-18
**Status:** APPROVED (Consensus: Planner + Architect + Critic)
**Complexity:** MEDIUM-HIGH
**Estimated Scope:** ~7 files modified, ~2 new types, ~400-500 lines net new code

---

## Context

Currently, `/team <goal>` is fire-and-forget: decompose via LLM, immediately add tasks to graph, start execution. The user has zero visibility into the decomposed plan and no ability to refine it before workers begin. This plan adds an interactive conversational refinement loop between decomposition and execution.

### Current Flow (app.go:543-556)
```
/team <goal> --> orch.Decompose() --> teamDecomposeResultMsg --> startTeamCmd() --> Run()
```

### Target Flow
```
/team <goal> --> DecomposeOnly() --> teamDecomposePreviewMsg (table in chat)
            --> refinement loop (chat input = feedback, not agent messages)
            --> "go" / [G] --> AddTasks() + Run()
            --> "cancel" / Esc --> back to idle
```

---

## Work Objectives

1. Decouple decomposition from execution so the user sees the plan before it runs
2. Render a structured task table in the chat area showing task details + match reasoning
3. Implement a chat-based refinement loop where user input drives re-decomposition
4. Provide clear approval ("go"/[G]) and cancel (Esc/"cancel") mechanisms
5. Preserve backward compatibility with `/team status` and `/team cancel`

---

## Guardrails

### Must Have
- Task table renders in chat with: ID, description, category, agent type (source + confidence), dependencies
- Natural language feedback triggers re-decomposition with context
- "go" text or [G] keybinding approves and starts execution
- Esc or "cancel" text aborts the decomposition flow
- `/team status` and `/team cancel` continue to work unchanged
- All existing tests pass without modification
- State machine prevents sending normal agent messages while in decomposition review

### Must NOT Have
- No GUI changes (TUI only)
- No interactive table widget (all refinement via chat text)
- No mid-execution control (v1 scope)
- No dashboard view
- No changes to the domain layer (task/, policy/, etc.)
- No new dependencies added to go.mod

---

## RALPLAN-DR Summary

### Principles
1. **Minimal invasion** -- Reuse existing patterns (message types, phase system, chat rendering) rather than building parallel infrastructure
2. **Hexagonal boundary respect** -- Decomposer changes stay in application/; TUI changes stay in tui/; no domain layer modifications
3. **State machine clarity** -- The decomposition review phase must be a distinct, well-bounded state that prevents conflicting user actions
4. **Testability** -- New application-layer methods (DecomposeOnly, DecomposeWithFeedback) must be independently testable with mock providers
5. **Backward compatibility** -- Existing `/team status`, `/team cancel`, and all current tests must pass unchanged

### Decision Drivers (Top 3)
1. **User control** -- The primary goal is giving users visibility and control over the task plan before execution commits resources
2. **Implementation simplicity** -- The change should fit naturally into the existing Bubbletea Update/View cycle and phase system without architectural rework
3. **Re-decomposition quality** -- Feedback must carry enough context (original goal + prior plan + user feedback) for the LLM to produce meaningfully improved plans

### Viable Options

#### Option A: TUI Phase-Based State Machine (RECOMMENDED)

Add a new App-level phase (`PhaseDecompositionReview`) that intercepts key/input handling in the existing `Update()` switch. The decomposition preview is rendered as a system message in the chat. Refinement input is routed to `DecomposeWithFeedback()` instead of the agent loop.

**Pros:**
- Fits naturally into the existing phase system (idle/streaming/approval already work this way)
- Minimal new types needed (2 new message types, 1 new phase constant, 1 new Decomposer method)
- Chat-based rendering reuses existing `AddUserMessage` with markdown tables
- Keybinding for [G] approval mirrors the existing approval pattern
- Easy to test: new Decomposer method is pure application logic

**Cons:**
- The `Update()` method in app.go grows more complex (another phase branch)
- Rendering a table as a system message means no interactive editing (acceptable for v1)
- [G] keybinding requires careful interaction with existing key handling

**Bounded effort:** ~400-500 lines across 7 files. No new packages.

#### Option B: Separate Bubbletea Model for Decomposition Review

Create a new `DecompositionReview` Bubbletea model (like Approval) that owns its own Update/View cycle. The App delegates to it when in decomposition mode.

**Pros:**
- Clean separation of concerns (decomposition review is a self-contained component)
- Does not bloat the main App.Update() method
- Could be extended to support interactive table editing in v2

**Cons:**
- More structural overhead: new file, new model type, delegation plumbing
- Must still coordinate with App state (streaming, input routing, sidebar updates)
- The Approval component (which this would resemble) is simpler because it has no multi-turn interaction -- a decomposition review model would need to manage its own sub-loop
- Overkill for v1 where refinement is just "type feedback, see new table"

**Invalidation rationale:** Option B is viable but its structural overhead does not pay off in v1 where the refinement loop is text-only. The extra component boundary creates coordination complexity (input focus, key routing, state sync) without v1 benefits. Would become the right choice if v2 adds interactive table editing.

### ADR

- **Decision:** Option A -- Phase-based state machine with chat-rendered tables
- **Drivers:** Minimal invasion, fits existing patterns, adequate for v1 scope
- **Alternatives considered:** Separate Bubbletea model (Option B) -- viable but over-engineered for text-only refinement
- **Why chosen:** Lower risk, fewer moving parts, proven pattern (phase system already handles 3 phases)
- **Consequences:** App.Update() gains another phase branch; future interactive table editing would require refactoring to Option B
- **Follow-ups:** Consider extracting a DecompositionReview component if v2 adds interactive table editing or dashboard integration

---

## Task Flow

```
Step 1: Application layer (decomposer.go, orchestrator.go)
   |
   v
Step 2: Domain constants (session/status.go)
   |
   v
Step 3: TUI message types (messages.go)
   |
   v
Step 4: Chat table rendering (chat.go)
   |
   v
Step 5: App state machine + key handling (app.go, keys.go)
   |
   v
Step 6: Tests (decomposer_test.go, orchestrator_test.go)
```

---

## Detailed TODOs

### Step 1: Add DecomposeOnly and DecomposeWithFeedback to Application Layer

**Files:** `harness/application/decomposer.go`, `harness/application/orchestrator.go`

#### 1a. Add `DecomposeWithFeedback` to Decomposer (`decomposer.go`)

Add a new method that accepts the original goal, previous task specs, and user feedback, then calls the LLM with enriched context so it can produce an improved plan.

**Changes in `decomposer.go`:**
- Add a new const `decompositionFeedbackPrompt` (system prompt that includes instructions for incorporating feedback). This prompt should instruct the LLM to consider the previous plan and the user's feedback, and output an updated JSON array. (~15 lines)
- Add method `DecomposeWithFeedback(ctx, goal, previousSpecs []TaskSpec, feedback string) ([]TaskSpec, error)`. This builds a multi-message conversation: system prompt, then a user message containing the original goal, then an assistant message containing the previous plan as JSON, then a user message with the feedback. Parsing logic is identical to `Decompose` -- extract into a shared `parseDecompositionResponse` helper. (~40 lines)
- Refactor: extract the JSON parsing logic from `Decompose` (lines 74-128) into a private `parseDecompositionResponse(raw string) ([]TaskSpec, error)` helper. Both `Decompose` and `DecomposeWithFeedback` call this. (~5 lines net change to existing Decompose)

**Acceptance criteria:**
- `DecomposeWithFeedback` returns `[]TaskSpec` incorporating feedback context
- `Decompose` continues to work identically (refactored to use shared parser)
- Both methods handle code fences, invalid categories, broken deps identically
- Unit testable with `mockLLMProvider`

#### 1b. Add `DecomposeOnly` to OrchestratorService (`orchestrator.go`)

Add a method that decomposes a goal and returns specs + match results WITHOUT adding to the graph. This is the preview path.

**Changes in `orchestrator.go`:**
- Add type `DecompositionPreview struct { Specs []TaskSpec; Matches []MatchResult }` (~5 lines)
- Add method `DecomposeOnly(ctx, goal) (DecompositionPreview, error)` that calls `decomposer.Decompose`, then runs `matcher.MatchAll` on temporary Task objects (not added to graph), and returns both. (~25 lines)
- Add method `DecomposeOnlyWithFeedback(ctx, goal, prevSpecs, feedback) (DecompositionPreview, error)` -- same but calls `decomposer.DecomposeWithFeedback`. (~15 lines)
- Add method `CommitDecomposition(preview DecompositionPreview) error` that takes a preview and calls `AddTasks` to commit it to the graph. (~10 lines)

**Acceptance criteria:**
- `DecomposeOnly` returns specs and match results without mutating the graph
- `CommitDecomposition` adds the previewed tasks to the graph
- `graph.Stats().Total` is 0 after `DecomposeOnly`, non-zero after `CommitDecomposition`
- Existing `Decompose` method unchanged (still does decompose + add in one shot)

---

### Step 2: Add Decomposition Review Phase Constant

**File:** `harness/domain/session/status.go`

**Changes:**
- Add `PhaseDecompositionReview = "decomposition review"` constant alongside existing phases (1 line)

**Acceptance criteria:**
- New constant exists and is a distinct string from all other phases
- No existing code references it yet (it will be used in Step 5)

---

### Step 3: Add New TUI Message Types

**File:** `harness/tui/messages.go`

**Changes:**
- Add `teamDecomposePreviewMsg` carrying `application.DecompositionPreview` and the original `Goal string` (~5 lines)
- Add `teamRefineResultMsg` carrying updated `application.DecompositionPreview`, `Goal string`, and `Err error` (~5 lines)

**Acceptance criteria:**
- Both types implement `tea.Msg` (they do implicitly as structs)
- Types carry all data needed for rendering: preview (specs + matches), goal, error

---

### Step 4: Add Task Table Rendering to Chat

**File:** `harness/tui/chat.go`

**Changes:**
- Add method `AddDecompositionTable(specs []TaskSpec, matches []MatchResult)` that builds a markdown table string and adds it as a system message. The table format:

```
| #  | Task ID           | Description                        | Category  | Agent Type          | Deps        |
|----|-------------------|------------------------------------|-----------|---------------------|-------------|
| 1  | explore-structure | Read the project structure          | explore   | explorer (cat, 0.9) | --          |
| 2  | impl-feature      | Implement the new feature           | implement | coder (cat, 0.9)    | 1           |
| 3  | verify-feature    | Verify implementation works         | verify    | verifier (cat, 0.9) | 2           |
```

The "Agent Type" column shows `<type> (<source>, <confidence>)` -- e.g., `explorer (category, 0.9)` or `coder (keyword, 0.7)`.

Dependencies show task numbers (not IDs) for readability, with a `--` for no deps.

After the table, add a hint line: `Type feedback to refine, "go" to execute, or "cancel" to abort.`

(~40 lines)

**Acceptance criteria:**
- Table renders in chat as a markdown-formatted system message
- Agent type column includes match source and confidence
- Dependencies reference task numbers, not raw IDs
- Hint line is visible below the table
- Table handles 0 tasks gracefully (shows "No tasks generated")

---

### Step 5: Wire State Machine in App (Main Integration)

**Files:** `harness/tui/app.go`, `harness/tui/keys.go`

This is the largest step. It wires the new decomposition preview flow into the existing Update/View cycle.

#### 5a. Add decomposition state fields to App struct (`app.go`)

**Changes to App struct (app.go:25-63):**
- Add `decompositionPreview *application.DecompositionPreview` -- holds the current preview being reviewed (nil when not in decomposition review)
- Add `decompositionGoal string` -- the original goal text for re-decomposition context
(~3 lines)

#### 5b. Add [G] keybinding (`keys.go`)

**Changes to keyMap and defaultKeyMap (keys.go):**
- Add `GoApprove key.Binding` to keyMap struct
- Add `GoApprove: key.NewBinding(key.WithKeys("g", "G"), key.WithHelp("g", "approve plan"))` to defaultKeyMap
(~2 lines)

#### 5c. Modify `/team <goal>` handler to use DecomposeOnly (`app.go`)

**Changes to handleSlashCommand, `/team` default case (app.go:543-556):**

Replace the current fire-and-forget decomposition:
```go
// OLD: calls orch.Decompose which adds to graph immediately
return func() tea.Msg {
    count, err := orch.Decompose(context.Background(), goal)
    return teamDecomposeResultMsg{TaskCount: count, Err: err}
}, true
```

With preview-only decomposition:
```go
// NEW: calls orch.DecomposeOnly which returns preview without committing
a.chat.AddUserMessage(shared.NewMessage(shared.RoleSystem,
    fmt.Sprintf("Decomposing: %s ...", goal)))
orch := a.orchestrator
return func() tea.Msg {
    preview, err := orch.DecomposeOnly(context.Background(), goal)
    return teamDecomposePreviewMsg{Preview: preview, Goal: goal, Err: err}
}, true
```
(~5 lines changed)

#### 5d. Handle `teamDecomposePreviewMsg` in Update (`app.go`)

**Add new case in Update switch (after existing teamDecomposeResultMsg handler, app.go:258-266):**

```go
case teamDecomposePreviewMsg:
    if msg.Err != nil {
        a.chat.ShowError(msg.Err)
        return a, nil
    }
    a.decompositionPreview = &msg.Preview
    a.decompositionGoal = msg.Goal
    a.chat.AddDecompositionTable(msg.Preview.Specs, msg.Preview.Matches)
    a.sessionService.SetPhase(session.PhaseDecompositionReview)
    a.statusBar.SetPhase(session.PhaseDecompositionReview)
    return a, nil
```
(~12 lines)

#### 5e. Handle `teamRefineResultMsg` in Update (`app.go`)

**Add new case in Update switch:**

```go
case teamRefineResultMsg:
    if msg.Err != nil {
        a.chat.ShowError(msg.Err)
        // Stay in review phase -- user can try again
        return a, nil
    }
    a.decompositionPreview = &msg.Preview
    a.chat.AddDecompositionTable(msg.Preview.Specs, msg.Preview.Matches)
    // Phase stays PhaseDecompositionReview
    return a, nil
```
(~10 lines)

#### 5f. Intercept input during PhaseDecompositionReview (`app.go`)

**Modify the `key.Matches(msg, a.keys.Send)` handler (app.go:184-210):**

After `a.input.Reset()` and before the slash command check, add decomposition review interception:

```go
// If in decomposition review, route input as feedback or approval
if a.sessionService.Phase() == session.PhaseDecompositionReview && a.decompositionPreview != nil {
    lower := strings.ToLower(strings.TrimSpace(content))

    if lower == "go" {
        // Approve: commit and execute
        preview := *a.decompositionPreview
        a.decompositionPreview = nil
        a.decompositionGoal = ""
        a.chat.AddUserMessage(shared.NewMessage(shared.RoleUser, content))
        a.chat.AddUserMessage(shared.NewMessage(shared.RoleSystem,
            fmt.Sprintf("Approved. Adding %d tasks and starting execution...", len(preview.Specs))))
        if err := a.orchestrator.CommitDecomposition(preview); err != nil {
            a.chat.ShowError(err)
            a.sessionService.SetPhase(session.PhaseIdle)
            a.statusBar.SetPhase(session.PhaseIdle)
            return a, nil
        }
        a.sessionService.SetPhase(session.PhaseIdle)
        a.statusBar.SetPhase(session.PhaseIdle)
        return a, a.startTeamCmd()
    }

    if lower == "cancel" {
        // Cancel decomposition
        a.decompositionPreview = nil
        a.decompositionGoal = ""
        a.chat.AddUserMessage(shared.NewMessage(shared.RoleUser, content))
        a.chat.AddUserMessage(shared.NewMessage(shared.RoleSystem, "Decomposition cancelled."))
        a.sessionService.SetPhase(session.PhaseIdle)
        a.statusBar.SetPhase(session.PhaseIdle)
        return a, nil
    }

    // Otherwise treat as refinement feedback
    a.chat.AddUserMessage(shared.NewMessage(shared.RoleUser, content))
    a.chat.AddUserMessage(shared.NewMessage(shared.RoleSystem, "Re-decomposing with feedback..."))
    goal := a.decompositionGoal
    prevSpecs := a.decompositionPreview.Specs
    orch := a.orchestrator
    return func() tea.Msg {
        preview, err := orch.DecomposeOnlyWithFeedback(context.Background(), goal, prevSpecs, content)
        return teamRefineResultMsg{Preview: preview, Goal: goal, Err: err}
    }, true
}
```
(~40 lines)

#### 5g. Handle Esc during PhaseDecompositionReview (`app.go`)

**Modify the Cancel key handler (app.go:171-182):**

Add a branch for decomposition review cancellation:

```go
case key.Matches(msg, a.keys.Cancel):
    // Cancel decomposition review
    if a.sessionService.Phase() == session.PhaseDecompositionReview {
        a.decompositionPreview = nil
        a.decompositionGoal = ""
        a.chat.AddUserMessage(shared.NewMessage(shared.RoleSystem, "Decomposition cancelled."))
        a.sessionService.SetPhase(session.PhaseIdle)
        a.statusBar.SetPhase(session.PhaseIdle)
        return a, nil
    }
    // ... existing streaming cancel logic ...
```
(~8 lines)

#### 5h. Handle [G] keybinding during PhaseDecompositionReview (`app.go`)

**Add a new key handler in the global keys section (app.go:159-215):**

```go
case key.Matches(msg, a.keys.GoApprove):
    if a.sessionService.Phase() == session.PhaseDecompositionReview && a.decompositionPreview != nil {
        preview := *a.decompositionPreview
        a.decompositionPreview = nil
        a.decompositionGoal = ""
        a.chat.AddUserMessage(shared.NewMessage(shared.RoleSystem,
            fmt.Sprintf("Approved. Adding %d tasks and starting execution...", len(preview.Specs))))
        if err := a.orchestrator.CommitDecomposition(preview); err != nil {
            a.chat.ShowError(err)
            a.sessionService.SetPhase(session.PhaseIdle)
            a.statusBar.SetPhase(session.PhaseIdle)
            return a, nil
        }
        a.sessionService.SetPhase(session.PhaseIdle)
        a.statusBar.SetPhase(session.PhaseIdle)
        return a, a.startTeamCmd()
    }
```

Note: The [G] keybinding must only activate during `PhaseDecompositionReview`. When idle, typing "g" should go to the input field as normal. This means the handler should check phase before matching, OR the `key.Matches` should only trigger when the input field is not focused. Since the input is always focused, this keybinding should be checked BEFORE delegating to input update, and only when in decomposition review phase. The simplest approach: check the phase inside the handler and fall through to input if not in review.

(~15 lines)

#### 5i. Update StatusBar hints for decomposition review (`statusbar.go`)

**Changes to View method (statusbar.go:30-39):**

Add a case for the decomposition review phase:

```go
case "decomposition review":
    hints = "Type feedback | \"go\" or G: execute | Esc: cancel"
```
(~2 lines)

#### 5j. Add Phase() convenience getter to SessionService

**File:** `harness/application/session.go`

`SessionService` has `Status()` which returns `StatusData` containing `Phase`, so the App can use `a.sessionService.Status().Phase`. However, since the phase is checked frequently in the new code paths, add a convenience getter:

```go
func (s *SessionService) Phase() string { return s.status.Phase }
```

(1 line)

**Acceptance criteria for Step 5:**
- `/team <goal>` shows decomposition table instead of immediately executing
- Typing "go" (case-insensitive) during review commits tasks and starts execution
- Typing "cancel" (case-insensitive) during review returns to idle
- Pressing Esc during review returns to idle
- Pressing [G] during review approves and starts execution
- Any other text input during review triggers re-decomposition with that text as feedback
- Status bar shows correct hints during decomposition review
- `/team status` and `/team cancel` still work as before
- Normal chat input works when NOT in decomposition review
- [G] keybinding does NOT interfere with normal typing when not in review

---

### Step 6: Tests

**Files:** `harness/application/decomposer_test.go`, `harness/application/orchestrator_test.go`

#### 6a. Decomposer tests (`decomposer_test.go`)

- `TestDecomposer_DecomposeWithFeedback_ParsesJSON` -- mock provider returns updated JSON, verify specs reflect feedback context
- `TestDecomposer_DecomposeWithFeedback_ProviderError` -- provider returns error, verify error propagation
- `TestDecomposer_parseDecompositionResponse_Shared` -- verify the extracted parser works for both code paths (covers code fence stripping, category validation, dep validation)

#### 6b. Orchestrator tests (`orchestrator_test.go`)

- `TestOrchestratorService_DecomposeOnly_DoesNotMutateGraph` -- call DecomposeOnly, verify graph is still empty
- `TestOrchestratorService_DecomposeOnly_ReturnsMatchResults` -- verify each spec has a corresponding MatchResult with non-empty AgentType
- `TestOrchestratorService_CommitDecomposition` -- call DecomposeOnly, then CommitDecomposition, verify graph has tasks
- `TestOrchestratorService_DecomposeOnlyWithFeedback` -- mock provider, verify feedback is passed through

**Acceptance criteria:**
- All new tests pass
- All existing tests pass unchanged (run `go test ./...` from harness/)
- No test depends on a real LLM provider (all use mockLLMProvider or dummy)

---

## Risks and Mitigations

### Risk 1: [G] keybinding conflicts with normal typing
**Severity:** Medium
**Mitigation:** Only handle [G] when `Phase() == PhaseDecompositionReview`. In all other phases, the key falls through to the input field. This is the same pattern used for approval keys (y/n/a only active when approval is visible).

### Risk 2: Re-decomposition produces wildly different plans
**Severity:** Low
**Mitigation:** The feedback prompt includes the original goal AND the previous plan as context. The LLM is instructed to make targeted changes based on feedback, not start from scratch. If the user wants a full re-decompose, they can say "start over" or "completely re-decompose".

### Risk 3: Large task tables overflow the chat viewport
**Severity:** Low
**Mitigation:** The existing chat viewport is scrollable (viewport.Model). The decomposition prompt already limits to 3-8 tasks. If needed, truncation can be added later.

### Risk 4: State leak -- decompositionPreview not cleaned up on error paths
**Severity:** Medium
**Mitigation:** Every exit path from decomposition review (go, cancel, Esc, error) must nil out `decompositionPreview` and `decompositionGoal` and reset phase to idle. The plan explicitly covers all four paths in Steps 5f, 5g, 5d (error case).

### Risk 5: SessionService.Phase() getter may not exist
**Severity:** Low
**Mitigation:** Step 5j explicitly calls out checking for this getter and adding it if missing. The session.go file already has `SetPhase`; adding `Phase()` is trivial.

---

## Verification Steps

1. **Unit tests:** `cd harness && go test ./...` -- all existing + new tests pass
2. **Manual smoke test -- happy path:** Launch TUI, run `/team Add a REST API endpoint`, verify table appears in chat, type "go", verify execution starts
3. **Manual smoke test -- refinement:** Run `/team <goal>`, see table, type "remove the documentation task", verify new table appears without it, type "go"
4. **Manual smoke test -- cancel:** Run `/team <goal>`, see table, press Esc, verify return to idle
5. **Manual smoke test -- text cancel:** Run `/team <goal>`, see table, type "cancel", verify return to idle
6. **Manual smoke test -- [G] keybinding:** Run `/team <goal>`, see table, press G, verify execution starts
7. **Manual smoke test -- backward compat:** Run `/team status` and `/team cancel` during execution, verify they work as before
8. **Manual smoke test -- no interference:** When NOT in decomposition review, verify typing "g" or "go" goes to input field normally
9. **Build verification:** `cd harness && go build ./...` -- no compilation errors

---

## Implementation Order Summary

| Step | File(s) | Lines | Depends On |
|------|---------|-------|------------|
| 1a | `application/decomposer.go` | ~60 | -- |
| 1b | `application/orchestrator.go` | ~55 | 1a |
| 2 | `domain/session/status.go` | ~1 | -- |
| 3 | `tui/messages.go` | ~10 | 1b |
| 4 | `tui/chat.go` | ~40 | 1b |
| 5a-5j | `tui/app.go`, `tui/keys.go`, `tui/statusbar.go`, `application/session.go` | ~100 | 1b, 2, 3, 4 |
| 6 | `application/decomposer_test.go`, `application/orchestrator_test.go` | ~80 | 1a, 1b |

**Total:** ~350-450 lines net new code across 7-8 files

---

## Consensus Review: Accepted Improvements

The following improvements were identified by the Architect and confirmed by the Critic during consensus review. **All must be applied during implementation.**

### CRITICAL: Reset graph in CommitDecomposition

`CommitDecomposition` must reset the task graph before adding tasks. Without this, a second `/team` invocation after a prior run fails with duplicate ID errors from `graph.Add()`.

**Fix in `orchestrator.go`:**
```go
func (o *OrchestratorService) CommitDecomposition(preview DecompositionPreview) error {
    o.graph = task.NewTaskGraph() // Reset graph for fresh execution
    return o.AddTasks(preview.Specs)
}
```

### MAJOR 1: [G] keybinding must not intercept normal typing

Do NOT add `GoApprove` to `keyMap` as a global keybinding. Instead, handle [G] approval **inside** the decomposition review input interception block (Step 5f), only when the input field is empty:

```go
// Inside the PhaseDecompositionReview input handler (Step 5f):
if lower == "go" || lower == "g" || lower == "approve" || lower == "run" || lower == "start" {
    // Approve and execute (only matches when user submits these as the full input)
    ...
}
```

This also addresses the spec compliance gap: the spec requires "go", "approve", "run", "start" as approval words. Remove Step 5b (keys.go changes) and Step 5h entirely.

### MAJOR 2: Set blocking phase during async decomposition

In Step 5c, set a blocking phase **before** dispatching the async `DecomposeOnly` call to prevent the user from starting an agent run while decomposition is in flight:

```go
// In /team handler, before returning the tea.Cmd:
a.sessionService.SetPhase(session.PhaseStreaming) // Block input during LLM call
a.statusBar.SetPhase(session.PhaseStreaming)
```

When `teamDecomposePreviewMsg` arrives (Step 5d), transition to `PhaseDecompositionReview`.

### MINOR: Extract shared approval logic

Extract the commit+execute logic (duplicated between "go" text and [G] keybinding) into a private method:

```go
func (a *App) commitDecomposition(preview application.DecompositionPreview) (tea.Model, tea.Cmd) {
    a.decompositionPreview = nil
    a.decompositionGoal = ""
    a.chat.AddUserMessage(shared.NewMessage(shared.RoleSystem,
        fmt.Sprintf("Approved. Adding %d tasks and starting execution...", len(preview.Specs))))
    if err := a.orchestrator.CommitDecomposition(preview); err != nil {
        a.chat.ShowError(err)
        a.sessionService.SetPhase(session.PhaseIdle)
        a.statusBar.SetPhase(session.PhaseIdle)
        return a, nil
    }
    a.sessionService.SetPhase(session.PhaseIdle)
    a.statusBar.SetPhase(session.PhaseIdle)
    return a, a.startTeamCmd()
}
```

### MINOR: Add error recovery hint in refinement failure

When `teamRefineResultMsg` has an error (Step 5e), add a hint after `ShowError`:
```go
a.chat.AddUserMessage(shared.NewMessage(shared.RoleSystem,
    "Refinement failed. Type feedback to try again, 'go' to execute the previous plan, or 'cancel' to abort."))
```

### MINOR: `/team cancel` during review should cancel the review

Add a branch in the `/team cancel` handler to clear decomposition state if in `PhaseDecompositionReview`:
```go
case "cancel":
    if a.sessionService.Phase() == session.PhaseDecompositionReview {
        a.decompositionPreview = nil
        a.decompositionGoal = ""
        a.chat.AddUserMessage(shared.NewMessage(shared.RoleSystem, "Decomposition cancelled."))
        a.sessionService.SetPhase(session.PhaseIdle)
        a.statusBar.SetPhase(session.PhaseIdle)
        return nil, true
    }
    // existing cancel logic...
```

### MINOR: Validate dependency graph during preview

In `DecomposeOnly`, validate the dep graph using a temporary `TaskGraph` so errors surface during preview, not at commit time:
```go
// After matching, validate deps with a temporary graph
tmpGraph := task.NewTaskGraph()
for _, s := range specs {
    t := task.NewTask(s.ID, s.Description, s.Category)
    t.BlockedBy = s.BlockedBy
    if err := tmpGraph.Add(t); err != nil {
        return DecompositionPreview{}, fmt.Errorf("invalid task plan: %w", err)
    }
}
```

---

## ADR (Architecture Decision Record)

- **Decision:** Option A — Phase-based state machine with chat-rendered tables
- **Drivers:** Minimal invasion (reuses existing phase system), fits proven patterns (approval already works this way), adequate for v1 text-only refinement
- **Alternatives considered:** Option B (separate Bubbletea model) — cleaner encapsulation, isolated testability, natural v2 migration path. Invalidated for v1 because structural overhead (new file, delegation plumbing, input focus coordination) does not pay off when refinement is text-only.
- **Why chosen:** Lower risk, fewer moving parts, ~150 fewer lines than Option B. The phase-based approach is a proven pattern in this codebase with 3 existing phases already working correctly.
- **Consequences:** `App.Update()` grows by ~100 lines (4th phase). Future interactive table editing (v2) would require refactoring to Option B.
- **Follow-ups:** (1) Extract `handleDecompositionInput` helper to concentrate scattered phase logic. (2) If v2 adds interactive table editing or dashboard integration, extract a `DecompositionReview` sub-model (Option B). (3) Consider capping refinement iterations (e.g., max 10) to prevent infinite re-decomposition loops.

---

## Changelog

- **v1.0** (2026-03-18): Initial plan created by Planner
- **v1.1** (2026-03-18): Architect review — 1 CRITICAL, 2 MAJOR, 4 MINOR issues identified
- **v1.2** (2026-03-18): Critic review — confirmed all issues, added spec compliance gap (approval words) and `/team cancel` during review
- **v1.3** (2026-03-18): Consensus reached — all improvements merged into plan. Status: APPROVED
