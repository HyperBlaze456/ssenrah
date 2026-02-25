# Example: TypeScript Agent Harness

This example implements the agent harness in TypeScript using the Anthropic SDK.
Architecture follows [How to Build an Agent](https://ampcode.com/notes/how-to-build-an-agent).

## Project Structure

```
agent/
  agent.ts        — Core agent loop (LLM + tool execution)
  tools.ts        — Filesystem tools: read_file, list_files, edit_file
  types.ts        — Shared TypeScript types
  index.ts        — Barrel export
teams/
  orchestrator.ts — Breaks goals into tasks, synthesizes results
  worker.ts       — Executes a single assigned task autonomously
  team.ts         — Coordinates orchestrator + worker pool
  types.ts        — Team-specific types
  index.ts        — Barrel export
agent-cli.ts      — Interactive REPL for the agent
index.ts          — Demo: single agent + team workflow
```

## Setup

```bash
cd examples
npm install
export ANTHROPIC_API_KEY=your_key_here
```

## Running

```bash
# Interactive agent REPL
npm run agent

# Demo: single agent + team
npm run dev

# Build TypeScript
npm run build

# Run tests
npm test
```

## Architecture

### Single Agent (`agent/agent.ts`)

The `Agent` class implements the conversational loop:

```
user message → Claude API → text | tool_use blocks
                                      ↓
                              execute tools
                                      ↓
                          tool_result → Claude API → ...
                                      ↓
                              end_turn (text only)
```

### Agent Teams (`teams/`)

```
Team.run(goal)
  → OrchestratorAgent.plan(goal)   — Claude decomposes goal → tasks[]
  → WorkerAgent.execute(task)      — parallel, each runs its own Agent loop
  → OrchestratorAgent.summarize()  — synthesizes all results
```

The team pattern maps to the harness philosophy:
- Orchestrator spawns the right number of workers
- Workers run independently and report status
- Failed workers are recorded but don't block the team
- Orchestrator synthesizes a coherent final result
