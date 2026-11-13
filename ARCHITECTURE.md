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


## Toolbar popup (v1.4.0+)

Branding, shortcuts reference, Customize (clock / shortcuts / ShuttleXpress), and General actions live in `popup.html`. Values sync through `chrome.storage.local` via `bridge.js`. In-video UI stays limited to transport, timeline, LIVE, match clock + offset nudge, kick-off, and Examino Source.

## Kickoff sync (planned — disabled since v1.7.1; still off in v2.0.0)

**Status:** Code and SQL remain in the repo (`src/sync/`, `background.js` gated paths, `supabase/`) but are **inert**. Gate: `Overlay-chrome-extension/sync-feature-flag.js` → `OMT_SYNC_FEATURE_ENABLED = false`. No Customize UI, no message handlers, no network, no Supabase host permission in the manifest while the flag is off.

Prototype (v1.7.0) used per-user URL/anon key/room fields + optional host permission. **That UX is abandoned.** Do not ship it.

### Future product design (owner decision — not implemented)

Always on for analysts; **zero configuration** in the popup.

| Topic | Planned behaviour |
|-------|-------------------|
| Config | One shared Supabase project **bundled** in extension config (project URL + **anon** key only — never service-role). Not user-entered. |
| Match key | Derived automatically from the match page (Examino play id / Inplay path). No Room id field. |
| UX | First analyst who sets the timer on a match publishes the kickoff row; colleagues on the same match see it appear (poll or equivalent). No Customize toggle. |
| Host permission | **Fixed** `host_permissions` (or equivalent) for that **one** project origin only — not `https://*.supabase.co/*` wildcard. |
| Conflict rule | **Latest write wins** (row `updated_at` / upsert). First writer seeds the match; later Set Kick-off / nudge overwrites. *(Documented alternative rejected for now: first-write-wins lock.)* |
| RLS | Tight policies: `SELECT`/`INSERT`/`UPDATE` only for the requested `match_key`; **no `DELETE`** for anon; prefer Postgres RPC or constrained upsert so clients cannot list all matches. Rate-limit writes (DB function / edge constraint). |
| Privacy (when enabled) | Update `store/privacy/` before ship: disclose that kickoff / clock-reference values for the current match are sent to the Stats Perform–operated (or designated) Supabase project; no video, no keystrokes, no personal profiles; data retained only as needed for live analysis rooms. **Owner / Stats Perform must confirm** wording and retention. |

Re-enable checklist for an **internal** prototype build of the old per-user UI (not the future design): see comments in `sync-feature-flag.js`. Future always-on work should replace that UI, not turn the flag on as-is.

Details and SQL notes: `supabase/SETUP.md`.
