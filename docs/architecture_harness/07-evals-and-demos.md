# Evaluations, Demos & CLI

> `examples/evals/`, `examples/skills/`, and top-level demo files.

---

## Evaluation System (`evals/`)

### Files

| File | Purpose |
|------|---------|
| `baseline-task-set.ts` | 5 deterministic baseline tasks |
| `scoring.ts` | Keyword-based scoring engine |
| `run-baseline.ts` | CLI runner for baseline evaluations |

### Baseline Tasks

Five regression tasks that test understanding of core concepts:

| Task ID | Topic | Required Keywords |
|---------|-------|-------------------|
| `runtime-phase` | Phase state machine | planning, executing, reconciling, completed, failed |
| `policy-approval` | Approval gates | await_user, approval, policy |
| `intent-gate` | Intent declarations | intent, toolName, riskLevel |
| `fallback` | Error recovery | fallback, retry, alternative |
| `events` | Event logging | JSONL, tool_call, tool_result |

### Scoring

```typescript
scoreBaselineResponses(tasks, responses) → BaselineScoreReport
```

- For each task, counts matched required keywords (case-insensitive)
- Score per task: `(matched / total_required) * weight`
- Report includes total score, max score, normalized score (0–1), and per-task breakdown

### CLI Usage

```bash
npx ts-node evals/run-baseline.ts --responses responses.json
# Output: .omc/evals/baseline-report.json
```

---

## Skill System (`skills/`)

### vision-qa.md

A markdown skill file defining Vision QA behavior:

```
---
name: Vision QA
description: UI testing skill
---

## Instructions
When analyzing screenshots:
1. Capture screenshot if no image provided
2. Analyze with analyze_image_ui_qa tool
3. Return findings grouped by severity
4. Provide actionable fix suggestions with UI locations
```

Skills are loaded via `loadMarkdownSkill()` and injected into agent system prompts via hooks. The YAML frontmatter provides metadata; the markdown body becomes the skill instructions.

---

## Demo: Harness (`demo-harness.ts`)

Full demonstration of the harness safety stack:

1. Creates an agent with filesystem tools
2. Enables **intent gating** — every tool call needs an `<intent>` block
3. Attaches **Beholder** overseer — monitors for loops, rate limits, budget
4. Configures **fallback provider** — retries on tool failure with alternative
5. Runs task: "List files in current directory and summarize"
6. Outputs event log with type summaries and Beholder stats

### What It Demonstrates

- Intent declarations before tool execution
- Policy evaluation per tool call
- Beholder oversight with statistics
- Event logging to JSONL
- Fallback recovery on tool failure

---

## Demo: Vision QA (`demo-vision-qa.ts`)

Vision-based UI/UX quality analysis workflow:

1. Accepts image path + optional context from CLI args
2. Creates provider (vision-capable model preferred)
3. Injects vision QA hook (auto-activates on vision keywords)
4. Runs UI/UX analysis with `analyze_image_ui_qa` tool
5. Returns severity-grouped findings (critical/major/minor/suggestion)

### Usage

```bash
npx ts-node demo-vision-qa.ts ./screenshot.png "login page"
```

---

## Interactive CLI (`agent-cli.ts`)

Sophisticated terminal UI for interactive agent conversations (~1000 lines).

### Features

- **Split-pane layout** with 6 panels rendered in real-time:
  - **Status**: Elapsed time, streaming state, overseer status, token counts, risk alerts
  - **Prompt**: Current user message being processed
  - **Assistant**: Streamed LLM output
  - **Tasks/Intents**: Declared tool purposes and risk levels
  - **Tool Execution**: Tool names, success/error, output length
  - **Event Log**: Event type counts, last errors, Beholder actions

- **Commands**: `/help`, `/stream on|off`, `/layout on|off`, `/panels on|off`, `/pane <name> <weight>`, `/prefs show|reset`, `/clear`, `/exit`

- **Keyboard shortcuts**: Ctrl+L (clear), Ctrl+G (toggle stream), Ctrl+O (toggle layout), Ctrl+B (toggle panels)

- **Preferences**: Persisted to `~/.ssenrah/agent-cli-preferences.json`

- **Beholder integration**: Live overseer monitoring in status panel

### Usage

```bash
npx ts-node agent-cli.ts
# or
npm run agent
```

---

## Test Suite (`tests/`)

30+ test files with comprehensive coverage across all subsystems:

### Coverage Areas

| Area | Test Files |
|------|-----------|
| Agent core | agent.test.ts |
| Harness components | harness.test.ts, guard-order.test.ts |
| Policy | policy-engine.test.ts, policy-audit.test.ts, toolpack-policy.test.ts |
| Phases | runtime-phase.test.ts |
| Checkpoints | checkpoint.test.ts, checkpoints.test.ts |
| Events | event-schema-compat.test.ts, risk-status.test.ts |
| Teams | team-runtime.test.ts, team-graph.test.ts, team-policy.test.ts |
| Task graph | task-graph-mutable.test.ts, task-graph-review.test.ts |
| Messaging | priority-mailbox.test.ts |
| Reconciliation | reconcile-loop.test.ts |
| Retention | retention.test.ts |
| Gates | gates.test.ts, regression-gates.test.ts |
| Tools | tools.test.ts, task-tools.test.ts, toolpack-manifest.test.ts |
| Spawning | spawn-agent.test.ts |
| Providers | providers.test.ts |
| Agent types | agent-type-registry.test.ts |
| Skills | skill-system.test.ts |
| Vision | vision-qa.test.ts |
| Evals | eval-baseline.test.ts |

### Running Tests

```bash
cd examples
npm test
```

Uses Jest with ts-jest for TypeScript execution.
