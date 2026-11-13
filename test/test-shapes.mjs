#!/usr/bin/env node
// Unit tests for js/shapes.js:  node test/test-shapes.mjs
import assert from 'node:assert/strict';
import { SHAPES, SHAPE_ORDER, buildShape, triangulate, extrudePolygon } from '../js/shapes.js';
import { signedVolume } from '../js/modeling.js';
import { analyzeMesh } from '../js/meshtools.js';

let failed = 0;
function test(name, fn) { try { fn(); console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '\n  ', String(e.message).slice(0, 300)); } }
const near = (a, b, rel = 0.01) => Math.abs(a - b) <= Math.abs(b) * rel + 1e-9;
const bounds = p => {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[i + k]); max[k] = Math.max(max[k], p[i + k]); }
    return { min, max, size: max.map((m, k) => m - min[k]) };
};

test('triangulate fills a concave polygon exactly (area of the triangles = area of the polygon)', () => {
    const L = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]]; // an L shape, area 7
    const tris = triangulate(L);
    assert.equal(tris.length, 4);
    let a = 0; for (const [i, j, k] of tris) a += ((L[j][0] - L[i][0]) * (L[k][1] - L[i][1]) - (L[j][1] - L[i][1]) * (L[k][0] - L[i][0])) / 2;
    assert.ok(near(a, 7));
});
test('triangulate handles clockwise input', () => {
    assert.equal(triangulate([[0, 0], [0, 1], [1, 1], [1, 0]]).length, 2);
});
test('extrudePolygon of an L is a closed solid of the right volume', () => {
    const p = extrudePolygon([[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]], 2);
    const h = analyzeMesh(p);
    assert.ok(h.watertight && h.inconsistentEdges === 0 && near(h.volume, 14), JSON.stringify(h));
});

test('every library shape is registered, buildable at its defaults, closed and outward-wound', () => {
    assert.deepEqual([...SHAPE_ORDER].sort(), Object.keys(SHAPES).sort());
    for (const id of SHAPE_ORDER) {
        const { positions } = buildShape(id, {});
        const h = analyzeMesh(positions);
        assert.ok(h.watertight && h.inconsistentEdges === 0 && h.degenerate === 0 && h.volume > 0, `${id}: ${JSON.stringify(h)}`);
    }
});

test('shapes come out centred on the origin', () => {
    for (const id of SHAPE_ORDER) {
        const b = bounds(buildShape(id, {}).positions);
        b.min.forEach((m, k) => assert.ok(Math.abs(m + b.max[k]) < 1e-5, `${id} axis ${k}: ${m}..${b.max[k]}`));
    }
});

test('wedge volume is half its box', () => assert.ok(near(signedVolume(buildShape('wedge', { width: 2, depth: 3, height: 4 }).positions), 12)));
test('roof volume is half its box and sizes match', () => {
    const { positions } = buildShape('roof', { width: 4, depth: 3, height: 2 });
    assert.ok(near(signedVolume(positions), 12));
    assert.deepEqual(bounds(positions).size.map(v => +v.toFixed(4)), [4, 2, 3]);
});
test('pyramid volume is a third of base x height', () => {
    const n = 5, R = 1.5, H = 2, base = n / 2 * R * R * Math.sin(2 * Math.PI / n);
    assert.ok(near(signedVolume(buildShape('pyramid', { sides: n, radius: R, height: H }).positions), base * H / 3));
});
test('polygon prism volume is base area x height', () => {
    const n = 6, R = 1.5, H = 2;
    assert.ok(near(signedVolume(buildShape('prism', { sides: n, radius: R, height: H }).positions), n / 2 * R * R * Math.sin(2 * Math.PI / n) * H));
});
test('a 4-sided pyramid has a flat, axis-aligned square base', () => {
    const b = bounds(buildShape('pyramid', { sides: 4, radius: 1.5, height: 2 }).positions);
    assert.ok(near(b.size[0], b.size[2]) && near(b.size[0], 1.5 * Math.SQRT2));
});
test('half sphere volume is 2/3 pi r^3', () => {
    assert.ok(near(signedVolume(buildShape('dome', { radius: 1.5, steps: 24 }).positions), 2 / 3 * Math.PI * 1.5 ** 3, 0.01));
});
test('torus volume is 2 pi^2 R r^2', () => {
    assert.ok(near(signedVolume(buildShape('torus', { radius: 1.5, tube: 0.5, steps: 48 }).positions), 2 * Math.PI ** 2 * 1.5 * 0.25, 0.02));
});
test('tube volume is pi (ro^2 - ri^2) h', () => {
    assert.ok(near(signedVolume(buildShape('tube', { outer: 1.5, inner: 1, height: 2, steps: 96 }).positions), Math.PI * (2.25 - 1) * 2, 0.01));
});
test('paraboloid volume is half its cylinder', () => {
    assert.ok(near(signedVolume(buildShape('paraboloid', { radius: 1.5, height: 2, steps: 32 }).positions), Math.PI * 2.25 * 2 / 2, 0.02));
});
test('star volume matches its polygon area', () => {
    const n = 5, R = 1.5, r = 0.65, H = 1;
    const area = n * R * r * Math.sin(Math.PI / n); // 2n triangles, each (1/2) R r sin(pi/n)
    assert.ok(near(signedVolume(buildShape('star', { points: n, outer: R, inner: r, height: H }).positions), area * H, 0.001));
});
test('heart is as wide as asked and has the notch (concave) filled in correctly', () => {
    const { positions } = buildShape('heart', { width: 3, height: 1, steps: 64 });
    assert.ok(near(bounds(positions).size[0], 3, 0.002));
    const h = analyzeMesh(positions); assert.ok(h.watertight && h.inconsistentEdges === 0);
});

test('torus and domes carry smooth normals; flat-sided shapes do not', () => {
    assert.ok(buildShape('torus', {}).normals && buildShape('dome', {}).normals);
    assert.ok(!buildShape('star', {}).normals);
});
test('invalid parameters are refused with a readable message', () => {
    assert.throws(() => buildShape('tube', { outer: 1, inner: 1.5 }), /inner radius/);
    assert.throws(() => buildShape('torus', { radius: 0.4, tube: 0.5 }), /ring radius/);
    assert.throws(() => buildShape('star', { inner: 2, outer: 1 }), /inner radius/);
    assert.throws(() => buildShape('wedge', { width: 0 }), /Width must be/);
    assert.throws(() => buildShape('pyramid', { sides: 2 }), /at least 3 sides/);
    assert.throws(() => buildShape('nope', {}), /Unknown shape/);
});
test('every field has a label, sensible limits and the registry has an icon for the gallery', () => {
    for (const id of SHAPE_ORDER) {
        const s = SHAPES[id];
        assert.ok(s.label && s.icon.includes('<'), id);
        s.fields.forEach(f => { assert.ok(f.label && f.min > 0 && f.max > f.min && id in SHAPES && f.key in s.defaults, `${id}.${f.key}`); });
    }
});
process.exit(failed ? 1 : 0);
