#!/usr/bin/env bash
# Build OverlayMatchTimer-extension-vX.Y.Z.zip with runtime files only.
# Sources (src/, scripts/, design/, package.json, vendor/) stay in the repo
# but are excluded from the packaged zip that analysts load unpacked.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

EXT_DIR="$ROOT/Overlay-chrome-extension"
VERSION="$(node -p "require('./Overlay-chrome-extension/package.json').version")"
OUT_DIR="${1:-/opt/cursor/artifacts}"
NAME="OverlayMatchTimer-extension-v${VERSION}.zip"
mkdir -p "$OUT_DIR"

# Ensure content.js matches src/ before packaging.
node "$EXT_DIR/scripts/build-content.mjs"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
PKG="$STAGE/extension"
mkdir -p "$PKG"

# Runtime allowlist — only files Chrome loads from manifest / HTML / getURL.
RUNTIME_FILES=(
  manifest.json
  background.js
  bridge.js
  content.js
  content.css
  sync-feature-flag.js
  popup.html
  popup.css
  popup.js
  popup-sync-section.html
  player.html
  player.css
)

for f in "${RUNTIME_FILES[@]}"; do
  if [[ ! -f "$EXT_DIR/$f" ]]; then
    echo "[pack] missing required runtime file: $f" >&2
    exit 1
  fi
  cp -a "$EXT_DIR/$f" "$PKG/$f"
done

mkdir -p "$PKG/assets"
# Icons + popup logo referenced by manifest / popup.html
for f in icon-16.png icon-32.png icon-48.png icon-128.png stats-perform-logo-dark.png; do
  if [[ ! -f "$EXT_DIR/assets/$f" ]]; then
    echo "[pack] missing asset: assets/$f" >&2
    exit 1
  fi
  cp -a "$EXT_DIR/assets/$f" "$PKG/assets/$f"
done

# Guard: refuse to ship known source/dev paths if they appear.
for bad in src scripts design package.json vendor node_modules; do
  if [[ -e "$PKG/$bad" ]]; then
    echo "[pack] refused: $bad must not be in the runtime package" >&2
    exit 1
  fi
done

OUT_ZIP="$OUT_DIR/$NAME"
rm -f "$OUT_ZIP"
(
  cd "$PKG"
  zip -qr "$OUT_ZIP" .
)

echo "Wrote $OUT_ZIP"
echo "--- top-level ---"
unzip -l "$OUT_ZIP" | awk 'NR>3 {print}' | head -40
