# Overlay MatchTimer

Chrome MV3 extension for Stats Perform / RunningBall match analysts. It injects a drift-aware match clock, HUD timeline, and playback controls over supported stream players, plus a local file player.

**Current build: v2.0.1.** Customize + local player. Kickoff sync disabled. Semver: 2.0.x bugfixes, 2.1.0+ features.

**v2.0.1 highlights:** control panel size M/S + Compact; custom skip seconds (1 to 999) on Shortcuts with panel auto-sort; YouTube-style time bar (scrubber + volume/time/fullscreen chrome); video-visibility guard; CSS isolation under `#omt-root`; runtime-only extension packaging.

Supported surfaces:

- **InplayIP** (`*.inplayip.tv`) - Video.js Review/DVR
- **Examino** (`examino.statsperform.io/play/dvr/*` and `/play/vod/*`) - OpenPlayer
- **Local player** (`chrome-extension://…/player.html`) - offline / NAS files

Xeatre content-script injection remains out of scope until material is provided (stub adapter + legacy HTML URL paste only).

> **Planned (disabled):** team Kickoff sync: always on, zero analyst config, one bundled Supabase project, match key from the page. See `ARCHITECTURE.md` and `supabase/SETUP.md`. Not enabled in this build.

---

## Project structure

| Path | Purpose |
|------|---------|
| `Overlay-chrome-extension/` | Dev tree: runtime files + `src/`, `scripts/`, `design/` |
| `Overlay-chrome-extension/src/` | Content-script **source of truth** (fragments concatenated into `content.js`) |
| `Overlay-chrome-extension/src/sync/` | Kickoff-sync hooks (inert while `sync-feature-flag.js` is false) |
| `Overlay-chrome-extension/sync-feature-flag.js` | Internal gate: `OMT_SYNC_FEATURE_ENABLED` |
| `Overlay-chrome-extension/scripts/build-content.mjs` | Concatenates sources → `content.js` |
| `Overlay-chrome-extension/scripts/generate-icons.mjs` | Regenerates `assets/icon-*.png` (v2 slash + 20:08 badge) |
| `scripts/pack-extension-zip.sh` | Runtime-only zip (`OverlayMatchTimer-extension-v*.zip`) for Load unpacked |
| `scripts/make-release-zip.sh` | Full owner/QA bundle (`OverlayMatchTimer-v*-full.zip`) |
| `supabase/` | SQL migration + planned always-on design notes (do not run from CI) |
| `docs/guideline/GUIDELINE.md` | **Editable** end-user Guideline source |
| `Overlay MatchTimer Guideline.pdf` | Generated Guideline PDF |
| `TESTING-TUESDAY.md` / `.pdf` | Short smoke checklist for a build |
| `store/` | Unlisted Chrome Web Store prep |
| `test/fixtures/` + `test/e2e/` | Local mocks + Playwright harness |
| `ARCHITECTURE.md` | Module map + planned sync design |
| `PERFORMANCE.md` | Perf audit notes (v1.7.2 baseline; v2.0.1 visibility observers) |
| `OverlayMatchTimer.html` | Legacy local companion dashboard |

---

## Install (Developer Mode)

**From the full zip (recommended for analysts):**

1. Extract `OverlayMatchTimer-v2.0.1-full.zip`.
2. Open `chrome://extensions/` → **Developer mode**.
3. **Load unpacked** → select `OverlayMatchTimer-v2.0.1-full/Overlay-chrome-extension/` (runtime files only; no `src/` folder).
4. Or extract the nested `OverlayMatchTimer-extension-v2.0.1.zip` and load that folder.

**From a git checkout (developers):**

1. Load unpacked → select the repo’s `Overlay-chrome-extension/` (includes `src/` for editing; Chrome still loads `content.js`).
2. Open InplayIP Review, Examino DVR/VOD, or popup → **Open local player**.

---

## How to build `content.js`

```bash
node Overlay-chrome-extension/scripts/build-content.mjs
```

Order: `Overlay-chrome-extension/scripts/module-order.json`. Commit regenerated `content.js`.

---

## How to run e2e

```bash
cd test
npm install
npx playwright install chromium
xvfb-run -a npm run test:e2e
```

To test the packaged runtime folder: extract `OverlayMatchTimer-extension-v2.0.1.zip`, then set `OMT_EXT_DIR` to that folder before `npm run test:e2e`.

v2.0.1 asserts Kickoff sync stays off (no Customize sync UI, no sync network). Screenshots: `/opt/cursor/artifacts/` in Cloud Agent. See `PERFORMANCE.md`.

---

## How to bump version and make the zip

1. Bump `manifest.json` and `package.json` versions together.
2. Update `popup.html` footer, `TESTING-TUESDAY.md`, Guideline revision, store copy if needed.
3. `node Overlay-chrome-extension/scripts/build-content.mjs`
4. `python3 scripts/generate-guideline-pdf.py && python3 scripts/generate-testing-tuesday-pdf.py`
5. `./scripts/make-release-zip.sh /opt/cursor/artifacts`  
   Writes `OverlayMatchTimer-vX.Y.Z-full.zip` (docs + runtime extension folder + nested clean extension zip).  
   Extension-only: `./scripts/pack-extension-zip.sh /opt/cursor/artifacts`.

Do not commit secrets. Do not publish/merge unless the owner asks.

---

## Icons & header assets

| Asset | How |
|-------|-----|
| `assets/icon-{16,32,48,128}.png` | v2 slash + 20:08 badge. `node scripts/generate-icons.mjs` (needs `sharp`) |
| Popup logo | `assets/stats-perform-logo-dark.png` |
| Popup 20:08 chip | CSS `.omt-header-clock` (`left: -6px`) |

---

## Updating the Guideline

- **Edit:** `docs/guideline/GUIDELINE.md`
- **PDF:** `python3 scripts/generate-guideline-pdf.py`
- Checklist when a feature changes: update Guideline + TESTING-TUESDAY + screenshots + regenerate both PDFs + include in zip.
- TESTING-TUESDAY = short smoke sheet for a build; Guideline = full how-to.

---

## Keyboard shortcuts (defaults)

| Action | Shortcut |
|--------|----------|
| Play / Pause | `Space` |
| Skip ±2s / ±10s / ±2m | `←`/`→` · Shift · Ctrl |
| Frame ± | `↑` / `↓` |
| Speed − / + / 1× | `Z` / `C` / `X` |
| Mark kick-off / Live / Hide | `K` / `L` / `H` |

Skip amounts follow Customize → Shortcuts (defaults 2 / 10 / 120 seconds). Rebind keys there too.

---

## Store / legal (Unlisted)

See `store/PUBLISHING.md`. Privacy must not claim active cloud sync while the feature flag is off.

---

## Author

Developer: Vasco Oliveira. Designed for professional performance analysis.
