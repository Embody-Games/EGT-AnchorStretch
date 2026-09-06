/*
 * Test harness for anchored_stretch.js
 *
 * Mocks the parts of Blockbench 5.x the plugin touches:
 *  - TransformerModule.dispatchMove and the 'edit' module's
 *    calculateOffset/onStart/onMove for stretch_tool and resize_tool, copied
 *    from js/modeling/transform/edit_transform.js
 *  - Cube.prototype.resize and the render formula
 *    (adjustFromAndToForInflateAndStretch), copied from js/outliner/types/cube.js
 *
 * Then it simulates gizmo drags and slider edits and checks which rendered faces
 * moved, and how far.
 */

const fs = require('fs');
const assert = require('assert');

let SNAP = 1; // canvasGridSize() default

// ---------------------------------------------------------------- Blockbench mocks

const settings = {
	negative_size: {value: false},
	transform_cube_from_center: {value: false}
};
class Setting {
	constructor(id, data) {
		this.id = id;
		this.value = data.value;
		this.category = data.category;
		settings[id] = this;
	}
	delete() { delete settings[this.id]; }
}

let last_tooltip = null;
const Blockbench = {setCursorTooltip(value) { last_tooltip = value; }};
const trimFloatNumber = n => n;

const Format = {stretch_cubes: true, integer_size: true, id: 'hytale_prop'};
const Toolbox = {selected: {id: 'stretch_tool', transformerMode: 'stretch'}};
const Outliner = {selected: []};
const Mesh = {hasSelected: () => false};
const BarItems = {swap_tools: {keybind: {key: 66}}};
const Pressing = {overrides: {shift: false, ctrl: false, alt: false}};
let nslide_updates = 0;
function updateNslideValues() { nslide_updates++; }

let uuid_counter = 0;
class Cube {
	constructor({from, to, stretch = [1, 1, 1], inflate = 0}) {
		this.uuid = 'cube-' + (++uuid_counter);
		this.from = from.slice();
		this.to = to.slice();
		this.stretch = stretch.slice();
		this.inflate = inflate;
		this.visibility = true;
		this.temp_data = {};
		let self = this;
		this.preview_controller = {updateGeometry() { self.geometry_updates = (self.geometry_updates || 0) + 1; }};
	}
	size(axis) {
		if (typeof axis === 'number') return this.to[axis] - this.from[axis];
		return [0, 1, 2].map(i => this.to[i] - this.from[i]);
	}
	getTypeBehavior(key) { return key === 'stretchable' || key === 'resizable'; }
	isStretched() { return !this.stretch.every(v => v === 1); }

	// js/outliner/types/cube.js -> Cube.prototype.resize (UV + size limiter omitted)
	resize(val, axis, negative, allow_negative, bidirectional) {
		let before = this.temp_data.old_size != undefined ? this.temp_data.old_size : this.size(axis);
		if (before instanceof Array) before = before[axis];
		let is_inverted = before < 0;
		if (is_inverted && allow_negative == null) negative = !negative;
		let modify = val instanceof Function ? val : n => (n + val);

		if (bidirectional) {
			let center = this.temp_data.oldCenter[axis] || 0;
			let difference = modify(before) - before;
			if (negative) difference *= -1;
			let from = center - (before / 2) - difference;
			let to = center + (before / 2) + difference;
			if (Format.integer_size) {
				from = Math.round(from - this.from[axis]) + this.from[axis];
				to = Math.round(to - this.to[axis]) + this.to[axis];
			}
			this.from[axis] = from;
			this.to[axis] = to;
			if (from > to && !(settings.negative_size.value || allow_negative)) {
				this.from[axis] = this.to[axis] = (from + to) / 2;
			}
		} else if (!negative) {
			let pos = this.from[axis] + modify(before);
			if (Format.integer_size) pos = Math.round(pos - this.from[axis]) + this.from[axis];
			if (pos >= this.from[axis] || settings.negative_size.value || allow_negative) {
				this.to[axis] = pos;
			} else {
				this.to[axis] = this.from[axis];
			}
		} else {
			let pos = this.to[axis] + modify(-before);
			if (Format.integer_size) pos = Math.round(pos - this.to[axis]) + this.to[axis];
			if (pos <= this.to[axis] || settings.negative_size.value || allow_negative) {
				this.from[axis] = pos;
			} else {
				this.from[axis] = this.to[axis];
			}
		}
		this.preview_controller.updateGeometry(this);
		return this;
	}
}
const MockCube = Cube;

// js/outliner/types/cube.js -> adjustFromAndToForInflateAndStretch
function renderedBounds(element) {
	let half = element.size().map(v => v / 2);
	let centre = element.from.map((from, i) => from + half[i]);
	return {
		from: centre.map((c, i) => c - (half[i] + element.inflate) * element.stretch[i]),
		to: centre.map((c, i) => c + (half[i] + element.inflate) * element.stretch[i])
	};
}

// js/modeling/transform/transform_modules.ts
class TransformerModule {
	constructor(id, options) {
		this.id = id;
		Object.assign(this, options);
		this.previous_value = null;
		this.initial_value = null;
		this.has_changed = false;
		TransformerModule.modules[id] = this;
	}
	dispatchPointerDown() {
		this.previous_value = null;
		this.initial_value = null;
	}
	dispatchMove(context) {
		let value = this.calculateOffset(context);
		if (this.previous_value == null) this.previous_value = value;
		if (this.initial_value == null) this.initial_value = value;
		if (value != this.previous_value || !this.has_changed) {
			context.value = value;
			if (!this.has_changed && this.onStart) this.onStart(context);
			if (this.onMove) this.onMove(context);
			this.previous_value = value;
			this.has_changed = true;
		}
	}
	dispatchEnd(context) {
		if (this.onEnd) this.onEnd(context);
		this.has_changed = false;
	}
	dispatchCancel(context) {
		if (this.onCancel) this.onCancel(context);
		this.has_changed = false;
	}
}
TransformerModule.modules = {};

// js/modeling/transform/edit_transform.js, resize_tool + stretch_tool paths
new TransformerModule('edit', {
	calculateOffset(context) {
		let {point, axis, second_axis} = context;
		let tool_id = Toolbox.selected.id;
		if (tool_id !== 'stretch_tool' && tool_id !== 'resize_tool') throw new Error('mock covers resize/stretch only');
		if (second_axis) {
			if (axis == 'y') { axis = 'z'; }
			else if (second_axis == 'y') { axis = 'y'; }
			else if (second_axis == 'z') { axis = 'x'; }
		}
		let move_value = point[axis];
		if (axis == 'e') move_value = Math.hypot(point.x, point.y, point.z) * Math.sign(point.y || point.x);
		move_value = Math.round(move_value / SNAP) * SNAP;
		if (tool_id === 'stretch_tool') move_value *= context.direction * 1 / 8;
		return move_value;
	},
	onStart(context) {
		Outliner.selected.forEach(obj => {
			obj.temp_data.old_size = obj.size();
			obj.temp_data.oldStretch = obj.stretch.slice();
			obj.temp_data.oldCenter = obj.from.map((from, i) => (from + obj.to[i]) / 2);
		});
		this.undo_snapshot = Outliner.selected.map(el => ({el, from: el.from.slice(), to: el.to.slice(), stretch: el.stretch.slice()}));
	},
	onMove(context) {
		let {event, axis, axis_number, value, second_axis, second_axis_number} = context;
		let tool_id = Toolbox.selected.id;

		if (tool_id === 'resize_tool') {
			let bidirectional = ((event.altKey || Pressing.overrides.alt) && BarItems.swap_tools.keybind.key != 18) !== Mesh.hasSelected();
			Outliner.selected.forEach(obj => {
				if (axis == 'e') {
					obj.resize(value, 0, false, null, true);
					obj.resize(value, 1, false, null, true);
					obj.resize(value, 2, false, null, true);
				} else if (!second_axis) {
					obj.resize(value, axis_number, context.direction == -1, null, bidirectional);
				} else {
					obj.resize(value, axis_number, false, null, true);
					obj.resize(value, second_axis_number, false, null, true);
				}
			});
			Blockbench.setCursorTooltip(trimFloatNumber(value * context.direction));
			updateNslideValues();
			return;
		}

		Outliner.selected.forEach(obj => {
			if (obj.stretch && obj.temp_data.oldStretch) {
				if (axis == 'e') {
					obj.stretch[0] = obj.temp_data.oldStretch[0] + value;
					obj.stretch[1] = obj.temp_data.oldStretch[1] + value;
					obj.stretch[2] = obj.temp_data.oldStretch[2] + value;
				} else if (!second_axis) {
					obj.stretch[axis_number] = obj.temp_data.oldStretch[axis_number] + value;
				} else {
					obj.stretch[axis_number] = obj.temp_data.oldStretch[axis_number] + value;
					obj.stretch[second_axis_number] = obj.temp_data.oldStretch[second_axis_number] + value;
				}
			}
		});
		Blockbench.setCursorTooltip(trimFloatNumber(value)); // displayDistance()
		Outliner.selected.forEach(el => el.preview_controller.updateGeometry(el));
		updateNslideValues();
	},
	onEnd() {
		Outliner.selected.forEach(obj => { obj.temp_data = {}; });
	},
	onCancel() {
		(this.undo_snapshot || []).forEach(s => {
			s.el.from = s.from.slice();
			s.el.to = s.to.slice();
			s.el.stretch = s.stretch.slice();
		});
		Outliner.selected.forEach(obj => { obj.temp_data = {}; });
	}
});

/** js/modeling/transform.js -> resizeOnAxis, i.e. the size sliders in the element panel */
function resizeOnAxis(modify, axis) {
	Outliner.selected.forEach(obj => {
		let center = Math.min(obj.from[axis], obj.to[axis]) + Math.abs(obj.to[axis] - obj.from[axis]) / 2;
		obj.resize(modify, axis, false, true, false);
		if (settings.transform_cube_from_center.value) {
			let offset = (obj.from[axis] + obj.to[axis]) / 2 - center;
			obj.from[axis] -= offset;
			obj.to[axis] -= offset;
			obj.preview_controller.updateGeometry(obj);
		}
	});
}

// ---------------------------------------------------------------- vertex snap mocks

/** Enough of THREE for the vertex snap path: Vector3 and unit Quaternions. */
class Vector3 {
	constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
	copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
	set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
	add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
	sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
	toArray() { return [this.x, this.y, this.z]; }
	fromArray(a) { this.x = a[0]; this.y = a[1]; this.z = a[2]; return this; }
	applyQuaternion(q) { // three.js Vector3.applyQuaternion
		const {x, y, z} = this;
		const ix = q.w * x + q.y * z - q.z * y;
		const iy = q.w * y + q.z * x - q.x * z;
		const iz = q.w * z + q.x * y - q.y * x;
		const iw = -q.x * x - q.y * y - q.z * z;
		this.x = ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y;
		this.y = iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z;
		this.z = iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x;
		return this;
	}
}
class Quaternion {
	constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
	copy(q) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; }
	invert() { this.x *= -1; this.y *= -1; this.z *= -1; return this; } // unit quaternions only
	static fromAxisAngle(axis, degrees) {
		let half = (degrees * Math.PI / 180) / 2;
		let s = Math.sin(half);
		return new Quaternion(axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half));
	}
}
const THREE = {Vector3, Quaternion};

/** Gives a cube a mesh positioned at its origin, optionally rotated. */
function attachMesh(cube, quaternion = new Quaternion()) {
	cube.origin = cube.origin || [0, 0, 0];
	cube.mesh = {
		quaternion,
		getWorldQuaternion(target) { return target.copy(quaternion); },
		worldToLocal(v) {
			v.sub({x: cube.origin[0], y: cube.origin[1], z: cube.origin[2]});
			let inverse = new Quaternion().copy(quaternion).invert();
			return v.applyQuaternion(inverse);
		}
	};
	return cube;
}

const undo_log = [];
const Undo = {
	initEdit(aspects, amended) { undo_log.push({call: 'initEdit', amended: !!amended, aspects}); },
	finishEdit(name) { undo_log.push({call: 'finishEdit', name}); },
	amendEdit(form, callback) { undo_log.push({call: 'amendEdit', form}); Undo.last_amend = {form, callback}; },
	last_amend: null
};
const canvas_updates = [];
const Canvas = {updateView(options) { canvas_updates.push(options); }};
const tl = key => key;
class OutlinerElement {}

let snap_calls = [];
const Vertexsnap = {
	step1: true,
	elements: [],
	groups: [],
	move_origin: false,
	vertex_pos: new Vector3(),
	vertex_index: 0,
	getGlobalVertexPos(element, vertex) { return new Vector3().fromArray(vertex); },
	clearVertexGizmos() {},
	snap(data, options = 0, amended) { snap_calls.push({data, options, amended, mode: BarItems.vertex_snap_mode.get()}); }
};

/** Minimal stand-in for core's BarSelect, matching how open()/trigger() read it. */
BarItems.vertex_snap_mode = {
	value: 'move',
	values: ['move', 'scale', 'rotate'],
	options: {move: true, scale: {condition: () => !Format.integer_size, name: true}, rotate: true},
	get() { return this.value; },
	set(key) { this.value = key; return this; }
};

Blockbench.showQuickMessage = function (text) { Blockbench.last_quick_message = text; };

const Modes = {edit: true};
Cube.all = [];
Cube.selected = [];

/** Minimal Action + Toolbar, matching how core's delete() unhooks itself. */
class Action {
	constructor(id, data) {
		this.id = id;
		Object.assign(this, data);
		this.toolbars = [];
		BarItems[id] = this;
	}
	delete() {
		this.toolbars.slice().forEach(bar => bar.remove(this));
		delete BarItems[this.id];
	}
}
class Toolbar {
	constructor(id) { this.id = id; this.children = []; }
	add(item) { this.children.push(item); item.toolbars.push(this); return this; }
	remove(item) {
		let i = this.children.indexOf(item);
		if (i !== -1) this.children.splice(i, 1);
		let j = item.toolbars.indexOf(this);
		if (j !== -1) item.toolbars.splice(j, 1);
		return this;
	}
}
const Toolbars = {element_stretch: new Toolbar('element_stretch')};

const registered = {};
const Plugin = {
	register(id, data) {
		registered[id] = data;
		data.onload();
	}
};

Object.assign(globalThis, {
	settings, Setting, Format, Toolbox, Outliner, Mesh, BarItems, Pressing, Blockbench,
	trimFloatNumber, updateNslideValues, TransformerModule, Plugin, Cube,
	THREE, Vertexsnap, Undo, Canvas, OutlinerElement, tl,
	Action, Toolbar, Toolbars, Modes
});

// Array.remove, used by the plugin when it takes its mode back out of the dropdown
if (!Array.prototype.remove) {
	Object.defineProperty(Array.prototype, 'remove', {
		value: function (item) { let i = this.indexOf(item); if (i !== -1) this.splice(i, 1); return this; }
	});
}
if (!Array.prototype.safePush) {
	Object.defineProperty(Array.prototype, 'safePush', {
		value: function (item) { if (!this.includes(item)) this.push(item); return this; }
	});
}

// ---------------------------------------------------------------- load the plugin

const plugin_source = fs.readFileSync(__dirname + '/anchored_stretch.js', 'utf8');
eval(plugin_source);
const plugin = registered.anchored_stretch;
assert.ok(plugin, 'plugin registered');

// The stretch-tool suite below is written against stock drag speed, which a step
// of 0.125 reproduces exactly. Step sizing gets its own section at the end.
const SHIPPED_STEP_DEFAULT = settings.anchored_stretch_step.value;
settings.anchored_stretch_step.value = 0.125;

function withStep(value, fn) {
	let before = settings.anchored_stretch_step.value;
	settings.anchored_stretch_step.value = value;
	try { return fn(); } finally { settings.anchored_stretch_step.value = before; }
}

function withFormat(id, fn) {
	let before = Format.id;
	Format.id = id;
	try { return fn(); } finally { Format.id = before; }
}

// ---------------------------------------------------------------- drag simulation

const AXES = {x: 0, y: 1, z: 2};

/**
 * Simulate a gizmo drag. `handle` is a gizmo handle name: X, NX, Y, NY, Z, NZ,
 * XY, XZ, YZ. `steps` are drag deltas (local space, gizmo units) as [x, y, z]
 * triples, applied one mouse-move at a time.
 */
function drag(handle, steps, {alt = false, shift = false, ctrl = false, meta = false, tool = 'stretch_tool'} = {}) {
	let module = TransformerModule.modules.edit;
	let previous_tool = Toolbox.selected;
	Toolbox.selected = tool === 'resize_tool'
		? {id: 'resize_tool', transformerMode: 'scale'}
		: {id: 'stretch_tool', transformerMode: 'stretch'};

	let direction = handle[0] !== 'N' ? 1 : -1;
	let letters = handle.replace(/^N/, '');
	let axis = letters[0].toLowerCase();
	let second_axis = letters.length === 2 ? letters[1].toLowerCase() : undefined;

	module.dispatchPointerDown({event: {}});
	for (let step of steps) {
		module.dispatchMove({
			event: {altKey: alt, shiftKey: shift, ctrlKey: ctrl, metaKey: meta},
			point: {x: step[0], y: step[1], z: step[2]},
			axis,
			axis_number: AXES[axis],
			second_axis,
			second_axis_number: second_axis ? AXES[second_axis] : undefined,
			direction
		});
	}
	module.dispatchEnd({event: {}, has_changed: true, keep_changes: true});
	Toolbox.selected = previous_tool;
}

function cancelDrag(handle, steps) {
	let module = TransformerModule.modules.edit;
	let direction = handle[0] !== 'N' ? 1 : -1;
	let axis = handle.replace(/^N/, '')[0].toLowerCase();
	module.dispatchPointerDown({event: {}});
	for (let step of steps) {
		module.dispatchMove({event: {}, point: {x: step[0], y: step[1], z: step[2]}, axis, axis_number: AXES[axis], direction});
	}
	module.dispatchCancel({event: {}, has_changed: true, keep_changes: false});
}

/** Run something with both plugin behaviours switched off, i.e. stock Blockbench. */
function stock(fn) {
	let a = settings.anchored_stretch_tool.value;
	let b = settings.anchored_stretch_resize.value;
	settings.anchored_stretch_tool.value = false;
	settings.anchored_stretch_resize.value = false;
	try { return fn(); } finally {
		settings.anchored_stretch_tool.value = a;
		settings.anchored_stretch_resize.value = b;
	}
}

function stockDrag(config, handle, steps, options) {
	return stock(() => {
		let cube = new Cube(config);
		Outliner.selected = [cube];
		drag(handle, steps, options);
		return cube;
	});
}

// ---------------------------------------------------------------- assertions

let passed = 0, failed = 0;
function test(name, fn) {
	try {
		fn();
		passed++;
		console.log('  ok   ' + name);
	} catch (e) {
		failed++;
		console.log('  FAIL ' + name + '\n         ' + e.message);
	}
}
const close = (a, b) => Math.abs(a - b) < 1e-9;
function assertFace(actual, expected, label) {
	assert.ok(close(actual, expected), `${label}: expected ${expected}, got ${actual}`);
}
// Whole-size paths: the anchored face is solved for exactly (on a 2^-30 grid),
// while the reached corner absorbs the 6-decimal stretch rounding.
const GRID_TOLERANCE = 1e-8;
const TARGET_TOLERANCE = 2e-5;
function assertFaceOnGrid(actual, expected, label) {
	assert.ok(Math.abs(actual - expected) < GRID_TOLERANCE, `${label}: expected ${expected}, got ${actual}`);
}
function assertTarget(actual, expected, label) {
	assert.ok(Math.abs(actual - expected) < TARGET_TOLERANCE, `${label}: expected ${expected}, got ${actual}`);
}

console.log('\nAnchored Stretch — stretch tool\n');

test('positive X handle: low face pinned, high face grows one way', () => {
	let cube = new Cube({from: [0, 0, 0], to: [8, 8, 8]});
	Outliner.selected = [cube];
	drag('X', [[8, 0, 0]]);

	assert.ok(close(cube.stretch[0], 1.5), 'applied stretch halved to 1.5, got ' + cube.stretch[0]);
	let after = renderedBounds(cube);
	assertFace(after.from[0], 0, 'low face stayed');
	assertFace(after.to[0], 12, 'high face moved out by 4, same as stock would');
	assert.deepStrictEqual(cube.size(), [8, 8, 8], 'stored size unchanged');
});

test('negative X handle: high face pinned, low face grows one way', () => {
	let cube = new Cube({from: [0, 0, 0], to: [8, 8, 8]});
	Outliner.selected = [cube];
	drag('NX', [[-8, 0, 0]]);

	assert.ok(close(cube.stretch[0], 1.5), 'applied stretch halved to 1.5, got ' + cube.stretch[0]);
	let after = renderedBounds(cube);
	assertFace(after.to[0], 8, 'high face stayed');
	assertFace(after.from[0], -4, 'low face moved out by 4');
});

test('the dragged face lands exactly where stock centred stretch puts it', () => {
	let cases = [
		{config: {from: [0, 0, 0], to: [8, 8, 8]}, handle: 'X', steps: [[8, 0, 0]]},
		{config: {from: [0, 0, 0], to: [8, 8, 8]}, handle: 'NX', steps: [[-8, 0, 0]]},
		{config: {from: [0, 0, 0], to: [8, 8, 8]}, handle: 'X', steps: [[-4, 0, 0]]},
		{config: {from: [2, 3, -5], to: [6, 10, 1]}, handle: 'Y', steps: [[0, 8, 0]]},
		{config: {from: [2, 3, -5], to: [6, 10, 1]}, handle: 'NZ', steps: [[0, 0, -5]]},
		{config: {from: [0, 0, 0], to: [8, 8, 8], inflate: 1}, handle: 'X', steps: [[8, 0, 0]]},
		{config: {from: [0, 0, 0], to: [5, 5, 5], inflate: 0.5}, handle: 'NY', steps: [[0, -3, 0]]},
		{config: {from: [0, 0, 0], to: [8, 8, 8], stretch: [1.5, 1, 1]}, handle: 'NX', steps: [[-4, 0, 0]]},
		{config: {from: [1, 1, 1], to: [7, 5, 3]}, handle: 'Z', steps: [[0, 0, 11]]}
	];

	for (let {config, handle, steps} of cases) {
		let axis = AXES[handle.replace(/^N/, '')[0].toLowerCase()];
		let dragged_face = handle[0] === 'N' ? 'from' : 'to';
		let anchored_face = handle[0] === 'N' ? 'to' : 'from';

		let stock_bounds = renderedBounds(stockDrag(config, handle, steps));

		let cube = new Cube(config);
		Outliner.selected = [cube];
		let before = renderedBounds(cube);
		drag(handle, steps);
		let after = renderedBounds(cube);

		let label = `${handle} on ${JSON.stringify(config)}`;
		assertFace(after[dragged_face][axis], stock_bounds[dragged_face][axis], `${label}: dragged face matches stock`);
		assertFace(after[anchored_face][axis], before[anchored_face][axis], `${label}: anchored face did not move`);
	}
});

test('off-centre cube on Y', () => {
	let cube = new Cube({from: [2, 3, -5], to: [6, 10, 1]});
	Outliner.selected = [cube];
	drag('Y', [[0, 8, 0]]);

	let after = renderedBounds(cube);
	assertFace(after.from[1], 3, 'low Y face stayed at 3');
	assertFace(after.to[1], 3 + 7 * 1.5, 'high Y face grew by half the raw stretch');
	assertFace(after.from[0], 2, 'X untouched');
	assertFace(after.to[2], 1, 'Z untouched');
});

test('inflate is respected', () => {
	let cube = new Cube({from: [0, 0, 0], to: [8, 8, 8], inflate: 1});
	Outliner.selected = [cube];
	let before = renderedBounds(cube);
	assertFace(before.from[0], -1, 'inflated low face starts at -1');
	drag('X', [[8, 0, 0]]);

	let after = renderedBounds(cube);
	assertFace(after.from[0], -1, 'inflated low face stayed');
	assertFace(after.to[0], 14, 'inflated high face moved out by the inflated half');
});

test('drag starting from an already stretched cube', () => {
	let cube = new Cube({from: [0, 0, 0], to: [8, 8, 8], stretch: [1.5, 1, 1]});
	Outliner.selected = [cube];
	let before = renderedBounds(cube);
	drag('NX', [[-4, 0, 0]]);

	assert.ok(close(cube.stretch[0], 1.75), 'stretch grew by half of 0.5, got ' + cube.stretch[0]);
	let after = renderedBounds(cube);
	assertFace(after.to[0], before.to[0], 'high face stayed where it already was');
	assertFace(after.from[0], -4, 'low face moved out by 2');
});

test('many small moves do not drift the anchored face', () => {
	let cube = new Cube({from: [1, 1, 1], to: [7, 5, 3]});
	Outliner.selected = [cube];
	let before = renderedBounds(cube);
	let steps = [];
	for (let i = 1; i <= 24; i++) steps.push([i, 0, 0]);
	for (let i = 23; i >= -4; i--) steps.push([i, 0, 0]);
	drag('X', steps);

	let after = renderedBounds(cube);
	assertFace(after.from[0], before.from[0], 'low face never drifted');
	assert.ok(close(cube.stretch[0], 1 + (-4 / 8) / 2), 'ends at half the final drag value, got ' + cube.stretch[0]);
});

test('returning the drag to zero restores the original from/to exactly', () => {
	let cube = new Cube({from: [1, 1, 1], to: [7, 5, 3]});
	Outliner.selected = [cube];
	let from = cube.from.slice(), to = cube.to.slice();
	drag('NZ', [[0, 0, -3], [0, 0, -9], [0, 0, -2], [0, 0, 0]]);

	assert.deepStrictEqual(cube.from, from, 'from restored');
	assert.deepStrictEqual(cube.to, to, 'to restored');
	assert.ok(close(cube.stretch[2], 1), 'stretch back to 1');
});

test('each cube in a multi-selection keeps its own opposite face', () => {
	let a = new Cube({from: [0, 0, 0], to: [4, 4, 4]});
	let b = new Cube({from: [20, 0, 0], to: [32, 4, 4]});
	Outliner.selected = [a, b];
	drag('X', [[8, 0, 0]]);

	let ra = renderedBounds(a), rb = renderedBounds(b);
	assertFace(ra.from[0], 0, 'cube A low face stayed');
	assertFace(ra.to[0], 6, 'cube A grew by half its width');
	assertFace(rb.from[0], 20, 'cube B low face stayed');
	assertFace(rb.to[0], 38, 'cube B grew by half its width');
	assert.ok(close(a.stretch[0], 1.5) && close(b.stretch[0], 1.5), 'both halved');
});

test('the cursor tooltip shows the applied stretch, not the raw value', () => {
	let cube = new Cube({from: [0, 0, 0], to: [8, 8, 8]});
	Outliner.selected = [cube];
	drag('X', [[8, 0, 0]]);
	assert.ok(close(last_tooltip, 0.5), 'tooltip shows 0.5, got ' + last_tooltip);
});

test('Alt restores the original centred stretch, at the original rate', () => {
	let cube = new Cube({from: [0, 0, 0], to: [8, 8, 8]});
	Outliner.selected = [cube];
	drag('X', [[8, 0, 0]], {alt: true});

	assert.ok(close(cube.stretch[0], 2), 'full stretch applied, got ' + cube.stretch[0]);
	let after = renderedBounds(cube);
	assertFace(after.from[0], -4, 'grew in the negative direction too');
	assertFace(after.to[0], 12, 'and the positive direction');
	assert.deepStrictEqual(cube.from, [0, 0, 0], 'from/to untouched');
	assert.ok(close(last_tooltip, 1), 'tooltip left to core, got ' + last_tooltip);
});

test('pressing Alt part way through a drag hands back cleanly', () => {
	let cube = new Cube({from: [0, 0, 0], to: [8, 8, 8]});
	Outliner.selected = [cube];
	let module = TransformerModule.modules.edit;
	module.dispatchPointerDown({event: {}});
	let move = (x, alt) => module.dispatchMove({
		event: {altKey: alt}, point: {x, y: 0, z: 0}, axis: 'x', axis_number: 0, direction: 1
	});
	move(4, false);          // one-sided
	move(8, true);           // Alt: should be pure stock
	assert.deepStrictEqual(cube.from, [0, 0, 0], 'from handed back to stock');
	assert.ok(close(cube.stretch[0], 2), 'stock stretch while Alt is held');
	// Blockbench only re-runs onMove when the snapped drag value changes, so the
	// mouse has to actually move for a modifier change to take effect. Same as
	// the resize tool.
	move(9, false);          // back to one-sided
	module.dispatchEnd({event: {}, has_changed: true, keep_changes: true});

	assert.ok(close(cube.stretch[0], 1 + 1.125 / 2), 'back to halved stretch, got ' + cube.stretch[0]);
	assertFace(renderedBounds(cube).from[0], 0, 'low face pinned again');
});

test('plane handle stays centred, like the resize tool', () => {
	let cube = new Cube({from: [0, 0, 0], to: [8, 8, 8]});
	Outliner.selected = [cube];
	drag('XZ', [[8, 0, 0]]);

	assert.deepStrictEqual(cube.from, [0, 0, 0], 'from untouched');
	assert.ok(close(cube.stretch[0], 2) && close(cube.stretch[2], 2), 'both axes at the stock rate');
});

test('uniform handle stays centred', () => {
	let cube = new Cube({from: [0, 0, 0], to: [8, 8, 8]});
	Outliner.selected = [cube];
	let module = TransformerModule.modules.edit;
	module.dispatchPointerDown({event: {}});
	module.dispatchMove({event: {}, point: {x: 8, y: 8, z: 0}, axis: 'e', axis_number: undefined, direction: 1});
	module.dispatchEnd({event: {}, has_changed: true, keep_changes: true});

	assert.deepStrictEqual(cube.from, [0, 0, 0], 'from untouched');
	assert.ok(cube.stretch[0] > 1 && cube.stretch[1] > 1 && cube.stretch[2] > 1, 'all axes stretched');
});

test('formats without stretch_cubes are untouched', () => {
	let cube = new Cube({from: [0, 0, 0], to: [8, 8, 8]});
	Outliner.selected = [cube];
	Format.stretch_cubes = false;
	drag('X', [[8, 0, 0]]);
	Format.stretch_cubes = true;

	assert.deepStrictEqual(cube.from, [0, 0, 0], 'from untouched');
	assert.ok(close(cube.stretch[0], 2), 'stock rate');
});

test('turning the setting off restores stock behaviour', () => {
	let cube = new Cube({from: [0, 0, 0], to: [8, 8, 8]});
	Outliner.selected = [cube];
	settings.anchored_stretch_tool.value = false;
	drag('X', [[8, 0, 0]]);
	settings.anchored_stretch_tool.value = true;

	assert.deepStrictEqual(cube.from, [0, 0, 0], 'from untouched');
	assert.ok(close(cube.stretch[0], 2), 'full stretch at the stock rate');
});

test('Alt bound to swap tools is not treated as an override', () => {
	let cube = new Cube({from: [0, 0, 0], to: [8, 8, 8]});
	Outliner.selected = [cube];
	BarItems.swap_tools.keybind.key = 18;
	drag('X', [[8, 0, 0]], {alt: true});
	BarItems.swap_tools.keybind.key = 66;

	let after = renderedBounds(cube);
	assertFace(after.from[0], 0, 'stayed one-sided');
	assert.ok(close(cube.stretch[0], 1.5), 'and stayed halved');
});

test('cancelling a drag leaves the cube as it was', () => {
	let cube = new Cube({from: [2, 0, 0], to: [10, 8, 8], stretch: [1.25, 1, 1]});
	Outliner.selected = [cube];
	let from = cube.from.slice(), to = cube.to.slice(), stretch = cube.stretch.slice();
	cancelDrag('X', [[4, 0, 0], [12, 0, 0]]);

	assert.deepStrictEqual(cube.from, from, 'from restored');
	assert.deepStrictEqual(cube.to, to, 'to restored');
	assert.deepStrictEqual(cube.stretch, stretch, 'stretch restored');
});

test('consecutive drags keep the same face and the same rate', () => {
	let cube = new Cube({from: [0, 0, 0], to: [8, 8, 8]});
	Outliner.selected = [cube];
	drag('X', [[8, 0, 0]]);
	let mid = renderedBounds(cube);
	drag('X', [[8, 0, 0]]);
	let after = renderedBounds(cube);

	assert.ok(close(cube.stretch[0], 2), 'stretch accumulated to 2, got ' + cube.stretch[0]);
	assertFace(mid.from[0], 0, 'low face after first drag');
	assertFace(mid.to[0], 12, 'high face after first drag');
	assertFace(after.from[0], 0, 'low face after second drag');
	assertFace(after.to[0], 16, 'high face moved by the same 4 again');
});

console.log('\nAnchored Stretch — resizing a stretched cube\n');

test('stock Blockbench really does drift (guards the tests below)', () => {
	let cube = stock(() => {
		let c = new Cube({from: [0, 0, 0], to: [8, 8, 8], stretch: [1.5, 1, 1]});
		Outliner.selected = [c];
		drag('X', [[2, 0, 0]], {tool: 'resize_tool'});
		return c;
	});
	let after = renderedBounds(cube);
	assertFace(after.from[0], -2.5, 'anchored face creeps out by (d/2)(1-stretch) = -0.5');
});

test('resizing on the positive handle keeps the low face', () => {
	let cube = new Cube({from: [0, 0, 0], to: [8, 8, 8], stretch: [1.5, 1, 1]});
	Outliner.selected = [cube];
	let before = renderedBounds(cube);
	assertFace(before.from[0], -2, 'starts at -2');
	drag('X', [[2, 0, 0]], {tool: 'resize_tool'});

	let after = renderedBounds(cube);
	assertFace(after.from[0], -2, 'low face did not move');
	assertFace(after.to[0], 13, 'high face grew by size_step * stretch');
	assert.strictEqual(cube.size(0), 10, 'size still an integer 10');
	assert.ok(close(cube.stretch[0], 1.5), 'stretch untouched');
});

test('resizing on the negative handle keeps the high face', () => {
	let cube = new Cube({from: [0, 0, 0], to: [8, 8, 8], stretch: [1.5, 1, 1]});
	Outliner.selected = [cube];
	drag('NX', [[-2, 0, 0]], {tool: 'resize_tool'});

	let after = renderedBounds(cube);
	assertFace(after.to[0], 10, 'high face did not move');
	assertFace(after.from[0], -5, 'low face grew outward');
	assert.strictEqual(cube.size(0), 10, 'size still an integer 10');
});

test('resizing keeps the anchored face for every stretch value and both handles', () => {
	for (let stretch of [0.5, 0.75, 1.0625, 1.25, 2, 3]) {
		for (let handle of ['X', 'NX']) {
			for (let step of [1, 3, -2]) {
				let config = {from: [1, 0, 0], to: [9, 8, 8], stretch: [stretch, 1, 1]};
				let cube = new Cube(config);
				Outliner.selected = [cube];
				let before = renderedBounds(cube);
				drag(handle, [[handle === 'N' + 'X' ? -step : step, 0, 0]], {tool: 'resize_tool'});
				let after = renderedBounds(cube);

				let anchored = handle === 'NX' ? 'to' : 'from';
				let label = `stretch ${stretch}, handle ${handle}, step ${step}`;
				assertFace(after[anchored][0], before[anchored][0], `${label}: anchored face`);
				assert.strictEqual(cube.size(0), 8 + step, `${label}: size`);
			}
		}
	}
});

test('resizing a stretched cube with inflate keeps the anchored face', () => {
	let cube = new Cube({from: [0, 0, 0], to: [8, 8, 8], stretch: [1.25, 1, 1], inflate: 0.5});
	Outliner.selected = [cube];
	let before = renderedBounds(cube);
	drag('X', [[3, 0, 0]], {tool: 'resize_tool'});

	assertFace(renderedBounds(cube).from[0], before.from[0], 'low face did not move');
	assert.strictEqual(cube.size(0), 11, 'size grew by 3');
});

test('an unstretched cube resizes exactly as stock', () => {
	let config = {from: [0, 0, 0], to: [8, 8, 8]};
	let reference = stockDrag(config, 'X', [[3, 0, 0]], {tool: 'resize_tool'});
	let cube = new Cube(config);
	Outliner.selected = [cube];
	drag('X', [[3, 0, 0]], {tool: 'resize_tool'});

	assert.deepStrictEqual(cube.from, reference.from, 'from matches stock');
	assert.deepStrictEqual(cube.to, reference.to, 'to matches stock');
});

test('a cube stretched on another axis resizes exactly as stock', () => {
	let config = {from: [0, 0, 0], to: [8, 8, 8], stretch: [1, 1.5, 1]};
	let reference = stockDrag(config, 'X', [[3, 0, 0]], {tool: 'resize_tool'});
	let cube = new Cube(config);
	Outliner.selected = [cube];
	drag('X', [[3, 0, 0]], {tool: 'resize_tool'});

	assert.deepStrictEqual(cube.from, reference.from, 'from matches stock');
	assert.deepStrictEqual(cube.to, reference.to, 'to matches stock');
});

test('bidirectional resize (Alt) is left to core', () => {
	let config = {from: [0, 0, 0], to: [8, 8, 8], stretch: [1.5, 1, 1]};
	let reference = stockDrag(config, 'X', [[2, 0, 0]], {tool: 'resize_tool', alt: true});
	let cube = new Cube(config);
	Outliner.selected = [cube];
	drag('X', [[2, 0, 0]], {tool: 'resize_tool', alt: true});

	assert.deepStrictEqual(cube.from, reference.from, 'from matches stock');
	assert.deepStrictEqual(cube.to, reference.to, 'to matches stock');
});

test('uniform and plane resize handles are left to core', () => {
	let config = {from: [0, 0, 0], to: [8, 8, 8], stretch: [1.5, 1.5, 1.5]};
	for (let handle of ['XZ', 'E']) {
		let run = () => {
			let cube = new Cube(config);
			Outliner.selected = [cube];
			let module = TransformerModule.modules.edit;
			let previous = Toolbox.selected;
			Toolbox.selected = {id: 'resize_tool', transformerMode: 'scale'};
			module.dispatchPointerDown({event: {}});
			module.dispatchMove(handle === 'E'
				? {event: {}, point: {x: 2, y: 2, z: 0}, axis: 'e', axis_number: undefined, direction: 1}
				: {event: {}, point: {x: 2, y: 0, z: 0}, axis: 'x', axis_number: 0, second_axis: 'z', second_axis_number: 2, direction: 1});
			module.dispatchEnd({event: {}, has_changed: true, keep_changes: true});
			Toolbox.selected = previous;
			return cube;
		};
		let reference = stock(run);
		let cube = run();
		assert.deepStrictEqual(cube.from, reference.from, handle + ': from matches stock');
		assert.deepStrictEqual(cube.to, reference.to, handle + ': to matches stock');
	}
});

test('dragging a resize handle over many moves does not accumulate drift', () => {
	let cube = new Cube({from: [3, 0, 0], to: [11, 8, 8], stretch: [1.375, 1, 1]});
	Outliner.selected = [cube];
	let before = renderedBounds(cube);
	let steps = [];
	for (let i = 1; i <= 20; i++) steps.push([i, 0, 0]);
	for (let i = 19; i >= -5; i--) steps.push([i, 0, 0]);
	drag('X', steps, {tool: 'resize_tool'});

	assertFace(renderedBounds(cube).from[0], before.from[0], 'low face never drifted');
	assert.strictEqual(cube.size(0), 3, 'ends at 8 - 5');
});

test('the size slider path is anchored too', () => {
	let cube = new Cube({from: [0, 0, 0], to: [8, 8, 8], stretch: [1.5, 1, 1]});
	Outliner.selected = [cube];
	let before = renderedBounds(cube);
	resizeOnAxis(n => n + 1, 0);

	assertFace(renderedBounds(cube).from[0], before.from[0], 'low face did not move');
	assert.strictEqual(cube.size(0), 9, 'size is 9');
});

test('the "resize from centre" setting still wins over the anchor', () => {
	let config = {from: [0, 0, 0], to: [8, 8, 8], stretch: [1.5, 1, 1]};
	settings.transform_cube_from_center.value = true;
	let reference = stock(() => {
		let c = new Cube(config);
		Outliner.selected = [c];
		resizeOnAxis(n => n + 2, 0);
		return c;
	});
	let cube = new Cube(config);
	Outliner.selected = [cube];
	resizeOnAxis(n => n + 2, 0);
	settings.transform_cube_from_center.value = false;

	assert.deepStrictEqual(cube.from, reference.from, 'from matches stock');
	assert.deepStrictEqual(cube.to, reference.to, 'to matches stock');
});

test('resizing works with integer_size off', () => {
	let cube = new Cube({from: [0, 0, 0], to: [8, 8, 8], stretch: [1.5, 1, 1]});
	Outliner.selected = [cube];
	let before = renderedBounds(cube);
	Format.integer_size = false;
	cube.resize(0.5, 0, false, null, false);
	Format.integer_size = true;

	assertFace(renderedBounds(cube).from[0], before.from[0], 'low face did not move');
	assert.ok(close(cube.size(0), 8.5), 'fractional size accepted, got ' + cube.size(0));
});

test('turning the resize setting off restores the drift', () => {
	let cube = new Cube({from: [0, 0, 0], to: [8, 8, 8], stretch: [1.5, 1, 1]});
	Outliner.selected = [cube];
	settings.anchored_stretch_resize.value = false;
	drag('X', [[2, 0, 0]], {tool: 'resize_tool'});
	settings.anchored_stretch_resize.value = true;

	assertFace(renderedBounds(cube).from[0], -2.5, 'stock drift is back');
});

test('one-sided stretch and then a resize both stay on the same side', () => {
	let cube = new Cube({from: [0, 0, 0], to: [8, 8, 8]});
	Outliner.selected = [cube];
	drag('X', [[8, 0, 0]]);                              // stretch -> 1.5, low face pinned at 0
	assertFace(renderedBounds(cube).from[0], 0, 'low face after stretching');
	drag('X', [[4, 0, 0]], {tool: 'resize_tool'});       // size 8 -> 12

	let after = renderedBounds(cube);
	assertFace(after.from[0], 0, 'low face after resizing');
	assertFace(after.to[0], 18, 'high face grew by 4 * 1.5');
	assert.strictEqual(cube.size(0), 12, 'size is 12');
});

console.log('\nAnchored Stretch — step size\n');

test('the setting ships as 0 (automatic)', () => {
	assert.strictEqual(SHIPPED_STEP_DEFAULT, 0, 'shipped default');
});

test('hytale_character defaults to 1/64 per step, applied as 1/128', () => {
	let cube = new Cube({from: [0, 0, 0], to: [8, 8, 8]});
	Outliner.selected = [cube];
	withStep(0, () => withFormat('hytale_character', () => drag('X', [[8, 0, 0]])));

	assert.ok(close(cube.stretch[0], 1 + 8 / 128), 'eight steps of 1/128, got ' + cube.stretch[0]);
	let after = renderedBounds(cube);
	assertFace(after.from[0], 0, 'low face pinned');
	assertFace(after.to[0], 8.5, 'face moved 8 * (2 * 4 / 128)');
});

test('hytale_prop defaults to double that', () => {
	let character = new Cube({from: [0, 0, 0], to: [8, 8, 8]});
	Outliner.selected = [character];
	withStep(0, () => withFormat('hytale_character', () => drag('X', [[8, 0, 0]])));

	let prop = new Cube({from: [0, 0, 0], to: [8, 8, 8]});
	Outliner.selected = [prop];
	withStep(0, () => withFormat('hytale_prop', () => drag('X', [[8, 0, 0]])));

	assert.ok(close(prop.stretch[0], 1 + 8 / 64), 'eight steps of 1/64, got ' + prop.stretch[0]);
	let moved_character = renderedBounds(character).to[0] - 8;
	let moved_prop = renderedBounds(prop).to[0] - 8;
	assert.ok(close(moved_prop, moved_character * 2), `prop travels double: ${moved_prop} vs ${moved_character}`);
});

test('one step of drag is one step of stretch', () => {
	for (let [format, applied] of [['hytale_character', 1 / 128], ['hytale_prop', 1 / 64]]) {
		let cube = new Cube({from: [0, 0, 0], to: [16, 16, 16]});
		Outliner.selected = [cube];
		withStep(0, () => withFormat(format, () => drag('X', [[1, 0, 0]])));
		assert.ok(close(cube.stretch[0], 1 + applied), `${format}: one unit of drag, got ${cube.stretch[0]}`);
	}
});

test('an unknown stretch format falls back to 1/64', () => {
	let cube = new Cube({from: [0, 0, 0], to: [8, 8, 8]});
	Outliner.selected = [cube];
	withStep(0, () => withFormat('some_other_format', () => drag('X', [[4, 0, 0]])));
	assert.ok(close(cube.stretch[0], 1 + 4 / 128), 'fell back to the character step, got ' + cube.stretch[0]);
});

test('an explicit step overrides the format default', () => {
	let cube = new Cube({from: [0, 0, 0], to: [8, 8, 8]});
	Outliner.selected = [cube];
	withStep(0.5, () => withFormat('hytale_prop', () => drag('X', [[3, 0, 0]])));
	assert.ok(close(cube.stretch[0], 1 + 3 * 0.25), 'three steps of 0.5, halved, got ' + cube.stretch[0]);
});

test('a step of 0.125 reproduces stock speed', () => {
	let config = {from: [0, 0, 0], to: [8, 8, 8]};
	let reference = renderedBounds(stockDrag(config, 'X', [[8, 0, 0]]));
	let cube = new Cube(config);
	Outliner.selected = [cube];
	withStep(0.125, () => drag('X', [[8, 0, 0]]));

	assertFace(renderedBounds(cube).to[0], reference.to[0], 'dragged face matches stock');
});

test('snapping settings no longer change the outcome', () => {
	let results = [];
	for (let snap of [16 / 8192, 0.25, 1, 4]) {
		let cube = new Cube({from: [0, 0, 0], to: [8, 8, 8]});
		Outliner.selected = [cube];
		let previous = SNAP;
		SNAP = snap;
		withStep(0, () => withFormat('hytale_character', () => drag('X', [[5, 0, 0]])));
		SNAP = previous;
		results.push(cube.stretch[0]);
	}
	assert.ok(results.every(v => close(v, results[0])), 'identical across snap settings: ' + results.join(', '));
	assert.ok(close(results[0], 1 + 5 / 128), 'five steps, got ' + results[0]);
});

test('part-steps round to the nearest step', () => {
	let cases = [[0.4, 0], [0.6, 1], [1.4, 1], [1.6, 2], [2.5, 3]];
	for (let [distance, steps] of cases) {
		let cube = new Cube({from: [0, 0, 0], to: [8, 8, 8]});
		Outliner.selected = [cube];
		withStep(0, () => withFormat('hytale_character', () => drag('X', [[distance, 0, 0]])));
		assert.ok(close(cube.stretch[0], 1 + steps / 128), `drag ${distance} -> ${steps} steps, got ${cube.stretch[0]}`);
	}
});

test('the negative handle steps the same amount the other way', () => {
	let cube = new Cube({from: [0, 0, 0], to: [8, 8, 8]});
	Outliner.selected = [cube];
	withStep(0, () => withFormat('hytale_character', () => drag('NX', [[-8, 0, 0]])));

	assert.ok(close(cube.stretch[0], 1 + 8 / 128), 'grew, not shrank, got ' + cube.stretch[0]);
	let after = renderedBounds(cube);
	assertFace(after.to[0], 8, 'high face pinned');
	assertFace(after.from[0], -0.5, 'low face moved out by the same 0.5');
});

test('a step grows the cube by the same amount one-sided or centred', () => {
	for (let format of ['hytale_character', 'hytale_prop']) {
		let one_sided = new Cube({from: [0, 0, 0], to: [12, 12, 12]});
		Outliner.selected = [one_sided];
		withStep(0, () => withFormat(format, () => drag('X', [[6, 0, 0]])));

		let centred = new Cube({from: [0, 0, 0], to: [12, 12, 12]});
		Outliner.selected = [centred];
		withStep(0, () => withFormat(format, () => drag('X', [[6, 0, 0]], {alt: true})));

		let one_sided_travel = renderedBounds(one_sided).to[0] - 12;
		let centred_travel = renderedBounds(centred).to[0] - 12;
		assert.ok(close(one_sided_travel, centred_travel),
			`${format}: dragged face travels the same (${one_sided_travel} vs ${centred_travel})`);
		assert.ok(close(one_sided.stretch[0] - 1, (centred.stretch[0] - 1) / 2),
			`${format}: the stretch number is half`);
	}
});

test('the uniform handle steps off the drag length', () => {
	let cube = new Cube({from: [0, 0, 0], to: [8, 8, 8]});
	Outliner.selected = [cube];
	let module = TransformerModule.modules.edit;
	withStep(0, () => withFormat('hytale_character', () => {
		module.dispatchPointerDown({event: {}});
		module.dispatchMove({event: {}, point: {x: 3, y: 4, z: 0}, axis: 'e', axis_number: undefined, direction: 1});
		module.dispatchEnd({event: {}, has_changed: true, keep_changes: true});
	}));

	assert.ok(close(cube.stretch[0], 1 + 5 / 64), 'length 5 -> five steps, centred, got ' + cube.stretch[0]);
	assert.deepStrictEqual(cube.from, [0, 0, 0], 'still centred');
});

test('Shift halves the step, Ctrl quarters it, both take an eighth', () => {
	let cases = [
		[{}, 1],
		[{shift: true}, 1 / 2],
		[{ctrl: true}, 1 / 4],
		[{shift: true, ctrl: true}, 1 / 8],
		[{meta: true}, 1 / 4],                       // cmd on macOS
		[{shift: true, meta: true}, 1 / 8]
	];

	for (let [modifiers, factor] of cases) {
		let cube = new Cube({from: [0, 0, 0], to: [8, 8, 8]});
		Outliner.selected = [cube];
		withStep(0, () => withFormat('hytale_character', () => drag('X', [[8, 0, 0]], modifiers)));

		let label = JSON.stringify(modifiers);
		assert.ok(close(cube.stretch[0], 1 + (8 / 128) * factor),
			`${label}: expected ${1 + (8 / 128) * factor}, got ${cube.stretch[0]}`);
		assertFace(renderedBounds(cube).from[0], 0, `${label}: low face still pinned`);
	}
});

test('the Pressing overrides count as held modifiers', () => {
	let cube = new Cube({from: [0, 0, 0], to: [8, 8, 8]});
	Outliner.selected = [cube];
	Pressing.overrides.ctrl = true;
	withStep(0, () => withFormat('hytale_character', () => drag('X', [[8, 0, 0]])));
	Pressing.overrides.ctrl = false;

	assert.ok(close(cube.stretch[0], 1 + (8 / 128) / 4), 'quartered, got ' + cube.stretch[0]);
});

test('modifiers scale an explicit step too, and stack with Alt', () => {
	let cube = new Cube({from: [0, 0, 0], to: [8, 8, 8]});
	Outliner.selected = [cube];
	withStep(0.125, () => drag('X', [[8, 0, 0]], {shift: true}));
	assert.ok(close(cube.stretch[0], 1.25), 'half of the stock step, halved again for one-sided, got ' + cube.stretch[0]);

	let centred = new Cube({from: [0, 0, 0], to: [8, 8, 8]});
	Outliner.selected = [centred];
	withStep(0.125, () => drag('X', [[8, 0, 0]], {shift: true, alt: true}));
	assert.ok(close(centred.stretch[0], 1.5), 'centred gets the full half-step, got ' + centred.stretch[0]);
	assert.deepStrictEqual(centred.from, [0, 0, 0], 'and stays centred');
});

test('an eighth step on a character is 1/1024 of stretch', () => {
	let cube = new Cube({from: [0, 0, 0], to: [16, 16, 16]});
	Outliner.selected = [cube];
	withStep(0, () => withFormat('hytale_character', () => drag('X', [[1, 0, 0]], {shift: true, ctrl: true})));

	assert.ok(close(cube.stretch[0], 1 + 1 / 1024), 'smallest step, got ' + cube.stretch[0]);
	// 16-wide cube, so the face moves 2 * 8 * (1/1024) = 1/64 of a unit
	assertFace(renderedBounds(cube).to[0], 16 + 1 / 64, 'face moved 1/64 unit');
	assertFace(renderedBounds(cube).from[0], 0, 'low face pinned');
});

test('the step does not touch the resize tool', () => {
	let config = {from: [0, 0, 0], to: [8, 8, 8], stretch: [1.5, 1, 1]};
	let reference = new Cube(config);
	Outliner.selected = [reference];
	drag('X', [[2, 0, 0]], {tool: 'resize_tool'});

	let cube = new Cube(config);
	Outliner.selected = [cube];
	withStep(0, () => drag('X', [[2, 0, 0]], {tool: 'resize_tool'}));

	assert.deepStrictEqual(cube.from, reference.from, 'from matches');
	assert.deepStrictEqual(cube.to, reference.to, 'to matches');
});

test('turning one-sided stretch off also restores stock drag maths', () => {
	let cube = new Cube({from: [0, 0, 0], to: [8, 8, 8]});
	Outliner.selected = [cube];
	settings.anchored_stretch_tool.value = false;
	withStep(0, () => drag('X', [[8, 0, 0]]));
	settings.anchored_stretch_tool.value = true;

	assert.ok(close(cube.stretch[0], 2), 'stock stretch, got ' + cube.stretch[0]);
});

console.log('\nAnchored Stretch — vertex snap stretch mode\n');

/**
 * Run a vertex snap. `pick` is the world position of the corner being grabbed,
 * `target` the world position it should land on.
 */
function vertexSnap(cubes, pick, target, {mode = 'stretch', options = 0, amended = false, move_origin = false} = {}) {
	BarItems.vertex_snap_mode.set(mode);
	Vertexsnap.elements = cubes;
	Vertexsnap.groups = [];
	Vertexsnap.move_origin = move_origin;
	Vertexsnap.step1 = false;
	Vertexsnap.vertex_pos = new Vector3().fromArray(pick);
	undo_log.length = 0;
	canvas_updates.length = 0;
	snap_calls = [];
	Vertexsnap.snap({element: cubes[0], vertex: target}, options, amended);
}

test('the Stretch mode is added to the vertex snap dropdown', () => {
	let select = BarItems.vertex_snap_mode;
	assert.ok(select.options.stretch, 'option present');
	assert.strictEqual(select.options.stretch.name, 'Stretch', 'labelled');
	assert.ok(select.values.includes('stretch'), 'in values, so wheel cycling reaches it');

	Format.stretch_cubes = false;
	assert.strictEqual(select.options.stretch.condition(), false, 'hidden outside stretch formats');
	Format.stretch_cubes = true;
	assert.strictEqual(select.options.stretch.condition(), true, 'shown in stretch formats');
});

test('pulling a high corner outward stretches that side only', () => {
	let cube = attachMesh(new Cube({from: [0, 0, 0], to: [8, 8, 8]}));
	let before = renderedBounds(cube);
	vertexSnap([cube], [8, 8, 8], [10, 8, 8]);

	assert.ok(close(cube.stretch[0], 1.25), 'stretch 1 + 2/8, got ' + cube.stretch[0]);
	let after = renderedBounds(cube);
	assertFace(after.from[0], before.from[0], 'low face stayed at 0');
	assertFace(after.to[0], 10, 'high face reached the target');
	assert.strictEqual(cube.size(0), 8, 'size untouched, so UVs are untouched');
});

test('pulling a low corner outward stretches the other way', () => {
	let cube = attachMesh(new Cube({from: [0, 0, 0], to: [8, 8, 8]}));
	vertexSnap([cube], [0, 0, 0], [-2, 0, 0]);

	assert.ok(close(cube.stretch[0], 1.25), 'stretch 1.25, got ' + cube.stretch[0]);
	let after = renderedBounds(cube);
	assertFace(after.to[0], 8, 'high face stayed');
	assertFace(after.from[0], -2, 'low face reached the target');
});

test('a corner dragged diagonally stretches all three axes', () => {
	let cube = attachMesh(new Cube({from: [0, 0, 0], to: [8, 8, 8]}));
	vertexSnap([cube], [8, 8, 8], [12, 10, 9]);

	let after = renderedBounds(cube);
	assertFace(after.to[0], 12, 'X reached');
	assertFace(after.to[1], 10, 'Y reached');
	assertFace(after.to[2], 9, 'Z reached');
	assertFace(after.from[0], 0, 'X anchored');
	assertFace(after.from[1], 0, 'Y anchored');
	assertFace(after.from[2], 0, 'Z anchored');
});

test('inflate counts toward the reach', () => {
	let cube = attachMesh(new Cube({from: [0, 0, 0], to: [8, 8, 8], inflate: 1}));
	let before = renderedBounds(cube);
	assertFace(before.to[0], 9, 'inflated corner starts at 9');
	vertexSnap([cube], [9, 9, 9], [11, 9, 9]);

	let after = renderedBounds(cube);
	assertFace(after.to[0], 11, 'reached the target');
	assertFace(after.from[0], -1, 'inflated low face stayed');
	assert.ok(close(cube.stretch[0], 1 + 2 / 10), 'reach was 5, got stretch ' + cube.stretch[0]);
});

test('a cube that already has stretch snaps from where it is', () => {
	let cube = attachMesh(new Cube({from: [0, 0, 0], to: [8, 8, 8], stretch: [1.5, 1, 1]}));
	let before = renderedBounds(cube);
	assertFace(before.to[0], 10, 'starts at 10');
	vertexSnap([cube], [10, 8, 8], [13, 8, 8]);

	let after = renderedBounds(cube);
	assertFace(after.to[0], 13, 'reached');
	assertFace(after.from[0], -2, 'anchored face stayed');
});

test('an off-centre cube with a non-zero origin still anchors correctly', () => {
	let cube = attachMesh(new Cube({from: [4, -2, 1], to: [12, 6, 5]}));
	cube.origin = [6, 1, 3];
	let before = renderedBounds(cube);
	vertexSnap([cube], [12, 6, 5], [15, 6, 5]);

	let after = renderedBounds(cube);
	assertFace(after.to[0], 15, 'reached');
	assertFace(after.from[0], before.from[0], 'anchored face stayed at 4');
});

test('ignoring an axis leaves it alone', () => {
	let cube = attachMesh(new Cube({from: [0, 0, 0], to: [8, 8, 8]}));
	vertexSnap([cube], [8, 8, 8], [12, 10, 9], {options: {ignore_axis: {x: false, y: true, z: true}}});

	let after = renderedBounds(cube);
	assertFace(after.to[0], 12, 'X reached');
	assert.ok(close(cube.stretch[1], 1) && close(cube.stretch[2], 1), 'Y and Z untouched');
});

test('a target behind the anchor clamps instead of inverting the cube', () => {
	let cube = attachMesh(new Cube({from: [0, 0, 0], to: [8, 8, 8]}));
	Blockbench.last_quick_message = null;
	vertexSnap([cube], [8, 8, 8], [-20, 8, 8]);

	assert.ok(cube.stretch[0] > 0, 'stretch stayed positive, got ' + cube.stretch[0]);
	assertFace(renderedBounds(cube).from[0], 0, 'anchored face held even while clamped');
	assert.ok(Blockbench.last_quick_message, 'told the user why it stopped');
});

test('a rotated cube snaps along its own axes', () => {
	// +90 degrees about Y maps local +Z onto world +X, so a world +X pull
	// becomes a local +Z stretch
	let cube = attachMesh(new Cube({from: [0, 0, 0], to: [8, 8, 8]}), Quaternion.fromAxisAngle([0, 1, 0], 90));
	vertexSnap([cube], [8, 8, 8], [10, 8, 8]);

	assert.ok(close(cube.stretch[0], 1), 'X untouched, got ' + cube.stretch[0]);
	assert.ok(close(cube.stretch[2], 1.25), 'Z took the stretch, got ' + cube.stretch[2]);
});

test('plain stretch mode rounds its numbers too', () => {
	let cube = attachMesh(new Cube({from: [0, 0, 0], to: [8, 8, 8]}));
	// a third of a unit would otherwise leave stretch at 1.0416666666666667
	vertexSnap([cube], [8, 8, 8], [8 + 1 / 3, 8, 8]);
	assert.strictEqual(cube.stretch[0], 1.041667, 'trimmed to six decimals, got ' + cube.stretch[0]);
	// the anchored face is still solved from the stretch actually applied
	assertFace(renderedBounds(cube).from[0], 0, 'low face still exact');
	assertTarget(renderedBounds(cube).to[0], 8 + 1 / 3, 'corner within a millionth');
});

test('non-cube elements in the selection are skipped', () => {
	let cube = attachMesh(new Cube({from: [0, 0, 0], to: [8, 8, 8]}));
	let locator = {uuid: 'loc', mesh: cube.mesh, position: [0, 0, 0]};
	vertexSnap([locator, cube], [8, 8, 8], [10, 8, 8]);

	assert.ok(close(cube.stretch[0], 1.25), 'the cube still moved');
	assert.deepStrictEqual(locator.position, [0, 0, 0], 'the locator was left alone');
});

test('the edit is wrapped in undo and offers the ignore-axis amend', () => {
	let cube = attachMesh(new Cube({from: [0, 0, 0], to: [8, 8, 8]}));
	vertexSnap([cube], [8, 8, 8], [10, 8, 8]);

	assert.strictEqual(undo_log[0].call, 'initEdit', 'opened an edit');
	assert.ok(undo_log.find(e => e.call === 'finishEdit' && e.name === 'Vertex snap stretch'), 'named the edit');
	assert.ok(undo_log.find(e => e.call === 'amendEdit'), 'offered the amend form');
	assert.ok(canvas_updates.length && canvas_updates[0].element_aspects.geometry, 'refreshed geometry');
	assert.strictEqual(Vertexsnap.step1, true, 'reset for the next snap');
});

test('an amended re-run does not offer the form again', () => {
	let cube = attachMesh(new Cube({from: [0, 0, 0], to: [8, 8, 8]}));
	vertexSnap([cube], [8, 8, 8], [10, 8, 8], {amended: true});

	assert.ok(undo_log[0].amended, 'initEdit told it is an amend');
	assert.ok(!undo_log.find(e => e.call === 'amendEdit'), 'no second form');
});

test('other snap modes are left to core', () => {
	for (let mode of ['move', 'scale', 'rotate']) {
		let cube = attachMesh(new Cube({from: [0, 0, 0], to: [8, 8, 8]}));
		vertexSnap([cube], [8, 8, 8], [10, 8, 8], {mode});
		assert.strictEqual(snap_calls.length, 1, mode + ': delegated to core');
		assert.deepStrictEqual(cube.stretch, [1, 1, 1], mode + ': untouched by us');
	}
});

test('stretch mode is left to core outside stretch formats, and for origin snaps', () => {
	let cube = attachMesh(new Cube({from: [0, 0, 0], to: [8, 8, 8]}));
	Format.stretch_cubes = false;
	vertexSnap([cube], [8, 8, 8], [10, 8, 8]);
	Format.stretch_cubes = true;
	assert.strictEqual(snap_calls.length, 1, 'delegated when the format has no stretch');

	let cube2 = attachMesh(new Cube({from: [0, 0, 0], to: [8, 8, 8]}));
	vertexSnap([cube2], [8, 8, 8], [10, 8, 8], {move_origin: true});
	assert.strictEqual(snap_calls.length, 1, 'delegated when snapping the origin');
	assert.deepStrictEqual(cube2.stretch, [1, 1, 1], 'and left the cube alone');
});

console.log('\nAnchored Stretch — resize + stretch snap\n');

test('the Resize + Stretch mode is in the dropdown', () => {
	let select = BarItems.vertex_snap_mode;
	assert.ok(select.options.resize_stretch, 'option present');
	assert.strictEqual(select.options.resize_stretch.name, 'Resize + Stretch', 'labelled');
	assert.ok(select.values.includes('resize_stretch'), 'in values');
	Format.stretch_cubes = false;
	assert.strictEqual(select.options.resize_stretch.condition(), false, 'hidden outside stretch formats');
	Format.stretch_cubes = true;
});

test('the gap goes into whole size first, stretch takes the remainder', () => {
	let cube = attachMesh(new Cube({from: [0, 0, 0], to: [8, 8, 8]}));
	vertexSnap([cube], [8, 8, 8], [10.7, 8, 8], {mode: 'resize_stretch'});

	assert.strictEqual(cube.size(0), 11, 'size rounded to a whole 11, got ' + cube.size(0));
	assert.ok(cube.stretch[0] === 0.972727, 'stretch covers the rest, got ' + cube.stretch[0]);
	let after = renderedBounds(cube);
	assertFaceOnGrid(after.from[0], 0, 'anchored face held');
	assertTarget(after.to[0], 10.7, 'corner landed exactly on the target');
});

test('rounding to nearest can squash as well as stretch', () => {
	let up = attachMesh(new Cube({from: [0, 0, 0], to: [8, 8, 8]}));
	vertexSnap([up], [8, 8, 8], [10.3, 8, 8], {mode: 'resize_stretch'});
	assert.strictEqual(up.size(0), 10, 'rounded down to 10');
	assert.ok(up.stretch[0] > 1, 'stretched slightly, got ' + up.stretch[0]);

	let down = attachMesh(new Cube({from: [0, 0, 0], to: [8, 8, 8]}));
	vertexSnap([down], [8, 8, 8], [10.7, 8, 8], {mode: 'resize_stretch'});
	assert.strictEqual(down.size(0), 11, 'rounded up to 11');
	assert.ok(down.stretch[0] < 1, 'squashed slightly, got ' + down.stretch[0]);

	assert.ok(Math.abs(up.stretch[0] - 1) < 0.5 && Math.abs(down.stretch[0] - 1) < 0.5, 'both within half a unit of 1');
});

test('an existing stretch gets absorbed into whole units', () => {
	// size 8 at stretch 1.5 renders as -2..10, an extent of 12
	let cube = attachMesh(new Cube({from: [0, 0, 0], to: [8, 8, 8], stretch: [1.5, 1, 1]}));
	let before = renderedBounds(cube);
	assertFaceOnGrid(before.from[0], -2, 'starts at -2');
	assertFaceOnGrid(before.to[0], 10, 'starts at 10');
	vertexSnap([cube], [10, 8, 8], [10.3, 8, 8], {mode: 'resize_stretch'});

	assert.strictEqual(cube.size(0), 12, 'the old stretch became whole size, got ' + cube.size(0));
	assert.ok(close(cube.stretch[0], 12.3 / 12), 'only the leftover is stretch, got ' + cube.stretch[0]);
	let after = renderedBounds(cube);
	assertFaceOnGrid(after.from[0], -2, 'anchored face held');
	assertTarget(after.to[0], 10.3, 'corner landed on the target');
});

test('inflate is taken out before rounding', () => {
	let cube = attachMesh(new Cube({from: [0, 0, 0], to: [8, 8, 8], inflate: 1}));
	let before = renderedBounds(cube);
	assertFaceOnGrid(before.to[0], 9, 'inflated extent starts at 10');
	vertexSnap([cube], [9, 9, 9], [11.7, 9, 9], {mode: 'resize_stretch'});

	// extent 12.7, minus 2 * inflate = 10.7, rounds to a size of 11
	assert.strictEqual(cube.size(0), 11, 'size 11, got ' + cube.size(0));
	assert.ok(cube.stretch[0] === 0.976923, 'stretch over the inflated reach, got ' + cube.stretch[0]);
	assertFaceOnGrid(renderedBounds(cube).from[0], -1, 'inflated anchored face held');
});

test('the low corner anchors the high face', () => {
	let cube = attachMesh(new Cube({from: [0, 0, 0], to: [8, 8, 8]}));
	vertexSnap([cube], [0, 0, 0], [-2.7, 0, 0], {mode: 'resize_stretch'});

	assert.strictEqual(cube.size(0), 11, 'size 11');
	let after = renderedBounds(cube);
	assertFaceOnGrid(after.to[0], 8, 'high face held');
	assertTarget(after.from[0], -2.7, 'low corner reached the target');
});

test('sizes always come out whole, across a range of targets', () => {
	for (let target of [9.1, 9.49, 9.5, 12.34, 20.8, 4.2]) {
		let cube = attachMesh(new Cube({from: [0, 0, 0], to: [8, 8, 8]}));
		vertexSnap([cube], [8, 8, 8], [target, 8, 8], {mode: 'resize_stretch'});
		assert.ok(Number.isInteger(cube.size(0)), `target ${target}: size ${cube.size(0)} is whole`);
		assertTarget(renderedBounds(cube).to[0], target, `target ${target}: reached`);
		assertTarget(renderedBounds(cube).from[0], 0, `target ${target}: anchored`);
	}
});

test('sizes stay whole at awkward coordinates', () => {
	for (let origin of [-137.5, 0.1, 512.3, -0.0001]) {
		for (let target of [3.7, 11.26, 9.5]) {
			let cube = attachMesh(new Cube({from: [origin, 0, 0], to: [origin + 8, 8, 8]}));
			vertexSnap([cube], [origin + 8, 8, 8], [origin + target, 8, 8], {mode: 'resize_stretch'});
			let size = cube.size(0);
			assert.ok(Number.isInteger(size), `from ${origin} target ${target}: size ${size} is whole`);
		}
	}
});

test('a whole-number gap leaves no stretch at all', () => {
	let cube = attachMesh(new Cube({from: [0, 0, 0], to: [8, 8, 8]}));
	vertexSnap([cube], [8, 8, 8], [11, 8, 8], {mode: 'resize_stretch'});
	assert.strictEqual(cube.size(0), 11, 'size 11');
	assert.strictEqual(cube.stretch[0], 1, 'stretch is exactly 1, got ' + cube.stretch[0]);
});

test('float noise near a whole number still comes out as exactly 1', () => {
	for (let target of [10.999999999, 11.000000001, 11 - 1e-9]) {
		let cube = attachMesh(new Cube({from: [0, 0, 0], to: [8, 8, 8]}));
		vertexSnap([cube], [8, 8, 8], [target, 8, 8], {mode: 'resize_stretch'});
		assert.strictEqual(cube.stretch[0], 1, `target ${target}: stretch is exactly 1, got ${cube.stretch[0]}`);
	}
});

test('stretch never comes out with a tail of digits', () => {
	for (let target of [10.7, 4.2, 12.34, 9.1, 20.8]) {
		let cube = attachMesh(new Cube({from: [0, 0, 0], to: [8, 8, 8]}));
		vertexSnap([cube], [8, 8, 8], [target, 8, 8], {mode: 'resize_stretch'});
		let text = JSON.stringify(cube.stretch[0]);
		let decimals = (text.split('.')[1] || '').length;
		assert.ok(decimals <= 6, `target ${target}: ${text} has ${decimals} decimals`);
	}
});

test('baked stretch is clean too', () => {
	let cube = new Cube({from: [0, 0, 0], to: [8, 8, 8], stretch: [1.5, 1, 1]});
	Cube.all = [cube];
	cube.selected = true;
	BarItems.anchored_stretch_bake.click();
	assert.strictEqual(cube.stretch[0], 1, 'an exact 12 leaves no stretch, got ' + cube.stretch[0]);
});

test('box_uv cubes get their UV refreshed', () => {
	let cube = attachMesh(new Cube({from: [0, 0, 0], to: [8, 8, 8]}));
	cube.box_uv = true;
	let uv_updates = 0;
	cube.preview_controller.updateUV = () => uv_updates++;
	vertexSnap([cube], [8, 8, 8], [10.7, 8, 8], {mode: 'resize_stretch'});
	assert.ok(uv_updates > 0, 'updateUV called');
});

test('plain stretch mode still leaves size alone', () => {
	let cube = attachMesh(new Cube({from: [0, 0, 0], to: [8, 8, 8]}));
	vertexSnap([cube], [8, 8, 8], [10.7, 8, 8], {mode: 'stretch'});
	assert.strictEqual(cube.size(0), 8, 'size untouched in plain stretch mode');
});

console.log('\nAnchored Stretch — bake stretch into size\n');

function bake(cubes) {
	Cube.all = cubes;
	cubes.forEach(cube => { cube.selected = true; });
	undo_log.length = 0;
	Blockbench.last_quick_message = null;
	BarItems.anchored_stretch_bake.click();
}

test('the bake button is registered next to the stretch sliders', () => {
	let action = BarItems.anchored_stretch_bake;
	assert.ok(action, 'action registered');
	assert.strictEqual(action.name, 'Bake Stretch into Size', 'named');
	assert.ok(Toolbars.element_stretch.children.includes(action), 'added to the stretch toolbar');

	Cube.selected = [1];
	assert.ok(action.condition(), 'enabled with cubes selected');
	Cube.selected = [];
	assert.ok(!action.condition(), 'disabled with nothing selected');
	Cube.selected = [1];
});

test('baking turns stretch into whole size without moving the cube', () => {
	let cube = new Cube({from: [0, 0, 0], to: [8, 8, 8], stretch: [1.5, 1, 1]});
	let before = renderedBounds(cube);
	bake([cube]);

	assert.strictEqual(cube.size(0), 12, 'size became 12, got ' + cube.size(0));
	assert.ok(close(cube.stretch[0], 1), 'stretch back to 1, got ' + cube.stretch[0]);
	let after = renderedBounds(cube);
	assertFace(after.from[0], before.from[0], 'low face did not move');
	assertFace(after.to[0], before.to[0], 'high face did not move');
});

test('a fractional extent keeps the leftover in stretch', () => {
	let cube = new Cube({from: [0, 0, 0], to: [8, 8, 8], stretch: [1.3, 1, 1]});
	let before = renderedBounds(cube);
	bake([cube]);

	assert.strictEqual(cube.size(0), 10, 'size 10, got ' + cube.size(0));
	assert.ok(close(cube.stretch[0], 10.4 / 10), 'stretch 1.04, got ' + cube.stretch[0]);
	let after = renderedBounds(cube);
	assertFace(after.from[0], before.from[0], 'low face did not move');
	assertFace(after.to[0], before.to[0], 'high face did not move');
});

test('baking handles all three axes and inflate', () => {
	let cube = new Cube({from: [0, 0, 0], to: [8, 6, 4], stretch: [1.5, 1.25, 0.5], inflate: 1});
	let before = renderedBounds(cube);
	bake([cube]);

	for (let axis = 0; axis < 3; axis++) {
		assert.ok(Number.isInteger(cube.size(axis)), `axis ${axis}: whole size ${cube.size(axis)}`);
		assert.ok(Math.abs(cube.stretch[axis] - 1) < 0.5, `axis ${axis}: stretch near 1, got ${cube.stretch[axis]}`);
		assertFace(renderedBounds(cube).from[axis], before.from[axis], `axis ${axis}: low face`);
		assertFace(renderedBounds(cube).to[axis], before.to[axis], `axis ${axis}: high face`);
	}
});

test('baking only touches selected cubes', () => {
	let picked = new Cube({from: [0, 0, 0], to: [8, 8, 8], stretch: [1.5, 1, 1]});
	let other = new Cube({from: [0, 0, 0], to: [8, 8, 8], stretch: [1.5, 1, 1]});
	Cube.all = [picked, other];
	picked.selected = true;
	other.selected = false;
	undo_log.length = 0;
	BarItems.anchored_stretch_bake.click();

	assert.strictEqual(picked.size(0), 12, 'the selected cube was baked');
	assert.strictEqual(other.size(0), 8, 'the other cube was left alone');
});

test('baking a clean cube does nothing and says so', () => {
	let cube = new Cube({from: [0, 0, 0], to: [8, 8, 8]});
	bake([cube]);

	assert.deepStrictEqual(cube.to, [8, 8, 8], 'untouched');
	assert.strictEqual(undo_log.length, 0, 'no undo entry for a no-op');
	assert.ok(Blockbench.last_quick_message, 'told the user there was nothing to do');
});

test('baking is wrapped in a named undo entry', () => {
	let cube = new Cube({from: [0, 0, 0], to: [8, 8, 8], stretch: [1.5, 1, 1]});
	bake([cube]);

	assert.strictEqual(undo_log[0].call, 'initEdit', 'opened an edit');
	assert.ok(undo_log.find(e => e.call === 'finishEdit' && e.name === 'Bake stretch into size'), 'named the edit');
});

console.log('\nAnchored Stretch — teardown\n');

test('unload restores all patches', () => {
	let module = TransformerModule.modules.edit;
	let wrapped_on_move = module.onMove;
	let wrapped_resize = Cube.prototype.resize;
	let wrapped_calculate = module.calculateOffset;
	let wrapped_snap = Vertexsnap.snap;
	BarItems.vertex_snap_mode.set('stretch');
	plugin.onunload();
	assert.ok(Vertexsnap.snap !== wrapped_snap, 'Vertexsnap.snap restored');
	assert.ok(!BarItems.vertex_snap_mode.options.stretch, 'mode removed from the dropdown');
	assert.ok(!BarItems.vertex_snap_mode.values.includes('stretch'), 'and from values');
	assert.ok(!BarItems.vertex_snap_mode.options.resize_stretch, 'resize+stretch mode removed too');
	assert.ok(!BarItems.anchored_stretch_bake, 'bake action removed from BarItems');
	assert.strictEqual(Toolbars.element_stretch.children.length, 0, 'and out of the stretch toolbar');
	assert.strictEqual(BarItems.vertex_snap_mode.get(), 'move', 'active mode reset off the removed option');
	assert.ok(module.onMove !== wrapped_on_move, 'onMove restored');
	assert.ok(module.calculateOffset !== wrapped_calculate, 'calculateOffset restored');
	assert.ok(Cube.prototype.resize !== wrapped_resize, 'resize restored');
	assert.ok(settings.anchored_stretch_tool === undefined, 'stretch setting removed');
	assert.ok(settings.anchored_stretch_resize === undefined, 'resize setting removed');
	assert.ok(settings.anchored_stretch_step === undefined, 'step setting removed');

	let cube = new Cube({from: [0, 0, 0], to: [8, 8, 8], stretch: [1.5, 1, 1]});
	Outliner.selected = [cube];
	module.has_changed = false;
	drag('X', [[2, 0, 0]], {tool: 'resize_tool'});
	assertFace(renderedBounds(cube).from[0], -2.5, 'stock drift is back');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
