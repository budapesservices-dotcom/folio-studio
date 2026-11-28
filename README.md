# Folio Studio

Folio is a lightweight-first visual development studio for interface design, interactive prototypes, and visual-to-code workflows. Its long-term direction connects visual design, behavior, code, and runtime around one native project models.

## Local development

Requirements: Node.js 24.11 or newer in the 24.x line, or Node.js 26.x; npm; and a modern browsers.

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

On Windows, `RUN-FOLIO.bat` checks the supported Node.js range, installs dependencies when needed, and starts the development server.

## GitHub Codespaces.

1. Open the repository on GitHub.
2. Choose **Code → Codespaces → Create codespace on main**.
3. Wait for the dev container setup and dependency installation to finish.
4. Run `npm run dev` in the terminal.
5. Open forwarded port **5173** from the Ports panel.

The dev container installs Node.js 26 and runs `npm install`. It does not create commits or push changes automatically.

See [Codespaces setup](docs/CODESPACES.md) for details.

## Verify changes

```bash
npm run check
npm run test
npm run build
```

## Project identity and architecture

- Product: **Folio Studio**
- Native project extension: **.flop**
- Source of truth: versioned JSON AST and the unified project aggregate
- Stack: TypeScript, Vite, Preact, DOM and SVG
- Local persistence: IndexedDB
- Initial code-generation target: HTML, CSS, and JavaScript

The project blueprint records product intent; [Architecture](docs/ARCHITECTURE.md), source code, tests, and [Acceptance Tests](docs/ACCEPTANCE_TESTS.md) describe current implementation and verification. The [Native AST v1 specification](docs/specs/NATIVE_AST_V1.md), [AST compatibility and migration plan](docs/specs/NATIVE_AST_COMPATIBILITY_MIGRATION.md), and [Native AST compatibility API](docs/specs/NATIVE_AST_COMPATIBILITY_API.md) document the relevant project contracts.

See also [Folio Architecture Blueprint](docs/FOLIO_ARCHITECTURE_BLUEPRINT.md), [Stage 1 acceptance](docs/ACCEPTANCE_TESTS.md), and [Stage 2 canvas acceptance](docs/STAGE_2_ACCEPTANCE.md).

## Development approach

Build in small, measurable vertical slices. Each change should preserve the document model, include focused regression coverage, and pass the relevant type-check, tests, and production build. Future engines are described in the architecture roadmap and should be created when implementation begins—not as empty placeholder directories.
