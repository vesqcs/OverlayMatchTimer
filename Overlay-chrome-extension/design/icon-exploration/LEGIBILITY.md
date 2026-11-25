# Icon exploration — legibility notes (v1.6.4)

Goal: OMT must be clearly distinguishable from other Stats Perform extensions in the Chrome toolbar.

## Variants
1. **v1 current** — slash only on #111. Clean brand mark, but identical family to any other SP slash icon → poor differentiator.
2. **v2 clock badge TL** — small 20:08 chip on 48/128. At 48 the digits are tiny; at 16/32 falls back to v1. Differentiator too weak in the toolbar (16px).
3. **v3 orange dial** — dial/dot badge on 48/128. Readable as "has a badge" at 48, invisible at 16. Better than nothing but still a corner ornament.
4. **v4 slash / 20:08 bar** — slashes top, Box-style clock bar bottom. At **48/128** the 20:08 bar is a real structural half of the icon → strong differentiator. At **32** still readable. At **16** the bar collapses to a few pixels; digits are not literally readable but the two-band silhouette differs from plain slash.
5. **v5 clock pill + slash** — the icon *is* the 20:08 Box/pill with a small slash on the left. At **48/128** excellent: immediately "match clock" not "another SP app". At **32** digits still clear. At **16** digits are marginal (blocky) but the horizontal pill silhouette is very distinct from a centred slash tile.
6. **v6 16px specials**
   - **6a slashes + bar strip**: best 16px *family match* to v4; reads as "slash + clock strip" even when digits vanish.
   - **6b stopwatch outline**: clearest non-SP glyph at 16px (orange watch), but departs from the slash brand.

## Honest 16px ranking (toolbar)
1. **v6b stopwatch** — most obviously different from plain SP slash (but least on-brand).
2. **v5 clock pill** — distinctive silhouette; "20:08" not really legible, shape carries it.
3. **v6a / v4** — two-band shape helps; better than v1 when compared side-by-side.
4. **v1 / v2 / v3** — not distinguishable enough at 16px from another SP slash icon.

## Recommendation to owner
- Ship **v5** (or **v4**) as the primary family for 32/48/128.
- Pair with **v6a** (or v5) at 16px so the toolbar slot never looks like a generic SP mark.
- Avoid relying on v2/v3 badges alone — they fail the "real differentiator" test at toolbar size.
