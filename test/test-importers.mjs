#!/usr/bin/env node
// Unit tests for the STL and OBJ parsers in js/importers.js. Pure node, no browser:
//   node test/test-importers.mjs
import assert from 'node:assert/strict';
import { convertImported, parseSTL, parseOBJ, encodePositions, decodePositions, ImportError } from '../js/importers.js';

const tri = [0, 0, 0, 1, 0, 0, 0, 1, 0];
let failed = 0;
function test(name, fn) {
    try { fn(); console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '\n  ', e.message); }
}

function binarySTL(tris, header = 'binary') {
    const buf = new ArrayBuffer(84 + tris.length * 50);
    const v = new DataView(buf);
    new TextEncoder().encodeInto(header, new Uint8Array(buf, 0, 80));
    v.setUint32(80, tris.length, true);
    tris.forEach((t, i) => t.forEach((n, k) => v.setFloat32(84 + i * 50 + 12 + k * 4, n, true)));
    return buf;
}

test('binary STL', () => {
    const { positions } = parseSTL(binarySTL([tri, tri.map(n => n + 1)]));
    assert.equal(positions.length, 18);
    assert.deepEqual(Array.from(positions.slice(9, 12)), [1, 1, 1]);
});

test('binary STL whose header starts with "solid" is not mistaken for ASCII', () => {
    const { positions } = parseSTL(binarySTL([tri], 'solid exported by some CAD tool'));
    assert.equal(positions.length, 9);
});

test('ASCII STL', () => {
    const txt = `solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1e0 0 0\nvertex 0 -1.5 0\nendloop\nendfacet\nendsolid`;
    const { positions } = parseSTL(new TextEncoder().encode(txt).buffer);
    assert.deepEqual(Array.from(positions), [0, 0, 0, 1, 0, 0, 0, -1.5, 0]);
});

test('empty and truncated STL are rejected', () => {
    assert.throws(() => parseSTL(new ArrayBuffer(10)), ImportError);
    assert.throws(() => parseSTL(new TextEncoder().encode('solid x\nvertex 0 0 0\nvertex 1 0 0').buffer), ImportError);
});

test('OBJ quad is fan-triangulated, v/vt/vn syntax and comments handled', () => {
    const { positions } = parseOBJ('# c\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nvt 0 0\nvn 0 0 1\nf 1/1/1 2/1/1 3/1/1 4/1/1\n');
    assert.equal(positions.length, 18);
});

test('OBJ negative indices are relative to the vertices seen so far', () => {
    const { positions } = parseOBJ('v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1\n');
    assert.deepEqual(Array.from(positions), tri);
});

test('OBJ with CRLF line endings', () => {
    assert.equal(parseOBJ('v 0 0 0\r\nv 1 0 0\r\nv 0 1 0\r\nf 1 2 3\r\n').positions.length, 9);
});

test('OBJ with a dangling face index or no faces is rejected', () => {
    assert.throws(() => parseOBJ('v 0 0 0\nf 1 2 3\n'), ImportError);
    assert.throws(() => parseOBJ('v 0 0 0\n'), ImportError);
});

test('positions survive the base64 round trip used by .holo files', () => {
    const p = Float32Array.from({ length: 300000 }, (_, i) => Math.fround(i * 0.37 - 5));
    assert.deepEqual(decodePositions(encodePositions(p)), p);
});

test('convertImported scales mm->cm and maps Z-up onto Y-up', () => {
    const out = convertImported(Float32Array.from([10, 20, 30]), { unitsMm: 1, zUp: true });
    assert.deepEqual(Array.from(out), [1, 3, -2]);
    assert.deepEqual(Array.from(convertImported(Float32Array.from([1, 2, 3]), { unitsMm: 25.4 })).map(v => +v.toFixed(3)), [2.54, 5.08, 7.62]);
});

process.exit(failed ? 1 : 0);
