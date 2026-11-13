---
title: Overlay MatchTimer — User Guideline
product: Overlay MatchTimer
version: 1.7.2
status: editable-source
supersedes_pdf: Overlay MatchTimer Guideline.pdf (1.0.0, 05 Jul 2026)
security: Stats Perform internal — confirm classification before external share
---

# Overlay MatchTimer — User Guideline

**Version:** 1.7.2  
**Audience:** Stats Perform / RunningBall match analysts  
**Primary product:** Chrome MV3 extension (`Overlay-chrome-extension/`)  
**Legacy companion:** `OverlayMatchTimer.html` (local dashboard; still documented for Tier-12 / URL paste)

> **Confidentiality:** The historical PDF (`Overlay MatchTimer Guideline.pdf`) is marked Stats Perform Security Level 2 — Restricted. This Markdown is the **editable maintenance source** for regenerating the PDF. Classification and distribution must be confirmed by the owner / Stats Perform before sharing outside the intended internal audience.

---

## 1. General information

### 1.1 Revision history

| Revision | Notes | Author | Date |
|----------|-------|--------|------|
| 1.0.0 | Original Guideline PDF (HTML dashboard + early Inplay extension) | Vasco Oliveira | 05 Jul 2026 |
| 1.7.0 | Editable Markdown; extension-first; temporary Kickoff sync Customize prototype | Maintainers | 13 Nov 2026 |
| 1.7.1 | Kickoff sync UI removed / feature flagged off; Guideline no longer documents sync as a current feature | Maintainers | 13 Nov 2026 |
| 1.7.2 | Perf audit (redesign scrubber micro-opt only); General Shuttle diagram action labels without Btn 1–5 numbers | Maintainers | 13 Nov 2026 |

### 1.2 Glossary

| Term | Meaning |
|------|---------|
| Overlay MatchTimer | Match clock + HUD overlay for analysis video |
| HUD | On-video heads-up display (clock, timeline, controls) |
| Kick-off / kickoff | Video time (or PDT) reference that anchors match minutes |
| ShuttleXpress | Contour USB jog/shuttle; WebHID after user enables |
| Customize | Toolbar popup tab for clock, shortcuts, ShuttleXpress |

### 1.3 What this Guideline covers

| Area | Covered? |
|------|----------|
| Install unpacked Chrome extension | Yes |
| InplayIP / Examino / local player | Yes |
| Match clock / kick-off calibration | Yes |
| Hotkeys, timeline, OSD | Yes |
| ShuttleXpress | Yes |
| Customize (clock / shortcuts / Shuttle) | Yes |
| Team Kickoff sync | **No** — not a current feature (planned later; see maintainer docs only) |
| Store publishing | No — `store/PUBLISHING.md` |

---

## 2. Installing the Chrome extension

1. Obtain the release zip (e.g. `OverlayMatchTimer-v1.7.2.zip`) and extract it.
2. Open `chrome://extensions` → enable **Developer mode**.
3. **Load unpacked** → select `Overlay-chrome-extension/` (contains `manifest.json`).
4. Confirm the card shows version **1.7.2** and no errors.
5. Pin the toolbar icon (slash + **20:08** badge).

Chrome is the supported browser.

---

## 3. Online streams (extension)

### 3.1 InplayIP

Open a Review / DVR session on `*.inplayip.tv`. The HUD injects over the Video.js player.

### 3.2 Examino

Open `examino.statsperform.io/play/dvr/…` or `/play/vod/…`. The overlay waits for OpenPlayer’s `<video>`, hides native chrome, and offers Source (DVR/VOD) + Auto-switch to VOD in the in-panel settings.

---

## 4. Local / offline video

### 4.1 Extension local player (preferred)

1. Toolbar popup → **Open local player**.
2. Choose a file or drag-and-drop.
3. Shuttle enablement is **per window** on local player.

### 4.2 Legacy HTML dashboard

`OverlayMatchTimer.html` remains for historical Tier-12 workflows and pasting Xeatre/Examino DVR URLs.

---

## 5. Match clock synchronization

1. Seek to the kick-off frame for the period (1st, 2nd, Custom 1/2).
2. Select the period in the half dropdown.
3. Click **Set Kick-off** (or press **K**).
4. Use ±1s / ±5s offset nudges if needed.
5. Clear with the reset control when starting a new match.

Click the HUD clock to type a match time (`45`, `45.30`, `45:30`, etc.).

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

1. Connect Contour ShuttleXpress over USB.
2. On the page HUD, enable **ShuttleXpress** (per window on local player).
3. Accept the browser device chooser.
4. Remap under **Customize → ShuttleXpress**. Auto pause on Alt+Tab never applies while Shuttle is on.

---

## 8. Customize & General (toolbar popup)

**General:** Open local player, Auto pause on Alt+Tab (default off), live shortcut list, Shuttle diagram summary (action labels only — no Btn 1–5 numbers; those appear under Customize → ShuttleXpress).

**Customize:**

| Section | Default |
|---------|---------|
| Match clock | Open |
| Shortcuts | Collapsed |
| ShuttleXpress | Collapsed |

**Reset all customizations** restores clock, shortcuts, and Shuttle defaults.

---

## 9. Legacy URL workflows (HTML)

Xeatre / Examino “copy DVR URL → paste into dashboard” steps from Guideline 1.0.0 still apply to `OverlayMatchTimer.html`. The extension injects on Examino play URLs and InplayIP directly.

---

## 10. Troubleshooting (short)

| Symptom | Try |
|---------|-----|
| No HUD on Examino | Confirm `/play/dvr/` or `/play/vod/` URL; wait for video; reload |
| No HUD on Inplay | Confirm Review/DVR session; reload unpacked |
| Hotkeys do nothing | Click the page; check Customize bindings |
| Shuttle won’t pair | Toggle off/on; re-plug USB; allow device |

---

## 11. Updating this Guideline (maintainers)

| File | Role |
|------|------|
| `docs/guideline/GUIDELINE.md` | Editable source |
| `scripts/generate-guideline-pdf.py` | Regenerates root PDF |
| `TESTING-TUESDAY.md` | Smoke checklist for a build |

When a feature changes: update this file + Tuesday sheet + screenshots + regenerate PDFs + include both PDFs in the release zip.

```bash
python3 scripts/generate-guideline-pdf.py
python3 scripts/generate-testing-tuesday-pdf.py
```

---

## 12. Disclaimer

Confirm security marking and distribution with the owner before sharing. Do not paste credentials into this document or commit them to git.
