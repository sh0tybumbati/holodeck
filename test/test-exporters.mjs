#!/usr/bin/env node
// Unit tests for js/exporters.js:  node test/test-exporters.mjs
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { parseSTL, parseOBJ } from '../js/importers.js';
import { writeBinarySTL, writeAsciiSTL, writeOBJ, write3MF, weld, crc32, zip } from '../js/exporters.js';
import { roundedBox, signedVolume } from '../js/modeling.js';

let failed = 0;
function test(name, fn) { try { fn(); console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '\n  ', e.message); } }

const cube = roundedBox(20, 20, 20, 0).positions; // 12 triangles, 8 distinct corners... plus grid points
const part = { name: 'A cube & <more>', positions: cube };

test('binary STL has the exact size and round-trips through the importer', () => {
    const buf = writeBinarySTL([part, part]);
    const n = cube.length / 9 * 2;
    assert.equal(buf.byteLength, 84 + 50 * n);
    const back = parseSTL(buf);
    assert.equal(back.positions.length, cube.length * 2);
    assert.deepEqual(Array.from(back.positions.slice(0, 9)), Array.from(cube.slice(0, 9)));
});
test('ASCII STL round-trips through the importer', () => {
    const back = parseSTL(new TextEncoder().encode(writeAsciiSTL([part])).buffer);
    assert.equal(back.positions.length, cube.length);
});
test('OBJ round-trips through the importer and welds shared vertices', () => {
    const txt = writeOBJ([part]);
    const back = parseOBJ(txt);
    assert.equal(back.positions.length, cube.length);
    assert.ok(txt.split('\n').filter(l => l.startsWith('v ')).length < cube.length / 3);
    assert.ok(Math.abs(signedVolume(back.positions) - 8000) < 1);
});
test('OBJ indices of a second part continue after the first', () => {
    const txt = writeOBJ([part, part]);
    const back = parseOBJ(txt);
    assert.equal(back.positions.length, cube.length * 2);
});
test('weld merges coincident vertices', () => {
    const { verts, tris } = weld(Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1]));
    assert.equal(verts.length / 3, 4); assert.equal(tris.length, 6);
});
test('crc32 matches the standard check value', () => {
    assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

// Reads a stored-or-deflated zip through its central directory, verifying every CRC.
function readZip(bytes) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = bytes.length - 22;
    assert.equal(v.getUint32(eocd, true), 0x06054b50);
    const count = v.getUint16(eocd + 10, true);
    let p = v.getUint32(eocd + 16, true);
    const files = {};
    for (let i = 0; i < count; i++) {
        assert.equal(v.getUint32(p, true), 0x02014b50);
        const method = v.getUint16(p + 10, true), crc = v.getUint32(p + 16, true), csize = v.getUint32(p + 20, true);
        const nlen = v.getUint16(p + 28, true), off = v.getUint32(p + 42, true);
        const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nlen));
        const lnlen = v.getUint16(off + 26, true), lxlen = v.getUint16(off + 28, true);
        const raw = bytes.subarray(off + 30 + lnlen + lxlen, off + 30 + lnlen + lxlen + csize);
        const data = method === 0 ? raw : inflateRawSync(raw);
        assert.equal(crc32(data), crc, `crc of ${name}`);
        files[name] = new TextDecoder().decode(data);
        p += 46 + nlen;
    }
    return files;
}

test('3MF is a valid zip with the three required parts and correct mesh counts', () => {
    const files = readZip(write3MF([part]));
    assert.deepEqual(Object.keys(files).sort(), ['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels']);
    const model = files['3D/3dmodel.model'];
    assert.equal((model.match(/<triangle /g) || []).length, cube.length / 9);
    assert.ok(model.includes('unit="millimeter"'));
    assert.ok(model.includes('name="A cube &amp; &lt;more&gt;"'), 'names are XML-escaped');
});
test('3MF is Z-up: a Y-up box 10 tall comes out 10 along Z', () => {
    const tall = roundedBox(20, 10, 30, 0).positions;
    const model = readZip(write3MF([{ name: 't', positions: tall }]))['3D/3dmodel.model'];
    const zs = [...model.matchAll(/z="(-?[\d.]+)"/g)].map(m => +m[1]);
    assert.equal(Math.max(...zs) - Math.min(...zs), 10);
});
test('zip stores arbitrary binary files intact', () => {
    const data = Uint8Array.from({ length: 1000 }, (_, i) => i % 251);
    assert.equal(crc32(data), crc32(readZipBinary(zip([['x.bin', data]]))));
    function readZipBinary(b) { const v = new DataView(b.buffer); const off = 0; const n = v.getUint32(off + 18, true); return b.subarray(30 + 5, 30 + 5 + n); }
});
process.exit(failed ? 1 : 0);
