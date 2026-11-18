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

  # Remove temporary bootstrap files before creating the permanent source commit.
  rm -rf "$ROOT_DIR/.devcontainer/payload"
  rm -f "$ROOT_DIR"/.devcontainer/source-*.b64
  rm -f "$ROOT_DIR/.devcontainer/bootstrap.sh"

  # Materialize the source tree as normal tracked files on the repository's main branch.
  if git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "$ROOT_DIR" add -A
    if ! git -C "$ROOT_DIR" diff --cached --quiet; then
      if ! git -C "$ROOT_DIR" config user.name >/dev/null 2>&1; then
        git -C "$ROOT_DIR" config user.name "FOLIO Bootstrap"
      fi
      if ! git -C "$ROOT_DIR" config user.email >/dev/null 2>&1; then
        git -C "$ROOT_DIR" config user.email "folio-bootstrap@users.noreply.github.com"
      fi
      git -C "$ROOT_DIR" commit -m "chore: materialize Folio Studio foundation"
      if git -C "$ROOT_DIR" push origin HEAD:main; then
        echo "[FOLIO] Foundation source committed and pushed to GitHub main."
      else
        echo "[FOLIO] Automatic push was rejected. Source is safe in this Codespace."
        echo "[FOLIO] After resolving the branch/authentication issue, run: git push origin HEAD:main"
      fi
    fi
  fi
fi

echo "[FOLIO] Installing dependencies..."
npm install
echo "[FOLIO] Bootstrap complete. Run: npm run dev"
