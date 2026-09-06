# Changelog

## 1.8.0 — 2026-09-05

- Vertex Snap gains a second mode, **Resize + Stretch**. It closes the gap by putting as much of it as possible into whole units of size, leaving stretch to cover only the fraction that will not fit, so most of the face keeps genuine texture resolution. Stretch a cube already has is absorbed into whole units on the way through. Rounds to the nearest whole size, so it can squash very slightly as well as stretch.
- New **Bake Stretch into Size** button next to the stretch sliders. Rolls each selected cube's stretch into whole size without moving the cube at all, since the fit preserves the rendered extent exactly.
- The whole-size paths snap positions to 1/65536 of a unit so that `to - from` stays exactly whole in floating point. Worst-case position error is under a millionth of a texel.

## 1.7.2 — 2026-09-05

- Updated the icon artwork, now 48x48.

## 1.7.1 — 2026-09-05

- Added a plugin icon, embedded as a data URL so the plugin stays a single file. `anchored_stretch_icon.png` is kept in the repo as the source.

## 1.7.0 — 2026-09-04

- Vertex Snap gains a **Stretch** mode. Pick a corner, pick a target, and the cube stretches to reach it with the opposite corner anchored — on all three axes as needed. Core's scale mode is hidden in the Hytale formats (`condition: () => !Format.integer_size`) and would change the cube's size; stretching leaves size and UVs alone.
- Supports the same ignore-axis amend options as the other snap modes. A target behind the anchored face clamps the stretch just above zero instead of inverting the cube.

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
