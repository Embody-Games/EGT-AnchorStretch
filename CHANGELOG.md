# Changelog

## 1.6.0 — 2026-09-04

Renamed from **One-Sided Stretch** to **Anchored Stretch**, since the plugin does three things rather than one. Behaviour is unchanged.

- Plugin id and filename are now `anchored_stretch`.
- Setting ids renamed to `anchored_stretch_tool`, `anchored_stretch_step`, `anchored_stretch_resize`, so settings reset to defaults on upgrade.

## 1.5.0 — 2026-09-04

- Shift, Ctrl and Ctrl+Shift while dragging cut the step to a half, a quarter and an eighth. Blockbench's snapping settings are still not used.

## 1.4.0 — 2026-09-04

- Replaced the drag maths outright: one unit of drag is one step of a fixed size, instead of stock's snapped-distance-times-an-eighth. Values now land on exact multiples and the tool no longer depends on the snapping settings or on how far you are zoomed out.
- New setting **Stretch per Drag Step**, defaulting to the format's base scale — 0.015625 for `hytale_character`, 0.03125 for `hytale_prop`. 0.125 reproduces stock.
- Removed the **Stretch Tool Precision** divisor added in 1.3.0; a step size does the same job directly.

## 1.3.0 — 2026-09-04

- Added a **Stretch Tool Precision** divisor to slow the gizmo down.

## 1.2.0 — 2026-09-04

- Resizing a cube that already has stretch no longer moves the anchored face. Applies to the gizmo, the size sliders and keyboard nudges.
- New setting **Keep Stretched Cubes Anchored When Resizing**.

## 1.1.0 — 2026-09-04

- Halved the applied stretch in one-sided mode, so the dragged face lands where stock centred stretch would have put it instead of travelling twice as fast.
- The cursor readout now shows the applied value rather than the raw one.

## 1.0.0 — 2026-09-04

- Initial release. The Stretch tool grows only the side you drag, keeping the opposite face at the same coordinates. Alt restores centred stretch.
