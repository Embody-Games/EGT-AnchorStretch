# Anchored Stretch

A Blockbench plugin for the Hytale formats. Only the side you drag ever moves.

Blockbench's Stretch tool scales a cube around its own centre, so pulling one handle moves both faces on that axis. Resizing a cube that already has stretch has a matching problem: the face you are *not* dragging creeps outward. This plugin fixes both, and replaces the stretch tool's drag maths with a fixed step size so values land on round numbers.

## Install

1. Download `anchored_stretch.js`.
2. In Blockbench: **File > Plugins > Load Plugin from File**, and pick it.

Keep the filename as-is. Blockbench takes a side-loaded plugin's id from its filename, so renaming the file registers it as a different plugin.

Requires Blockbench 5.0.5 or newer.

## What it changes

**Stretching is one-sided.** Drag a stretch handle and the face you pulled moves while the opposite face stays at the same coordinates, the way the Resize tool works. Hold **Alt** for the original centred behaviour.

**Stretch moves in fixed steps.** Stock Blockbench derives the value from the snapped drag distance times an eighth, which makes it depend on your snapping settings and on how far you are zoomed out. Here one unit of drag is one step, and the step is a fixed size, so the value always lands on an exact multiple.

**Resizing a stretched cube stays anchored.** Growing a cube's size by `d` used to move the anchored face by `(d / 2) * (1 - stretch)`. It now stays put — on the gizmo, the size sliders and keyboard nudges alike.

**Vertex snap gains a Stretch mode.** Pick a corner, pick a target, and the cube stretches to reach it with the opposite corner anchored. Handy for closing the gap between two cubes at different angles.

Core has a vertex snap *scale* mode, but it is gated behind `condition: () => !Format.integer_size`, so it is hidden and inert in the Hytale formats — and scaling would change the cube's size, which is what the integer size rule exists to prevent. Stretching reaches the same place while leaving size and UVs alone.

Pick the mode from the dropdown in the Vertex Snap toolbar. It stretches on all three axes as needed, each anchored at its opposite face, and the undo bar offers the same ignore-axis options as the other modes. If the target sits behind the anchored face the stretch clamps just above zero rather than turning the cube inside out.

## Settings

Under **Settings > Edit**:

| Setting | Default | What it does |
| --- | --- | --- |
| Anchored Stretch Tool | on | One-sided stretching |
| Stretch per Drag Step | 0 (automatic) | Stretch added per unit of dragging |
| Keep Stretched Cubes Anchored When Resizing | on | The resize fix |

`Stretch per Drag Step` at 0 picks the format's base scale: **0.015625** for `hytale_character`, **0.03125** for `hytale_prop`. The value is total growth, and one-sided mode applies half of it, so a step grows the cube by the same amount whether it is one-sided or centred. Set it to **0.125** to get stock Blockbench speed back. The field takes arithmetic, so `1/64` works.

## Modifiers while dragging

| Held | Effect |
| --- | --- |
| Alt | Centred stretch, the stock behaviour |
| Shift | Half step |
| Ctrl | Quarter step |
| Ctrl + Shift | Eighth step |

An eighth step on a 16-wide character cube is 1/1024 of stretch, which moves the face 1/64 of a unit. Blockbench's snapping settings deliberately do not affect the stretch tool — that coupling is what made it unpredictable in the first place.

## Scope

Both hooks bail out unless the format sets `stretch_cubes`, which no built-in Blockbench format does — only `hytale_character` and `hytale_prop`. Java, Bedrock and everything else are untouched. The resize hook additionally needs the cube to actually be stretched on the axis being resized.

Single-axis handles only. The plane and uniform handles stay centred, matching how the Resize tool treats those same handles.

## How it works

Blockbench renders a cube as:

```
rendered_low  = centre - (half_size + inflate) * stretch
rendered_high = centre + (half_size + inflate) * stretch
```

where `centre` and `half_size` both come from `from`/`to`. Stretch never touches `from`/`to`, which is why the cube grows in both directions. To pin one face the plugin shifts `from`/`to` by exactly the amount the dragged half grew:

```
growth = (stretch_core_applied - stretch_at_drag_start) / 2
delta  = direction * (half_size + inflate) * growth
```

The halving is there because all the growth now lands on one face instead of being split between two, so without it the dragged face would travel twice as far per pixel as it used to. Size is unchanged, so UVs are unaffected, and the cube's origin is left alone. Every value is recomputed from a snapshot taken at the start of the drag rather than accumulated, so the anchored face cannot drift.

Implementation is a wrapper around `TransformerModule.modules.edit` for the stretch tool and around `Cube.prototype.resize` for the resize fix. Both are restored on unload. See the comment block at the top of `anchored_stretch.js`.

## Tests

```
node test_anchored_stretch.js
```

No dependencies. The harness mocks the parts of Blockbench the plugin touches, including copies of core's stretch and resize drag logic, the cube render formula, and enough of THREE for the vertex snap path, then simulates gizmo drags and snaps and checks which rendered faces moved and by how much. 68 cases covering both handle directions, inflate, off-centre, rotated and already-stretched cubes, multi-selection, the modifier factors, snapping independence, drift over long drags, undo/cancel, and clean unload.
