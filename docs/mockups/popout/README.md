# Pop-out always-on-top — concept mockups (not shipped)

Static PNG mockups for Vasco’s review. **No extension code changes.**  
Visual language matches Overlay MatchTimer **2.3.9** (S+Compact panel chrome, orange accent `#F5831F`).

## Images

| # | File | State |
|---|------|--------|
| 1a | `omt_popout_mockup_01_panel_popout_button.png` | Control panel with new **Pop out** button (rest) |
| 1b | `omt_popout_mockup_02_panel_popout_hover_tooltip.png` | Same button with hover tooltip **“Pop out”** |
| 2 | `omt_popout_mockup_03_popout_medium_with_controls.png` | Medium always-on-top window: video + match timer + compact controls + Return |
| 3 | `omt_popout_mockup_04_popout_tiny_video_timer_only.png` | Very small window: video + timer only (controls on hover — recommended) |
| 4 | `omt_popout_mockup_05_original_tab_while_popped_out.png` | Original tab placeholder while popped out |

## Button placement (mockup choice)

Top row of the existing floating panel, **beside the eye/hide control and before LIVE** — same 28×28 icon-button size as More / mute, so it does not crowd transport or LIVE.

## Regenerating

```bash
# from repo root, with playwright available (e.g. test/node_modules)
node docs/mockups/popout/capture.mjs
```

Implementation is **not** approved until Vasco signs off on these mockups.
