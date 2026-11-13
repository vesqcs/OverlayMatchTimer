# Overlay MatchTimer — Performance audit (v1.7.2)

**Constraint:** Do **not** change pre-redesign mechanisms (InPlay/Examino hooks, PDT, observers, intervals, polling, adapters, `timeupdate` wiring). Only redesign-added UI may be trimmed when clearly wasteful. Costly original paths are **suggestions only** below — left untouched.

**Harness:** `test/e2e/perf-audit.mjs`  
**Artifacts:** `/opt/cursor/artifacts/perf-audit-before.json`, `perf-audit-after.json`  
**Method:** local fixtures (examino / inplayip mocks + local player); Chrome CDP `Performance.getMetrics` (same session) + sampling Profiler (250 µs); MutationObserver / `timeupdate` / rAF / long-task probes; ~5 min heap series (InPlay ON vs OFF).

Numbers are measured on this Cloud Agent VM with Playwright Chromium — not a substitute for the Tuesday Chrome Task Manager check on a work PC.

---

## 1. Summary

| Surface | Ext | Script ms/s (before → after) | Approx JS ms/s (profiler) | Long tasks (60 s) | MO/s | Notes |
|---------|-----|------------------------------|---------------------------|-------------------|------|-------|
| Examino mock | OFF | 2.7 → 2.8 | ~2.4 | 0 | 0 | Baseline page |
| Examino mock | ON | 574 → 576 | ~567–571 | 0 | ~3.8 | Dominant cost; see §3 |
| InPlay mock | OFF | 2.3 → 2.3 | ~1.9 | 0 | 0 | Baseline |
| InPlay mock | ON | 319 → 325 | ~304–305 | 0 | 0* | *MO wrap often misses observers created before probe |
| Local player | ON | 507 → 525 | ~471–493 | 0 | 0 | Extension page only |

**Redesign-only change shipped in v1.7.2:** skip redundant `#omt-timeline-bar` / panel `omt-at-live` class toggles and `--omt-progress` CSS-var writes when the live/progress presentation has not changed (`src/playback.js` → `atualizarEstadoLive`). Original `liveBtn.classList.toggle('is-live', …)` still runs every `timeupdate`.

**Measured effect of that change:** within run-to-run noise on total ScriptDuration / profiler JS share. Kept anyway as clearly wasteful redesign chrome (avoids repeated style invalidation when scrubber state is stable). No behaviour change to seek / LIVE / PDT.

**Memory (~5 min InPlay mock):** ON heap samples oscillated (≈8.2 → 5.9 → 16.1 → 11.4 → 7.7 → 2.6 MB) — GC, not a steady climb. OFF stayed ≈1.6–2.2 MB. No evidence of a linear leak over the window in this harness.

---

## 2. What was optimised (redesign chrome only)

| Item | File | Change |
|------|------|--------|
| Scrubber live colour / progress fill | `src/playback.js` | Cache last `atLive` + rounded progress %; only write redesign DOM/CSS when changed |

**Intentionally not touched:** `atualizarRelogio`, PDT fragment scans, Examino native-chrome observer, SPA 1500 ms interval, boot MutationObservers, `timeupdate` → anti-snap / slider / kickoff recalibration, adapters, sync (already gated off).

---

## 3. Suggestions only — original / host paths that look costly

Do **not** implement these without owner approval and production validation. Listed because measurements show they dominate vs redesign scrubber writes.

1. **Examino document-wide MutationObserver → `hideExaminoNativeChrome()`** (`src/examino-features.js`)  
   - Observed ~3.8 MO callbacks/s while playing on the mock; Examino ON ScriptDuration ≈ **574 ms/s** vs OFF ≈ **3 ms/s**.  
   - Heuristic walks `div, section, nav, aside` and reads `innerText` on many nodes. Likely necessary for OpenPlayer chrome; if ever revisited, measure on real Examino first.

2. **`timeupdate` → `atualizarRelogio()` + four `getVideoTimeForPdt` / `getProgramDateTime` paths** (`src/timer.js`, `src/pdt.js`, `src/wire.js`)  
   - Fires ~3.8/s with video; PDT helpers may scan HLS/VHS fragment lists. Original sync design — leave alone unless profiling on real streams proves a safe cache.

3. **SPA monitor `setInterval(..., 1500)`** (`src/boot.js`)  
   - Cheap vs Examino MO, but perpetual. Required for stream swap / teardown detection historically.

4. **Boot `MutationObserver` on `document.documentElement` subtree** (`src/boot.js`)  
   - Needed for late `<video>` mount; disconnects after init. Fine after boot; suggestion only if somehow left connected.

5. **Clock `innerText` / colour writes every `timeupdate` even when the string is unchanged** (`atualizarRelogio`)  
   - Original timer path. A “write only if changed” guard would be a micro-opt; treat as suggestion so display edge cases stay identical.

6. **Listener / DOM size with extension ON**  
   - Examino ON: ~149 listeners at start, ~1145 nodes (CDP); InPlay ON: ~93 listeners, ~721 nodes. Expected for HUD; not a redesign leak by itself.

---

## 4. Tuesday manual check (work PC)

See **TESTING-TUESDAY.md §7** — Chrome Task Manager with extension ON vs OFF on a real InPlay/Examino tab (~60 s each). Record process CPU % and JS memory; compare to this report’s directionality (Examino ON ≫ OFF), not absolute ms/s from the VM harness.

---

## 5. How to re-run

```bash
cd test
PERF_PHASE=before PERF_QUICK=1 xvfb-run -a node e2e/perf-audit.mjs   # 60 s surfaces
# apply redesign-only change + rebuild content.js
PERF_PHASE=after xvfb-run -a node e2e/perf-audit.mjs                # 60 s + 5 min memory
```

Env knobs: `PERF_PLAY_MS`, `PERF_MEMORY_MS`, `PERF_QUICK=1`.
