# Deep Interview Spec: Team Mode Transparency & Interactive Decomposition

## Metadata
- Interview ID: di-team-mode-improvements
- Rounds: 9
- Final Ambiguity Score: 14.8%
- Type: brownfield
- Generated: 2026-03-18
- Threshold: 20%
- Status: PASSED

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.95 | 35% | 0.333 |
| Constraint Clarity | 0.75 | 25% | 0.188 |
| Success Criteria | 0.85 | 25% | 0.213 |
| Context Clarity | 0.80 | 15% | 0.120 |
| **Total Clarity** | | | **0.853** |
| **Ambiguity** | | | **14.8%** |

## Goal

Replace the opaque, fire-and-forget `/team <goal>` command with an **interactive conversational decomposition flow** where the user sees the proposed task plan, refines it through natural language chat, and explicitly approves before execution begins. This is **v1** of a 3-phase improvement roadmap.

## Phased Roadmap

| Phase | Feature | Scope |
|-------|---------|-------|
| **v1 (this spec)** | Conversational decomposition + approval | TUI harness |
| v2 (future) | Transparent live dashboard (split-screen, tiered detail, match reasoning, deps, worker status) | TUI harness |
| v3 (future) | Mid-execution interactive control (cancel/reassign/add tasks during run) | TUI harness |
| v4 (future) | Full debug view with tool traces, text streaming per worker | GUI app (`app/`) |

## v1 Feature: Conversational Decomposition

### Flow

```
User types: /team refactor the auth module
    |
    v
1. Decomposer calls LLM -> returns task plan (JSON)
    |
    v
2. TUI displays structured task table in chat area:
    ┌──────────────────────────────────────────────────────┐
    │ Decomposition Plan (3 tasks):                        │
    │                                                      │
    │   ID            Category   Agent      Deps           │
    │   explore-auth  explore    explorer   (none)         │
    │   refactor-jwt  implement  coder      explore-auth   │
    │   verify-auth   verify     verifier   refactor-jwt   │
    │                                                      │
    │ Does this look right? Type feedback or press [G] go  │
    └──────────────────────────────────────────────────────┘
    |
    v
3. User enters chat-based refinement loop:
    > "split refactor-jwt into backend and frontend tasks"
    |
    v
4. LLM re-decomposes with user feedback as context -> updated plan shown
    |
    v
5. User approves: types "go" or presses [G] keybinding
    |
    v
6. Orchestrator.AddTasks() + Run() executes the approved plan
```

### Refinement Capabilities (all chat-based, LLM-interpreted)

| Edit Type | Example User Input |
|-----------|--------------------|
| Add/remove tasks | "Add a testing task" / "Remove explore, I already know the codebase" |
| Reassign agent types | "Use coder instead of explorer for the first task" |
| Edit dependencies | "Make backend and frontend run in parallel" / "Verify should depend on both" |
| Re-decompose entirely | "This is wrong, break it down with more focus on testing" |

The LLM receives the current plan + user feedback and generates a new plan. The table is re-rendered after each refinement. No manual table editing UI — all changes flow through natural language.

### Approval Mechanism

- **Approve:** User types "go", "approve", "run", "start" OR presses `[G]` keybinding
- **Cancel:** User types "cancel" or presses `[Esc]`
- **Refine:** Any other input is treated as refinement feedback, sent to LLM with current plan

### UI Layout During Decomposition

The task table renders as a system message in the chat area (not a separate panel). The chat input remains active for refinement. The sidebar continues showing model/token info as usual.

After approval and execution begins, the current sidebar team panel updates with task status (existing behavior). The v2 dashboard improvements are out of scope for v1.

## Constraints

- **TUI-only**: All changes in `harness/` Go code. No GUI (`app/`) changes.
- **v1 scope**: Conversational decomposition + approval only. Dashboard and live control are future phases.
- **Chat-based refinement**: No manual table editing widget. LLM interprets natural language edits.
- **Existing architecture**: Build on existing `Decomposer`, `OrchestratorService`, `AgentMatcher`, and TUI `App` components.
- **Backwards compatible**: `/team status` and `/team cancel` continue to work unchanged.

## Non-Goals

- Full tool call traces per worker (deferred to GUI, v4)
- Split-screen subagent dashboard (v2)
- Mid-execution task reassignment/cancellation of individual workers (v3)
- Manual table editing widgets (all refinement is chat-based)
- Changes to the GUI Tauri app under `app/`

## Acceptance Criteria

- [ ] `/team <goal>` decomposes the goal and displays a structured task table in the chat area showing: task ID, description, category, assigned agent type, and dependencies
- [ ] After displaying the plan, the harness enters a refinement loop where the user's chat input is interpreted as plan feedback (not sent to the normal agent loop)
- [ ] User can add/remove tasks, reassign agent types, edit dependencies, or request full re-decomposition via natural language — LLM regenerates the plan and the table re-renders
- [ ] User approves the plan by typing "go" (or similar) or pressing a keybinding `[G]`, which triggers `OrchestratorService.AddTasks()` + `Run()`
- [ ] User can cancel decomposition by pressing `[Esc]` or typing "cancel", returning to normal chat mode
- [ ] Agent type matching reasoning is shown in the table (e.g., "explorer (category, 0.9)")
- [ ] Task dependencies are displayed as a readable chain (e.g., "blocked by: explore-auth")
- [ ] The refinement loop re-calls the Decomposer (or a refinement variant) with the user's feedback appended to the conversation context
- [ ] Existing `/team status` and `/team cancel` commands continue to work during execution
- [ ] All existing tests pass (`go test ./... -short`)
- [ ] New tests cover: decomposition display, refinement loop, approval trigger, cancel behavior

## Assumptions Exposed & Resolved

| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| Users want to see everything at once | Contrarian: "What if less is more?" | Tiered/expandable — clean overview with drill-down (applies to v2 dashboard) |
| Full lifecycle visibility is v1 | Simplifier: "Which single capability first?" | v1 = conversational decomposition only; dashboard and control are v2/v3 |
| Refinement needs structured UI | User clarified | Chat-based natural language only; LLM interprets and re-generates |
| Full tool traces belong in TUI | User clarified | Deferred to GUI app (v4); TUI shows summary-level info only |

## Technical Context

### Key Files to Modify

| File | Change |
|------|--------|
| `harness/tui/app.go` | Modify `/team` handler: add decomposition display state, refinement loop, approval keybinding |
| `harness/tui/messages.go` | Add new message types for decomposition display, refinement, approval |
| `harness/application/decomposer.go` | Add refinement variant: `DecomposeWithFeedback(ctx, goal, currentPlan, feedback)` |
| `harness/application/orchestrator.go` | Add `DecomposeOnly(ctx, goal)` that returns specs without adding to graph |
| `harness/tui/chat.go` | Add `AddDecompositionTable()` method for rendering structured task tables |
| `harness/application/matcher.go` | Expose match reasoning (source + confidence) in `MatchResult` — already exists, just needs to flow to TUI |

### Existing Components Leveraged

- **Decomposer**: Already parses LLM JSON into `TaskSpec[]`. Extend with feedback context.
- **AgentMatcher**: Already computes `MatchResult` with `Source` and `Confidence`. Surface to TUI.
- **App.handleSlashCommand**: Already dispatches `/team`. Extend with decomposition state machine.
- **Chat.AddUserMessage**: Already renders system messages. Add table formatting variant.
- **Approval modal pattern**: Existing `approval.go` shows keybinding-driven approval. Reuse pattern.

### State Machine for `/team` Command

```
Idle
  |
  | /team <goal>
  v
Decomposing (LLM call in progress)
  |
  | LLM returns plan
  v
Reviewing (table displayed, chat input = refinement)
  |
  +-- user types feedback --> Refining (re-decompose) --> Reviewing
  |
  +-- user types "go" / presses [G] --> Executing (AddTasks + Run)
  |
  +-- user presses [Esc] / "cancel" --> Idle
```

## Interview Transcript

<details>
<summary>Full Q&A (9 rounds)</summary>

### Round 1
**Q:** When you say team mode is 'too opaque', which moment during execution frustrates you the most?
**A:** All of the above equally — the entire pipeline from goal input to completion is opaque.
**Ambiguity:** 78.5% (Goal: 0.3, Constraints: 0.1, Criteria: 0.1, Context: 0.4)

### Round 2
**Q:** (Rejected — user clarified) Where should orchestrator decisions and worker activity appear?
**A:** Dedicated area to view subagents. Not full tool traces (that's for GUI later). Summary level for TUI.

### Round 3
**Q:** For the dedicated subagent view in the TUI, what information per worker would be most valuable?
**A:** All four: current phase/action, agent match reasoning, task dependency context, completion summary. Each in its own clean section.
**Ambiguity:** 59.0% → 46.5%

### Round 4
**Q:** TUI layout — replace chat, split screen, or overlay?
**A:** Split screen with chat. Subagent window should show multiple agents running in parallel.
**Ambiguity:** 46.5%

### Round 5 (Contrarian Mode)
**Q:** Showing everything risks noise. Would you accept tiered/expandable?
**A:** Yes, tiered/expandable — clean overview by default, drill into details on demand.
**Ambiguity:** 29.2%

### Round 6
**Q:** Beyond viewing, do you want to change how the orchestrator decides?
**A:** Full interactive control. Decomposition should ask first, like deep-interview skill.
**Ambiguity:** 41.5% (went up — scope expanded)

### Round 7 (Simplifier Mode)
**Q:** If you could only ship ONE capability first?
**A:** Priority order: 1) conversational decomposition, 2) live dashboard, 3) mid-execution control.
**Ambiguity:** 28.5%

### Round 8
**Q:** How should the approval conversation work?
**A:** Hybrid: structured table shown first, then chat-based refinement, keybinding to approve. Mainly chat-based.
**Ambiguity:** 21.0%

### Round 9
**Q:** What kinds of edits should be supported during refinement?
**A:** All four: add/remove tasks, reassign agents, edit deps, re-decompose entirely. All via chat.
**Ambiguity:** 14.8% — PASSED

</details>
