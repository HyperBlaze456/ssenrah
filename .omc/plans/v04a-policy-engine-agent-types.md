# v0.4a — Policy Engine + Agent Types

**Date:** 2026-03-13
**Branch:** `custom_harness`
**Status:** APPROVED — Consensus reached (Architect: APPROVE, Critic: ACCEPT)

---

## RALPLAN-DR Summary

### Principles

1. **Pragmatic Trust** — Remove the human from the loop for low-risk operations. The policy engine classifies risk and auto-approves safe tool calls without user interaction.
2. **Configurable Safety Tiers** — Four default tiers (supervised/balanced/autonomous/yolo) defined in YAML, each specifying per-tool allow/deny/ask rules. Users can add custom tiers.
3. **Composition Over Modification** — Agent type templates are immutable definitions (tools, model, policy, prompt). The orchestrator composes context around them; agents do not self-configure.
4. **Orchestrator Owns Completion** — Workers submit results; the orchestrator verifies before marking done. (Structural principle carried from CLAUDE.md — not directly implemented in v0.4a but respected in design.)
5. **Audit Everything** — Every policy decision (allow, deny, await) is logged through the EventLogger with full context for replay and debugging.

### Decision Drivers (Top 3)

1. **Backward compatibility** — The existing v0.3 agent loop, TUI approval flow, and dummy provider must continue working identically under the default "supervised" policy tier. Zero regressions.
2. **YAML as single source of truth** — Policy tiers and agent types must be YAML-defined (not Go structs compiled in). Runtime behavior changes by editing a config file, not recompiling.
3. **Minimal domain model changes** — The existing `PolicyEngine` interface, `PolicyProfile`, `PolicyDecision`, and `AgentConfig` stubs are extended, not replaced. New code plugs into existing ports.

### Viable Options

#### Option A: Embedded YAML Defaults + File Override (RECOMMENDED)

Policy tiers and agent types ship as Go-embedded YAML (`embed.FS`). Users can override with a `harness.yaml` file on disk. **Full-file replacement semantics**: if `harness.yaml` exists, it replaces all embedded defaults entirely (no deep merge). Users who customize must provide a complete file. A future `--dump-config` flag will let users export defaults as a starting point.

**Pros:**
- Zero-config startup: works out of the box without any YAML file on disk
- Single `harness.yaml` replaces `harness.json` — one config format going forward
- Embedded defaults are testable and version-controlled
- `go:embed` is stdlib, no new dependencies beyond `gopkg.in/yaml.v3`

**Cons:**
- Need to add `gopkg.in/yaml.v3` dependency (small, stable, widely used)
- Migration path: `harness.json` still works but `harness.yaml` takes precedence when both exist
- Users who customize must provide a complete YAML file (no partial overrides)

#### Option B: Pure File-Based YAML (No Embedded Defaults)

All config lives in `harness.yaml` on disk. If missing, the app creates a default one on first run.

**Pros:**
- Simpler loader — just read file, no merge
- User always sees their full config (no hidden defaults)

**Cons:**
- First-run experience requires file creation side effect
- Config file must exist for tests (or tests must create temp files)
- No graceful degradation if file is missing or malformed
- Harder to ship default policy tiers that "just work"

**Why Option B is inferior:** The embedded-defaults approach means `go test ./...` works without any filesystem setup, the binary is self-contained, and users get a working system immediately. Option B adds friction for both developers and users.

---

## Context

### Current State (v0.3)

The agent loop in `application/agent.go` has:
- **Hardcoded `classifyRisk()`** — Maps tool names to string risk levels ("high"/"medium"/"low") with a switch statement (lines 374-383).
- **Session-scoped `alwaysAllow map[string]bool`** — Simple auto-approve tracking per tool name (line 84).
- **`processToolCalls()`** — Checks `alwaysAllow`, if not found sends `EventApprovalNeeded` with a blocking response channel (lines 297-371).
- **No EventLogger** — Events go to the TUI channel only; nothing is persisted or structured for audit.
- **No agent types** — Single agent config (model + system prompt) set in `main.go`.

### Existing Domain Stubs

| File | What exists | What needs to change |
|------|-------------|---------------------|
| `domain/policy/models.go` | `PolicyDecision` (Allow/AwaitUser/Deny), `PolicyProfile` (Name, AllowList, DenyList), `RiskLevel` (Low/Med/High) | `PolicyProfile` needs per-tool rules with actions, not just string lists |
| `domain/policy/port.go` | `PolicyEngine` interface with `Evaluate(call, profile) PolicyDecision` | Signature is good. Needs the new `PolicyProfile` to support rules. |
| `domain/event/models.go` | `Event` struct with types (tool_call, tool_result, message, error, policy_eval) | Good as-is. |
| `domain/event/port.go` | `EventLogger` interface with `Log(event) error`, `Flush() error` | Good as-is. |
| `domain/agent/models.go` | `AgentConfig` (Name, Model, SystemPrompt, ToolPacks, MaxTurns) | Needs `PolicyTier` field, YAML tags |

### Config State

- `infrastructure/config/config.go` — `AppConfig` with JSON tags, loaded from `harness.json`
- `infrastructure/config/defaults.go` — Returns `DefaultConfig()` with dummy provider
- No YAML files exist anywhere in the project
- `go.mod` has no YAML dependency

---

## Work Objectives

1. Replace hardcoded `classifyRisk()` with a YAML-driven policy engine
2. Define agent types in YAML with tools, model, policy tier, and system prompt template
3. Implement a concrete `EventLogger` that logs every policy decision
4. Add runtime `/policy` and `/agent` commands for switching tiers and agent types
5. Demonstrate autonomous operation: dummy provider + autonomous tier = zero approval prompts for safe tools
6. Maintain full backward compatibility with existing v0.3 behavior

---

## Guardrails

### Must Have
- YAML config with 4 default policy tiers (supervised, balanced, autonomous, yolo)
- Per-tool rules: each tool maps to allow/deny/ask per tier
- Agent types in YAML: name, model, allowed tools, policy tier, system prompt template
- `PolicyEngine.Evaluate()` replaces `classifyRisk()` + `alwaysAllow`
- `/policy <tier>` slash command for runtime switching
- `/agent <type>` slash command for runtime switching
- `EventLogger` concrete implementation logging policy decisions
- All existing tests pass
- New tests for: policy evaluation, agent type loading, runtime switching, event logging

### Must NOT Have
- DAG orchestrator (deferred to v0.4b)
- Task lifecycle management (deferred to v0.4b)
- Multi-agent coordination (deferred to v0.4b)
- Changes to the LLM provider interface
- Changes to the `tool.Tool` interface
- Breaking changes to the TUI approval UX (supervised tier must still show Y/N/A modal)

---

## Task Flow (Dependency Graph)

```
Wave 0 (First commit — hidden dependency for Wave 1)
  [0.1] Domain model struct changes (PolicyProfile, AgentType) — must land first

Wave 1 (Independent — parallelizable, after Wave 0)
  [1.1] YAML config schema + loader
  [1.2] Policy engine implementation
  [1.3] EventLogger implementation

Wave 2 (Depends on Wave 0+1)
  [2.1] AgentService integration (depends on 0.1, 1.2, 1.3)
  [2.2] Config wiring in main.go + NewApp signature (depends on 1.1, 0.1, 2.1)

Wave 3 (Depends on Wave 2)
  [3.1] TUI slash commands + approval flow update (depends on 2.1)
  [3.2] Dummy provider demo update (depends on 2.1)
  [3.3] Integration tests + manual verification (depends on all)
```

---

## Detailed TODOs

### Wave 1: Domain + Infrastructure Foundation

#### TODO 1.1 — YAML Config Schema + Loader

**Files to create:**
- `infrastructure/config/yaml_config.go` — YAML config types and loader
- `infrastructure/config/defaults.yaml` — Embedded default config (via `go:embed`)
- `infrastructure/config/yaml_config_test.go` — Tests

**Files to modify:**
- `go.mod` — Add `gopkg.in/yaml.v3`
- `infrastructure/config/config.go` — Add `LoadYAMLConfig()`, keep `LoadConfig()` for backward compat

**Key types in `yaml_config.go`:**
```
// HarnessConfig is the top-level YAML config
type HarnessConfig struct {
    App          AppConfig                  `yaml:"app"`
    PolicyTiers  map[string]PolicyTierConfig `yaml:"policy_tiers"`
    AgentTypes   map[string]AgentTypeConfig  `yaml:"agent_types"`
}

// PolicyTierConfig defines a single policy tier
type PolicyTierConfig struct {
    Description  string                     `yaml:"description"`
    DefaultAction string                    `yaml:"default_action"` // "ask", "allow", "deny"
    ToolRules    map[string]ToolRuleConfig  `yaml:"tool_rules"`
}

// ToolRuleConfig defines per-tool policy within a tier
type ToolRuleConfig struct {
    Action string `yaml:"action"` // "allow", "deny", "ask"
    Reason string `yaml:"reason"` // human-readable reason for audit log
}

// AgentTypeConfig defines an agent type template
type AgentTypeConfig struct {
    Description  string   `yaml:"description"`
    Model        string   `yaml:"model"`
    PolicyTier   string   `yaml:"policy_tier"`
    Tools        []string `yaml:"tools"`
    SystemPrompt string   `yaml:"system_prompt"`
    MaxTurns     int      `yaml:"max_turns"`
}
```

**Key functions:**
```
func LoadHarnessConfig(path string) (HarnessConfig, error)
func DefaultHarnessConfig() HarnessConfig  // parses embedded YAML
func (c HarnessConfig) Validate() error     // checks tier references, tool names
```

**`defaults.yaml` content (embedded):**
```yaml
app:
  model: "dummy-v1"
  provider: "dummy"
  theme: "dark"
  sidebar_open: true

policy_tiers:
  supervised:
    description: "All tool calls require explicit user approval"
    default_action: "ask"
    tool_rules: {}
  balanced:
    description: "Safe tools auto-approve, risky tools require approval"
    default_action: "ask"
    tool_rules:
      read_file:
        action: "allow"
        reason: "Read-only file access is safe"
  autonomous:
    description: "Most tools auto-approve, only destructive ops require approval"
    default_action: "allow"
    tool_rules:
      bash:
        action: "ask"
        reason: "Shell commands can have side effects"
  yolo:
    description: "All tools auto-approve without user interaction"
    default_action: "allow"
    tool_rules: {}

agent_types:
  default:
    description: "General-purpose agent with all tools"
    model: "dummy-v1"
    policy_tier: "supervised"
    tools: ["read_file", "write_file", "bash"]
    system_prompt: |
      You are ssenrah, a helpful AI assistant running inside a terminal-based agent harness.
      Respond in markdown format. Use code blocks with language tags for code.
    max_turns: 10
  reader:
    description: "Read-only agent for code analysis"
    model: "dummy-v1"
    policy_tier: "balanced"
    tools: ["read_file"]
    system_prompt: |
      You are ssenrah in read-only mode. You can read files to analyze code but cannot modify anything.
      Respond in markdown format.
    max_turns: 5
```

**Acceptance criteria:**
- [ ] `LoadHarnessConfig("harness.yaml")` parses a valid YAML file into `HarnessConfig`
- [ ] When no file exists, `DefaultHarnessConfig()` returns the embedded defaults with 4 tiers and 2 agent types
- [ ] `Validate()` returns error if an agent type references a nonexistent policy tier
- [ ] `Validate()` returns error if `default_action` is not one of "allow"/"deny"/"ask"
- [ ] Existing `AppConfig` fields are preserved under the `app:` key
- [ ] Tests pass with no YAML file on disk (embedded defaults only)

---

#### TODO 1.2 — Policy Domain Model + Engine

**Files to modify:**
- `domain/policy/models.go` — Expand `PolicyProfile` to support per-tool rules

**Files to create:**
- `domain/policy/engine.go` — Concrete `PolicyEngine` implementation
- `domain/policy/engine_test.go` — Comprehensive tests

**Changes to `models.go`:**

Replace `PolicyProfile` with a richer structure:
```
// ToolRule defines the policy action for a specific tool.
type ToolRule struct {
    Action PolicyDecision
    Reason string
}

// PolicyProfile defines a named set of policy rules.
type PolicyProfile struct {
    Name          string
    Description   string
    DefaultAction PolicyDecision   // what to do for tools not in ToolRules
    ToolRules     map[string]ToolRule // key: tool name
}
```

Remove `AllowList`/`DenyList` (replaced by `ToolRules` map). Keep `RiskLevel` constants (may be used for audit metadata, not for decision-making).

**`engine.go` implementation:**
```
// DefaultPolicyEngine evaluates tool calls against a PolicyProfile.
type DefaultPolicyEngine struct{}

func NewPolicyEngine() *DefaultPolicyEngine { return &DefaultPolicyEngine{} }

// Evaluate checks the profile's ToolRules for the tool name.
// If a rule exists, return its action. Otherwise return DefaultAction.
func (e *DefaultPolicyEngine) Evaluate(call shared.ToolCall, profile PolicyProfile) PolicyDecision {
    if rule, ok := profile.ToolRules[call.ToolName]; ok {
        return rule.Action
    }
    return profile.DefaultAction
}
```

**Acceptance criteria:**
- [ ] `Evaluate()` returns `Allow` for a tool in the allow rules
- [ ] `Evaluate()` returns `Deny` for a tool in the deny rules
- [ ] `Evaluate()` returns `AwaitUser` for a tool with "ask" rule
- [ ] `Evaluate()` returns `DefaultAction` for an unknown tool
- [ ] Profile with `DefaultAction=Allow` and no rules allows everything (yolo tier)
- [ ] Profile with `DefaultAction=AwaitUser` and no rules asks for everything (supervised tier)
- [ ] Satisfies `PolicyEngine` interface (compile-time assertion)

---

#### TODO 1.3 — Agent Type Domain Model

**Files to modify:**
- `domain/agent/models.go` — Add `AgentType` struct, add `PolicyTier` to `AgentConfig`

**Changes:**
```
// AgentType is an immutable template defining an agent's capabilities.
// Loaded from YAML config. Not modified at runtime.
type AgentType struct {
    Name         string
    Description  string
    Model        string
    PolicyTier   string   // references a PolicyProfile by name
    Tools        []string // tool names this agent is allowed to use
    SystemPrompt string
    MaxTurns     int
}
```

Update `AgentConfig` to include `PolicyTier`:
```
type AgentConfig struct {
    Name         string
    Model        string
    SystemPrompt string
    ToolPacks    []string
    PolicyTier   string    // NEW: which policy tier this agent uses
    MaxTurns     int
}
```

**No new test file needed** — these are pure data structures. Validated by config loader tests (1.1) and engine tests (1.2).

**Acceptance criteria:**
- [ ] `AgentType` struct exists with all fields
- [ ] `AgentConfig` has `PolicyTier` field
- [ ] No breaking changes to `RunOptions` or `AgentLoop` interface

---

#### TODO 1.4 — EventLogger Implementation

**Files to create:**
- `infrastructure/logging/event_logger.go` — Concrete `EventLogger`
- `infrastructure/logging/event_logger_test.go` — Tests

**Implementation:**

```
// MemoryEventLogger is an in-memory EventLogger for v0.4a.
// Stores events in a slice. Future versions may persist to file/DB.
type MemoryEventLogger struct {
    mu     sync.RWMutex
    events []event.Event
}

func NewMemoryEventLogger() *MemoryEventLogger

func (l *MemoryEventLogger) Log(ev event.Event) error    // append to slice
func (l *MemoryEventLogger) Flush() error                 // no-op for memory impl
func (l *MemoryEventLogger) Events() []event.Event        // read accessor for tests/TUI
func (l *MemoryEventLogger) EventsByType(t event.EventType) []event.Event
```

**Helper for creating policy events:**
```
// NewPolicyEvent creates an Event for a policy evaluation.
func NewPolicyEvent(toolName string, decision policy.PolicyDecision, tierName string, reason string) event.Event
```

**Acceptance criteria:**
- [ ] `Log()` stores events, `Events()` returns them in order
- [ ] `EventsByType(EventPolicyEval)` filters correctly
- [ ] Thread-safe (concurrent Log + Events calls)
- [ ] Satisfies `event.EventLogger` interface (compile-time assertion)
- [ ] `NewPolicyEvent` produces event with type `EventPolicyEval` and correct data fields

---

### Wave 2: Application Layer Integration

#### TODO 2.1 — AgentService Integration

**Files to modify:**
- `application/agent.go` — Replace hardcoded risk classification with policy engine

**Changes:**

1. **Add fields to `AgentService`:**
```
type AgentService struct {
    // ... existing fields ...
    policyEngine  policy.PolicyEngine   // NEW
    policyProfile policy.PolicyProfile  // NEW: active policy tier
    eventLogger   event.EventLogger     // NEW
    agentType     *agent.AgentType      // NEW: active agent type (nil = legacy mode)
}
```

2. **Update `NewAgentService` signature:**
```
func NewAgentService(
    conv *conversation.Conversation,
    prov provider.LLMProvider,
    reg  *tool.Registry,
    systemPrompt string,
    engine policy.PolicyEngine,        // NEW
    profile policy.PolicyProfile,      // NEW
    logger event.EventLogger,          // NEW
) *AgentService
```

3. **Add runtime switching methods:**
```
func (a *AgentService) SetPolicyProfile(p policy.PolicyProfile)  // also calls ResetApprovals()
func (a *AgentService) ActivePolicyProfile() policy.PolicyProfile
func (a *AgentService) ApplyAgentType(at agent.AgentType, reg *tool.Registry)  // switches model, prompt, policy, filters registry; also calls ResetApprovals()
func (a *AgentService) ActiveAgentType() *agent.AgentType
func (a *AgentService) ResetApprovals()  // clears alwaysAllow map — called on every policy/agent switch
```

**IMPORTANT (Architect/Critic amendment):** `SetPolicyProfile()` and `ApplyAgentType()` must call `ResetApprovals()` to clear the `alwaysAllow` map. Without this, switching from a permissive tier (yolo) to a restrictive tier (supervised) would be silently defeated for previously auto-approved tools.

**IMPORTANT (Concurrency):** These methods are only safe to call when the agent loop is idle (not streaming). The TUI must guard `/policy` and `/agent` commands with `if a.streaming { return }`, matching the existing pattern at `tui/app.go:148`. No mutex is needed — switching is idle-only.

4. **Replace `processToolCalls` approval logic (lines 297-334):**

Old flow:
```
check alwaysAllow -> if not, send EventApprovalNeeded -> block for response
```

New flow:
```
decision := a.policyEngine.Evaluate(tc, a.policyProfile)
a.logPolicyDecision(tc, decision)  // log via EventLogger

switch decision {
case policy.Allow:
    // emit EventToolCall, then execute immediately, no approval needed
case policy.Deny:
    // do NOT emit EventToolCall — skip directly to denial message in conversation
    // emit EventToolResult with denial content
case policy.AwaitUser:
    // emit EventToolCall
    // check alwaysAllow map first
    // if not in alwaysAllow: send EventApprovalNeeded (existing flow)
    // if user says "always allow", that's still session-scoped
}
```

**ApprovalRequest.RiskLevel (Architect/Critic amendment):** After removing `classifyRisk()`, populate `ApprovalRequest.RiskLevel` from the `ToolRule.Reason` field. When the decision is `AwaitUser` and the tool has an explicit rule, use `rule.Reason` (e.g., "Shell commands can have side effects"). When the tool falls through to `DefaultAction`, use "Default policy: requires approval". This preserves the TUI approval modal's risk context display.

5. **Remove `classifyRisk()` function entirely** (lines 374-383).

6. **Keep `alwaysAllow` map** — but only consulted when policy says `AwaitUser`. Cleared on every policy/agent switch via `ResetApprovals()`. The check order becomes:
```
1. Policy engine evaluates -> Allow/Deny/AwaitUser
2. If AwaitUser: check alwaysAllow map
3. If not in alwaysAllow: send EventApprovalNeeded to TUI
4. On policy/agent switch: alwaysAllow is cleared
```

7. **Add `logPolicyDecision` helper:**
```
func (a *AgentService) logPolicyDecision(tc shared.ToolCall, decision policy.PolicyDecision) {
    if a.eventLogger != nil {
        a.eventLogger.Log(logging.NewPolicyEvent(
            tc.ToolName, decision, a.policyProfile.Name, /* reason from rule */
        ))
    }
}
```

**Files to modify:**
- `application/agent_test.go` — Update `NewAgentService` calls to include new params. Add tests for policy-driven behavior.

**New tests to add:**
- `TestAgentService_PolicyAllow_NoApproval` — autonomous tier, safe tool, should NOT emit `EventApprovalNeeded`
- `TestAgentService_PolicyDeny_NeverExecutes` — tool on deny list is never executed, denial message sent
- `TestAgentService_PolicyAsk_ShowsApproval` — supervised tier, tool requires approval (existing behavior preserved)
- `TestAgentService_PolicySwitch_Runtime` — switch from supervised to autonomous between runs (idle-only), verify behavior changes
- `TestAgentService_PolicyDecisionLogged` — verify `EventLogger` receives `EventPolicyEval` for every tool call
- `TestAgentService_PolicySwitch_ClearsAlwaysAllow` — always-allow a tool, switch policy tier, verify alwaysAllow is cleared and tool now requires approval again
- `TestAgentService_PolicyDeny_SkipsEventToolCall` — verify Deny decision does NOT emit EventToolCall (only denial result)

**Acceptance criteria:**
- [ ] All existing 7 tests in `agent_test.go` still pass (with updated constructor)
- [ ] Autonomous tier + `read_file` tool = no `EventApprovalNeeded` emitted
- [ ] Supervised tier preserves exact v0.3 behavior (all tools prompt)
- [ ] Deny decision prevents tool execution and appends denial to conversation
- [ ] Every tool call produces exactly one `EventPolicyEval` log entry
- [ ] `SetPolicyProfile()` changes behavior for subsequent tool calls in same session
- [ ] `ApplyAgentType()` switches model, system prompt, and policy profile atomically

---

#### TODO 2.2 — Config Wiring in main.go

**Files to modify:**
- `main.go` — Load YAML config, wire policy engine, agent types, event logger
- `infrastructure/factory.go` — Add helper to convert YAML config types to domain types

**Changes to `factory.go`:**
```
// BuildPolicyProfiles converts YAML tier configs to domain PolicyProfiles.
func BuildPolicyProfiles(tiers map[string]config.PolicyTierConfig) (map[string]policy.PolicyProfile, error)

// BuildAgentTypes converts YAML agent type configs to domain AgentTypes.
func BuildAgentTypes(types map[string]config.AgentTypeConfig) (map[string]agent.AgentType, error)

// BuildRegistryForAgentType creates a filtered Registry containing only the tools an agent type is allowed to use.
func BuildRegistryForAgentType(at agent.AgentType, fullRegistry *tool.Registry) *tool.Registry
```

**Changes to `main.go`:**
```
1. Load HarnessConfig (YAML) instead of AppConfig (JSON)
   - Try harness.yaml first, fall back to harness.json for backward compat
2. Build policy profiles map from config
3. Build agent types map from config
4. Create MemoryEventLogger
5. Look up default agent type ("default") and its policy tier
6. Pass policy engine + profile + logger to NewAgentService
7. Store profiles map and agent types map on App (for /policy and /agent commands)
```

**Acceptance criteria:**
- [ ] `go build ./...` succeeds
- [ ] App starts with no config file (embedded defaults)
- [ ] App starts with `harness.yaml` (overrides defaults)
- [ ] App starts with legacy `harness.json` (backward compat)
- [ ] Default agent type "default" uses "supervised" policy tier
- [ ] PolicyEngine, EventLogger, and PolicyProfile are wired into AgentService

---

### Wave 3: TUI + Demo + Tests

#### TODO 3.1 — TUI Slash Commands + Approval Flow

**Files to modify:**
- `tui/app.go` — Add `/policy` and `/agent` commands, store profiles/types maps
- `tui/statusbar.go` — Show active policy tier name
- `tui/sidebar.go` — Show active agent type and policy tier

**Changes to `App` struct:**
```
type App struct {
    // ... existing fields ...
    policyProfiles map[string]policy.PolicyProfile  // NEW
    agentTypes     map[string]agent.AgentType        // NEW
    fullRegistry   *tool.Registry                    // NEW: unfiltered registry for agent type switching
}
```

**New slash commands in `handleSlashCommand`:**

`/policy` (no args) — Show current policy tier and list available tiers
`/policy <tier>` — **Guard: `if a.streaming { show error "Cannot switch policy while streaming"; return }`**. Switch to named tier. Validate tier exists. Call `agentService.SetPolicyProfile(profiles[tier])`. Show confirmation in chat.

`/agent` (no args) — Show current agent type and list available types
`/agent <type>` — **Guard: `if a.streaming { show error "Cannot switch agent while streaming"; return }`**. Switch to named type. Validate type exists. Call `agentService.ApplyAgentType(types[type], fullRegistry)`. Update sidebar. Show confirmation in chat.

**Update `/help` command** to include `/policy` and `/agent` in the help text.

**`NewApp` signature change** is coordinated with TODO 2.2 — `main.go` updates happen in the same commit as `NewApp` changes to avoid compile breakage. The new signature accepts profiles map, agent types map, and full registry.

**Acceptance criteria:**
- [ ] `/policy` lists all 4 tiers with descriptions
- [ ] `/policy autonomous` switches tier, shows confirmation
- [ ] `/policy nonexistent` shows error message
- [ ] `/policy` blocked during streaming with user-visible message
- [ ] `/agent` lists all agent types with descriptions
- [ ] `/agent reader` switches agent type, updates sidebar model/prompt info
- [ ] `/agent nonexistent` shows error message
- [ ] `/agent` blocked during streaming with user-visible message
- [ ] `/help` lists `/policy` and `/agent` commands
- [ ] Status bar shows current policy tier name
- [ ] Sidebar shows current agent type name

---

#### TODO 3.2 — Dummy Provider Demo Update

**Files to modify:**
- `infrastructure/dummy/provider.go` — No changes needed (already works with tool calls)

**Verification script (manual):**
1. Start harness with no config file (defaults to supervised tier)
2. Send a message -> dummy provider returns tool calls -> approval modal appears for each -> v0.3 behavior
3. Run `/policy autonomous` -> switch to autonomous tier
4. Send another message -> dummy provider returns tool calls -> `read_file` and `write_file` auto-approve, only `bash` shows approval modal
5. Run `/policy yolo` -> switch to yolo tier
6. Send another message -> all tool calls auto-approve, zero modals
7. Run `/agent reader` -> switch to reader agent type
8. Send message -> only `read_file` available, balanced tier applies

**Acceptance criteria:**
- [ ] Supervised tier: all 3 tool calls show approval modal (identical to v0.3)
- [ ] Autonomous tier: `read_file` and `write_file` auto-approve, `bash` shows modal
- [ ] Yolo tier: all tool calls auto-approve, zero modals
- [ ] Agent type switch changes available tools and policy tier

---

#### TODO 3.3 — Integration Tests

**Files to create:**
- `application/policy_integration_test.go` — End-to-end tests combining policy engine + agent service + event logger

**Tests:**
```
TestIntegration_SupervisedTier_AllToolsAsk
  - Wire supervised profile + dummy provider with tool calls
  - Verify EventApprovalNeeded emitted for every tool call
  - Verify EventPolicyEval logged for every tool call

TestIntegration_AutonomousTier_SafeToolsAutoApprove
  - Wire autonomous profile + dummy provider
  - Verify read_file executes without EventApprovalNeeded
  - Verify bash still triggers EventApprovalNeeded

TestIntegration_YoloTier_ZeroApprovals
  - Wire yolo profile + dummy provider with 3 tool calls
  - Verify zero EventApprovalNeeded events
  - Verify all 3 tools execute

TestIntegration_RuntimeTierSwitch
  - Start with supervised, send message (approvals happen)
  - Switch to autonomous
  - Send another message (safe tools auto-approve)
  - Verify event log shows both tiers

TestIntegration_AgentTypeSwitch
  - Start with default agent type
  - Switch to reader agent type
  - Verify model, system prompt, and policy changed
  - Verify only read_file is in the filtered registry

TestIntegration_EventLoggerCapture
  - Run a full agent loop
  - Verify EventLogger has correct count of policy_eval events
  - Verify each event has tool_name, decision, tier_name in Data map
```

**Acceptance criteria:**
- [ ] All integration tests pass
- [ ] `go test ./...` passes across entire project (including all pre-existing tests)
- [ ] No test relies on a YAML file on disk (uses embedded defaults or in-memory config)

---

## File Impact Summary

### New Files (8)
| File | Wave | Description |
|------|------|-------------|
| `infrastructure/config/yaml_config.go` | 1.1 | YAML config types + loader |
| `infrastructure/config/defaults.yaml` | 1.1 | Embedded default config |
| `infrastructure/config/yaml_config_test.go` | 1.1 | Config loader tests |
| `domain/policy/engine.go` | 1.2 | Concrete PolicyEngine |
| `domain/policy/engine_test.go` | 1.2 | Policy engine tests |
| `infrastructure/logging/event_logger.go` | 1.4 | MemoryEventLogger |
| `infrastructure/logging/event_logger_test.go` | 1.4 | Event logger tests |
| `application/policy_integration_test.go` | 3.3 | Integration tests |

### Modified Files (10)
| File | Wave | Changes |
|------|------|---------|
| `go.mod` (+`go.sum`) | 1.1 | Add `gopkg.in/yaml.v3` |
| `domain/policy/models.go` | 0.1 | Replace AllowList/DenyList with ToolRules map, add ToolRule struct |
| `domain/agent/models.go` | 0.1 | Add AgentType struct, add PolicyTier to AgentConfig |
| `application/agent.go` | 2.1 | Replace classifyRisk with policy engine, add logger, add ResetApprovals(), add switching methods |
| `application/agent_test.go` | 2.1 | Update all 9 constructor calls, add 7 new policy tests |
| `infrastructure/factory.go` | 2.2 | Add profile/type builders, BuildRegistryForAgentType (creates fresh Registry, selectively registers from master) |
| `main.go` | 2.2 | Wire YAML config, policy engine, event logger; retain masterRegistry separate from per-agent-type registry; update NewApp call |
| `tui/app.go` | 3.1 | Add /policy and /agent commands (idle-only guard), update /help, store maps |
| `tui/sidebar.go` | 3.1 | Show active agent type and policy tier names |
| `tui/statusbar.go` | 3.1 | Show active policy tier name |

### Unchanged Files
- All `infrastructure/tools/*.go` (read_file, write_file, bash)
- `infrastructure/dummy/provider.go`
- `infrastructure/openrouter/provider.go`, `infrastructure/codex/provider.go`
- `domain/tool/port.go`, `domain/tool/models.go`, `domain/tool/registry.go`
- `domain/provider/port.go`, `domain/provider/models.go`
- `domain/event/port.go`, `domain/event/models.go`
- `domain/conversation/conversation.go`
- `domain/shared/*.go`
- `application/chat.go`, `application/session.go`
- `tui/chat.go`, `tui/input.go`, `tui/approval.go`, `tui/messages.go`
- `infrastructure/prompt/loader.go`

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Breaking existing tests when changing `NewAgentService` signature | HIGH | MEDIUM | Update all 9 existing test calls in the same commit as the signature change. Create a helper `newTestAgentService()` to reduce future churn. |
| YAML parsing edge cases (empty tiers, missing fields) | MEDIUM | LOW | `Validate()` method catches malformed config at startup. Tests cover edge cases. Default values for missing optional fields. |
| `alwaysAllow` persists across policy switches (security) | HIGH | HIGH | `ResetApprovals()` called inside `SetPolicyProfile()` and `ApplyAgentType()`. Test: `TestAgentService_PolicySwitch_ClearsAlwaysAllow`. |
| Concurrent access during policy/agent switch | MEDIUM | HIGH | **Idle-only switching**: TUI blocks `/policy` and `/agent` during streaming with `if a.streaming` guard (matches existing pattern). No mutex needed. |
| `ApprovalRequest.RiskLevel` orphaned after classifyRisk removal | HIGH | LOW | Populate from `ToolRule.Reason` for explicit rules, or "Default policy: requires approval" for DefaultAction fallthrough. |
| `go:embed` path issues across platforms | LOW | MEDIUM | Use relative embed path `defaults.yaml` in same package. Tested in CI. |
| Circular import between `infrastructure/logging` and `domain/policy` | LOW | HIGH | `NewPolicyEvent` helper lives in `infrastructure/logging`, imports `domain/policy` and `domain/event`. Domain packages never import infrastructure. Direction: infra -> domain only. |

---

## Success Criteria

- [ ] `go build ./...` passes
- [ ] `go test ./...` passes (all existing + all new tests)
- [ ] Default startup (no config file) behaves identically to v0.3 (supervised tier)
- [ ] `/policy autonomous` + send message = `read_file`/`write_file` auto-approve
- [ ] `/policy yolo` + send message = zero approval prompts
- [ ] `/agent reader` switches to read-only agent with balanced tier
- [ ] EventLogger contains `policy_eval` events for every tool call in a session
- [ ] No changes to LLM provider or tool interfaces

---

## ADR: Policy Engine Implementation Approach

**Decision:** Embedded YAML defaults with file override (Option A).

**Drivers:**
1. Zero-config startup is essential for developer onboarding and demo scenarios
2. YAML is the accepted format for policy/config in the Go ecosystem
3. Tests must work without filesystem setup

**Alternatives Considered:**
- **Option B (Pure File-Based YAML):** Rejected because it requires file creation side effects on first run and complicates test setup
- **Hardcoded Go structs:** Rejected because it violates the "configurable without recompilation" requirement
- **JSON config extension:** Rejected because YAML is more readable for nested policy rules and supports comments

**Why Chosen:** Option A provides the best balance of zero-config convenience, test ergonomics, and user configurability. The `go:embed` approach is stdlib and adds no complexity. The single new dependency (`gopkg.in/yaml.v3`) is stable and ubiquitous.

**Consequences:**
- Must maintain `defaults.yaml` in sync with Go types
- Two config formats coexist temporarily (JSON legacy + YAML primary)
- Future versions should deprecate `harness.json`

**Follow-ups:**
- v0.4b: Deprecation warning when `harness.json` is detected
- v0.4b: DAG orchestrator reads agent types from the same config
- Future: File-watcher for hot-reload of `harness.yaml` without restart
