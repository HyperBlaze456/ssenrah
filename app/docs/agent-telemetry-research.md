# Agent telemetry research report

Date: 2026-04-01
Project: ssenrah / harness / app monitor
Purpose: compactable reference for future telemetry work

## Why this report exists

We want telemetry that helps answer:
- why a run failed
- where time and cost went
- which agent, task, or tool caused the issue

Not just more fields. A usable flight recorder.

## Current local baseline

Today the system already has:
- raw Claude Code hook logging to `~/.ssenrah/events/events.jsonl`
- transcript-derived cost tracking
- transcript-derived reasoning extraction
- anomaly detection from the raw log
- session verification from tool/file/test events
- app monitor panels over the event log

Main current gaps:
- missing newer Claude Code hook fields in the normalized event shape
- flat `AgentEvent` contract, with too much meaning reconstructed ad hoc later
- no shared timeline / agent / task telemetry model
- no first-class causal run reconstruction
- app and harness event schemas can drift

## External references

### 1. Claude Code hooks docs
Source: https://code.claude.com/docs/en/hooks

Most important takeaways:
- hook surface is larger than the current harness type captures
- current docs include richer event-specific payloads, including newer events like `TaskCreated`
- useful fields include session/task/agent lifecycle data, cwd/file/worktree changes, transcript references, and elicitation data

Implication:
- the harness should capture the full current hook contract, not just the older subset
- transcript paths and agent transcript paths should be first-class telemetry references

### 2. AgentFlow
Source: https://github.com/shouc/agentflow

Key idea:
- think in terms of a graph of execution, workers, branching/merging, and shared scratchboard state

Implication for ssenrah:
- telemetry should not stop at flat events
- we should reconstruct lineage across session -> agent -> task -> tool -> outcome
- derived telemetry should make fanout, handoff, and merge behavior visible

### 3. Meta-Harness
Source: https://yoonholee.com/meta-harness/

Key idea:
- keep raw artifacts and traces around for diagnosis instead of compressing them away too early
- source-level evidence matters when debugging agent behavior

Implication for ssenrah:
- JSONL raw log should stay the source of truth
- transcript links, file effects, and raw evidence need to remain accessible
- derived views should summarize, not destroy the raw trace

### 4. OpenTelemetry GenAI semantic conventions
Sources:
- https://opentelemetry.io/docs/specs/semconv/gen-ai/
- https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/

Key ideas:
- use stable operation names
- separate agent/tool/workflow spans conceptually
- capture model/provider/token metadata consistently
- content capture should be explicit and safe, with truncation/redaction policy

Implication for ssenrah:
- use a normalized telemetry layer with operation + phase + actor + resource + severity
- do not force full OTLP export yet, but design a schema that can map there later

## CEO-style review synthesis

Blunt conclusion:
- "capture more fields + add nicer views" is not enough by itself
- the real product is a flight recorder for agent execution

Top user outcomes to optimize for:
1. fast root-cause analysis
2. cost + latency accountability
3. trust in rerunning automation

Mandatory telemetry:
- lineage: session -> agent -> task -> tool -> outcome
- lifecycle timing
- tool attempt model, including failures and retries
- task state transitions
- file and command impact
- cost attribution
- transcript/raw evidence linkage

## Engineering review synthesis

Best near-term shape:
- keep JSONL as source of truth for now
- add a normalized derived telemetry read model on top
- keep app and harness schemas in sync, do not treat that as optional
- avoid immediate storage migration, but design for incremental processing later

Important risks:
- schema drift across harness / CLI / app
- repeated full-file rereads and repeated transcript rescans
- ordering assumptions when deriving timelines or durations

## Recommended v1 implementation direction

### Foundation
- extend normalized event capture to include current Claude Code hook fields
- version the event schema
- preserve raw payloads and add a forward-compatible extras bag

### Derived telemetry model
Add a new telemetry module that derives:
- timeline records
- agent summaries
- task summaries

Use normalized fields such as:
- operation name
- phase/status
- severity
- actor id / actor kind
- resource / artifact reference
- transcript links
- concise summary/detail

### Operator surfaces
Add CLI commands for:
- `timeline`
- `agents`
- `tasks`

These should answer real debugging questions, not just pretty-print logs.

## Deferred for later
- SQLite or indexed storage migration
- full OTLP export pipeline
- richer graph analytics beyond reliable source correlations
- major monitor UI overhaul
- run-to-run comparison and failure explanation commands

## Local code hotspots to change

Harness:
- `../harness/src/types.ts`
- `../harness/src/hook.ts`
- `../harness/src/cli.ts`
- new: `../harness/src/telemetry.ts`
- `../harness/src/index.ts`
- `../harness/tests/*.test.ts`
- `../harness/INSTALL.md`

App contract sync:
- `src/types/index.ts`

## Decision for this implementation pass

Implement now:
- richer hook field capture
- versioned normalized event shape
- derived telemetry module
- timeline/agents/tasks CLI surfaces
- tests + docs
- app-side type sync

Do not implement now:
- database migration
- full UI rewrite
- OTLP exporter

## Review notes from separate agents

### CEO / product review
- current plan is good but too incremental if it stops at field completeness
- telemetry must feel like a forensic tool, not a museum of events
- prioritize causal reconstruction and debugging outcomes

### Engineering review
- shared schema drift is a real risk
- JSONL is fine for now, but derived reads must be structured
- timeline / agents / tasks are the right next operator surfaces

## Working principle going forward

Raw log stays.
Derived telemetry gets smarter.
The product goal is not more logging.
The product goal is faster diagnosis.
