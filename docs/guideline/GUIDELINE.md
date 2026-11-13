---
title: Overlay MatchTimer — User Guideline
product: Overlay MatchTimer
version: 1.7.0
status: editable-source
supersedes_pdf: Overlay MatchTimer Guideline.pdf (1.0.0, 05 Jul 2026)
security: Stats Perform internal — confirm classification before external share
---

# Overlay MatchTimer — User Guideline

**Version:** 1.7.0  
**Audience:** Stats Perform / RunningBall match analysts  
**Primary product:** Chrome MV3 extension (`Overlay-chrome-extension/`)  
**Legacy companion:** `OverlayMatchTimer.html` (local dashboard; still documented for Tier-12 / URL paste)

> **Confidentiality:** The historical PDF (`Overlay MatchTimer Guideline.pdf`) is marked Stats Perform Security Level 2 — Restricted. This Markdown is the **editable maintenance source** for regenerating the PDF. Classification, disclaimer wording, and external distribution must be confirmed by the owner / Stats Perform before sharing outside the intended internal audience.

---

## 1. General information

### 1.1 Revision history

| Revision | Notes | Author | Date |
|----------|-------|--------|------|
| 1.0.0 | Original Guideline PDF (HTML dashboard + early Inplay extension) | Vasco Oliveira | 05 Jul 2026 |
| 1.7.0 | Editable Markdown source; Chrome extension first; Customize, local player, optional Kickoff sync (default off) | Maintainers | 13 Nov 2026 |

### 1.2 Glossary

| Term | Meaning |
|------|---------|
| Overlay MatchTimer | Match clock + HUD overlay for analysis video |
| HUD | On-video heads-up display (clock, timeline, controls) |
| Kick-off / kickoff | Video time (or PDT) reference that anchors match minutes |
| ShuttleXpress | Contour USB jog/shuttle; WebHID after user enables |
| Kickoff sync | Optional team share of kickoff references via a user-owned Supabase project (off by default) |
| Customize | Toolbar popup tab for clock, shortcuts, Shuttle, kickoff sync |

### 1.3 What this Guideline covers

| Area | Covered? | Notes |
|------|----------|-------|
| Install unpacked Chrome extension | Yes | §2 |
| InplayIP overlay | Yes | §3 |
| Examino DVR/VOD overlay | Yes | §3 |
| Local player / offline files | Yes | §4 |
| Match clock / kick-off calibration | Yes | §5 |
| Hotkeys, timeline, OSD | Yes | §6 |
| ShuttleXpress | Yes | §7 |
| Customize (clock / shortcuts / Shuttle) | Yes | §8 |
| Optional Kickoff sync (Supabase) | Yes | §9 — default **off** |
| Xeatre URL paste (legacy HTML) | Brief | §10 — Xeatre injector still out of scope |
| Store publishing / legal | No | See `store/PUBLISHING.md` |
| Developer build / e2e | No | See root `README.md` |

Screens / figures in the historical PDF (FIGURE 1–29) map mainly to the **HTML dashboard** and early Inplay load steps. Prefer regenerating screenshots from the live extension (popup, Examino, Inplay, local player) when updating this guide — see §12.

---

## 2. Installing the Chrome extension

1. Obtain the release zip (e.g. `OverlayMatchTimer-v1.7.0.zip`) and extract it.
2. Open `chrome://extensions` → enable **Developer mode**.
3. **Load unpacked** → select the `Overlay-chrome-extension/` folder (the one that contains `manifest.json`).
4. Confirm the card shows version **1.7.0** and no errors.
5. Pin the toolbar icon (slash + **20:08** badge).

Chrome is the supported browser.

---

## 3. Online streams (extension)

### 3.1 InplayIP

Open a Review / DVR session on `*.inplayip.tv`. The HUD injects over the Video.js player. Use the same kick-off, hotkeys, and Shuttle behaviour as on other surfaces.

### 3.2 Examino

Open `examino.statsperform.io/play/dvr/…` or `/play/vod/…`. The overlay waits for OpenPlayer’s `<video>`, hides native chrome, and offers Source (DVR/VOD) + Auto-switch to VOD in the in-panel settings.

---

## 4. Local / offline video

### 4.1 Extension local player (preferred)

1. Open the toolbar popup → **Open local player**.
2. Choose a file or drag-and-drop onto the window.
3. Shuttle enablement is **per window** (session only) so a shared upper monitor and a personal window do not fight.

### 4.2 Legacy HTML dashboard

`OverlayMatchTimer.html` remains for historical Tier-12 workflows and pasting Xeatre/Examino DVR URLs. Prefer the extension local player for day-to-day offline work.

---

## 5. Match clock synchronization

1. Seek to the kick-off frame for the period (1st, 2nd, Custom 1/2).
2. Select the period in the half dropdown.
3. Click **Set Kick-off** (or press **K**).
4. Use ±1s / ±5s offset nudges if the whistle frame needs a trim.
5. Clear with the reset control when starting a new match.

Timeline ticks appear per period (1st / 2nd / C1 / C2). Click the HUD clock to type a match time (`45`, `45.30`, `45:30`, etc.).

---

## 6. Navigation & hotkeys

| Action | Default shortcut |
|--------|------------------|
| Play / Pause | Space |
| Skip ±2s | ← / → |
| Skip ±10s | Shift + ← / → |
| Skip ±2m | Ctrl + ← / → |
| Frame ± | ↑ / ↓ |
| Speed − / + / 1× | Z / C / X |
| Mark kick-off | K |
| Go Live | L |
| Hide controls | H |

Defaults are rebindable under **Customize → Shortcuts**.

---

## 7. ShuttleXpress

1. Connect the Contour ShuttleXpress over USB.
2. On the page HUD, enable **ShuttleXpress** (per window on local player).
3. Accept the browser device chooser.
4. Defaults: Btn3 Play/Pause; Btn1 −2m; Btn2 −10s; Btn4 +10s; Btn5 +2m; Jog frames; ring scrub.
5. Remap under **Customize → ShuttleXpress** (diagram + rows). Auto pause on Alt+Tab never applies while Shuttle is on.

---

## 8. Customize & General (toolbar popup)

**General:** Open local player, Auto pause on Alt+Tab (default off), live shortcut list, Shuttle diagram summary.

**Customize (collapsible sections):**

| Section | Default | Purpose |
|---------|---------|---------|
| Match clock | Open | Position / size / style |
| Shortcuts | Collapsed | Rebind + conflict warnings |
| ShuttleXpress | Collapsed | Skip seconds, Play/Pause button, jog/ring |
| Kickoff sync | Collapsed | Optional team sync — **toggle off by default** |

**Reset all customizations** restores clock, shortcuts, Shuttle, and turns Kickoff sync off (clears stored URL/key/room).

---

## 9. Optional Kickoff sync (v1.7.0, default off)

Share kickoff / clock-reference values with colleagues on the **same match room**.

- **Off (default):** no sync network requests; no optional Supabase host permission used.
- **On:** user enters their own Supabase **Project URL** + **anon key** (stored only in `chrome.storage.local`). Chrome asks for host access to that origin when enabling. Optional **Room id** overrides the auto key derived from the page URL.
- Owner setup (SQL, RLS): see `supabase/SETUP.md`. Do **not** put service-role keys in the extension. Do **not** commit secrets.

Risks (plain language): anyone with the shared anon key can read/write every row in that project’s `kickoff_sync` table — treat it as a private team room.

---

## 10. Legacy URL workflows (HTML)

Xeatre / Examino “copy DVR URL → paste into dashboard” steps from Guideline 1.0.0 still apply to `OverlayMatchTimer.html`. The extension injects on Examino play URLs and InplayIP directly; Xeatre content-script injection remains out of scope until material is provided.

---

## 11. Troubleshooting (short)

| Symptom | Try |
|---------|-----|
| No HUD on Examino | Confirm `/play/dvr/` or `/play/vod/` URL; wait for video; reload |
| No HUD on Inplay | Confirm Review/DVR (seekable) session; reload unpacked |
| Hotkeys do nothing | Click the page once; check Customize bindings; Examino uses capture-phase keys |
| Shuttle won’t pair | Toggle off/on; re-plug USB; allow device in chooser |
| Sync does nothing | Confirm toggle on, URL + anon key, host permission granted, same Room id / match page |

---

## 12. Updating this Guideline (maintainers)

### Where the source lives

| File | Role |
|------|------|
| `docs/guideline/GUIDELINE.md` | **Editable source** (this file) |
| `docs/guideline/_extract-from-pdf-1.0.0.txt` | Raw text extract from historical PDF (reference only) |
| `Overlay MatchTimer Guideline.pdf` | Generated / published PDF at repo root |
| `scripts/generate-guideline-pdf.py` | Regenerates the PDF from the Markdown |

### Checklist when a feature changes

1. Update the matching section(s) in `GUIDELINE.md` (and revision table).
2. Update `TESTING-TUESDAY.md` rows if analysts should re-verify the change.
3. Capture fresh screenshots (popup / HUD) into `docs/guideline/screenshots/` or `store/screenshots/` as appropriate.
4. Run `python3 scripts/generate-guideline-pdf.py` → refresh root PDF.
5. Bump extension version only if shipping code; zip includes both PDFs (Guideline + TESTING-TUESDAY).

### How TESTING-TUESDAY relates

`TESTING-TUESDAY.md` (+ `.pdf`) is a **~15 minute smoke checklist** for a build, not the full Guideline. Keep them aligned on version number and new high-risk behaviours (e.g. Kickoff sync default off). Guideline = how to use; Tuesday sheet = did this build still work.

### Regenerating the PDF

```bash
python3 scripts/generate-guideline-pdf.py
# writes: Overlay MatchTimer Guideline.pdf
```

Optional: `python3 scripts/generate-testing-tuesday-pdf.py` for `TESTING-TUESDAY.pdf`.

---

## 13. Disclaimer

This document may contain proprietary information of Stats Perform. Confirm the correct security marking and distribution list with the owner before sharing. Optional Kickoff sync credentials and project URLs are user-supplied and must never be pasted into this document or committed to git.
