#!/usr/bin/env node
// Unit tests for js/revolve.js:  node test/test-revolve.mjs
import assert from 'node:assert/strict';
import { revolveAroundAxis, meridianOutline } from '../js/revolve.js';
import { roundedBox, signedVolume } from '../js/modeling.js';
import { buildShape } from '../js/shapes.js';
import { analyzeMesh } from '../js/meshtools.js';

let failed = 0;
function test(name, fn) { try { fn(); console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '\n  ', String(e.message).slice(0, 400)); } }
const near = (a, b, rel = 0.02) => Math.abs(a - b) <= Math.abs(b) * rel;
const bounds = p => {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[i + k]); max[k] = Math.max(max[k], p[i + k]); }
    return { min, max };
};
// A box spanning [x0,x1] x [y0,y1] x [z0,z1].
const box = (x0, x1, y0, y1, z0, z1) => {
    const p = roundedBox(x1 - x0, y1 - y0, z1 - z0, 0).positions;
    return Float32Array.from(p, (v, i) => v + [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2][i % 3]);
};
const concat = (...a) => Float32Array.from(a.flatMap(x => Array.from(x)));
const Y = { point: [0, 0, 0], dir: [0, 1, 0] };

test('a thin slice revolved about its end is a solid disc', () => {
    const r = revolveAroundAxis(box(0, 3, 0, 1, -0.05, 0.05), Y);
    assert.ok(near(signedVolume(r.positions), Math.PI * 9), `${signedVolume(r.positions)}`);
    const h = analyzeMesh(r.positions); assert.ok(h.watertight && h.inconsistentEdges === 0 && h.volume > 0, JSON.stringify(h));
});
test('a slice standing off the axis makes a ring', () => {
    const r = revolveAroundAxis(box(1, 2, 0, 1, -0.05, 0.05), Y);
    assert.ok(near(signedVolume(r.positions), Math.PI * 3), `${signedVolume(r.positions)}`);
});
test('a slice that crosses the axis sweeps to its larger radius', () => {
    const r = revolveAroundAxis(box(-1, 2, 0, 1, -0.05, 0.05), Y);
    assert.ok(near(signedVolume(r.positions), Math.PI * 4), `${signedVolume(r.positions)}`);
});
test('thickness does not matter: a fat block sweeps the same ring', () => {
    const r = revolveAroundAxis(box(1, 2, 0, 1, -0.9, 0.9), Y); // reaches out to r = sqrt(4 + .81) at the corners
    const outer = Math.sqrt(4 + 0.81);
    assert.ok(near(signedVolume(r.positions), Math.PI * (outer * outer - 1) * 1, 0.03), `${signedVolume(r.positions)}`);
    const b = bounds(r.positions);
    assert.ok(near(b.max[0], outer, 0.02) && near(b.max[2], outer, 0.02), `${b.max}`);
});
test('a hole in the outline stays a cavity', () => {
    // a slice 1..5 wide with a window 2..4 by .25..-.75, made of four overlapping boxes
    const p = concat(box(1, 2, 0, 1, -.05, .05), box(4, 5, 0, 1, -.05, .05), box(2, 4, 0, .25, -.05, .05), box(2, 4, .75, 1, -.05, .05));
    const r = revolveAroundAxis(p, Y);
    const expected = Math.PI * (25 - 1) * 1 - Math.PI * (16 - 4) * 0.5;
    assert.ok(near(signedVolume(r.positions), expected, 0.03), `${signedVolume(r.positions)} vs ${expected}`);
    assert.equal(r.loops, 2);
    const h = analyzeMesh(r.positions); assert.ok(h.watertight && h.inconsistentEdges === 0, JSON.stringify(h));
});
test('a tube wrapped round the axis revolves to itself, not to its two walls', () => {
    const tube = buildShape('tube', { outer: 1.5, inner: 1, height: 2, steps: 64 }).positions;
    const r = revolveAroundAxis(tube, Y);
    assert.ok(near(signedVolume(r.positions), Math.PI * (2.25 - 1) * 2, 0.03), `${signedVolume(r.positions)}`);
});
test('the axis can lie along X or Z and the result lands in the right place', () => {
    const r = revolveAroundAxis(box(0, 1, 0, 3, -0.05, 0.05), { point: [0, 0, 0], dir: [1, 0, 0] });
    assert.ok(near(signedVolume(r.positions), Math.PI * 9 * 1), `${signedVolume(r.positions)}`);
    const b = bounds(r.positions);
    assert.ok(Math.abs(b.max[0] - 1) < 0.02 && Math.abs(b.min[0]) < 0.02, `${b.min} .. ${b.max}`);
    assert.ok(Math.abs(b.max[1] - 3) < 0.05 && Math.abs(b.max[2] - 3) < 0.05 && Math.abs(b.min[1] + 3) < 0.05, `${b.min} .. ${b.max}`);
    const z = revolveAroundAxis(box(0, 3, 0, 1, 0, 1), { point: [0, 0, 0], dir: [0, 0, 1] });
    assert.ok(near(signedVolume(z.positions), Math.PI * 10 * 1, 0.03), `${signedVolume(z.positions)}`);
});
test('an axis away from the origin works', () => {
    const r = revolveAroundAxis(box(10, 13, 5, 6, -0.05, 0.05), { point: [10, 0, 0], dir: [0, 1, 0] });
    const b = bounds(r.positions);
    assert.ok(Math.abs(b.min[0] - 7) < 0.05 && Math.abs(b.max[0] - 13) < 0.05 && Math.abs(b.min[1] - 5) < 0.05 && Math.abs(b.max[1] - 6) < 0.05, `${b.min} .. ${b.max}`);
    assert.ok(near(signedVolume(r.positions), Math.PI * 9), `${signedVolume(r.positions)}`);
});
test('more detail tightens the edge; the result is outward-wound either way', () => {
    const slice = box(0, 3, 0, 1, -0.05, 0.05);
    const lo = signedVolume(revolveAroundAxis(slice, Y, { resolution: 120 }).positions);
    const hi = signedVolume(revolveAroundAxis(slice, Y, { resolution: 960 }).positions);
    assert.ok(Math.abs(hi - Math.PI * 9) <= Math.abs(lo - Math.PI * 9) + 1e-6 && lo > 0 && hi > 0, `${lo} ${hi}`);
});
test('normals are provided and the mesh carries no degenerate triangles', () => {
    const r = revolveAroundAxis(box(0, 3, 0, 1, -0.05, 0.05), Y, { segments: 48 });
    assert.equal(r.normals.length, r.positions.length);
    assert.equal(analyzeMesh(r.positions).degenerate, 0);
});
test('an empty selection or an axis the shape does not use is a clear error', () => {
    assert.throws(() => revolveAroundAxis(new Float32Array(0), Y), /nothing to revolve/);
    assert.throws(() => meridianOutline(Float32Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0]), Y), /too small/);
});
process.exit(failed ? 1 : 0);
