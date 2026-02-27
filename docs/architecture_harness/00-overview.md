# ssenrah — Architecture Overview

## What Is ssenrah?

ssenrah is an **agent harness framework** — a runtime for building, governing, and orchestrating LLM-powered agents. It provides the scaffolding that sits between your LLM provider and the outside world: tool execution, safety layers, multi-agent coordination, and auditability.

## System Map

```
┌─────────────────────────────────────────────────────────────┐
│                        examples/                            │
│                                                             │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌───────────┐  │
│  │  agent/   │  │ providers/ │  │  tools/   │  │  agents/  │  │
│  │ Core loop │  │ LLM layer  │  │ Toolpacks │  │ Type sys  │  │
│  └────┬─────┘  └─────┬─────┘  └─────┬────┘  └─────┬─────┘  │
│       │              │              │              │         │
│       ▼              ▼              ▼              ▼         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                    harness/                           │   │
│  │  intent · policy-engine · beholder · fallback        │   │
│  │  events · checkpoints · runtime-phase · skills       │   │
│  │  risk-status · policy-audit · hooks · components     │   │
│  └──────────────────────────────────────────────────────┘   │
│       │                                                     │
│       ▼                                                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                     teams/                            │   │
│  │  orchestrator · worker · team · task-graph            │   │
│  │  mailbox · priority-mailbox · reconcile · policy      │   │
│  │  events · state · retention · regression-gates        │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌───────────┐  ┌──────────┐  ┌──────────────────────┐     │
│  │   evals/   │  │  skills/  │  │  tests/ (30+ files) │     │
│  └───────────┘  └──────────┘  └──────────────────────┘     │
│                                                             │
│  demo-harness.ts · demo-vision-qa.ts · agent-cli.ts        │
└─────────────────────────────────────────────────────────────┘
```

## Directory Purpose

| Directory | Role |
|-----------|------|
| `agent/` | Core agent loop — provider-agnostic turn execution |
| `providers/` | LLM adapters (Anthropic, Gemini, OpenAI) |
| `harness/` | Safety primitives — intent, policy, oversight, events |
| `teams/` | Multi-agent orchestration with dependency-aware scheduling |
| `tools/` | Tool pack system — manifests, registry, spawn, vision |
| `agents/` | Predefined agent type schemas and registry |
| `evals/` | Baseline evaluation task sets and scoring |
| `skills/` | Markdown-based capability definitions |
| `tests/` | Jest test suite with 30+ test files |

## Layered Architecture

The system is organized in layers, each building on the one below:

```
Layer 4  │ teams/          Multi-agent orchestration
Layer 3  │ harness/        Safety, governance, observability
Layer 2  │ agent/ + tools/ Core execution loop + capabilities
Layer 1  │ providers/      LLM abstraction
```

**Layer 1 — Provider Abstraction**: Unified `LLMProvider` interface with implementations for Anthropic, Gemini, and OpenAI-compatible APIs. All higher layers are provider-agnostic.

**Layer 2 — Core Agent**: The `Agent` class implements the agentic loop (message → LLM → tools → loop). Tools are injected via a registry of named "tool packs."

**Layer 3 — Harness (Safety & Governance)**: Intent declarations, policy engine, behavioral monitoring (Beholder), fallback recovery, checkpoint persistence, and event logging. Each is composable via hooks.

**Layer 4 — Teams (Orchestration)**: Multi-agent coordination with an orchestrator that decomposes goals into dependency-aware task graphs. Workers execute tasks; the orchestrator owns verification and completion.

## Key Data Flows

### Single-Agent Execution
```
User message
  → Agent.run()
    → Pre-run hooks (skill injection, model override)
    → LLM generates response + intent declarations + tool calls
    → Intent validation (block undeclared tools)
    → Policy engine (allow / await_user / deny)
    → Beholder oversight (rate limit, loop detection, budget)
    → Tool execution
    → If failure → Fallback agent (LLM-guided retry)
    → Event logging (JSONL)
    → Loop until done or limit reached
  → Checkpoint persistence
  → TurnResult
```

### Multi-Agent Team Run
```
Goal
  → Orchestrator.plan() → TaskGraph (validated DAG)
  → Execution loop:
      → Claim ready tasks (dependency-sorted)
      → Workers execute in parallel (with timeout + retry)
      → Workers submit results
      → Orchestrator verifies (optional verifier agent)
      → Tasks marked done/failed
      → Cascade failures to blocked tasks
      → Reconcile loop (stale heartbeats, caps, context)
  → Orchestrator.summarize() → final narrative
  → Regression gates (optional MVP validation)
  → TeamResult
```

## Core Design Principles

1. **Provider agnosticism** — Swap LLMs without changing agent logic
2. **Intent before action** — Agents declare purpose before executing tools
3. **Policy-driven governance** — Tiered profiles control what's allowed
4. **Orchestrator owns completion** — Workers submit; orchestrators verify
5. **Predefined agent types** — No ad-hoc self-configuration
6. **Event-driven auditability** — Structured JSONL logs for everything
7. **Composable hooks** — Layer concerns via pre-run hook chains
8. **Deterministic state** — Versioned task graphs with replay validation

## File Count Summary

| Directory | Files | Approx. Lines |
|-----------|-------|---------------|
| `agent/` | 4 | ~900 |
| `providers/` | 5 | ~800 |
| `harness/` | 13 | ~1,400 |
| `teams/` | 14 | ~3,100 |
| `tools/` | 12 | ~1,200 |
| `agents/` | 3 | ~200 |
| `evals/` | 3 | ~200 |
| `tests/` | 30+ | ~4,000+ |
| Top-level | 5 | ~1,500 |
