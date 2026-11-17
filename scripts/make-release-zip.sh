#!/usr/bin/env bash
# Build OverlayMatchTimer-vX.Y.Z-full.zip for owner / QA.
# Does not publish. Never includes .env or real Supabase keys.
# Extension folder inside the bundle is runtime-only (same allowlist as pack-extension-zip.sh).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./Overlay-chrome-extension/package.json').version")"
NAME="OverlayMatchTimer-v${VERSION}-full.zip"
PKG_ROOT="OverlayMatchTimer-v${VERSION}-full"
OUT_DIR="${1:-/opt/cursor/artifacts}"
mkdir -p "$OUT_DIR"

# Ensure content.js matches src/
node Overlay-chrome-extension/scripts/build-content.mjs

# Refresh PDFs if tools available
python3 scripts/generate-guideline-pdf.py || echo "[zip] guideline PDF skipped"
python3 scripts/generate-testing-tuesday-pdf.py || echo "[zip] testing PDF skipped"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

PKG="$STAGE/$PKG_ROOT"
mkdir -p "$PKG"

# Extension runtime only (same allowlist as pack-extension-zip.sh)
EXT_STAGE="$(mktemp -d)"
./scripts/pack-extension-zip.sh "$EXT_STAGE"
EXT_ZIP="$EXT_STAGE/OverlayMatchTimer-extension-v${VERSION}.zip"
unzip -q "$EXT_ZIP" -d "$PKG/Overlay-chrome-extension"
# Also keep the clean extension zip at the full-bundle top level
cp -a "$EXT_ZIP" "$PKG/OverlayMatchTimer-extension-v${VERSION}.zip"
rm -rf "$EXT_STAGE"

# Docs useful for the owner package
cp -a README.md TESTING-TUESDAY.md TESTING-TUESDAY.pdf \
  "Overlay MatchTimer Guideline.pdf" ARCHITECTURE.md PERFORMANCE.md \
  "$PKG/" 2>/dev/null || true
cp -a docs supabase store "$PKG/" 2>/dev/null || true

# Safety: strip accidental env / key files
find "$STAGE" -type f \( -name '.env' -o -name '*.pem' -o -name '*service_role*' \) -delete

# Guard: runtime extension folder must not contain source/dev paths
for bad in src scripts design package.json vendor node_modules; do
  if [[ -e "$PKG/Overlay-chrome-extension/$bad" ]]; then
    echo "[zip] refused: Overlay-chrome-extension/$bad must not be in the full bundle" >&2
    exit 1
  fi
done

(
  cd "$STAGE"
  zip -qr "$OUT_DIR/$NAME" "$PKG_ROOT"
)

echo "Wrote $OUT_DIR/$NAME"
unzip -l "$OUT_DIR/$NAME" | head -80
