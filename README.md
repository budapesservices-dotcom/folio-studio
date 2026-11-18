# FOLIO Studio

FOLIO Studio is a lightweight-first hybrid visual UI/UX design, prototyping, animation, and visual-to-code workspace.

## Open in GitHub Codespaces

This repository is prepared for Codespaces and includes a first-run bootstrap archive.

1. Open this repository on GitHub.
2. Choose **Code → Codespaces → Create codespace on main**.
3. Let the dev container finish creating. It restores the Stage 1 TypeScript/Preact source tree and installs dependencies automatically.
4. In the Codespaces terminal, start the editor:

```bash
npm run dev
```

5. Open the forwarded **Folio Studio** port (5173) from the Ports panel.

## Save the source tree to GitHub (first run only)

The first Codespace bootstrap extracts the complete source tree into the workspace and removes the temporary encoded archive parts. Commit those restored files once so they become the normal tracked repository contents:

```bash
git add -A
git commit -m "chore: add Folio Studio foundation"
git push origin main
```

After this commit, future Codespaces open the tracked source directly; the bootstrap script will only run `npm install`.

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

Requirements: Node.js 24.11+ (Node.js 26 LTS recommended), npm, and a modern browser.

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173` locally.

See `docs/ARCHITECTURE.md`, `docs/CODESPACES.md`, and `docs/ACCEPTANCE_TESTS.md` for architecture and Stage 1 acceptance criteria.

## Development rule

Build one stage at a time. Do not begin the next engine until the current stage passes its automated and manual acceptance tests.
