# FOLIO Copilot Instructions

Before each task, read:
- `AGENTS.md` at the repository root.
- `docs/FOLIO_ARCHITECTURE_BLUEPRINT.md` for product vision and target architecture.
- `docs/ARCHITECTURE.md` for the current implementation.
- `docs/ACCEPTANCE_TESTS.md` for the current acceptance expectations.
- `docs/specs/NATIVE_AST_V1.md` for the AST contract, `docs/specs/NATIVE_AST_COMPATIBILITY_MIGRATION.md` for legacy compatibility, and `docs/specs/NATIVE_AST_COMPATIBILITY_API.md` for AST facade implementation tasks.

Treat these as mandatory project context, not optional background reading.

The blueprint is authoritative for agreed product intent. Source code, tests, and the current architecture document are authoritative for what exists today. Never present a proposal as implemented or an implementation as verified without evidence.

Preserve the FOLIO principles: Native Engine First, one Unified Project Model, independent but interoperable Designer and Developer workspaces, stable native AST identity, explicit code mapping, preservation of custom/unmapped code, versioned `.flop` compatibility, and validated native commands.

Do not create a separate source of truth for a workspace. Do not bypass FOLIO contracts for project mutations. Do not silently discard custom code, component overrides, IDs, or project data. Treat long-term roadmap items as planned until implemented and verified.

Before editing, inspect relevant source files, tests, branch state, and existing changes. Keep changes scoped to the authorized milestone. Add/update tests and run relevant checks. Report exact paths changed and checks actually executed. User-facing UI labels, tooltips, errors, and notifications must be in English.

For detailed requirements and status rules, follow `AGENTS.md`.