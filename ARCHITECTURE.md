# Overlay MatchTimer — Architecture (v1.3.0 untangled)

Zero-behaviour refactor of the MV3 content script. Runtime behaviour matches **v1.2.2**; this document describes module layout only.

## Load model

MV3 content scripts cannot use native ES modules in MAIN world reliably across hosts. Sources under `Overlay-chrome-extension/src/` are **plain script fragments** that share one scope when concatenated into a single IIFE:

```text
Overlay-chrome-extension/content.js   ← committed bundle (load unpacked as usual)
```

Rebuild after editing `src/*`:

```bash
node Overlay-chrome-extension/scripts/build-content.mjs
```

Users do **not** need to run the build — `content.js` is committed. `bridge.js` stays a separate ISOLATED-world script (chrome.storage).

## Module map

| Fragment | Role |
| --- | --- |
| `src/state.js` | Shared mutable state (video, HUD refs, timer, Examino session flags) |
| `src/adapters/interface.js` | Documented site-adapter contract |
| `src/adapters/inplayip.js` | InplayIP Video.js adapter |
| `src/adapters/examino.js` | Examino OpenPlayer adapter |
| `src/adapters/local.js` | Extension local player (`player.html`) |
| `src/adapters/xeatre.js` | Xeatre **stub** (`stub: true` → script idles; waits for Vasco material) |
| `src/adapters/detect.js` | Host/path/`data-omt-site` → adapter |
| `src/boot.js` | `teardown` / `boot` / SPA monitor / `init` |
| `src/hls.js` | hls.js / VHS discovery + DVR anti-snap patch |
| `src/suppress.js` | Delegates to `site.suppressHostControls` |
| `src/ui.js` | HUD inject, HTML, compact layout, fullscreen reparent, refs |
| `src/wire.js` | Event wiring hub |
| `src/anti-snap.js` | Seek clamp / anti-live-snap |
| `src/pdt.js` | PDT helpers + timeline metadata |
| `src/timer.js` | Match clock / kick-off / edit |
| `src/markers.js` | Timeline markers |
| `src/playback.js` | Transport (seek, play, frames, speed, **LIVE**, mute, FS) |
| `src/osd.js` | OSD toasts |
| `src/autohide.js` | Auto-hide + UI activity / hover keep-visible |
| `src/hotkeys.js` | Capture-phase shortcuts |
| `src/drag.js` | Panel drag |
| `src/setup-visibility.js` | Setup panel show/hide |
| `src/shuttle.js` | ShuttleXpress WebHID |
| `src/restore.js` | localStorage kick-off restore |
| `src/storage.js` | Prefs ↔ `bridge.js`; local player Shuttle uses sessionStorage (per-window) |
| `src/auto-pause.js` | Auto pause on Alt+Tab / tab hide |
| `src/examino-features.js` | Click-to-toggle, hide native bars, Source DVR/VOD, auto-VOD |
| `src/local-features.js` | Local file picker, drag-and-drop, Open file control |
| `src/entry.js` | Entry: early Examino hooks, then `boot()` |

Concat order is `Overlay-chrome-extension/scripts/module-order.json`.

## Site adapter interface

Each adapter is a plain object:

```js
{
  id: 'inplayip' | 'examino' | 'local' | 'xeatre',
  rootClass: string,
  findVideo(): HTMLVideoElement | null,
  findAnchor(videoEl): Element | null,
  findFullscreenTarget(videoEl): Element | null,
  isReviewStream(): boolean,      // true → inject HUD
  isLiveStream(): boolean,        // Inplay Live idle path
  suppressHostControls(videoEl): void,
  mediaReady(videoEl): boolean,   // auto-hide gate
  effectiveDuration(videoEl): number,
  stub?: true                     // optional — content script idles
}
```

### Adding Xeatre later

1. Replace `src/adapters/xeatre.js` stub with a real adapter (same interface).
2. Register host/path detection in `src/adapters/detect.js` (already has a placeholder).
3. Add `src/xeatre-features.js` only if host-only behaviour is needed (mirror Examino).
4. Append the new fragment in `module-order.json` **before** `src/entry.js`, rebuild, commit `content.js`.

## Worlds

| File | World | Purpose |
| --- | --- | --- |
| `content.js` | MAIN | Overlay + player control |
| `bridge.js` | ISOLATED | `chrome.storage.local` ↔ page localStorage for Auto-VOD |
| `content.css` | — | HUD styles |

## Invariants (do not break in refactors)

- Capture-phase hotkeys must win over OpenPlayer / Video.js.
- Examino click-to-toggle arms only on `<video>` / `.op-media-element-container` (not whole `.op-player`).
- Programmatic OpenPlayer menu clicks use `examinoSuppressClickToggle` / `withClickToggleSuppressed`.
- Settle-to-live only after explicit VOD→DVR (`examinoPendingDvrSettle`).
- **LIVE button behaviour / time logic** stays as in v1.2.2 (`irParaLive` / `atualizarEstadoLive` untouched in intent).


## Toolbar popup (v1.4.0)

Branding, Shuttle toggle, shortcuts reference, and the prepared **Personalizar** section live in `popup.html` (Chrome `action.default_popup`). Values sync through `chrome.storage.local` via `bridge.js` (now also injected on InplayIP). In-video UI stays limited to transport, timeline, LIVE, match clock + offset nudge, kick-off, and Examino Source.
