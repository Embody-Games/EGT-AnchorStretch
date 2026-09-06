# Changelog

Generated from `changelog.json` by `scripts/changelog.mjs`. Edit that file, not this one.

## v1.7.2 - New icon artwork

_2026-09-05_

### Changed

- Updated the icon artwork, now 48x48.

## v1.7.1 - Plugin icon

_2026-09-05_

### Added

- Added a plugin icon, embedded as a data URL so the plugin stays a single file. `anchored_stretch_icon.png` is kept in the repo as the source.

## v1.7.0 - Stretch mode for Vertex Snap

_2026-09-04_

### Added

- Vertex Snap gains a **Stretch** mode. Pick a corner, pick a target, and the cube stretches to reach it with the opposite corner anchored — on all three axes as needed. Core's scale mode is hidden in the Hytale formats (`condition: () => !Format.integer_size`) and would change the cube's size; stretching leaves size and UVs alone.
- Supports the same ignore-axis amend options as the other snap modes. A target behind the anchored face clamps the stretch just above zero instead of inverting the cube.

## v1.6.0 - Renamed to Anchored Stretch

_2026-09-04_

### Changed

- Renamed from **One-Sided Stretch** to **Anchored Stretch**, since the plugin does three things rather than one. Behaviour is unchanged.
- Plugin id and filename are now `anchored_stretch`.
- Setting ids renamed to `anchored_stretch_tool`, `anchored_stretch_step`, `anchored_stretch_resize`, so settings reset to defaults on upgrade.

## v1.5.0 - Modifier keys for finer steps

_2026-09-04_

### Added

- Shift, Ctrl and Ctrl+Shift while dragging cut the step to a half, a quarter and an eighth. Blockbench's snapping settings are still not used.

## v1.4.0 - Fixed step sizing

_2026-09-04_

### Added

- New setting **Stretch per Drag Step**, defaulting to the format's base scale — 0.015625 for `hytale_character`, 0.03125 for `hytale_prop`. 0.125 reproduces stock.

### Changed

- Replaced the drag maths outright: one unit of drag is one step of a fixed size, instead of stock's snapped-distance-times-an-eighth. Values now land on exact multiples and the tool no longer depends on the snapping settings or on how far you are zoomed out.

### Removed

- Removed the **Stretch Tool Precision** divisor added in 1.3.0; a step size does the same job directly.

## v1.3.0 - Stretch Tool Precision

_2026-09-04_

### Added

- Added a **Stretch Tool Precision** divisor to slow the gizmo down.

## v1.2.0 - Resizing keeps the anchor

_2026-09-04_

### Added

- New setting **Keep Stretched Cubes Anchored When Resizing**.

### Fixed

- Resizing a cube that already has stretch no longer moves the anchored face. Applies to the gizmo, the size sliders and keyboard nudges.

## v1.1.0 - Correct stretch amount and readout

_2026-09-04_

### Fixed

- Halved the applied stretch in one-sided mode, so the dragged face lands where stock centred stretch would have put it instead of travelling twice as fast.
- The cursor readout now shows the applied value rather than the raw one.

## v1.0.0 - One-sided stretch

_2026-09-04_

### Added

- Initial release. The Stretch tool grows only the side you drag, keeping the opposite face at the same coordinates. Alt restores centred stretch.
