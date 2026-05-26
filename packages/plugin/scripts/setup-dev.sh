#!/usr/bin/env bash
set -euo pipefail

# setup-dev.sh — Copies overlay build output to the well-known overlay path
# so the plugin can spawn it during local development.
#
# Post-copy it runs bun install to resolve the overlay's dependencies
# (@opencode-pets/core, zod) at the deployed path so Electron's Node.js
# runtime can find them.

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

# Copy package.json, replace workspace protocol with file: dep, install
if [ -f "$OVERLAY_DIR/package.json" ]; then
  cp "$OVERLAY_DIR/package.json" "$TARGET/package.json"
  sed -i "s|\"workspace:\*\"|\"file:$MONOREPO_ROOT/packages/core\"|g" "$TARGET/package.json"
  echo "  ✓ package.json (workspace → file: dep)"

  echo "Installing overlay dependencies..."
  (cd "$TARGET" && bun install --production 2>/dev/null || bun install)
  echo "  ✓ dependencies installed"
fi

echo "✓ Overlay dev setup complete at $TARGET"
