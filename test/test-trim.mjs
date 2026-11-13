#!/usr/bin/env node
// Unit tests for js/trim.js:  node test/test-trim.mjs
import assert from 'node:assert/strict';
import { stepsProfile, reededProfile, shiftProfile, sweepProfile, sliceOutline, footprintPath, facePath, snapPathToSurface } from '../js/trim.js';
import { roundedBox, signedVolume, frustum } from '../js/modeling.js';
import { analyzeMesh } from '../js/meshtools.js';

let failed = 0;
function test(name, fn) { try { fn(); console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '\n  ', String(e.message).slice(0, 400)); } }
const near = (a, b, rel = 1e-4) => Math.abs(a - b) <= Math.abs(b) * rel + 1e-9;
const area = pts => { let s = 0; for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; s += x1 * y2 - x2 * y1; } return Math.abs(s) / 2; };
const boxAt = (x0, x1, y0, y1, z0, z1) => { const p = roundedBox(x1 - x0, y1 - y0, z1 - z0, 0).positions; return Float32Array.from(p, (v, i) => v + [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2][i % 3]); };
const bounds = p => { const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[i + k]); max[k] = Math.max(max[k], p[i + k]); } return { min, max }; };
const closedOk = p => { const h = analyzeMesh(p); return h.watertight && h.inconsistentEdges === 0 && h.degenerate === 0 && h.volume > 0; };

test('steps profile: tiers step out toward the bottom, area is the sum of the tiers', () => {
    const p = stepsProfile({ count: 3, height: 4, depth: 2, embed: 0.5 });
    assert.ok(near(area(p), 0.5 * 12 + 4 * (2 + 4 + 6)), `${area(p)}`); // tucked-in strip + three tiers (reach 2, 4, 6)
    const widest = Math.max(...p.map(q => q[0])), top = Math.max(...p.map(q => q[1]));
    assert.equal(widest, 6); assert.equal(top, 12);
    const bottomReach = Math.max(...p.filter(q => q[1] === 0).map(q => q[0])), topReach = Math.max(...p.filter(q => q[1] === 12).map(q => q[0]));
    assert.ok(bottomReach === 6 && topReach === 2, `${bottomReach} ${topReach}`); // the top tier still stands one step proud
});
test('steps profile can be widest at the top', () => {
    const p = stepsProfile({ count: 3, height: 4, depth: 2, widestAtBottom: false });
    assert.equal(Math.max(...p.filter(q => q[1] === 12).map(q => q[0])), 6);
});
test('reeded profile: backing plate plus ribs', () => {
    const p = reededProfile({ count: 5, pitch: 4, fill: 0.5, depth: 1, base: 0.5, embed: 0.2 });
    assert.ok(near(area(p), 20 * 0.7 + 5 * 2 * 1), `${area(p)}`);
    const r = reededProfile({ count: 5, pitch: 4, fill: 0.5, depth: 1, base: 0.5, round: true, steps: 8 });
    assert.ok(area(r) > 20 * 0.5 && area(r) < 20 * 0.5 + 5 * 2 * 1, `${area(r)}`);
});

test('sweeping a rectangle round a rectangular loop gives an exact mitred frame', () => {
    const loop = [[-2, -1], [2, -1], [2, 1], [-2, 1]]; // 4 x 2
    const path = footprintPath(loop, 0);
    const prof = [[-0.2, 0], [0.5, 0], [0.5, 1], [-0.2, 1]]; // 0.7 wide, 1 tall
    const pos = sweepProfile(prof, path.points, path.normals, path.side, true);
    assert.ok(closedOk(pos), JSON.stringify(analyzeMesh(pos)));
    assert.ok(near(signedVolume(pos), 1 * ((4 + 1) * (2 + 1) - (4 - 0.4) * (2 - 0.4)), 1e-4), `${signedVolume(pos)}`);
    const b = bounds(pos);
    assert.ok(near(b.max[0], 2.5) && near(b.min[2], -1.5) && near(b.max[1], 1), `${b.min} ${b.max}`);
});
test('a stepped moulding round a box: closed, outward-wound, volume matches the profile area times the mean perimeter', () => {
    const loop = [[-3, -2], [3, -2], [3, 2], [-3, 2]];
    const path = footprintPath(loop, 0);
    const prof = stepsProfile({ count: 3, height: 0.4, depth: 0.2, embed: 0.1 });
    const pos = sweepProfile(prof, path.points, path.normals, path.side, true);
    assert.ok(closedOk(pos));
    // exact for a rectangle: sum over tiers of h * ((L + 2 reach)(W + 2 reach)) minus the tucked-in part
    let expected = 0;
    for (let i = 1; i <= 3; i++) expected += 0.4 * ((6 + 2 * (4 - i) * 0.2) * (4 + 2 * (4 - i) * 0.2) - (6 - 0.2) * (4 - 0.2));
    assert.ok(near(signedVolume(pos), expected, 1e-4), `${signedVolume(pos)} vs ${expected}`);
});
test('an L-shaped (concave) loop sweeps to a closed solid', () => {
    const loop = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]];
    const path = footprintPath(loop, 0);
    const pos = sweepProfile([[-0.05, 0], [0.2, 0], [0.2, 0.3], [-0.05, 0.3]], path.points, path.normals, path.side, true);
    assert.ok(closedOk(pos), JSON.stringify(analyzeMesh(pos)));
});
test('an open straight run with a reeded profile is capped into a closed solid of the right volume', () => {
    const prof = reededProfile({ count: 4, pitch: 2, fill: 0.5, depth: 0.5, base: 0.3, embed: 0.1 });
    const path = facePath({ min: [-5, 0, -5], max: [5, 10, 5] }, 'front', 'vertical', 0.5);
    const pos = sweepProfile(prof, path.points, path.normals, path.side, false);
    assert.ok(closedOk(pos), JSON.stringify(analyzeMesh(pos)));
    assert.ok(near(signedVolume(pos), area(prof) * 10, 1e-4), `${signedVolume(pos)} vs ${area(prof) * 10}`);
});
test('a rounded-rib profile sweeps closed too, and a poly-line bend is mitred', () => {
    const prof = reededProfile({ count: 3, pitch: 2, fill: 0.7, depth: 0.5, base: 0.3, round: true, steps: 6 });
    const pts = [[0, 0, 0], [0, 5, 0], [0, 5, -4]];                       // up a face, then back over a top
    const normals = [[0, 0, 1], [0, 1, 0]];
    const pos = sweepProfile(prof, pts, normals, [1, 0, 0], false);
    assert.ok(closedOk(pos), JSON.stringify(analyzeMesh(pos)));
});

test('sliceOutline traces a box as its four corners, counter-clockwise, collinear points removed', () => {
    const loop = sliceOutline(boxAt(-3, 3, 0, 2, -2, 2), 1);
    assert.equal(loop.length, 4);
    assert.ok(near(area(loop), 24));
    let s = 0; for (let i = 0; i < 4; i++) { const [x1, y1] = loop[i], [x2, y2] = loop[(i + 1) % 4]; s += x1 * y2 - x2 * y1; }
    assert.ok(s > 0, 'counter-clockwise');
});
test('sliceOutline follows a stepped body: a different outline at each height', () => {
    const body = Float32Array.from([...boxAt(-4, 4, 0, 2, -3, 3), ...boxAt(-2, 2, 2, 5, -2, 2)]); // wide base, narrow tower
    assert.ok(near(area(sliceOutline(body, 1)), 48) && near(area(sliceOutline(body, 3.5)), 16));
});
test('sliceOutline of a round shape is a fine polygon of the right size', () => {
    const loop = sliceOutline(frustum(1.5, 1.5, 2, null, 48).positions, 0.1);
    assert.ok(loop.length >= 40 && near(area(loop), Math.PI * 2.25, 0.01), `${loop.length} ${area(loop)}`);
});
test('slicing above the shape, or an open mesh, is a clear error', () => {
    assert.throws(() => sliceOutline(boxAt(-1, 1, 0, 1, -1, 1), 5), /nothing at that height/);
    assert.throws(() => sliceOutline(Float32Array.from([0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 5, 1, 0, 5, 0, 3, 5]).slice(0, 9), 0.5), /not a closed loop/);
});

test('footprint normals point away from the inside', () => {
    const loop = sliceOutline(boxAt(-3, 3, 0, 2, -2, 2), 1);
    const path = footprintPath(loop, 0);
    path.points.forEach((p, i) => {
        const q = path.points[(i + 1) % 4], mid = [(p[0] + q[0]) / 2, (p[2] + q[2]) / 2];
        assert.ok(mid[0] * path.normals[i][0] + mid[1] * path.normals[i][2] > 0, `edge ${i}`);
    });
});
test('a band on a face lies on that face, runs its full length and is centred as asked', () => {
    const box = { min: [-5, 0, -3], max: [5, 10, 3] };
    const f = facePath(box, 'front', 'vertical', 0.25);
    assert.deepEqual(f.points, [[-2.5, 0, 3], [-2.5, 10, 3]]); assert.deepEqual(f.normals, [[0, 0, 1]]); assert.deepEqual(f.side, [1, 0, 0]);
    const h = facePath(box, 'right', 'horizontal', 0.5);
    assert.deepEqual(h.points, [[5, 5, -3], [5, 5, 3]]); assert.deepEqual(h.side, [0, 1, 0]);
    const t = facePath(box, 'top', 'vertical', 0.5);
    assert.deepEqual(t.points, [[0, 10, -3], [0, 10, 3]]);
    assert.throws(() => facePath(box, 'bottom', 'vertical', 0.5), /Unknown face/);
});
test('a vertical reeded band on the front of a box sticks out of that face by its depth', () => {
    const prof = reededProfile({ count: 5, pitch: 1, fill: 0.6, depth: 0.4, base: 0.3, embed: 0.1 });
    const box = { min: [-5, 0, -3], max: [5, 10, 3] };
    const path = facePath(box, 'front', 'vertical', 0.5);
    const b = bounds(sweepProfile(prof, path.points, path.normals, path.side, false));
    assert.ok(near(b.max[2], 3 + 0.7) && near(b.min[2], 3 - 0.1) && near(b.min[0], -2.5) && near(b.max[0], 2.5) && near(b.max[1], 10), `${b.min} ${b.max}`);
});
test('a band snaps onto the body, not onto a base flange that widens the bounding box', () => {
    const body = boxAt(-5, 5, 0, 10, -3, 3), flange = boxAt(-6, 6, 0, 1, -4, 4);   // the flange sticks 1 out in front
    const all = Float32Array.from([...body, ...flange]);
    const raw = facePath({ min: [-6, 0, -4], max: [6, 10, 4] }, 'front', 'vertical', 0.5); // bbox plane z = 4
    assert.equal(raw.points[0][2], 4);
    const snapped = snapPathToSurface(raw, all);                                          // mid-run (y = 5) hits the body at z = 3
    assert.ok(near(snapped.points[0][2], 3) && near(snapped.points[1][2], 3), `${snapped.points}`);
    assert.deepEqual([snapped.points[0][0], snapped.points[0][1]], [0, 0]);              // nothing else moved
    assert.deepEqual([snapped.points[1][0], snapped.points[1][1]], [0, 10]);
});
test('snapping works on every face direction and leaves a path alone that misses the mesh', () => {
    const body = boxAt(-5, 5, 0, 10, -3, 3);
    const right = snapPathToSurface(facePath({ min: [-9, 0, -3], max: [9, 10, 3] }, 'right', 'vertical', 0.5), body);
    assert.ok(near(right.points[0][0], 5));
    const top = snapPathToSurface(facePath({ min: [-5, 0, -3], max: [5, 12, 3] }, 'top', 'vertical', 0.5), body);
    assert.ok(near(top.points[0][1], 10));
    const miss = facePath({ min: [20, 0, 20], max: [30, 10, 30] }, 'front', 'vertical', 0.5);
    assert.equal(snapPathToSurface(miss, body).points[0][2], 30);
});
process.exit(failed ? 1 : 0);
