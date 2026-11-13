# Overlay MatchTimer

Chrome MV3 extension for Stats Perform / RunningBall match analysts. It injects a drift-aware match clock, HUD timeline, and playback controls over supported stream players, plus a local file player.

**Current build: v1.7.0** — Customize (clock / shortcuts / ShuttleXpress), local player, optional **Kickoff sync** via your own Supabase project (**default off**, no network when off).

Supported surfaces:

- **InplayIP** (`*.inplayip.tv`) — Video.js Review/DVR
- **Examino** (`examino.statsperform.io/play/dvr/*` and `/play/vod/*`) — OpenPlayer
- **Local player** (`chrome-extension://…/player.html`) — offline / NAS files

Xeatre content-script injection remains out of scope until material is provided (stub adapter + legacy HTML URL paste only).

---

## Project structure

| Path | Purpose |
|------|---------|
| `Overlay-chrome-extension/` | Shipped MV3 extension (`manifest.json`, `content.js`, `bridge.js`, `background.js`, `popup.*`, `player.html`, `assets/`) |
| `Overlay-chrome-extension/src/` | Content-script **source of truth** (fragments concatenated into `content.js`) |
| `Overlay-chrome-extension/src/sync/` | Isolated kickoff-sync hooks (no-op when disabled) |
| `Overlay-chrome-extension/scripts/build-content.mjs` | Concatenates `src/` → `content.js` using `module-order.json` |
| `Overlay-chrome-extension/scripts/generate-icons.mjs` | Regenerates `assets/icon-*.png` (v2 slash + 20:08 badge) |
| `Overlay-chrome-extension/design/` | Icon / header explorations (not all shipped) |
| `supabase/` | SQL migration + owner setup notes for optional Kickoff sync (**do not run from CI**) |
| `docs/guideline/GUIDELINE.md` | **Editable** end-user Guideline source |
| `docs/guideline/_extract-from-pdf-1.0.0.txt` | Text extract from historical PDF (reference) |
| `Overlay MatchTimer Guideline.pdf` | Generated Guideline PDF |
| `TESTING-TUESDAY.md` / `.pdf` | Short smoke checklist for a build |
| `store/` | Unlisted Chrome Web Store prep (listing, privacy, permissions, terms, screenshots) |
| `test/fixtures/` + `test/e2e/` | Local mocks + Playwright harness |
| `scripts/` | PDF generators + `make-release-zip.sh` |
| `ARCHITECTURE.md` | Module map + site adapter interface |
| `OverlayMatchTimer.html` | Legacy local companion dashboard |

---

## Install (Developer Mode)

1. Open `chrome://extensions/` → **Developer mode**.
2. **Load unpacked** → select `Overlay-chrome-extension/` (folder with `manifest.json`).
3. Open InplayIP Review, Examino DVR/VOD, or popup → **Open local player**.

---

## How to build `content.js`

Editable logic lives under `Overlay-chrome-extension/src/`. After changing any fragment:

```bash
node Overlay-chrome-extension/scripts/build-content.mjs
```

Order is controlled by `Overlay-chrome-extension/scripts/module-order.json`. Commit the regenerated `content.js` (load unpacked does not require a bundler).

---

## How to run e2e

```bash
cd test
npm install
npx playwright install chromium
xvfb-run -a npm run test:e2e   # omit xvfb-run if you have a display
```

Harness covers Examino + InplayIP fixtures, local player, Customize popup, and Kickoff sync (**off → zero requests**; **on → mocked PostgREST upsert**). Screenshots land in `/opt/cursor/artifacts/` in Cloud Agent (path is set in `test/e2e/extension.spec.mjs`).

---

## How to bump version and make the zip

1. Bump **both** `Overlay-chrome-extension/manifest.json` → `version` and `Overlay-chrome-extension/package.json` → `version` (keep them equal).
2. Update footer in `popup.html`, `TESTING-TUESDAY.md`, Guideline revision row, and any store copy that cites the version.
3. Rebuild content if `src/` changed: `node Overlay-chrome-extension/scripts/build-content.mjs`
4. Refresh PDFs (optional but expected for a release package):

   ```bash
   python3 scripts/generate-guideline-pdf.py
   python3 scripts/generate-testing-tuesday-pdf.py
   ```

5. Zip:

   ```bash
   chmod +x scripts/make-release-zip.sh
   ./scripts/make-release-zip.sh /opt/cursor/artifacts
   # → OverlayMatchTimer-v1.7.0.zip
   ```

Do **not** commit secrets, `.env`, or real Supabase keys. Do **not** publish or merge from the agent unless the owner asks.

---

## Icons & header assets

| Asset | Where | How it is made |
|-------|--------|----------------|
| Toolbar / store icons `assets/icon-{16,32,48,128}.png` | Shipped | **v2**: dark tile + SP slash (`design/icon-exploration/slash_source.png`) + **20:08** Box badge. Regenerate: `cd Overlay-chrome-extension && npm install --no-save sharp && node scripts/generate-icons.mjs` |
| Popup header logo | `assets/stats-perform-logo-dark.png` | Official SP mark+wordmark (do not crop) |
| Popup **20:08** chip | CSS in `popup.css` (`.omt-header-clock`) | Keep `left: -6px` aligned with icon-128 badge placement |
| Explorations | `design/icon-exploration/`, `design/header-chip/` | Reference only; see `design/README.md` + `LEGIBILITY.md` |

---

## Updating the Guideline

### Source of truth

- **Edit:** `docs/guideline/GUIDELINE.md`
- **Generate PDF:** `python3 scripts/generate-guideline-pdf.py` → `Overlay MatchTimer Guideline.pdf`
- Historical 1.0.0 PDF text extract (reference): `docs/guideline/_extract-from-pdf-1.0.0.txt`

The old PDF described the HTML dashboard + early Inplay load. The Markdown source is extension-first (v1.7.0) and must stay classified as internal until the owner / Stats Perform confirms distribution.

### Features / screens the Guideline should cover

Install unpacked · InplayIP · Examino · local player · kick-off calibration · hotkeys · timeline / clock edit · ShuttleXpress · Customize sections · optional Kickoff sync (default off) · short troubleshooting.

### Checklist when a feature changes

1. Update the matching section + revision table in `GUIDELINE.md`.
2. Update `TESTING-TUESDAY.md` if analysts should re-check it on Tuesday.
3. Capture / replace screenshots if UI changed (`store/screenshots/` or `docs/guideline/screenshots/`).
4. Regenerate both PDFs.
5. Include both PDFs in the release zip.

### How TESTING-TUESDAY relates

| Doc | Job |
|-----|-----|
| Guideline | Full “how to use” for operators |
| TESTING-TUESDAY | ~15 min pass/fail smoke for **this build** |

Keep version numbers aligned. Tuesday is not a substitute for the Guideline.

---

## Optional Kickoff sync (summary)

- Customize → **Kickoff sync**, collapsed, toggle **off** by default.
- Module: `src/sync/*` + service worker fetch; **no network when off**.
- User-entered project URL + anon key in `chrome.storage.local`; optional room id.
- `optional_host_permissions`: `https://*.supabase.co/*` requested **only when enabling**.
- SQL: `supabase/migrations/…_kickoff_sync.sql` (owner runs in their project; agents must not create real projects/keys).

See `supabase/SETUP.md` and `docs/reports/V1.7.0-SYNC.md`.

---

## Local verification (without Stats Perform login)

Fixtures under `test/fixtures/` + Playwright as above. `http://127.0.0.1/*` / `localhost` host permissions exist so fixtures can inject the content script.

---

## Keyboard shortcuts (defaults)

| Action | Shortcut |
|--------|----------|
| Play / Pause | `Space` |
| Skip ±2s | `→` / `←` |
| Skip ±10s | `Shift` + `→` / `←` |
| Skip ±2m | `Ctrl` + `→` / `←` |
| Next / previous frame | `↑` / `↓` |
| Speed ±0.25× / reset | `C` / `Z` / `X` |
| Mark kick-off | `K` |
| Go to Live | `L` |
| Toggle controls visibility | `H` |

Rebind in Customize → Shortcuts.

---

## Store / legal (Unlisted)

See `store/PUBLISHING.md` for what the Chrome Web Store actually requires and where to host privacy (and optional terms). Do not invent legal claims — owner / Stats Perform must confirm before submit.

---

## Author

Developer: Vasco Oliveira. Designed for professional performance analysis.
