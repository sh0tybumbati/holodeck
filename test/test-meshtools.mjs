#!/usr/bin/env node
// Unit tests for js/meshtools.js:  node test/test-meshtools.mjs
import assert from 'node:assert/strict';
import { analyzeMesh, repairMesh, describeHealth } from '../js/meshtools.js';
import { roundedBox, flipWinding } from '../js/modeling.js';

let failed = 0;
function test(name, fn) { try { fn(); console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '\n  ', e.message); } }
const cube = () => roundedBox(2, 2, 2, 0).positions;

test('a cube is watertight and consistently wound', () => {
    const h = analyzeMesh(cube());
    assert.ok(h.watertight && h.inconsistentEdges === 0 && h.degenerate === 0 && Math.abs(h.volume - 8) < 1e-4, JSON.stringify(h));
});
test('a rounded cube is watertight too (its many grid vertices are welded)', () => {
    assert.ok(analyzeMesh(roundedBox(2, 2, 2, 0.4, 'fillet', 4).positions).watertight);
});
test('removing a triangle opens the mesh', () => {
    const h = analyzeMesh(cube().slice(9));
    assert.ok(!h.watertight && h.openEdges === 3, JSON.stringify(h));
    assert.match(describeHealth(h), /not watertight \(3 open edge/);
});
test('a lone triangle is all open edges', () => {
    assert.equal(analyzeMesh(Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0])).openEdges, 3);
});
test('flipping one triangle is reported as inconsistent winding', () => {
    const p = cube();
    const q = Float32Array.from(p);
    for (let k = 0; k < 3; k++) { const t = q[3 + k]; q[3 + k] = q[6 + k]; q[6 + k] = t; }
    const h = analyzeMesh(q);
    assert.ok(h.watertight && h.inconsistentEdges > 0, JSON.stringify(h));
});
test('an inside-out cube is turned the right way round', () => {
    const r = repairMesh(flipWinding(cube()));
    assert.ok(r.flipped);
    assert.ok(analyzeMesh(r.positions).volume > 0);
    assert.match(describeHealth(analyzeMesh(r.positions), r), /flipped/);
});
test('zero-area triangles are removed and counted', () => {
    const p = Float32Array.from([...cube(), 5, 5, 5, 5, 5, 5, 6, 6, 6]);
    const r = repairMesh(p);
    assert.equal(r.removedDegenerate, 1); assert.ok(r.positions.length === cube().length);
});
test('a healthy mesh has no warning and is returned untouched', () => {
    const p = cube(), r = repairMesh(p);
    assert.ok(r.positions === p, 'the same array comes back');
    assert.equal(describeHealth(analyzeMesh(p), r), '');
});
test('an open mesh is not "repaired" by guessing', () => {
    const open = flipWinding(cube()).slice(9);
    assert.equal(repairMesh(open).flipped, false);
});
process.exit(failed ? 1 : 0);
