# ssenrah — Agent Harness

## Design Decisions

### Task Completion Ownership
Workers do NOT mark tasks as completed. Workers submit their results, but the **orchestrator** owns task completion. Before marking a task done, the orchestrator must verify the work — typically by spawning a separate verifier/tester agent to validate the output. This ensures quality gating at the orchestration layer.

### Agent Type System
Agent types are predefined schemas (not ad-hoc). Users define agent types with specific tool sets, models, and isolation configs. The orchestrator selects the appropriate agent type per task — agents don't dynamically configure themselves.
