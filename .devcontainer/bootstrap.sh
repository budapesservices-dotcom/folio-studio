#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(pwd)"

if [ ! -f "$ROOT_DIR/package.json" ]; then
  echo "[FOLIO] Restoring the verified Stage 1 source tree..."
  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TMP_DIR"' EXIT

  cp "$ROOT_DIR/README.md" "$TMP_DIR/README.md.keep"
  cat "$ROOT_DIR"/.devcontainer/payload/part-*.b64 > "$TMP_DIR/folio-studio.tar.xz.b64"
  base64 --decode "$TMP_DIR/folio-studio.tar.xz.b64" > "$TMP_DIR/folio-studio.tar.xz"
  tar -xJf "$TMP_DIR/folio-studio.tar.xz" -C "$TMP_DIR"
  cp -a "$TMP_DIR/folio-studio/." "$ROOT_DIR/"
  cp "$TMP_DIR/README.md.keep" "$ROOT_DIR/README.md"

  # Remove only temporary bootstrap payload files after a successful extract.
  rm -rf "$ROOT_DIR/.devcontainer/payload"
  rm -f "$ROOT_DIR"/.devcontainer/source-*.b64
  rm -f "$ROOT_DIR/.devcontainer/bootstrap.sh"
fi

echo "[FOLIO] Installing dependencies..."
npm install
echo "[FOLIO] Bootstrap complete. Run: npm run dev"
