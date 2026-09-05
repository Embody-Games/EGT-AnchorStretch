(function () {

/*
 * Anchored Stretch
 *
 * Blockbench's Stretch tool (enabled by formats with `stretch_cubes`, e.g. the
 * Hytale formats) scales a cube around its own centre, so both faces on the
 * dragged axis move outwards. This plugin makes the Stretch tool behave like the
 * Resize tool instead: the face you pull moves, the opposite face stays where it
 * was.
 *
 * How it works
 * ------------
 * Blockbench renders a cube as
 *
 *     rendered_low  = centre - (half_size + inflate) * stretch
 *     rendered_high = centre + (half_size + inflate) * stretch
 *
 * (see adjustFromAndToForInflateAndStretch in js/outliner/types/cube.js), where
 * centre is derived from from/to. Stretch never touches from/to, which is why
 * the cube grows in both directions.
 *
 * To pin one face we shift from/to (i.e. the centre) by exactly the amount the
 * dragged half grew:
 *
 *     delta = direction * (half_size + inflate) * growth
 *
 * direction is +1 when the positive-axis handle is being dragged and -1 for the
 * negative-axis handle. from/to are in the cube's own local space and so is the
 * drag axis, so no space conversion is needed, and the cube's origin/pivot is
 * left alone.
 *
 * Drag rate
 * ---------
 * All of the growth now lands on one face instead of being split between two,
 * so the same drag would move the dragged face twice as far as it used to. To
 * keep the tool feeling like it always did, the applied stretch is halved:
 *
 *     growth = (stretch_core_applied - stretch_at_drag_start) / 2
 *
 * The result is that the face you drag ends up exactly where the stock centred
 * stretch would have put it, and the opposite face simply doesn't move.
 *
 * Step size
 * ---------
 * Stock Blockbench derives the stretch value from the snapped drag distance:
 * round(point[axis] / grid) * grid * 1/8. With a fine snapping setting (a large
 * ctrl_shift_size, say) that grid is tiny, so stretch becomes effectively
 * continuous: nothing lands on a round value and the only thing controlling how
 * fine it feels is how much model space a mouse pixel covers, i.e. the zoom.
 *
 * So the drag value is replaced outright with a fixed step:
 *
 *     steps = round(drag_distance / UNITS_PER_STEP)   // one unit of drag, one step
 *     value = steps * step_size * direction
 *
 * step_size is the growth per step measured the centred way — the total change
 * in stretch. One-sided mode then applies half of it (the halving above), so a
 * step moves the cube by the same amount whether it is one-sided or centred.
 * That is the factor of two to keep in mind: a step_size of 1/64 shows up as
 * 1/128 in the stretch field, and grows the cube exactly as a 1/64 centred step
 * would have.
 *
 * Defaults follow the format's base scale: 1/64 for hytale_character, 1/32 for
 * hytale_prop. 0.125 reproduces stock Blockbench exactly.
 *
 * Snapping settings deliberately no longer affect the stretch tool, since that
 * coupling is what made it unpredictable. Shift, Ctrl and Ctrl+Shift take the
 * place of that: they cut the step to a half, a quarter and an eighth for fine
 * tuning. There is no precision floor worth worrying about — the Hytale codec
 * writes stretch as a raw float (only rotations get rounded, to 3 places).
 *
 * Everything is recomputed from a snapshot taken at the start of the drag rather
 * than accumulated per mouse move, so the anchored face cannot drift.
 *
 * Scope: single-axis handles only. The two-axis (plane) handles and the uniform
 * handle stay centred, matching how the Resize tool treats those same handles —
 * they have no single side to anchor to.
 *
 *
 * Part two: resizing a cube that already has stretch
 * --------------------------------------------------
 * Resize changes from/to, which changes half_size, which changes the centre —
 * and the rendered faces are measured from that centre with stretch applied. So
 * on a stretched cube, growing the size by d moves the face you are NOT dragging
 * by
 *
 *     (d / 2) * (1 - stretch)
 *
 * i.e. the anchored side creeps outward whenever stretch is above 1, and inward
 * below it. Blockbench applies the resize to from/to without accounting for the
 * stretch multiplier at all.
 *
 * The fix wraps Cube.prototype.resize: measure where the anchored rendered face
 * is, let core do the resize, then shift from/to to put that face back. This
 * covers every path into resize — the gizmo, the size sliders in the element
 * panel, and keyboard nudges. Bidirectional resizes are skipped, because they
 * are centred by definition and have no anchored face.
 *
 * One consequence, unavoidable: size is in unstretched units, so one grid step
 * of resize moves the dragged face by (step * stretch) on screen. Blockbench's
 * integer_size rounding (on for the Hytale formats) would round away any attempt
 * to compensate for that, and stretch values in practice sit near 1, so the
 * difference is small.
 */

const PLUGIN_ID = 'anchored_stretch';
const SETTING_ID = 'anchored_stretch_tool';
const RESIZE_SETTING_ID = 'anchored_stretch_resize';
const STEP_SETTING_ID = 'anchored_stretch_step';

// Growth per step, measured the centred way, per format. One-sided mode applies
// half of this so the cube grows by the same amount either way.
const AUTO_STEPS = {
	hytale_character: 0.015625, // 1/64
	hytale_prop: 0.03125        // 1/32, double, matching the 32x base scale
};
const FALLBACK_STEP = 0.015625;
const STOCK_STEP = 0.125;

// Model units of drag per step, matching the resize tool's one unit per step.
const UNITS_PER_STEP = 1;

// Vertex snap: the mode key added to BarItems.vertex_snap_mode, and the floor a
// stretch is clamped to when the target sits behind the anchored face.
const VERTEX_SNAP_MODE = 'stretch';
const MIN_STRETCH = 0.0001;

// Held modifiers cut the step down for fine tuning. Alt is not among them; it
// switches back to centred stretch.
const SHIFT_FACTOR = 1 / 2;
const CTRL_FACTOR = 1 / 4;
const CTRL_SHIFT_FACTOR = 1 / 8;

// The plugin icon, embedded so the plugin stays a single file wherever it is
// loaded from. Blockbench's getIconNode accepts any data:image/ URL.
const ICON = 'data:image/png;base64,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';

let stretch_setting;
let resize_setting;
let step_setting;
let edit_module;
let originals = {};
let wrappers = {};
let original_resize;
let resize_wrapper;
let original_snap;
let snap_wrapper;
let mode_option_added = false;

// uuid -> { from, to, stretch } captured when a stretch drag starts
let snapshots = new Map();

function enabled() {
	return !settings[SETTING_ID] || settings[SETTING_ID].value !== false;
}

function resizeAnchorEnabled() {
	return !settings[RESIZE_SETTING_ID] || settings[RESIZE_SETTING_ID].value !== false;
}

/**
 * Growth per drag step, measured the centred way. The setting overrides; 0 (or
 * anything unusable) falls back to the current format's base scale.
 */
function stretchStep() {
	let setting = settings[STEP_SETTING_ID];
	let value = setting ? parseFloat(setting.value) : 0;
	if (isFinite(value) && value > 0) return value;
	let format_id = Format && Format.id;
	return AUTO_STEPS[format_id] || FALLBACK_STEP;
}

/** Shift halves the step, Ctrl quarters it, both together take an eighth. */
function stretchModifierFactor(event) {
	let overrides = (typeof Pressing !== 'undefined' && Pressing.overrides) || {};
	let shift = !!((event && event.shiftKey) || overrides.shift);
	let ctrl = !!((event && (event.ctrlOrCmd || event.ctrlKey || event.metaKey)) || overrides.ctrl);

	if (shift && ctrl) return CTRL_SHIFT_FACTOR;
	if (ctrl) return CTRL_FACTOR;
	if (shift) return SHIFT_FACTOR;
	return 1;
}

/**
 * Replaces core's snapped-distance-times-an-eighth with a fixed step per unit of
 * drag. The axis remap for the two-axis handles is core's, kept so those handles
 * keep reading the same axis they always did.
 */
function stretchOffset(context) {
	let {point, axis, second_axis} = context;
	if (second_axis) {
		if (axis == 'y') { axis = 'z'; }
		else if (second_axis == 'y') { axis = 'y'; }
		else if (second_axis == 'z') { axis = 'x'; }
	}

	let distance;
	if (axis == 'e') {
		let length = typeof point.length === 'function'
			? point.length()
			: Math.sqrt(point.x * point.x + point.y * point.y + point.z * point.z);
		distance = length * Math.sign(point.y || point.x);
	} else {
		distance = point[axis];
	}
	if (!isFinite(distance)) return 0;

	let steps = Math.round(distance / UNITS_PER_STEP);
	let step = stretchStep() * stretchModifierFactor(context.event);
	return steps * step * (context.direction === -1 ? -1 : 1);
}

/** Where a rendered face of `element` sits on `axis`. Mirrors adjustFromAndToForInflateAndStretch. */
function renderedFace(element, axis, high) {
	let half_size = element.size(axis) / 2;
	let centre = element.from[axis] + half_size;
	let reach = (half_size + (element.inflate || 0)) * element.stretch[axis];
	return high ? centre + reach : centre - reach;
}

function stretchDrag() {
	return Format && Format.stretch_cubes && Toolbox.selected && Toolbox.selected.id === 'stretch_tool';
}

function canStretch(element) {
	return element
		&& element.stretch instanceof Array
		&& element.from instanceof Array
		&& element.to instanceof Array;
}

/**
 * Alt temporarily restores the original centred stretch, mirroring how Alt flips
 * the Resize tool between one-sided and bidirectional. Skipped when Alt is bound
 * to the "swap tools" shortcut, same check the Resize tool makes.
 */
function altOverride(event) {
	let alt = (event && event.altKey) || (typeof Pressing !== 'undefined' && Pressing.overrides && Pressing.overrides.alt);
	if (!alt) return false;
	if (BarItems.swap_tools && BarItems.swap_tools.keybind && BarItems.swap_tools.keybind.key == 18) return false;
	return true;
}

function takeSnapshots() {
	snapshots.clear();
	for (let element of Outliner.selected) {
		if (!canStretch(element)) continue;
		snapshots.set(element.uuid, {
			from: element.from.slice(),
			to: element.to.slice(),
			stretch: element.stretch.slice()
		});
	}
}

function anchorOppositeSide(context) {
	// Two-axis and uniform handles have no single side to pull, so leave them
	// centred, exactly like the Resize tool does.
	if (context.second_axis || context.axis === 'e') return;

	let axis = context.axis_number;
	if (typeof axis !== 'number' || axis < 0 || axis > 2) return;

	let direction = context.direction === -1 ? -1 : 1;
	// Alt falls back to core's centred stretch: the full growth, and from/to put
	// back where the drag started.
	let centred = altOverride(context.event);
	let affected = [];
	let applied_growth = 0;

	for (let element of Outliner.selected) {
		let snapshot = snapshots.get(element.uuid);
		if (!snapshot || !canStretch(element)) continue;

		// Half the growth, because all of it lands on one face now instead of
		// being split between two. This puts the dragged face exactly where the
		// stock centred stretch would have put it.
		let raw_growth = element.stretch[axis] - snapshot.stretch[axis];
		let growth = centred ? raw_growth : raw_growth / 2;
		let stretch = snapshot.stretch[axis] + growth;
		applied_growth = growth;

		// Half size is taken from the snapshot, so our own repositioning can
		// never feed back into it.
		let half_size = (snapshot.to[axis] - snapshot.from[axis]) / 2;
		let reach = half_size + (element.inflate || 0);
		let delta = centred ? 0 : direction * reach * growth;

		let from = snapshot.from[axis] + delta;
		let to = snapshot.to[axis] + delta;

		if (element.from[axis] !== from || element.to[axis] !== to || element.stretch[axis] !== stretch) {
			element.from[axis] = from;
			element.to[axis] = to;
			element.stretch[axis] = stretch;
			affected.push(element);
		}
	}

	if (!affected.length) return;

	// Core's cursor tooltip shows the un-halved value
	if (!centred && typeof Blockbench !== 'undefined' && Blockbench.setCursorTooltip && typeof trimFloatNumber === 'function') {
		Blockbench.setCursorTooltip(trimFloatNumber(applied_growth));
	}

	for (let element of affected) {
		if (element.visibility !== false && element.preview_controller && element.preview_controller.updateGeometry) {
			element.preview_controller.updateGeometry(element);
		}
	}
	if (typeof updateNslideValues === 'function') updateNslideValues();
}

/**
 * Vertex snap, stretch mode.
 *
 * Core's vertex snap has a scale mode, but it is gated behind
 * `condition: () => !Format.integer_size`, so it is hidden and inert in the
 * Hytale formats. Scaling would also change the cube's size, which is what the
 * integer size rule exists to prevent. Stretching reaches the same place while
 * leaving size — and therefore the UV map — alone.
 *
 * Per axis, to move the picked corner by d while the opposite face stays put:
 *
 *     stretch += sign * d / (2 * reach)      // reach = half_size + inflate
 *     from/to += sign * reach * change_in_stretch     // = d/2 when unclamped
 *
 * sign is +1 when the picked corner is on the axis's high side. The from/to
 * shift is written in terms of the stretch actually applied rather than d/2
 * directly, so the anchor still holds when the stretch is clamped.
 */
function applyVertexStretch(element, offset, mesh_space_vertex, ignore) {
	let changed = false;
	let clamped = false;

	for (let axis = 0; axis < 3; axis++) {
		if (ignore && ignore[axis]) continue;
		let d = offset[axis];
		if (!d || !isFinite(d)) continue;

		let half_size = element.size(axis) / 2;
		let reach = half_size + (element.inflate || 0);
		if (Math.abs(reach) < 1e-9) continue; // flat on this axis, nothing to scale

		let centre = element.from[axis] + half_size;
		// mesh space is model space minus the origin, so put the vertex back into
		// model space before deciding which side of the cube it sits on
		let high = (mesh_space_vertex[axis] + element.origin[axis]) >= centre;
		let sign = high ? 1 : -1;

		let before = element.stretch[axis];
		let after = before + sign * d / (2 * reach);
		if (after < MIN_STRETCH) {
			after = MIN_STRETCH;
			clamped = true;
		}
		if (after === before) continue;

		let shift = sign * reach * (after - before);
		element.from[axis] += shift;
		element.to[axis] += shift;
		element.stretch[axis] = after;
		changed = true;
	}

	return {changed, clamped};
}

/** Stands in for Vertexsnap.snap while the stretch mode is picked. */
function vertexStretchSnap(data, options, amended) {
	let elements = Vertexsnap.elements.slice();
	if (Vertexsnap.groups && Vertexsnap.groups.length) {
		for (let group of Vertexsnap.groups) {
			group.forEachChild(child => elements.safePush(child), OutlinerElement);
		}
	}
	Undo.initEdit({elements, groups: Vertexsnap.groups}, amended);

	let ignore_axis = options && options.ignore_axis;
	let ignore = [!!(ignore_axis && ignore_axis.x), !!(ignore_axis && ignore_axis.y), !!(ignore_axis && ignore_axis.z)];

	let target = Vertexsnap.getGlobalVertexPos(data.element, data.vertex);
	let global_delta = new THREE.Vector3().copy(target).sub(Vertexsnap.vertex_pos);
	let clamped = false;

	for (let element of elements) {
		if (!canStretch(element) || typeof element.size !== 'function' || !element.mesh) continue;

		let rotation = element.mesh.getWorldQuaternion(new THREE.Quaternion()).invert();
		let offset = new THREE.Vector3().copy(global_delta).applyQuaternion(rotation).toArray();
		let vertex = element.mesh.worldToLocal(new THREE.Vector3().copy(Vertexsnap.vertex_pos)).toArray();

		let result = applyVertexStretch(element, offset, vertex, ignore);
		clamped = clamped || result.clamped;
	}

	Vertexsnap.clearVertexGizmos();
	let update_options = {
		elements,
		element_aspects: {transform: true, geometry: true},
		selection: true
	};
	if (Vertexsnap.groups && Vertexsnap.groups.length) {
		update_options.groups = Vertexsnap.groups;
		update_options.group_aspects = {transform: true};
	}
	Canvas.updateView(update_options);
	Undo.finishEdit('Vertex snap stretch');
	Vertexsnap.step1 = true;

	if (clamped && typeof Blockbench !== 'undefined' && Blockbench.showQuickMessage) {
		Blockbench.showQuickMessage('Target sits behind the anchored side', 2500);
	}

	if (!amended) {
		Undo.amendEdit({
			ignore_axis: {
				type: 'inline_multi_select',
				label: tl('edit.vertex_snap.ignore_axis', ''),
				options: {x: 'X', y: 'Y', z: 'Z'},
				value: {x: false, y: false, z: false}
			}
		}, form => {
			Vertexsnap.snap(data, form, true);
		});
	}
}

function patchVertexSnap() {
	if (typeof Vertexsnap === 'undefined' || typeof Vertexsnap.snap !== 'function') {
		console.error('[Anchored Stretch] Could not find Vertexsnap.snap; the vertex snap stretch mode is inactive.');
		return;
	}

	original_snap = Vertexsnap.snap;
	snap_wrapper = function (data, options = 0, amended) {
		let mode = BarItems.vertex_snap_mode && BarItems.vertex_snap_mode.get();
		let mine = mode === VERTEX_SNAP_MODE
			&& Format && Format.stretch_cubes
			&& !Vertexsnap.move_origin;

		if (!mine) return original_snap.call(this, data, options, amended);
		return vertexStretchSnap(data, options, amended);
	};
	Vertexsnap.snap = snap_wrapper;

	// Add the mode to the existing dropdown. `open()` reads `options` live and
	// `trigger()` (wheel / keybind cycling) reads `values`, so both need the key.
	let select = BarItems.vertex_snap_mode;
	if (select && select.options && !select.options[VERTEX_SNAP_MODE]) {
		select.options[VERTEX_SNAP_MODE] = {
			name: 'Stretch',
			condition: () => Format && Format.stretch_cubes
		};
		if (select.values && !select.values.includes(VERTEX_SNAP_MODE)) {
			select.values.push(VERTEX_SNAP_MODE);
		}
		mode_option_added = true;
	}
}

function unpatchVertexSnap() {
	if (original_snap && typeof Vertexsnap !== 'undefined' && Vertexsnap.snap === snap_wrapper) {
		Vertexsnap.snap = original_snap;
	}
	original_snap = null;
	snap_wrapper = null;

	let select = typeof BarItems !== 'undefined' && BarItems.vertex_snap_mode;
	if (mode_option_added && select) {
		if (select.value === VERTEX_SNAP_MODE && select.set) select.set('move');
		if (select.options) delete select.options[VERTEX_SNAP_MODE];
		if (select.values) select.values.remove(VERTEX_SNAP_MODE);
	}
	mode_option_added = false;
}

function patchResize() {
	if (typeof Cube === 'undefined' || typeof Cube.prototype.resize !== 'function') {
		console.error('[Anchored Stretch] Could not find Cube.prototype.resize; the resize anchor fix is inactive.');
		return;
	}
	original_resize = Cube.prototype.resize;

	resize_wrapper = function (val, axis, negative, allow_negative, bidirectional) {
		let skip = bidirectional
			|| !resizeAnchorEnabled()
			|| !Format || !Format.stretch_cubes
			|| !this.stretch
			|| typeof this.stretch[axis] !== 'number'
			|| this.stretch[axis] === 1;

		if (skip) {
			return original_resize.call(this, val, axis, negative, allow_negative, bidirectional);
		}

		// Work out which face core is going to hold still, including the flip it
		// applies to cubes with a negative size.
		let before = (this.temp_data && this.temp_data.old_size != undefined) ? this.temp_data.old_size : this.size(axis);
		if (before instanceof Array) before = before[axis];
		let keep_high = !!negative;
		if (before < 0 && allow_negative == null) keep_high = !keep_high;

		let anchored = renderedFace(this, axis, keep_high);

		let result = original_resize.call(this, val, axis, negative, allow_negative, bidirectional);

		let drift = anchored - renderedFace(this, axis, keep_high);
		if (drift) {
			this.from[axis] += drift;
			this.to[axis] += drift;
			if (this.visibility !== false && this.preview_controller && this.preview_controller.updateGeometry) {
				this.preview_controller.updateGeometry(this);
			}
		}
		return result;
	};

	Cube.prototype.resize = resize_wrapper;
}

function patch() {
	patchResize();
	patchVertexSnap();
	edit_module = typeof TransformerModule !== 'undefined' && TransformerModule.modules && TransformerModule.modules.edit;
	if (!edit_module) {
		console.error('[Anchored Stretch] Could not find the edit transform module. This plugin needs Blockbench 5.0.5 or newer.');
		return;
	}

	originals.calculateOffset = edit_module.calculateOffset;
	originals.onStart = edit_module.onStart;
	originals.onMove = edit_module.onMove;
	originals.onEnd = edit_module.onEnd;
	originals.onCancel = edit_module.onCancel;

	wrappers.calculateOffset = function (context) {
		if (enabled() && stretchDrag() && context && context.point) {
			return stretchOffset(context);
		}
		return originals.calculateOffset.call(this, context);
	};

	wrappers.onStart = function (context) {
		let result = originals.onStart.call(this, context);
		if (enabled() && stretchDrag()) takeSnapshots();
		return result;
	};

	wrappers.onMove = function (context) {
		let result = originals.onMove.call(this, context);
		if (enabled() && stretchDrag() && snapshots.size) anchorOppositeSide(context);
		return result;
	};

	wrappers.onEnd = function (context) {
		snapshots.clear();
		return originals.onEnd.call(this, context);
	};

	wrappers.onCancel = function (context) {
		snapshots.clear();
		return originals.onCancel.call(this, context);
	};

	for (let key in wrappers) {
		edit_module[key] = wrappers[key];
	}
}

function unpatch() {
	snapshots.clear();
	unpatchVertexSnap();

	// Only restore if nothing else has wrapped us in the meantime.
	if (original_resize && typeof Cube !== 'undefined' && Cube.prototype.resize === resize_wrapper) {
		Cube.prototype.resize = original_resize;
	}
	original_resize = null;
	resize_wrapper = null;

	if (!edit_module) return;
	for (let key in wrappers) {
		if (edit_module[key] === wrappers[key]) {
			edit_module[key] = originals[key];
		}
	}
	edit_module = null;
	originals = {};
	wrappers = {};
}

Plugin.register(PLUGIN_ID, {
	title: 'Anchored Stretch',
	author: 'Embody Games',
	description: 'Only the side you drag ever expands. Makes the Stretch tool one-sided instead of centred, and stops resizing a stretched cube from creeping outward on the anchored side.',
	about: [
		'Blockbench\'s Stretch tool scales cubes around their centre, so both faces on an axis move when you drag one handle. With this plugin the dragged face moves and the opposite face stays put: the cube\'s from/to are repositioned by the same amount the stretched half grew.',
		'',
		'- Since all the growth lands on one face, the applied stretch is halved, so the face you drag tracks at the rate it always did rather than twice as fast.',
		'- **Stretch per Drag Step** sets a fixed step instead of stock\'s snapped-distance maths, so the value lands on round numbers and the tool no longer gets coarser as you zoom out. It defaults to the format\'s base scale: 0.015625 for Hytale characters, 0.03125 for props. One-sided mode applies half the step, so the cube grows by the same amount either way.',
		'- Hold **Shift** for half a step, **Ctrl** for a quarter, both for an eighth.',
		'- The Vertex Snap tool gains a **Stretch** mode: pick a corner, pick a target, and the cube stretches to reach it with the opposite corner anchored. Core\'s scale mode is hidden in the Hytale formats because it would break integer sizes; stretching leaves size and UVs alone.',
		'- Works on the single-axis stretch handles. The plane and uniform handles stay centred, same as with the Resize tool.',
		'- Hold **Alt** while dragging for centred stretch.',
		'',
		'It also fixes the other half of the problem: **resizing** a cube that already has stretch moves the anchored face too, because Blockbench applies the size change to from/to without accounting for the stretch multiplier. The anchored face is now put back where it was, on the gizmo, the size sliders and keyboard nudges alike.',
		'',
		'All three settings live under Settings > Edit.',
		'',
		'Only active in formats that support cube stretching, such as the Hytale formats.'
	].join('\n'),
	icon: ICON,
	version: '1.7.1',
	variant: 'both',
	min_version: '5.0.5',
	tags: ['Hytale', 'Transform'],
	onload() {
		stretch_setting = new Setting(SETTING_ID, {
			name: 'Anchored Stretch Tool',
			description: 'Stretch cubes only on the side you drag, keeping the opposite face in place. Hold Alt while dragging to stretch from the centre instead.',
			category: 'edit',
			value: true,
			plugin: PLUGIN_ID
		});
		step_setting = new Setting(STEP_SETTING_ID, {
			name: 'Stretch per Drag Step',
			description: 'Stretch added per unit of dragging, as total growth. One-sided stretch applies half of this, so a step grows the cube by the same amount either way. 0 picks the format\'s base scale: 0.015625 for Hytale characters, 0.03125 for props. 0.125 is stock Blockbench. Hold Shift, Ctrl or both while dragging for a half, a quarter or an eighth of the step; the snapping settings are not used.',
			category: 'edit',
			type: 'number',
			value: 0,
			min: 0,
			max: 1,
			step: 0.0078125,
			plugin: PLUGIN_ID
		});
		resize_setting = new Setting(RESIZE_SETTING_ID, {
			name: 'Keep Stretched Cubes Anchored When Resizing',
			description: 'When resizing a cube that has stretch applied, keep the face you are not dragging at the same coordinates instead of letting it creep outward.',
			category: 'edit',
			value: true,
			plugin: PLUGIN_ID
		});
		patch();
	},
	onunload() {
		unpatch();
		for (let setting of [stretch_setting, resize_setting, step_setting]) {
			if (setting) setting.delete();
		}
		stretch_setting = resize_setting = step_setting = null;
	}
});

})();
