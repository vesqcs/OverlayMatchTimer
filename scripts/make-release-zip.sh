#!/usr/bin/env bash
# Build OverlayMatchTimer-vX.Y.Z.zip for QA / Unlisted upload prep.
# Does not publish. Never includes .env or real Supabase keys.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./Overlay-chrome-extension/package.json').version")"
# Full owner/QA bundle (extension + docs + store + supabase). Not the Store upload zip.
NAME="OverlayMatchTimer-v${VERSION}-full.zip"
OUT_DIR="${1:-/opt/cursor/artifacts}"
mkdir -p "$OUT_DIR"

# Ensure content.js matches src/
node Overlay-chrome-extension/scripts/build-content.mjs

# Refresh PDFs if tools available
python3 scripts/generate-guideline-pdf.py || echo "[zip] guideline PDF skipped"
python3 scripts/generate-testing-tuesday-pdf.py || echo "[zip] testing PDF skipped"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

PKG="$STAGE/OverlayMatchTimer-v${VERSION}"
mkdir -p "$PKG"
# Extension (no node_modules)
mkdir -p "$PKG/Overlay-chrome-extension"
tar -C Overlay-chrome-extension \
  --exclude=node_modules --exclude=.git \
  -cf - . | tar -C "$PKG/Overlay-chrome-extension" -xf -

# Docs useful for the owner package
cp -a README.md TESTING-TUESDAY.md TESTING-TUESDAY.pdf \
  "Overlay MatchTimer Guideline.pdf" ARCHITECTURE.md PERFORMANCE.md \
  "$PKG/" 2>/dev/null || true
cp -a docs supabase store "$PKG/" 2>/dev/null || true

# Safety: strip accidental env / key files
find "$STAGE" -type f \( -name '.env' -o -name '*.pem' -o -name '*service_role*' \) -delete

(
  cd "$STAGE"
  zip -qr "$OUT_DIR/$NAME" "OverlayMatchTimer-v${VERSION}"
)

echo "Wrote $OUT_DIR/$NAME"
unzip -l "$OUT_DIR/$NAME" | head -50
