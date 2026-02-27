# ssenrah GUI — Technical Specification

Navigation hub for all spec documents. Each file is self-contained but cross-references others where relevant.

**Parent document**: [PLAN-GUI.md](../../PLAN-GUI.md) (feature requirements and config domains)

---

## Spec Files

| File | Description |
|------|-------------|
| [ipc.md](ipc.md) | Tauri IPC commands — the contract between React frontend and Rust backend |
| [schemas.md](schemas.md) | TypeScript types and Zod schemas for every Claude Code config structure |
| [file-io.md](file-io.md) | Path resolution, read/write strategies, atomic writes, concurrency |
| [merging.md](merging.md) | Config merging algorithm — scope precedence, per-field semantics, source attribution |
| [state.md](state.md) | Zustand store architecture, store shapes, data flow, derived state |
| [validation.md](validation.md) | Schema validation (Zod), semantic validation, timing, error presentation |
| [errors.md](errors.md) | Error taxonomy, recovery strategies, user-facing messages |
| [platform.md](platform.md) | OS-specific paths, shell detection, Claude Code installation detection |
| [components.md](components.md) | Reusable UI patterns, panel contract, layout system |

---

## Conventions

- **TypeScript types** are the source of truth. Zod schemas are derived from them.
- **IPC command names** use `snake_case` (Tauri convention).
- **Store slices** are named `use<Domain>Store` (Zustand convention).
- **All file writes** use atomic write (temp + rename). No exceptions.
- **Auto-save** uses 500ms debounce from last keystroke.
- **`.claude/` directory** is auto-created on first project-scoped edit if it doesn't exist.
