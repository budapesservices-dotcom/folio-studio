#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(pwd)"

# The repository is seeded with a split, text-safe archive so Codespaces can
# bootstrap the full project on first creation without a separate local upload.
if [ ! -f "$ROOT_DIR/package.json" ]; then
  echo "[FOLIO] Restoring the Stage 1 source tree..."
  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TMP_DIR"' EXIT

  cat "$ROOT_DIR"/.devcontainer/source-*.b64 | base64 --decode > "$TMP_DIR/folio-studio.tar.xz"
  tar -xJf "$TMP_DIR/folio-studio.tar.xz" -C "$TMP_DIR"
  cp -a "$TMP_DIR/folio-studio/." "$ROOT_DIR/"
  rm -f "$ROOT_DIR"/.devcontainer/source-*.b64
fi

echo "[FOLIO] Installing dependencies..."
npm install
echo "[FOLIO] Bootstrap complete. Run: npm run dev"
