# Overlay MatchTimer — Tuesday manual test (~15 min)

**Build:** v1.6.6 · **PC:** work machine · **Date:** ________ · **Tester:** ________

Install from the zip (`OverlayMatchTimer-v1.6.6.zip` → `Overlay-chrome-extension/`). Load unpacked in `chrome://extensions` (Developer mode). Do not use an old folder.

Mark each row: `[ ]` → `[x]` when pass. Use **Notes** for anything odd (screenshot path / console error).

---

## 0. Install & shell

| # | Action | Expected | ✓ | Notes |
|---|--------|----------|---|-------|
| 0.1 | Load unpacked from zip’s `Overlay-chrome-extension` | Extension shows **1.6.6**, no errors on card | [ ] | |
| 0.2 | Check toolbar / extensions icon | Slash + **20:08** badge top-left (v2) on dark tile | [ ] | |
| 0.3 | Open popup | Header: SP logo with **20:08** badge over the mark (same offset as icon-128) + OverlayMatchTimer; footer `v1.6.6` | [ ] | |

---

## 1. InplayIP

Open a live/VOD InplayIP match page with the overlay injected.

| # | Action | Expected | ✓ | Notes |
|---|--------|----------|---|-------|
| 1.1 | Confirm HUD | Clock + control panel appear over video | [ ] | |
| 1.2 | Click clock → type `45` → Enter | Clock shows **45:00** (or running from that point) | [ ] | |
| 1.3 | Edit: `45.30` | Accepts → **45:30** | [ ] | |
| 1.4 | Edit: `45,30` | Accepts → **45:30** | [ ] | |
| 1.5 | Edit: `45 30` | Accepts → **45:30** | [ ] | |
| 1.6 | Edit: `45:70` | Stays open; **thin red outline**; hint **Seconds 0–59**; no commit | [ ] | |
| 1.7 | Press **Esc** while editing | Edit cancels; previous valid time restored | [ ] | |
| 1.8 | Popup → Customize → move clock through 6 positions × sizes S–XL × Box/Pill/Minimal | Clock stays clear of OSD/timeline; style matches choice | [ ] | |
| 1.9 | Speed row / panel hide / autohide | Behave as usual; no layout break | [ ] | |
| 1.10 | Trigger an OSD (skip / play) | OSD appears **at top**, not over clock oddly | [ ] | |

---

## 2. Examino (DVR / VOD)

| # | Action | Expected | ✓ | Notes |
|---|--------|----------|---|-------|
| 2.1 | Open Examino DVR or VOD play URL | Overlay injects; clock + panel work | [ ] | |
| 2.2 | Repeat clock edit smoke (`45`, `45.30`, invalid `45:70`, Esc) | Same as InplayIP | [ ] | |
| 2.3 | Kick-off / sync controls you normally use | Still set clock vs video as before | [ ] | |

---

## 3. Local player

| # | Action | Expected | ✓ | Notes |
|---|--------|----------|---|-------|
| 3.1 | Popup → **Open local player** | New window; same HUD chrome | [ ] | |
| 3.2 | Open a local / NAS-mapped file | Playback + clock + shortcuts work | [ ] | |
| 3.3 | Enable ShuttleXpress only on this window if testing device | Toggle stays per-window | [ ] | |

---

## 4. Customize — shortcuts

| # | Action | Expected | ✓ | Notes |
|---|--------|----------|---|-------|
| 4.1 | Rebind Play/Pause to another key | Binding updates; works on page | [ ] | |
| 4.2 | Bind two actions to the same key | Inline **conflict** warning | [ ] | |
| 4.3 | Use a native-ish shortcut (e.g. space) while focused on page | Extension override still fires when expected | [ ] | |
| 4.4 | **Reset all shortcuts** | Defaults restored | [ ] | |

---

## 5. ShuttleXpress (device + Customize)

| # | Action | Expected | ✓ | Notes |
|---|--------|----------|---|-------|
| 5.1 | Enable Shuttle on page; pair device | Connects; cheatsheet/controls as usual | [ ] | |
| 5.2 | Press Btn 1–5, turn Jog, rock Shuttle ring | Correct skip / play-pause / frame / scrub; **OSD** labels unchanged | [ ] | |
| 5.3 | Customize: click **Btn 5** on SVG | **Only** Btn 5 orange on diagram **and** its row; Jog/ring neutral | [ ] | |
| 5.4 | Focus **Jog** select | **Only** Jog highlighted on SVG + row | [ ] | |
| 5.5 | Move Play/Pause to **Btn 5** | Btn 5 = Play/Pause (no number field); Btn 3 = **+2m**; General diagram labels match | [ ] | |
| 5.6 | Press physical Btn 5 / Btn 3 | 5 toggles play; 3 skips +2m; OSD correct | [ ] | |
| 5.7 | **Reset all ShuttleXpress** | Btn 3 Play/Pause; 1 −2m; 2 −10s; 4 +10s; 5 +2m | [ ] | |
| 5.8 | Auto pause on Alt+Tab **ON**, Shuttle **enabled** on page | Alt+Tab does **not** pause (Shuttle skip path) | [ ] | |
| 5.9 | Shuttle **off**, Auto pause **ON** | Alt+Tab pauses; return resumes only if we paused it | [ ] | |

---

## 6. General tab & reset

| # | Action | Expected | ✓ | Notes |
|---|--------|----------|---|-------|
| 6.1 | Default General | Actions open; Shortcuts + Shuttle **collapsed** | [ ] | |
| 6.2 | Open ShuttleXpress | **Diagram only** (live labels); no Btn 1…5 text list | [ ] | |
| 6.3 | **Reset all customizations** | Clock, shortcuts, Shuttle back to defaults | [ ] | |

---

## Sign-off

| Result | |
|--------|--|
| Ready for daily use? | [ ] Yes · [ ] No · [ ] Yes with notes |
| Blockers | |
| Nice-to-haves | |
