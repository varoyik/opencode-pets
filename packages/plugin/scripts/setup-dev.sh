#!/usr/bin/env bash
set -euo pipefail

# setup-dev.sh — Copies overlay build output to the well-known overlay path
# so the plugin can spawn it during local development.

TARGET="$HOME/.opencode-pets/overlay"
OVERLAY_DIR="$(cd "$(dirname "$0")/../../overlay" && pwd)"

echo "Setting up overlay at $TARGET ..."

mkdir -p "$TARGET"

if [ -d "$OVERLAY_DIR/dist" ]; then
  rm -rf "$TARGET/dist"
  cp -r "$OVERLAY_DIR/dist" "$TARGET/dist"
  echo "  ✓ dist/"
fi

# Copy assets (spritesheet, pet manifests)
if [ -d "$OVERLAY_DIR/assets" ]; then
  rm -rf "$TARGET/assets"
  cp -r "$OVERLAY_DIR/assets" "$TARGET/assets"
  echo "  ✓ assets/"
fi

# Copy package.json so Electron knows the main entry
if [ -f "$OVERLAY_DIR/package.json" ]; then
  cp "$OVERLAY_DIR/package.json" "$TARGET/package.json"
  echo "  ✓ package.json"
fi

echo "✓ Overlay dev setup complete at $TARGET"
