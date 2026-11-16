# Overlay MatchTimer - Architecture

Describes the MV3 content-script layout and current v2.0.1 runtime behaviour. Rebuild after editing `src/*`:

```bash
node Overlay-chrome-extension/scripts/build-content.mjs
```

Users do **not** need to run the build: `content.js` is committed. `bridge.js` stays a separate ISOLATED-world script (`chrome.storage`).

## Load model

MV3 content scripts cannot use native ES modules in MAIN world reliably across hosts. Sources under `Overlay-chrome-extension/src/` are **plain script fragments** that share one scope when concatenated into a single IIFE:

```text
Overlay-chrome-extension/content.js   ← committed bundle (load unpacked as usual)
```

Concat order is `Overlay-chrome-extension/scripts/module-order.json`.

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
| `src/pdt.js` | PDT helpers + timeline metadata / chrome time text |
| `src/timer.js` | Match clock / kick-off / edit |
| `src/markers.js` | Timeline markers |
| `src/playback.js` | Transport (seek, play, frames, speed, **LIVE**, mute, FS, volume sync) |
| `src/osd.js` | OSD toasts |
| `src/autohide.js` | Auto-hide + UI activity / hover keep-visible (panel + timeline together) |
| `src/hotkeys.js` | Capture-phase shortcuts |
| `src/drag.js` | Panel drag |
| `src/setup-visibility.js` | Setup panel show/hide |
| `src/video-visibility.js` | Video surface guard (hide overlay when video collapsed / covered) |
| `src/shuttle.js` | ShuttleXpress WebHID |
| `src/restore.js` | localStorage kick-off restore |
| `src/storage.js` | Prefs ↔ `bridge.js`; local player Shuttle uses sessionStorage (per-window) |
| `src/auto-pause.js` | Auto pause on Alt+Tab / tab hide |
| `src/examino-features.js` | Click-to-toggle, hide native bars, Source DVR/VOD, auto-VOD |
| `src/local-features.js` | Local file picker, drag-and-drop, Open file control |
| `src/entry.js` | Entry: early Examino hooks, then `boot()` |

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
  stub?: true                     // optional: content script idles
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
| `content.css` | (injected) | HUD styles (scoped under `#omt-root`) |

## Invariants (do not break in refactors)

- Capture-phase hotkeys must win over OpenPlayer / Video.js.
- Examino click-to-toggle arms only on `<video>` / `.op-media-element-container` (not whole `.op-player`).
- Programmatic OpenPlayer menu clicks use `examinoSuppressClickToggle` / `withClickToggleSuppressed`.
- Settle-to-live only after explicit VOD→DVR (`examinoPendingDvrSettle`).
- **LIVE panel button / seek-to-live / PDT time reading** stay on the existing paths (`irParaLive` / `atualizarEstadoLive` / PDT helpers). Do not change those mechanisms for UI-only work.

## Video-visibility guard (v2.0.1)

`src/video-visibility.js` watches the active video surface with `IntersectionObserver`, `ResizeObserver`, rect checks, and optional `elementFromPoint`. When the video is collapsed, offscreen, or covered (e.g. InPlay Review curtain), `#omt-root` is hidden. When the surface is visible again, the overlay returns. This does **not** change how video time or PDT is read.

## CSS isolation under `#omt-root` (v2.0.1)

Overlay tokens and font metrics are rooted on `#omt-root` so host `html { font-size }` and button resets cannot shrink the HUD. Accent colours (Kick-off orange, active speed, playing pause, LIVE chip) are locked with `#omt-root … !important` against host `button { background/color/filter }` greys.

## Timeline chrome (YouTube-style, v2.0.1)

Bottom bar layout:

1. Full-width scrubber on top.
2. Slim chrome row below: volume (mute + slider) and time text on the left; fullscreen on the right.

Chrome visibility follows the control panel (existing auto-hide): when the panel fades, the timeline fades with it.

**Time text rules** (`pdt.js` / timeline helpers):

| Situation | Chrome time |
|-----------|-------------|
| Kickoff set (live or post) | Match clock only (same as HUD clock) |
| Live, no kickoff | Delay behind live (`-12 s`, `-1:05`, …) or red **LIVE** chip near the edge |
| Post / VOD / local, no kickoff | `current / duration` |

**LIVE chip hysteresis:** enter the red LIVE presentation when delay is within about **10 s** of the live edge; leave it only after delay grows past about **15 s** (`OMT_LIVE_CHIP_ENTER_S` / `OMT_LIVE_CHIP_LEAVE_S`). Click jumps to live. Hover tip behaviour is unchanged (video time, or period · match clock when kickoff is set).

Fullscreen lives on the timeline chrome row (not duplicated on the panel). Volume on the bar stays in sync with the panel volume control.

## Toolbar popup (v1.4.0+)

Branding, shortcuts reference, Customize (clock / control panel / shortcuts / ShuttleXpress), and General actions live in `popup.html`. Values sync through `chrome.storage.local` via `bridge.js`.

**v2.0.1 Customize additions:**

- Control panel: Size **M** / **S**, **Compact** (hides lower speed-chip row).
- Shortcuts: per-row skip seconds **1 to 999** (defaults 2 / 10 / 120); panel buttons auto-sort by size; keyboard uses each row’s value. ShuttleXpress Btn 1 to 5 times stay separate.

In-video UI: transport, timeline, LIVE (streams), match clock + offset nudge, kick-off, Examino Source. No tips on play / skip / lower speed-row chips.

## Runtime-only packaging (v2.0.1)

`scripts/pack-extension-zip.sh` builds `OverlayMatchTimer-extension-v*.zip` with an allowlist of runtime files only (`manifest.json`, `background.js`, `bridge.js`, `content.js`, `content.css`, `sync-feature-flag.js`, popup/player HTML/CSS/JS, `assets/` icons + logo). Excluded: `src/`, `scripts/`, `design/`, `package.json`, `vendor/`, `node_modules/`.

`scripts/make-release-zip.sh` builds the full owner/QA bundle `OverlayMatchTimer-v*-full.zip` containing docs, store, supabase, runtime `Overlay-chrome-extension/`, and the clean extension zip at the bundle root. Analysts should Load unpacked from the runtime folder inside that bundle (or from the nested extension zip extract), not from a full git tree.

E2e can point at a packaged folder with `OMT_EXT_DIR`.

## Kickoff sync (planned: disabled since v1.7.1; still off in v2.0.1)

**Status:** Code and SQL remain in the repo (`src/sync/`, `background.js` gated paths, `supabase/`) but are **inert**. Gate: `Overlay-chrome-extension/sync-feature-flag.js` → `OMT_SYNC_FEATURE_ENABLED = false`. No Customize UI, no message handlers, no network, no Supabase host permission in the manifest while the flag is off.

Prototype (v1.7.0) used per-user URL/anon key/room fields + optional host permission. **That UX is abandoned.** Do not ship it.

### Future product design (owner decision: not implemented)

Always on for analysts; **zero configuration** in the popup.

| Topic | Planned behaviour |
|-------|-------------------|
| Config | One shared Supabase project **bundled** in extension config (project URL + **anon** key only; never service-role). Not user-entered. |
| Match key | Derived automatically from the match page (Examino play id / Inplay path). No Room id field. |
| UX | First analyst who sets the timer on a match publishes the kickoff row; colleagues on the same match see it appear (poll or equivalent). No Customize toggle. |
| Host permission | **Fixed** `host_permissions` (or equivalent) for that **one** project origin only; not `https://*.supabase.co/*` wildcard. |
| Conflict rule | **Latest write wins** (row `updated_at` / upsert). First writer seeds the match; later Set Kick-off / nudge overwrites. |
| RLS | Tight policies: `SELECT`/`INSERT`/`UPDATE` only for the requested `match_key`; **no `DELETE`** for anon; prefer Postgres RPC or constrained upsert so clients cannot list all matches. Rate-limit writes. |
| Privacy (when enabled) | Update `store/privacy/` before ship: disclose that kickoff / clock-reference values for the current match are sent to the Stats Perform-operated (or designated) Supabase project; no video, no keystrokes, no personal profiles; data retained only as needed for live analysis rooms. **Owner / Stats Perform must confirm** wording and retention. |
| Cleanup | When sync is re-enabled, schedule retention cleanup (see `supabase/SETUP.md` and draft `supabase/drafts/cleanup_match_timers.sql`). |

Re-enable checklist for an **internal** prototype build of the old per-user UI (not the future design): see comments in `sync-feature-flag.js`. Future always-on work should replace that UI, not turn the flag on as-is.

Details and SQL notes: `supabase/SETUP.md`.
