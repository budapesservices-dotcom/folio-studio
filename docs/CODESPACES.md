# GitHub Codespaces Setup

Folio Studio is configured for GitHub Codespaces through `.devcontainer/devcontainer.json`.

## Create the Codespace

1. Open the `folio-studio` repository on GitHub.
2. Select **Code → Codespaces → Create codespace on main**.
3. Wait for the dev container to finish creating. It installs Node.js 26 and runs `npm install`.

## Start the editor

```bash
npm run dev
```

Open the forwarded **Folio Studio** port `5173` from the Ports panel. Keep the terminal session running while using the editor.

## Validate before committing

```bash
npm run check
npm run test
npm run build
```

## Notes

- Vite listens on `0.0.0.0` so the Codespaces port proxy can reach it.
- Vite host validation remains enabled and explicitly permits `.app.github.dev`.
- Port `5173` is private by default. Do not change it to public unless sharing the development server is intentional.
- Browser IndexedDB data belongs to the browser origin. A new Codespace or forwarded URL may use a different origin, so export important work as `.flop` files.
