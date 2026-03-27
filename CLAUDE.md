# ssenrah — Agent Harness

> **[Architecture Reference](ARCHITECTURE.md)** — full specs, core logic, provider system, task lifecycle, policy engine, and all harness features.

## Philosophy

[Documentation](docs/harness_architecutre/initial_philosophy.md)

We are currently working on the MVT v1 scope defined along with gstack's Offic hours, CEO review and Eng review.

On each major feature implementation we would commit our changes.

# ssenrah — Harness Configurer (GUI)

> **[GUI Plan](PLAN-GUI.md)** — features, config domains, tech stack, UI layout, and project structure.
>
> **[Technical Specs](docs/spec_ssenrah_gui/index.md)** — IPC contracts, config schemas, file I/O, merging algorithm, state management, validation, errors, platform behavior, and UI components.

# General guidelines

This guideline is not dependent to the type of a project.

## Versioning

Always commit the changes if a job is done. A task is considered as done when all tests necessary passes. Run linter and basic logic overhaul, then do the tess.

## Code styles

Every code must be self-explanatory. Comments only occure either at the top level or when the logic itself is complicated.