# Agent Type System

> `examples/agents/` — Predefined agent schemas and registry.

## Files

| File | Purpose |
|------|---------|
| `agent-types.ts` | `AgentType` and `AgentTypeIsolation` interfaces |
| `registry.ts` | `AgentTypeRegistry` — Map-based type store |
| `index.ts` | Barrel exports |

---

## Design Decision

> **Agent types are predefined schemas, not ad-hoc.** Users define agent types with specific tool sets, models, and isolation configs. The orchestrator selects the appropriate agent type per task — agents don't dynamically configure themselves.

This means:
- No runtime type generation
- All agent capabilities declared upfront
- The orchestrator is the only entity that selects which type to use

---

## AgentType Interface

```typescript
interface AgentType {
  name: string;                // Unique identifier (e.g., "researcher", "verifier")
  description: string;         // What this agent type does
  model: string;               // LLM model to use
  systemPrompt?: string;       // Custom system prompt (optional)
  toolPacks?: string[];        // Named tool packs from registry (optional)
  isolation?: AgentTypeIsolation;  // Runtime restrictions
  maxTurns?: number;           // Safety cap on turns (default 10)
  intentRequired?: boolean;    // Require intent declarations (default true)
  policyProfile?: PolicyProfile;   // Governance tier
}
```

## AgentTypeIsolation

```typescript
interface AgentTypeIsolation {
  readOnly?: boolean;         // Restrict to read-only tool packs
  toolPacks?: string[];       // Override the default tool packs
  maxTurns?: number;          // Override the default max turns
  maxDepth?: number;          // Max recursive spawn depth (default 1)
  workspaceRoot?: string;     // Restrict filesystem access (future enforcement)
}
```

---

## AgentTypeRegistry

Simple Map-based registry:

```typescript
class AgentTypeRegistry {
  register(type: AgentType): void;
  get(name: string): AgentType | undefined;
  list(): AgentType[];
  has(name: string): boolean;
}
```

### Usage Pattern

```typescript
// At startup
const registry = new AgentTypeRegistry();
registry.register({
  name: "researcher",
  description: "Reads files and gathers information",
  model: "claude-sonnet-4-20250514",
  systemPrompt: "You are a research agent...",
  toolPacks: ["filesystem"],
  policyProfile: "strict",
  isolation: { readOnly: true }
});

registry.register({
  name: "verifier",
  description: "Validates worker output",
  model: "claude-sonnet-4-20250514",
  systemPrompt: "You verify task completion...",
  toolPacks: ["filesystem"],
  policyProfile: "strict",
  isolation: { readOnly: true, maxTurns: 5 }
});

// At runtime (orchestrator selects type)
const type = registry.get("researcher");
// → spawn agent with this type's config
```

---

## How Types Flow Through the System

```
1. Registry populated at startup
   └─ AgentTypeRegistry.register(type)

2. Team receives registry in config
   └─ TeamConfig.agentTypeRegistry

3. Orchestrator selects type for task
   └─ Based on task requirements

4. Spawn tool resolves type
   └─ spawn_agent({ agentType: "researcher", prompt: "..." })
       └─ Registry lookup → AgentType
       └─ Resolve tool packs → ToolDefinition[]
       └─ Create Agent with type config

5. Verification uses type (optional)
   └─ orchestrator.verify() checks for "verifier" type
       └─ If found → spawn verifier agent
       └─ If not → inline LLM verification
```

---

## Relationship to Other Systems

| System | Interaction |
|--------|------------|
| **Tool Registry** | Agent types reference tool pack names; resolved at spawn time |
| **Policy Engine** | Agent types declare a policyProfile; enforced during execution |
| **Spawn Tool** | Uses registry to look up type definitions |
| **Orchestrator** | Selects types per task; uses "verifier" type for quality gates |
| **Trust Gating** | Isolation config restricts what the agent can access |
