# FOLIO Studio

FOLIO Studio is a lightweight-first hybrid visual UI/UX design, prototyping, animation, and visual-to-code workspace.

## Development environment

This repository is configured for GitHub Codespaces. Create a Codespace from the `main` branch, then add the FOLIO source package from the project bootstrap archive.

### Bootstrap the source

1. Download **Folio-Studio-Codespaces-v0.1.1.zip** from the project handoff.
2. In the Codespaces Explorer, upload the ZIP into the repository root.
3. In the terminal, run:

```bash
unzip -o Folio-Studio-Codespaces-v0.1.1.zip -d /tmp/folio-import
cp -a /tmp/folio-import/folio-studio/. .
rm Folio-Studio-Codespaces-v0.1.1.zip
```

4. Rebuild the Codespace container using **Codespaces: Rebuild Container** from the Command Palette.
5. Start the editor:

```bash
npm install
npm run check
npm run test
npm run build
npm run dev
```

Open forwarded port **5173** to use Folio Studio.

## Project decisions

- Application: **Folio Studio**
- Native project extension: **.flop**
- Source of truth: versioned JSON AST
- Stack: TypeScript, Vite, Preact, DOM + SVG
- Persistence: IndexedDB
- Output target: HTML, CSS, JavaScript

See `docs/ARCHITECTURE.md` and `docs/CODESPACES.md` after importing the source package.
