# Deep Interview Spec: v0.4 — Policy Engine, Agent Types & Multi-Agent Orchestration

## Metadata
- Interview ID: v04-philosophy
- Rounds: 8
- Final Ambiguity Score: 19%
- Type: brownfield
- Generated: 2026-03-12
- Threshold: 20%
- Status: PASSED

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.92 | 0.35 | 0.322 |
| Constraint Clarity | 0.78 | 0.25 | 0.195 |
| Success Criteria | 0.78 | 0.25 | 0.195 |
| Context Clarity | 0.65 | 0.15 | 0.098 |
| **Total Clarity** | | | **0.810** |
| **Ambiguity** | | | **19%** |

## Goal

Build a pragmatic-trust agentic system where the human is removed from the loop as much as possible. The system uses configurable YAML-based policy tiers and immutable agent type templates with orchestrator-driven composition to achieve minimal human intervention while remaining safe. v0.4 is split into two phases: **v0.4a** (Policy Engine + Agent Types — the foundation) and **v0.4b** (DAG-based Multi-Agent Orchestrator + TUI visualization — the payoff).

## Core Philosophy

1. **Pragmatic Trust**: The point of agentic systems is to remove the human from the loop. Low-risk operations (file reads, searches) should never require approval. Users should be able to hand over full permissions if they choose.
2. **Configurable Safety Tiers**: Four default policy profiles defined in YAML, fully customizable by the user. Safety is not imposed — it's chosen.
3. **Composition, Not Modification**: Agent types are immutable YAML templates. The orchestrator composes agents by selecting a base type and layering task-specific context (e.g., injecting relevant file paths, Skills.md prompts). The type itself stays immutable. Dynamic tool allocation is possible but NOT the recommended default.
4. **Orchestrator Owns Completion**: Workers submit results; the orchestrator verifies and marks tasks done (per CLAUDE.md design decision).
5. **DAG-Based Parallel Execution**: The orchestrator constructs a dependency graph of tasks and manages execution order, running independent tasks in parallel.

## Constraints

- **YAML-based configuration**: Policy tiers and agent types are defined in YAML files, user-editable
- **4 default policy tiers**: `supervised`, `balanced`, `autonomous`, `yolo` — shipped as defaults, modifiable by user
- **Immutable agent type templates**: Orchestrator composes by layering context, NOT by mutating type definitions
- **Dynamic tool allocation**: Possible but not default — types define their tool sets, orchestrator uses them as-is unless there's a specific reason to narrow
- **Context injection**: Orchestrator can pass context to agents directly (system prompt injection) or indirectly (commanding the agent to read a file like Skills.md)
- **Runtime switching**: Both policy tiers and agent types must be switchable at runtime via slash commands
- **Backward compatible**: Must work with existing v0.3 agent loop — policy engine replaces the hardcoded `classifyRisk()` and `alwaysAllow` map

## Non-Goals

- v0.4a does NOT include DAG orchestration or parallel multi-agent execution (deferred to v0.4b)
- v0.4a does NOT include TUI DAG visualization (deferred to v0.4b)
- No inter-agent communication protocol in v0.4a — agents don't talk to each other yet
- No persistent agent state across sessions — agents are ephemeral per task

## Acceptance Criteria

### v0.4a — Policy Engine + Agent Types

- [ ] A YAML config defines 4 policy tiers (`supervised`, `balanced`, `autonomous`, `yolo`) with per-tool allow/deny/ask rules
- [ ] Agent types defined in YAML with: name, model, allowed tools list, policy tier, system prompt template
- [ ] The existing agent loop respects the active policy tier — auto-approves, asks user, or denies tool calls based on the profile (replaces hardcoded `classifyRisk`)
- [ ] Switching policy tiers at runtime (e.g., `/policy autonomous`) changes agent behavior immediately
- [ ] Switching agent types at runtime (e.g., `/agent coder`, `/agent reviewer`) changes the tool set, system prompt, model, and policy tier accordingly
- [ ] The dummy provider demo shows an agent running under `autonomous` tier with zero approval prompts for safe tools
- [ ] Every policy decision (allow/deny/ask) is logged via the EventLogger port
- [ ] Tests cover: policy evaluation logic, agent type loading from YAML, runtime switching, event logging of decisions

### v0.4b — DAG Orchestrator + TUI (future, not yet fully specified)

- [ ] Orchestrator decomposes a user task into a DAG of subtasks
- [ ] Independent subtasks execute in parallel via typed agents
- [ ] Dependent subtasks wait for their prerequisites
- [ ] DAG status is visualized in the TUI sidebar
- [ ] Orchestrator verifies agent results before marking tasks complete

## Assumptions Exposed & Resolved

| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| Agent types need dynamic composition | Contrarian: "Why not just rigid pre-defined types?" | Composition, not modification — base types stay immutable, orchestrator layers context on top |
| Trust model should be restrictive (least privilege) | Direct question on philosophy | Pragmatic trust — the goal is removing the human from the loop, not adding friction |
| All v0.4 features must ship together | Simplifier: "What's the simplest valuable version?" | Split into v0.4a (foundation) and v0.4b (orchestration) |
| Policy should have hard safety floors | Direct question on `rm -rf /` scenario | Configurable tiers — the user chooses their safety level, including "yolo" with no restrictions |
| Features are independent modules | Opening question | Co-equal and entangled — they must be designed with awareness of each other |

## Technical Context (Brownfield)

### Existing Domain Ports (stubs ready for implementation)
- `domain/policy/port.go`: `PolicyEngine` interface with `Evaluate(call, profile) PolicyDecision`
- `domain/policy/models.go`: `PolicyDecision` (Allow/AwaitUser/Deny), `PolicyProfile`, `RiskLevel`
- `domain/event/port.go`: `EventLogger` interface with `Log(event)` and `Flush()`
- `domain/event/models.go`: `Event` with types including `EventPolicyEval`
- `domain/agent/port.go`: `AgentLoop` interface (UNSTABLE marker)
- `domain/agent/models.go`: `AgentConfig` with model, tools, isolation fields

### Current Implementation to Replace/Extend
- `application/agent.go`: Hardcoded `classifyRisk()` (bash=high, write_file=medium, else=low) — to be replaced by PolicyEngine
- `application/agent.go`: Session-scoped `alwaysAllow map[string]bool` — to be replaced by policy tier auto-approve rules
- `tui/app.go`: Hardcoded approval flow — to be driven by policy decisions
- `infrastructure/config/config.go`: `AppConfig` — needs extension for policy/agent-type YAML paths
- `harness/main.go`: Wiring — needs PolicyEngine and EventLogger injection

### File Structure for v0.4a (proposed)
```
harness/
  configs/
    policies/
      supervised.yaml
      balanced.yaml
      autonomous.yaml
      yolo.yaml
    agents/
      default.yaml       # base agent type
      coder.yaml
      reviewer.yaml
      searcher.yaml
  domain/
    policy/             # existing stubs — implement
    event/              # existing stubs — implement
    agent/              # existing stubs — extend with type loading
  infrastructure/
    policy/
      engine.go         # PolicyEngine implementation
      loader.go         # YAML policy profile loader
    event/
      logger.go         # EventLogger implementation (file-based or structured)
    agent/
      type_loader.go    # YAML agent type loader
  application/
    agent.go            # Refactor to use PolicyEngine instead of classifyRisk
```

## Ontology (Key Entities)

| Entity | Fields | Relationships |
|--------|--------|---------------|
| PolicyProfile | name, tier, tool_rules (map of tool→allow/deny/ask), default_action | Applied to AgentType, evaluated by PolicyEngine |
| PolicyEngine | profiles (loaded from YAML) | Evaluates ToolCalls against active PolicyProfile |
| AgentType | name, model, tools[], policy_tier, system_prompt, hooks[] | Selected by Orchestrator, composed with context |
| AgentConfig | base_type + context overlays | Runtime instance created by Orchestrator from AgentType |
| EventLogger | log sink (file/structured) | Records all PolicyDecisions and tool executions |
| DAGTask (v0.4b) | id, description, dependencies[], agent_type, status | Managed by Orchestrator, forms dependency graph |
| Orchestrator (v0.4b) | dag, active_agents[], results[] | Decomposes tasks, spawns typed agents, verifies results |

## Interview Transcript
<details>
<summary>Full Q&A (8 rounds)</summary>

### Round 1
**Q:** You said this is 'the crucial feature part where iterative refinement would happen the most.' What specifically makes v0.4 the inflection point?
**A:** They're co-equal and entangled — all v0.4 features are deeply interdependent and can't be designed without the others.
**Ambiguity:** 77% (Goal: 0.30, Constraints: 0.10, Criteria: 0.10, Context: 0.50)

### Round 2
**Q:** What's the core principle for how policy, agent types, and orchestration should work together?
**A:** Pragmatic trust. The point of agentic systems is to remove the human from the loop. Default tools like file reading must not require approval every time. Users should be able to hand over full permissions. Minimal human intervention while still safe.
**Ambiguity:** 63% (Goal: 0.60, Constraints: 0.20, Criteria: 0.15, Context: 0.50)

### Round 3
**Q:** What does 'safe' look like? If a user grants full permissions and an agent runs `rm -rf /`, should the policy engine still block it?
**A:** Configurable safety tiers. 4 default categories with permissions written in YAML, modifiable by user.
**Ambiguity:** 51% (Goal: 0.65, Constraints: 0.55, Criteria: 0.20, Context: 0.50)

### Round 4
**Q:** What IS an agent type — user-defined role templates, orchestrator-composed at runtime, or hybrid?
**A:** Hybrid. Users predefine templates with hooks for different behavior. Orchestrator can modify tools or system prompts (e.g., codebase searcher only gets LSP read + context7-like search).
**Ambiguity:** 44% (Goal: 0.75, Constraints: 0.60, Criteria: 0.25, Context: 0.55)

### Round 5 (Contrarian Mode)
**Q:** If the orchestrator owns everything, why does it need to modify agent configs at runtime? Wouldn't rigid pre-defined types be simpler and safer?
**A:** Composition, not modification. The orchestrator picks a base type and layers context (e.g., Skills.md with code style preferences). Dynamic tool allocation is possible but not recommended as default.
**Ambiguity:** 39% (Goal: 0.82, Constraints: 0.65, Criteria: 0.30, Context: 0.60)

### Round 6
**Q:** What's the ONE demo scenario that proves v0.4 is done?
**A:** Multi-agent parallel orchestrating execution. The main orchestrator makes a DAG task graph and manages order of agent execution. Showing the DAG and status on the sidebar.
**Ambiguity:** 29% (Goal: 0.88, Constraints: 0.65, Criteria: 0.60, Context: 0.60)

### Round 7 (Simplifier Mode)
**Q:** That's a LOT for one version. What's the simplest v0.4 that would still be valuable?
**A:** Split into v0.4a (Policy engine + agent types) and v0.4b (DAG orchestrator + TUI visualization).
**Ambiguity:** 24% (Goal: 0.90, Constraints: 0.75, Criteria: 0.65, Context: 0.65)

### Round 8
**Q:** Are these 5 acceptance criteria for v0.4a correct, or is something missing?
**A:** Missing agent type switching — user should be able to switch agent types at runtime (/agent coder, /agent reviewer) with tool set + prompt changing accordingly.
**Ambiguity:** 19% (Goal: 0.92, Constraints: 0.78, Criteria: 0.78, Context: 0.65)

</details>
