#!/usr/bin/env node
// Unit tests for js/modeling.js:  node test/test-modeling.mjs
import assert from 'node:assert/strict';
import { roundedBox, revolveProfile, mirrorPositions, flipWinding, signedVolume, normalizeEdge, beveledBox, frustum, frustumProfile } from '../js/modeling.js';
import { analyzeMesh } from '../js/meshtools.js';

let failed = 0;
function test(name, fn) { try { fn(); console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '\n  ', e.message); } }
const bounds = p => {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[i + k]); max[k] = Math.max(max[k], p[i + k]); }
    return { min, max };
};
const near = (a, b, e = 1e-4) => Math.abs(a - b) < e;

test('a box with zero radius is the box', () => {
    const { positions } = roundedBox(2, 4, 6, 0);
    assert.ok(near(signedVolume(positions), 48));
});
test('fillet volume is between a sphere-ish core and the full box, and winds outward', () => {
    const { positions, normals } = roundedBox(2, 2, 2, 0.5, 'fillet', 6);
    const v = signedVolume(positions);
    assert.ok(v > 0 && v < 8 && v > 8 - (1 - Math.PI / 4) * 0.25 * 12 - 0.5, `volume ${v}`);
    assert.equal(normals.length, positions.length);
    const b = bounds(positions); assert.deepEqual(b.max.map(x => +x.toFixed(4)), [1, 1, 1]);
});
test('chamfer removes the wedge along each edge', () => {
    const r = 0.4, { positions, normals } = roundedBox(2, 2, 2, r, 'chamfer');
    assert.equal(normals, null);
    const v = signedVolume(positions);
    const edgeWedges = 12 * (r * r / 2) * (2 - 2 * r); // 12 edges, each a triangular prism
    // The straight prisms are removed exactly; the corner facets take a bit more, but never
    // more than a full r-sized wedge of edge length at each of the 12 edge ends... bounded loosely.
    assert.ok(v < 8 - edgeWedges + 1e-3 && v > 8 - edgeWedges - 12 * (r * r / 2) * 2 * r, `volume ${v}`);
});
test('radius is clamped so the box never inverts', () => {
    const { positions } = roundedBox(2, 2, 2, 50, 'fillet', 4);
    assert.ok(signedVolume(positions) > 0);
});
test('revolving a rectangle makes a cylinder of the right volume', () => {
    const p = revolveProfile([[0, 0], [2, 0], [2, 5], [0, 5]], 256);
    const v = signedVolume(p);
    assert.ok(Math.abs(v - Math.PI * 4 * 5) / (Math.PI * 20) < 0.01, `volume ${v}`);
});
test('revolving a profile off the axis makes a ring (annulus) and stays outward-wound', () => {
    const p = revolveProfile([[1, 0], [2, 0], [2, 1], [1, 1]], 256);
    assert.ok(Math.abs(signedVolume(p) - Math.PI * (4 - 1)) / (Math.PI * 3) < 0.01);
});
test('revolving a profile that crosses the axis is rejected', () => {
    assert.throws(() => revolveProfile([[-1, 0], [1, 0], [1, 1]]), /crosses the axis/);
});
test('mirror reflects and keeps triangles outward-wound', () => {
    const { positions } = roundedBox(2, 2, 2, 0.3);
    const shifted = Float32Array.from(positions, (v, i) => (i % 3 === 0 ? v + 5 : v));
    const m = mirrorPositions(shifted, 'x');
    assert.ok(near(bounds(m).min[0], -6) && near(bounds(m).max[0], -4));
    assert.ok(near(signedVolume(m), signedVolume(shifted)));
});
test('flipWinding negates the volume', () => {
    const { positions } = roundedBox(1, 1, 1, 0);
    assert.ok(near(signedVolume(flipWinding(positions)), -1));
});

// --- bevel parameters ---
test('old {style, segments} bevels still load and new {radius, steps} pass through', () => {
    assert.deepEqual(normalizeEdge({ style: 'chamfer', radius: 0.2, segments: 5 }), { radius: 0.2, steps: 1 });
    assert.deepEqual(normalizeEdge({ style: 'fillet', radius: 0.2, segments: 5 }), { radius: 0.2, steps: 5 });
    assert.deepEqual(normalizeEdge({ radius: 0.3, steps: 3 }), { radius: 0.3, steps: 3 });
    assert.equal(normalizeEdge({ radius: 0, steps: 3 }), null); assert.equal(normalizeEdge(null), null);
});
test('beveledBox: steps 1 is the flat chamfer, more steps the rounded fillet', () => {
    assert.equal(beveledBox(2, 2, 2, { radius: 0.4, steps: 1 }).normals, null);
    const round = beveledBox(2, 2, 2, { radius: 0.4, steps: 4 });
    assert.ok(round.normals && round.positions.length > beveledBox(2, 2, 2, { radius: 0.4, steps: 1 }).positions.length);
});

// --- cone / cylinder ---
const V = (rt, rb, h) => Math.PI * h / 3 * (rb * rb + rb * rt + rt * rt);
test('equal radii make a cylinder of the right volume', () => {
    const { positions } = frustum(1, 1, 2, null, 256);
    assert.ok(Math.abs(signedVolume(positions) - V(1, 1, 2)) / V(1, 1, 2) < 0.01, `${signedVolume(positions)}`);
});
test('a zero top radius makes a cone; a frustum sits in between', () => {
    assert.ok(Math.abs(signedVolume(frustum(0, 1.5, 2, null, 256).positions) - V(0, 1.5, 2)) / V(0, 1.5, 2) < 0.01);
    assert.ok(Math.abs(signedVolume(frustum(0.5, 1, 2, null, 256).positions) - V(0.5, 1, 2)) / V(0.5, 1, 2) < 0.01);
});
test('a cone pointing down works too', () => {
    assert.ok(Math.abs(signedVolume(frustum(1, 0, 2, null, 256).positions) - V(1, 0, 2)) / V(1, 0, 2) < 0.01);
});
test('unbeveled and beveled cones are watertight with consistent winding', () => {
    for (const edge of [null, { radius: 0.2, steps: 1 }, { radius: 0.2, steps: 4 }]) {
        for (const [rt, rb] of [[1, 1], [0, 1.5], [0.5, 1], [1, 0]]) {
            const h = analyzeMesh(frustum(rt, rb, 2, edge, 24).positions);
            assert.ok(h.watertight && h.inconsistentEdges === 0 && h.volume > 0, `${rt},${rb} ${JSON.stringify(edge)} ${JSON.stringify(h)}`);
        }
    }
});
test('a bevel takes material off the rim and more steps take less than a chamfer', () => {
    const plain = signedVolume(frustum(1, 1, 2, null, 128).positions);
    const chamfer = signedVolume(frustum(1, 1, 2, { radius: 0.3, steps: 1 }, 128).positions);
    const round = signedVolume(frustum(1, 1, 2, { radius: 0.3, steps: 6 }, 128).positions);
    assert.ok(chamfer < plain && round < plain && round > chamfer, `${plain} ${chamfer} ${round}`);
    // Each chamfered rim removes a triangular ring of leg 0.3: 2π·~1·0.045 each, two rims.
    assert.ok(Math.abs((plain - chamfer) - 2 * 0.045 * 2 * Math.PI * (1 - 0.3 / 3)) < 0.02, `${plain - chamfer}`);
});
test('the bevel is clamped so it cannot swallow the shape', () => {
    assert.ok(signedVolume(frustum(0.3, 1, 1, { radius: 50, steps: 3 }, 32).positions) > 0);
});
test('a beveled cylinder keeps its overall size; a beveled cone loses only its rim corner', () => {
    const b = bounds(frustum(1, 1, 2, { radius: 0.3, steps: 4 }, 64).positions);
    assert.ok(near(b.max[1], 1) && near(b.min[1], -1) && near(b.max[0], 1, 1e-3));
    const c = bounds(frustum(1, 1.5, 2, { radius: 0.3, steps: 4 }, 64).positions);
    assert.ok(near(c.max[1], 1) && near(c.min[1], -1) && c.max[0] < 1.5 && c.max[0] > 1.35);
});
test('cylinder normals are smooth round the side and flat on the ends', () => {
    const { positions, normals } = frustum(1, 1, 2, null, 32);
    let flat = 0, radial = 0;
    for (let i = 0; i < normals.length; i += 3) {
        if (Math.abs(Math.abs(normals[i + 1]) - 1) < 1e-6) flat++;
        else if (Math.abs(normals[i + 1]) < 1e-6 && Math.abs(Math.hypot(normals[i], normals[i + 2]) - 1) < 1e-6) radial++;
    }
    assert.ok(flat > 0 && radial > 0 && flat + radial === normals.length / 3, `${flat} ${radial} ${normals.length / 3}`);
});
test('both radii zero or a zero height is refused', () => {
    assert.throws(() => frustumProfile(0, 0, 2), /radius/);
    assert.throws(() => frustumProfile(1, 1, 0), /height/);
});
process.exit(failed ? 1 : 0);
