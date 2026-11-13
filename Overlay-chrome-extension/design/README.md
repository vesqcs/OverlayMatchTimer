# Design exploration

## Shipped (v1.6.5+)

- Toolbar / store icons: **v2** slash + **20:08** Box badge → `assets/icon-{16,32,48,128}.png`
- Popup header: SP logo + CSS **20:08** chip (`.omt-header-clock`, `left: -6px`)

Regenerate icons: `node scripts/generate-icons.mjs` (needs `sharp`; see root README).

## `header-chip/`

Exploration variants (A beside / B topleft). Variant B-style treatment informed the shipped CSS chip.

## `icon-exploration/`

Toolbar distinguishability study. See `LEGIBILITY.md`. Folders `v1_*` … `v6*` are historical candidates; **v2** was selected for ship.
