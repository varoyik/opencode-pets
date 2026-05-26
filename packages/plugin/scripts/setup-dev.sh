#!/usr/bin/env bash
set -euo pipefail

# setup-dev.sh — Copies overlay build output to the well-known overlay path
# so the plugin can spawn it during local development.
#
# Post-copy it runs bun install to resolve the overlay's dependencies
# (@opencode-pets/core, zod) at the deployed path. Electron is NOT installed —
# it's symlinked from the monorepo to avoid Node.js v24 extract-zip bug
# (Electron issue #51619) and to reuse the already-working binary.

TARGET="$HOME/.opencode-pets/overlay"
OVERLAY_DIR="$(cd "$(dirname "$0")/../../overlay" && pwd)"
MONOREPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

echo "Setting up overlay at $TARGET ..."

mkdir -p "$TARGET"

if [ -d "$OVERLAY_DIR/dist" ]; then
  rm -rf "$TARGET/dist"
  cp -r "$OVERLAY_DIR/dist" "$TARGET/dist"
  echo "  ✓ dist/"
fi

if [ -d "$OVERLAY_DIR/assets" ]; then
  rm -rf "$TARGET/assets"
  cp -r "$OVERLAY_DIR/assets" "$TARGET/assets"
  echo "  ✓ assets/"
fi

# Copy package.json, strip electron (symlinked from monorepo instead),
# replace workspace protocol with file: dep, install
if [ -f "$OVERLAY_DIR/package.json" ]; then
  cp "$OVERLAY_DIR/package.json" "$TARGET/package.json"

  sed -i "s|\"workspace:\*\"|\"file:$MONOREPO_ROOT/packages/core\"|g" "$TARGET/package.json"

  # Strip electron from deps — symlinked from monorepo to avoid Node.js v24
  # extract-zip bug (Electron issue #51619) and ~150MB re-download.
  bun -e "
    const fs = require('fs');
    const p = JSON.parse(fs.readFileSync('$TARGET/package.json', 'utf8'));
    delete p.dependencies.electron;
    fs.writeFileSync('$TARGET/package.json', JSON.stringify(p, null, 2) + '\n');
  "
  echo "  ✓ package.json (stripped electron, workspace → file: dep)"

  echo "Installing overlay dependencies (core + zod only)..."
  (cd "$TARGET" && bun install --production 2>/dev/null || bun install)
  echo "  ✓ dependencies installed"

  # Symlink electron from monorepo — avoids re-download, reuses working binary
  rm -rf "$TARGET/node_modules/electron"
  ln -sf "$OVERLAY_DIR/node_modules/electron" "$TARGET/node_modules/electron"

  # Create .bin/electron symlink so node_modules/.bin/electron resolves
  mkdir -p "$TARGET/node_modules/.bin"
  ln -sf "../electron/dist/electron" "$TARGET/node_modules/.bin/electron"
  echo "  ✓ electron symlinked from monorepo (+ .bin/electron)"
fi

echo "✓ Overlay dev setup complete at $TARGET"
