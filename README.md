# Overlay MatchTimer

Chrome MV3 extension for Stats Perform / RunningBall match analysts. It injects a drift-aware match clock, HUD timeline, and playback controls over supported stream players, plus a local file player.

**Current build: v1.7.1** — Customize (clock / shortcuts / ShuttleXpress) and local player. Kickoff sync code exists in the repo but is **disabled** (internal feature flag off; no UI, no network).

Supported surfaces:

- **InplayIP** (`*.inplayip.tv`) — Video.js Review/DVR
- **Examino** (`examino.statsperform.io/play/dvr/*` and `/play/vod/*`) — OpenPlayer
- **Local player** (`chrome-extension://…/player.html`) — offline / NAS files

Xeatre content-script injection remains out of scope until material is provided (stub adapter + legacy HTML URL paste only).

> **Planned (disabled):** team Kickoff sync — always on, zero analyst config, one bundled Supabase project, match key from the page. See `ARCHITECTURE.md` and `supabase/SETUP.md`. Not enabled in this build.

---

## Project structure

| Path | Purpose |
|------|---------|
| `Overlay-chrome-extension/` | Shipped MV3 extension (`manifest.json`, `content.js`, `bridge.js`, `background.js`, `popup.*`, `player.html`, `assets/`) |
| `Overlay-chrome-extension/src/` | Content-script **source of truth** (fragments concatenated into `content.js`) |
| `Overlay-chrome-extension/src/sync/` | Kickoff-sync hooks (inert while `sync-feature-flag.js` is false) |
| `Overlay-chrome-extension/sync-feature-flag.js` | Internal gate: `OMT_SYNC_FEATURE_ENABLED` |
| `Overlay-chrome-extension/scripts/build-content.mjs` | Concatenates sources → `content.js` |
| `Overlay-chrome-extension/scripts/generate-icons.mjs` | Regenerates `assets/icon-*.png` (v2 slash + 20:08 badge) |
| `Overlay-chrome-extension/design/` | Icon / header explorations |
| `supabase/` | SQL migration + planned always-on design notes (do not run from CI) |
| `docs/guideline/GUIDELINE.md` | **Editable** end-user Guideline source |
| `Overlay MatchTimer Guideline.pdf` | Generated Guideline PDF |
| `TESTING-TUESDAY.md` / `.pdf` | Short smoke checklist for a build |
| `store/` | Unlisted Chrome Web Store prep |
| `test/fixtures/` + `test/e2e/` | Local mocks + Playwright harness |
| `scripts/` | PDF generators + `make-release-zip.sh` |
| `ARCHITECTURE.md` | Module map + planned sync design |
| `OverlayMatchTimer.html` | Legacy local companion dashboard |

---

## Install (Developer Mode)

1. Open `chrome://extensions/` → **Developer mode**.
2. **Load unpacked** → select `Overlay-chrome-extension/` (folder with `manifest.json`).
3. Open InplayIP Review, Examino DVR/VOD, or popup → **Open local player**.

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

v1.7.1 asserts **no** Kickoff sync Customize UI and **zero** sync network requests. Screenshots: `/opt/cursor/artifacts/` in Cloud Agent.

---

## How to bump version and make the zip

1. Bump `manifest.json` and `package.json` versions together.
2. Update `popup.html` footer, `TESTING-TUESDAY.md`, Guideline revision, store copy if needed.
3. `node Overlay-chrome-extension/scripts/build-content.mjs`
4. `python3 scripts/generate-guideline-pdf.py && python3 scripts/generate-testing-tuesday-pdf.py`
5. `./scripts/make-release-zip.sh /opt/cursor/artifacts`

Do not commit secrets. Do not publish/merge unless the owner asks.

---

## Icons & header assets

| Asset | How |
|-------|-----|
| `assets/icon-{16,32,48,128}.png` | v2 slash + 20:08 badge — `node scripts/generate-icons.mjs` (needs `sharp`) |
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

Rebind in Customize → Shortcuts.

---

## Store / legal (Unlisted)

See `store/PUBLISHING.md`. Privacy must not claim active cloud sync while the feature flag is off.

---

## Author

Developer: Vasco Oliveira. Designed for professional performance analysis.
