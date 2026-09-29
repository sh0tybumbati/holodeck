// Model writers for Holodeck: binary/ASCII STL, OBJ and 3MF. Pure functions over
//   parts: [{ name, positions }]   positions = Float32Array triangle soup, world space, mm
// so they run under plain node (test/test-exporters.mjs) and never touch the scene graph.

function triangleNormal(p, i) {
    const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2];
    const vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    return [nx / len, ny / len, nz / len];
}

export const countTriangles = parts => parts.reduce((n, part) => n + part.positions.length / 9, 0);

export function writeBinarySTL(parts) {
    const n = countTriangles(parts);
    const buf = new ArrayBuffer(84 + n * 50);
    const view = new DataView(buf);
    new TextEncoder().encodeInto('Holodeck binary STL (millimetres)', new Uint8Array(buf, 0, 80));
    view.setUint32(80, n, true);
    let off = 84;
    for (const { positions: p } of parts) {
        for (let i = 0; i < p.length; i += 9) {
            triangleNormal(p, i).forEach((v, k) => view.setFloat32(off + k * 4, v, true));
            for (let k = 0; k < 9; k++) view.setFloat32(off + 12 + k * 4, p[i + k], true);
            off += 50;
        }
    }
    return buf;
}

const num = v => String(+v.toFixed(5));

export function writeAsciiSTL(parts) {
    const out = [];
    for (const { name, positions: p } of parts) {
        out.push(`solid ${name.replace(/\s+/g, '_') || 'part'}`);
        for (let i = 0; i < p.length; i += 9) {
            out.push(`facet normal ${triangleNormal(p, i).map(num).join(' ')}`, ' outer loop');
            for (let k = 0; k < 9; k += 3) out.push(`  vertex ${num(p[i + k])} ${num(p[i + k + 1])} ${num(p[i + k + 2])}`);
            out.push(' endloop', 'endfacet');
        }
        out.push(`endsolid ${name.replace(/\s+/g, '_') || 'part'}`);
    }
    return out.join('\n') + '\n';
}

// Merges vertices with identical coordinates, so OBJ and 3MF share vertices between the
// triangles that meet at them instead of repeating every corner.
export function weld(positions) {
    const index = new Map();
    const verts = [];
    const tris = new Uint32Array(positions.length / 3);
    for (let i = 0; i < positions.length; i += 3) {
        const key = `${positions[i]},${positions[i + 1]},${positions[i + 2]}`;
        let id = index.get(key);
        if (id === undefined) { id = verts.length / 3; index.set(key, id); verts.push(positions[i], positions[i + 1], positions[i + 2]); }
        tris[i / 3] = id;
    }
    return { verts, tris };
}

export function writeOBJ(parts) {
    const out = ['# Holodeck export (millimetres)'];
    let base = 1;
    for (const { name, positions } of parts) {
        const { verts, tris } = weld(positions);
        out.push(`o ${name.replace(/\s+/g, '_') || 'part'}`);
        for (let i = 0; i < verts.length; i += 3) out.push(`v ${num(verts[i])} ${num(verts[i + 1])} ${num(verts[i + 2])}`);
        for (let i = 0; i < tris.length; i += 3) out.push(`f ${tris[i] + base} ${tris[i + 1] + base} ${tris[i + 2] + base}`);
        base += verts.length / 3;
    }
    return out.join('\n') + '\n';
}

const xmlEscape = s => s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

export function write3MFModel(parts) {
    const objects = [], items = [];
    parts.forEach(({ name, positions }, k) => {
        const { verts, tris } = weld(positions);
        const id = k + 1;
        let v = '', t = '';
        for (let i = 0; i < verts.length; i += 3) v += `<vertex x="${num(verts[i])}" y="${num(verts[i + 1])}" z="${num(verts[i + 2])}"/>`;
        for (let i = 0; i < tris.length; i += 3) t += `<triangle v1="${tris[i]}" v2="${tris[i + 1]}" v3="${tris[i + 2]}"/>`;
        objects.push(`<object id="${id}" type="model" name="${xmlEscape(name)}"><mesh><vertices>${v}</vertices><triangles>${t}</triangles></mesh></object>`);
        items.push(`<item objectid="${id}"/>`);
    });
    return '<?xml version="1.0" encoding="UTF-8"?>\n'
        + '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
        + `<metadata name="Application">Holodeck</metadata><resources>${objects.join('')}</resources><build>${items.join('')}</build></model>`;
}

// Y-up (Holodeck, Three.js) to Z-up (3MF, slicers): (x, y, z) -> (x, -z, y). A rotation,
// so triangle winding is unchanged.
export function zUpParts(parts) {
    return parts.map(({ name, positions }) => {
        const o = new Float32Array(positions.length);
        for (let i = 0; i < o.length; i += 3) { o[i] = positions[i]; o[i + 1] = -positions[i + 2]; o[i + 2] = positions[i + 1]; }
        return { name, positions: o };
    });
}

export function write3MF(parts) {
    // Slicers treat 3MF as Z-up and would otherwise stand the model on its side.
    const files = [
        ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'],
        ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'],
        ['3D/3dmodel.model', write3MFModel(zUpParts(parts))]
    ];
    return zip(files);
}

// --- minimal ZIP writer (stored, no compression) ---------------------------------------
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
})();
export function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

export function zip(files) {
    const enc = new TextEncoder();
    const entries = files.map(([name, content]) => ({ name: enc.encode(name), data: typeof content === 'string' ? enc.encode(content) : content }));
    let size = 22;
    entries.forEach(e => { size += 30 + e.name.length + e.data.length + 46 + e.name.length; });
    const out = new Uint8Array(size), v = new DataView(out.buffer);
    let off = 0;
    const central = [];
    for (const e of entries) {
        const crc = crc32(e.data);
        central.push({ ...e, crc, offset: off });
        v.setUint32(off, 0x04034b50, true); v.setUint16(off + 4, 20, true); v.setUint16(off + 6, 0x0800, true); // UTF-8 names
        v.setUint16(off + 8, 0, true); v.setUint16(off + 10, 0, true); v.setUint16(off + 12, 0x21, true);       // stored, 1980-01-01
        v.setUint32(off + 14, crc, true); v.setUint32(off + 18, e.data.length, true); v.setUint32(off + 22, e.data.length, true);
        v.setUint16(off + 26, e.name.length, true); v.setUint16(off + 28, 0, true);
        out.set(e.name, off + 30); out.set(e.data, off + 30 + e.name.length);
        off += 30 + e.name.length + e.data.length;
    }
    const cdStart = off;
    for (const e of central) {
        v.setUint32(off, 0x02014b50, true); v.setUint16(off + 4, 20, true); v.setUint16(off + 6, 20, true); v.setUint16(off + 8, 0x0800, true);
        v.setUint16(off + 10, 0, true); v.setUint16(off + 12, 0, true); v.setUint16(off + 14, 0x21, true);
        v.setUint32(off + 16, e.crc, true); v.setUint32(off + 20, e.data.length, true); v.setUint32(off + 24, e.data.length, true);
        v.setUint16(off + 28, e.name.length, true); v.setUint32(off + 42, e.offset, true);
        out.set(e.name, off + 46);
        off += 46 + e.name.length;
    }
    v.setUint32(off, 0x06054b50, true); v.setUint16(off + 8, entries.length, true); v.setUint16(off + 10, entries.length, true);
    v.setUint32(off + 12, off - cdStart, true); v.setUint32(off + 16, cdStart, true);
    return out;
}

export const EXPORT_FORMATS = {
    'stl-binary': { label: 'STL (binary) — smallest, for slicers', ext: 'stl', mime: 'model/stl', write: writeBinarySTL },
    'stl-ascii': { label: 'STL (ASCII) — human-readable', ext: 'stl', mime: 'text/plain', write: writeAsciiSTL },
    'obj': { label: 'OBJ — shared vertices', ext: 'obj', mime: 'text/plain', write: writeOBJ },
    '3mf': { label: '3MF — units and Z-up, for modern slicers', ext: '3mf', mime: 'model/3mf', write: write3MF }
};
