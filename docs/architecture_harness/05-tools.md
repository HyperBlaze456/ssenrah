# Tool System

> `examples/tools/` — Tool packs, registry, spawn, task tools, and vision.

## Files

| File | Purpose |
|------|---------|
| `registry.ts` | `StaticToolRegistry` — pack registration and resolution |
| `manifest.ts` | Tool pack manifest schema and parser |
| `spawn-agent.ts` | Recursive agent spawning tool |
| `task-tools.ts` | Task graph tools with role-based access |
| `toolpack-policy.ts` | Risk profile → policy capability mapping |
| `vision-qa.ts` | Legacy vision tool re-exports |
| `vision/analyze-image.ts` | Image QA analysis via LLM |
| `vision/capture-screenshot.ts` | Platform-native screenshot capture |
| `vision/types.ts` | Vision data models (QAFinding, QAReport) |
| `toolpacks/*.json` | Declarative tool pack manifests |
| `toolpacks/README.md` | Manifest schema documentation |

---

## Tool Pack Architecture

Tools are organized into named **packs** — logical groupings that can be assigned to agent types and resolved at runtime.

```
Agent Type Definition
  └─ toolPacks: ["filesystem", "vision-analysis", "spawn"]

At runtime:
  └─ toolRegistry.resolvePacks(["filesystem", "vision-analysis", "spawn"])
      └─ Returns: [readFileTool, listFilesTool, editFileTool, analyzeImageTool, spawnAgentTool]
```

### Built-in Packs

| Pack | Tools | Risk Profile |
|------|-------|-------------|
| `filesystem` | read_file, list_files, edit_file | standard |
| `screenshot` | capture_screenshot | standard |
| `vision-analysis` | analyze_image_ui_qa | read-only |
| `spawn` | spawn_agent | (dynamic) |
| `tasklist` | list_tasks, get_task, submit_result, create_task, complete_task, reject_task | (dynamic) |

---

## Registry (`registry.ts`)

### StaticToolRegistry

```typescript
class StaticToolRegistry implements ToolRegistry {
  registerPack(name: string, tools: ToolDefinition[]): void;
  resolvePacks(names: string[]): ToolDefinition[];
  listPackNames(): string[];
}
```

- Packs are registered at startup
- `resolvePacks()` flattens multiple packs into a single tool array
- Deduplication by tool name (last registration wins)

### Factory: createDefaultToolRegistry

```typescript
createDefaultToolRegistry(options?: {
  visionProvider?: LLMProvider;
  visionModel?: string;
  spawnDeps?: SpawnAgentToolDeps;
  taskToolsDeps?: TaskToolsDeps;
}): StaticToolRegistry
```

Conditionally registers packs based on available dependencies:
1. **Always**: `filesystem` pack
2. **If vision configured**: `screenshot` + `vision-analysis` packs
3. **If spawn deps**: `spawn` pack
4. **If task deps**: `tasklist` pack

---

## Tool Pack Manifests (`manifest.ts`, `toolpacks/*.json`)

Declarative JSON schema for tool pack metadata:

```json
{
  "schemaVersion": 1,
  "name": "filesystem",
  "description": "Core local file navigation and edits",
  "tools": ["read_file", "list_files", "edit_file"],
  "riskProfile": "standard",
  "tags": ["core", "local"]
}
```

### Risk Profiles

| Profile | Capabilities |
|---------|-------------|
| `read-only` | read, trace |
| `standard` | read, write, trace |
| `privileged` | read, write, exec, network, trace |

### Validation

`parseToolPackManifest()` enforces:
- Required fields: schemaVersion, name, description, tools, riskProfile
- Non-empty strings (trimmed)
- Non-empty tools array
- Valid riskProfile enum
- Deduplicates tool names and tags

---

## Spawn Agent Tool (`spawn-agent.ts`)

Enables recursive agent spawning with safety limits.

### Input Schema

```typescript
{
  agentType: string;    // Name of predefined agent type (required)
  prompt: string;       // Task for subagent (required)
  context?: string;     // Additional context
}
```

### Spawn Safety

```
spawn_agent(agentType, prompt)
  │
  ├─ Validate agent type exists in registry
  │
  ├─ Check spawn depth: currentDepth < maxDepth
  │   └─ Fail if depth exceeded
  │
  ├─ Resolve effective policy:
  │   └─ max(parentPolicy, childPolicy) — child can't be LESS restrictive
  │
  ├─ Resolve child tool packs (exclude "spawn" pack)
  │
  ├─ If child needs "spawn" pack:
  │   └─ Create new spawn tool with depth = currentDepth + 1
  │
  ├─ Create Agent instance with resolved config
  │
  ├─ agent.run(fullPrompt)
  │   └─ Inherits parent AbortSignal
  │
  └─ Return result text
```

### Key Safety Properties

| Property | Mechanism |
|----------|-----------|
| Depth limiting | `currentDepth >= maxDepth` → error |
| Policy escalation | Child inherits parent's policy if more restrictive |
| Signal inheritance | Parent's AbortSignal propagates to children |
| Type enforcement | Agent type must exist in registry |

---

## Task Tools (`task-tools.ts`)

Provides agents with shared task graph access. **Role-gated**: different tools available for orchestrators vs. workers.

### Tool Access Matrix

| Tool | Worker | Orchestrator | Description |
|------|--------|-------------|-------------|
| `list_tasks` | yes | yes | View all tasks with status |
| `get_task` | yes | yes | Get detailed task info |
| `submit_result` | yes | no | Submit work result |
| `create_task` | no | yes | Create new task with deps |
| `complete_task` | no | yes | Mark task as done |
| `reject_task` | no | yes | Reject submission → deferred |

This enforces the ownership model: **workers submit, orchestrators complete**.

---

## Toolpack Policy (`toolpack-policy.ts`)

Maps tool pack risk profiles to the trust/policy system.

```typescript
toExtensionManifestFromToolPack(manifest: ToolPackManifest): ExtensionManifest
```

Converts a manifest's `riskProfile` to required capabilities, then validates against the runtime policy's trust gating.

```typescript
assertToolPackAllowed(pack: ToolPackManifest, policy: RuntimePolicy): void
```

Throws if the tool pack's trust requirements exceed the runtime's trust level.

---

## Vision Tools (`vision/`)

### capture_screenshot (`capture-screenshot.ts`)

Platform-native screenshot capture:

| Platform | Tool | Method |
|----------|------|--------|
| macOS | `screencapture` | `-x` (PNG), `-i` (interactive) |
| Linux | ImageMagick `import` | root window capture |
| Windows | PowerShell | System.Windows.Forms screen capture |

**Input**: `{ outputPath?, mode?, format? }`
**Output**: `{ ok, outputPath, mode, format }`

### analyze_image_ui_qa (`analyze-image.ts`)

LLM-powered UI/UX quality analysis:

1. Read image file as base64
2. Infer MIME type from extension
3. Send image + context to LLM with structured QA prompt
4. Parse JSON response into `QAReport`:

```typescript
interface QAReport {
  imagePath: string;
  findings: QAFinding[];
  summary: string;
  analyzedAt: string;
}

interface QAFinding {
  severity: "critical" | "major" | "minor" | "suggestion";
  category: "layout" | "accessibility" | "consistency" | "ux" | "content";
  description: string;
  location?: string;
  suggestion: string;
}
```

Falls back to free-text summary if JSON parsing fails.

---

## Design Principles

### 1. Pack-Based Organization
Tools aren't registered individually — they're grouped into semantic packs. This enables:
- Role-based tool assignment (agent types specify pack names)
- Policy enforcement at the pack level
- Consistent risk profiling

### 2. Registry as Dependency Injection
The `StaticToolRegistry` acts as a DI container for tools. Agents don't know or care how tools are constructed — they receive resolved `ToolDefinition[]` arrays.

### 3. Declarative Manifests
Tool pack metadata lives in JSON files, separate from implementation. This enables:
- Static analysis of tool configurations
- Policy validation without loading code
- External tooling for manifest generation

### 4. Recursive Spawning with Safety
Agent spawning is depth-limited and policy-escalating. A child agent can never have more permissions than its parent. The spawn tool itself is just another tool in a pack — it can be included or excluded from any agent type.
