# Overlay MatchTimer

**Overlay MatchTimer** is a Chrome MV3 extension for professional football / sports match analysts. It injects a drift-aware match timer, HUD timeline, and playback controls over supported stream players.

Supported by this extension build:

* **InplayIP** (`*.inplayip.tv`) — Video.js Review/DVR sessions (unchanged known-good behaviour)
* **Examino** (`examino.statsperform.io/play/dvr/*`) — OpenPlayer DVR pages (no iframes / shadow roots)

Xeatre remains out of scope for the extension injector (use the local HTML companion to load copied DVR URLs). A stub adapter is left in `content.js` for a future pass.

The local companion app (`OverlayMatchTimer.html`) and the user guide (`Overlay MatchTimer Guideline.pdf`) document kick-off sync, halves, hotkeys, the draggable auto-hiding panel, HUD timeline jumps, and ShuttleXpress.

---

## Key features

* Kick-off sync with half / custom period selection and persistent `localStorage` state
* Capture-phase hotkeys (Space, arrows, Z/C/X, H) that override host player shortcuts
* Draggable glass setup + controls panels with auto-hide
* HUD match clock with click-to-jump minute editing
* Contour ShuttleXpress via WebHID
* HLS PDT sync + anti-live-snap when a VHS / hls.js instance is present (InplayIP)

### Examino-specific behaviour

* Site adapter waits for a late-mounted / replaced `<video>` (OpenPlayer MSE) via `MutationObserver` + SPA monitor
* Overlay anchors inside `.op-player` / `.op-media-element-container` and reparents on fullscreen so the HUD stays visible
* Compact CSS mode for small popup players (~465×261)
* Native OpenPlayer controls / UI chrome are hidden so they do not fight OMT hotkeys and clicks

---

## Install (Developer Mode)

1. Clone or download this repository.
2. Open `chrome://extensions/` and enable **Developer mode**.
3. Click **Load unpacked** and select `Overlay-chrome-extension/` (the folder that contains `manifest.json`).
4. Open an InplayIP Review session or an Examino DVR URL such as  
   `https://examino.statsperform.io/play/dvr/<id>/?st=<epoch ms>`.
5. The Overlay MatchTimer HUD should appear over the player within a couple of seconds after the `<video>` mounts.

Optional: the local HTML companion (`OverlayMatchTimer.html`) can still be used for offline files and for pasting Xeatre/Examino DVR URLs into the dashboard player.

---

## Local verification (without Stats Perform login)

Real Examino / InplayIP hosts are internal. This repo includes OpenPlayer-like and Video.js-like fixtures plus a Playwright harness:

```bash
cd test
npm install
npx playwright install chromium
xvfb-run -a npm run test:e2e   # or omit xvfb-run on a machine with a display
```

What the harness checks:

* Examino mock: late video inject + one replacement, overlay appears, compact mode, kick-off sync, Space / seek hotkeys, panel drag, fullscreen keeps overlay
* InplayIP mock: overlay regression + kick-off sync

Fixtures live under `test/fixtures/`. Screenshots are written to `/opt/cursor/artifacts/` when run in the Cloud Agent environment (or adjust the path in `test/e2e/extension.spec.mjs`).

`http://127.0.0.1/*` and `http://localhost/*` are included in the extension match patterns solely so these fixtures can load the content script.

---

## Project layout

| Path | Purpose |
| --- | --- |
| `Overlay-chrome-extension/` | MV3 extension (`manifest.json`, `content.js`, `content.css`) |
| `OverlayMatchTimer.html` | Local companion dashboard |
| `Overlay MatchTimer Guideline.pdf` | End-user guide |
| `test/fixtures/` | Examino OpenPlayer + InplayIP Video.js mocks |
| `test/e2e/` | Playwright extension smoke tests |

Site-specific selectors and positioning are isolated in small adapters at the top of `content.js` (`SITE_INPLAYIP`, `SITE_EXAMINO`, `SITE_XEATRE` stub).

---

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Play / Pause | `Space` |
| Skip ±2s | `→` / `←` |
| Skip ±10s | `Shift` + `→` / `←` |
| Skip ±2m | `Ctrl` + `→` / `←` |
| Next / previous frame | `↑` / `↓` |
| Speed ±0.25× / reset | `C` / `Z` / `X` |
| Toggle controls visibility | `H` |

---

## Author

* Developer: Vasco Oliveira  
* Designed for professional performance analysis. All rights reserved.
