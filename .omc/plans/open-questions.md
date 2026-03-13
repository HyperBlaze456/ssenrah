# Open Questions

## p1-tui-harness-v01 - 2026-03-10
- [ ] Should the Go module path be `github.com/ssenrah/harness` or `github.com/hht63/ssenrah/harness`? — Affects all import paths across the project.
- [ ] Config format preference: YAML vs TOML vs JSON? — YAML chosen by default, but user may prefer TOML (more Go-idiomatic) or JSON (consistency with GUI app).
- [ ] Minimum supported terminal size: 80x24 assumed. — Below this, a "terminal too small" message displays instead of the TUI. Confirm this is acceptable.
- [ ] Should `glamour` markdown style be auto-detected from terminal background (dark/light) or hardcoded to dark? — Glamour supports auto-detection but it can be unreliable on some terminals.
- [ ] Multi-line input: should Enter send and Shift+Enter add newline, or the reverse? — Interview spec says Enter sends, but multi-line prompts are common in agent workflows.
- [ ] Should the dummy provider responses be deterministic (same canned responses) or randomly selected? — Affects testability vs demo variety.
- [ ] `domain/provider/models.go` references `conversation.StreamChunk` and `tool.ToolCall` — this creates cross-context imports within domain. Should we use a shared `domain/shared/` package for cross-cutting VOs, or duplicate the types? — Affects domain purity.

## v04a-policy-engine-agent-types - 2026-03-13
- [ ] Should `harness.json` be formally deprecated in v0.4a or just coexist silently? — If deprecated, we need a migration warning on startup. If silent, users may not discover the YAML config.
- [ ] Should policy tier switching be allowed mid-stream (while agent loop is running)? — Current plan says it takes effect on the next tool call. An alternative is to reject switching while streaming and show an error.
- [ ] Should the `alwaysAllow` session map persist across agent type switches? — If a user always-allows `read_file` in the default agent, then switches to reader agent, should that carry over? Current plan: yes (session-scoped, not agent-scoped).
- [ ] Should `ApplyAgentType()` rebuild the tool registry (filtering from full registry), or should it just change which tools are sent to the LLM in `buildRequest()`? — Registry filtering is cleaner but means the agent literally cannot call unlisted tools. Request filtering is softer (tool still exists, just not offered to LLM).
- [ ] Event log retention: should `MemoryEventLogger` have a max capacity or grow unbounded for the session? — For v0.4a in-memory is fine, but long sessions could accumulate thousands of events.
