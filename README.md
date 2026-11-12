# Overlay MatchTimer

**Overlay MatchTimer** is a Chrome MV3 extension for professional football / sports match analysts. It injects a drift-aware match timer, HUD timeline, and playback controls over supported stream players.

Supported by this extension build (**v1.4.0** UI redesign on top of the v1.3.0 untangle (behaviour preserved)):

* **InplayIP** (`*.inplayip.tv`) — Video.js Review/DVR sessions (unchanged known-good behaviour)
* **Examino** (`examino.statsperform.io/play/dvr/*` and `/play/vod/*`) — OpenPlayer DVR/VOD pages (no iframes / shadow roots)

Xeatre remains out of scope for the extension injector (use the local HTML companion to load copied DVR URLs). A stub adapter lives under `Overlay-chrome-extension/src/adapters/xeatre.js`.

**Layout:** editable sources are in `Overlay-chrome-extension/src/` (concatenated into committed `content.js`). See [`ARCHITECTURE.md`](./ARCHITECTURE.md). After editing sources: `node Overlay-chrome-extension/scripts/build-content.mjs`. Load unpacked still needs no build step. Toolbar popup holds branding / Customize (Coming soon) / shortcuts. In-video: floating draggable control panel + bottom-only timeline; match controls (period, kick-off, Source, Shuttle) live in the panel’s expandable chevron group.

The local companion app (`OverlayMatchTimer.html`) and the user guide (`Overlay MatchTimer Guideline.pdf`) document kick-off sync, halves, hotkeys, the draggable auto-hiding panel, HUD timeline, and ShuttleXpress.

---

## Key features

* Kick-off sync with half / custom period selection and persistent `localStorage` state
* Capture-phase hotkeys (Space, arrows, Z/C/X, H, **K** mark kick-off, **L** go live) that override host player shortcuts
* Draggable glass setup + controls panels with auto-hide
* HUD match clock with click-to-jump minute editing
* Contour ShuttleXpress via WebHID
* HLS PDT sync + anti-live-snap when a VHS / hls.js instance is present (InplayIP)

### Examino-specific behaviour

* Site adapter waits for a late-mounted / replaced `<video>` (OpenPlayer MSE) via `MutationObserver` + SPA monitor
* Overlay anchors inside `.op-player` / `.op-media-element-container` and reparents on fullscreen so the HUD stays visible
* Compact CSS mode for small popup players (~465×261)
* Native OpenPlayer + Examino chrome hidden (3 bottom button rows, hamburger, gear, OpenPlayer bars); main player expands into the freed space
* **Window capture-phase hotkeys** installed at `document_start` so OpenPlayer/Examino shortcuts never win
* **Click-to-toggle** play/pause on the **video surface only** (never the whole `.op-player` tree — that broke OpenPlayer Source switching in v1.2.1)
* Expandable in-panel controls keep a compact **Source (DVR/VOD)** control + **Auto-switch to VOD** toggle (chrome.storage via `bridge.js`, default ON). Options are exact `DVR`/`VOD` only; label tracks the live Source; MutationObserver drives faster auto-VOD. Manual DVR choice wins for the page session; settle-to-live runs only after VOD→DVR
* Auto-hide treats clicks / wheel / keys on our UI as activity and never hides while the pointer is over the controls (InplayIP included)

---

## Install (Developer Mode)

1. Clone or download this repository.
2. Open `chrome://extensions/` and enable **Developer mode**.
3. Click **Load unpacked** and select `Overlay-chrome-extension/` (the folder that contains `manifest.json`).
4. Open an InplayIP Review session or an Examino DVR/VOD URL such as  
   `https://examino.statsperform.io/play/dvr/<id>/?st=<epoch ms>`.
5. The Overlay MatchTimer HUD should appear over the player within a couple of seconds after the `<video>` mounts.
6. On Examino, confirm native bottom bars are gone, hotkeys work, and Source auto-switches to **VOD** (toggle under Setup → Examino Player).

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
| `Overlay-chrome-extension/` | MV3 extension (`manifest.json`, committed `content.js`, `content.css`, `bridge.js`) |
| `Overlay-chrome-extension/src/` | Content-script fragments (adapters, timer, playback, hotkeys, …) |
| `ARCHITECTURE.md` | Module map + site adapter interface |
| `OverlayMatchTimer.html` | Local companion dashboard |
| `Overlay MatchTimer Guideline.pdf` | End-user guide |
| `test/fixtures/` | Examino OpenPlayer + InplayIP Video.js mocks |
| `test/e2e/` | Playwright extension smoke tests |

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
| Mark kick-off (current frame) | `K` |
| Go to Live | `L` |
| Toggle controls visibility | `H` |

---

## Author

* Developer: Vasco Oliveira  
* Designed for professional performance analysis. All rights reserved.
