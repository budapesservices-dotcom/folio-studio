# FOLIO Studio

FOLIO Studio is a lightweight-first hybrid visual UI/UX design, prototyping, animation, and visual-to-code workspace.

## Product vision and AI working context

FOLIO's product vision and target architecture are documented in [FOLIO Architecture Blueprint](docs/FOLIO_ARCHITECTURE_BLUEPRINT.md). Repository-wide AI agent rules are in [AGENTS.md](AGENTS.md). GitHub Copilot also reads [.github/copilot-instructions.md](.github/copilot-instructions.md).

Before every task, AI agents must read the blueprint, the current [Architecture](docs/ARCHITECTURE.md), and [Acceptance Tests](docs/ACCEPTANCE_TESTS.md). The blueprint defines intended direction; source code, tests, and the current architecture document define what is actually implemented. Planned capabilities must never be described as completed.

## Open in GitHub Codespaces

This repository is prepared for Codespaces and includes a verified first-run source bootstrap.

1. Open this repository on GitHub.
2. Choose **Code → Codespaces → Create codespace on main**.
3. Let the dev container finish creating. It restores the Stage 1 TypeScript/Preact source tree, removes the temporary payload, automatically creates a source commit, and attempts to push that commit to `main`.
4. In the Codespaces terminal, start the editor:

```bash
npm run dev
```

5. Open the forwarded **Folio Studio** port (5173) from the Ports panel.

The automatic source push uses the GitHub credentials available in Codespaces. If GitHub rejects the push because of an authentication or branch conflict, the source remains in the Codespace and the bootstrap prints the recovery command:

```bash
git push origin HEAD:main
```

## Verify the foundation

```bash
npm run check
npm run test
npm run build
```

## Project decisions

- Product: **FOLIO**
- Application: **Folio Studio**
- Repository: `folio-studio`
- Native project extension: **.flop**
- Source of truth: versioned JSON AST
- Stack: TypeScript, Vite, Preact, DOM + SVG
- Persistence: IndexedDB
- Output target: HTML, CSS, JavaScript

## Local development

Requirements: Node.js 26 LTS (or Node.js 24.11+), npm, and a modern browser.

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173` locally.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/FOLIO_ARCHITECTURE_BLUEPRINT.md](docs/FOLIO_ARCHITECTURE_BLUEPRINT.md), [docs/CODESPACES.md](docs/CODESPACES.md), and [docs/ACCEPTANCE_TESTS.md](docs/ACCEPTANCE_TESTS.md) for architecture and Stage 1 acceptance criteria.

## Development rule

Build one stage at a time. Do not begin the next engine until the current stage passes its automated and manual acceptance tests. All AI-assisted changes must follow [AGENTS.md](AGENTS.md).
