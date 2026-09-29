// File importers for Holodeck. Every parser returns { positions: Float32Array } — a flat,
// non-indexed triangle soup in the file's own units and axes — so the result can be stored
// in a project file as-is and turned into a geometry by the same code on every load.
//
// STL and OBJ parsing needs nothing but the standard library, so test/test-importers.mjs runs
// it under plain node. SVG goes through THREE.SVGLoader and therefore needs the browser.

export const MAX_TRIANGLES = 1_000_000;

export class ImportError extends Error {}

function assertTriangleBudget(count) {
    if (count === 0) throw new ImportError('The file contains no triangles.');
    if (count > MAX_TRIANGLES) {
        throw new ImportError(`The file has ${count.toLocaleString()} triangles; the limit is ${MAX_TRIANGLES.toLocaleString()}.`);
    }
}

// A binary STL is exactly 84 + 50 * n bytes. Checking that is the only reliable way to tell
// it from ASCII — plenty of binary files begin with the word "solid" in their 80-byte header.
export function parseSTL(buffer) {
    const view = new DataView(buffer);
    if (buffer.byteLength >= 84) {
        const n = view.getUint32(80, true);
        if (84 + n * 50 === buffer.byteLength) return parseBinarySTL(view, n);
    }
    return parseAsciiSTL(new TextDecoder().decode(buffer));
}

function parseBinarySTL(view, n) {
    assertTriangleBudget(n);
    const positions = new Float32Array(n * 9);
    for (let i = 0; i < n; i++) {
        const base = 84 + i * 50 + 12; // skip the 12-byte facet normal; it is recomputed
        for (let k = 0; k < 9; k++) positions[i * 9 + k] = view.getFloat32(base + k * 4, true);
    }
    return { positions };
}

function parseAsciiSTL(text) {
    const out = [];
    const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
    let m;
    while ((m = re.exec(text))) {
        out.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
        if (out.length / 9 > MAX_TRIANGLES) assertTriangleBudget(out.length / 9);
    }
    if (out.length % 9 !== 0) throw new ImportError('The STL file is truncated or malformed.');
    assertTriangleBudget(out.length / 9);
    return { positions: Float32Array.from(out) };
}

// Wavefront OBJ: vertices and faces only. Polygons are fan-triangulated (correct for the
// convex faces modelling tools export), negative indices are relative, and every object or
// group in the file is merged into one mesh.
export function parseOBJ(text) {
    const verts = [];
    const out = [];
    const lines = text.split(/\r?\n/);
    for (let line of lines) {
        line = line.trim();
        if (line.startsWith('v ')) {
            const p = line.split(/\s+/);
            verts.push([parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[3])]);
        } else if (line.startsWith('f ')) {
            const idx = line.split(/\s+/).slice(1).map(tok => {
                const i = parseInt(tok.split('/')[0], 10);
                return i < 0 ? verts.length + i : i - 1;
            });
            if (idx.length < 3) continue;
            for (let k = 1; k < idx.length - 1; k++) {
                for (const vi of [idx[0], idx[k], idx[k + 1]]) {
                    const v = verts[vi];
                    if (!v || v.some(Number.isNaN)) throw new ImportError('The OBJ file references a vertex that does not exist.');
                    out.push(v[0], v[1], v[2]);
                }
            }
            if (out.length / 9 > MAX_TRIANGLES) assertTriangleBudget(out.length / 9);
        }
    }
    assertTriangleBudget(out.length / 9);
    return { positions: Float32Array.from(out) };
}

// SVG -> extruded solid. Returned in millimetres, lying flat on the XZ plane and extruded
// up +Y, with the drawing reading the right way up when viewed from above. One SVG user unit
// is one CSS pixel (0.2646 mm at 96 dpi).
const SVG_PX_TO_MM = 25.4 / 96;
export const SVG_DEFAULT_DEPTH_MM = 5;

export function parseSVG(text, depthMm = SVG_DEFAULT_DEPTH_MM) {
    const loader = new THREE.SVGLoader();
    const data = loader.parse(text);
    const geometries = [];

    const addPath = path => {
        for (const shape of THREE.SVGLoader.createShapes(path)) {
            const { shape: outline, holes } = shape.extractPoints(12);
            if (outline.length < 3) continue;
            // SVG's y axis points down; negating y here (rather than mirroring the finished
            // mesh) keeps the triangle winding intact.
            const flipped = new THREE.Shape(outline.map(p => new THREE.Vector2(p.x, -p.y)));
            flipped.holes = holes.map(h => new THREE.Path(h.map(p => new THREE.Vector2(p.x, -p.y))));
            geometries.push(new THREE.ExtrudeGeometry(flipped, { depth: depthMm / SVG_PX_TO_MM, bevelEnabled: false, curveSegments: 12 }));
        }
    };

    const isFilled = p => p.userData?.style?.fill !== 'none';
    data.paths.filter(isFilled).forEach(addPath);
    // Icon sets are often stroke-only. Rather than import nothing, treat an outline as a
    // filled shape when the file has no filled paths at all.
    if (geometries.length === 0) data.paths.forEach(addPath);
    if (geometries.length === 0) throw new ImportError('The SVG has no closed shapes to extrude.');

    const merged = THREE.BufferGeometryUtils.mergeBufferGeometries(geometries.map(g => {
        const flat = g.index ? g.toNonIndexed() : g;
        flat.deleteAttribute('uv'); flat.deleteAttribute('normal');
        return flat;
    }));
    geometries.forEach(g => g.dispose());
    merged.rotateX(-Math.PI / 2); // (x, y, z) -> (x, z, -y): extrusion axis z becomes up
    merged.scale(SVG_PX_TO_MM, SVG_PX_TO_MM, SVG_PX_TO_MM);
    const positions = Float32Array.from(merged.attributes.position.array);
    merged.dispose();
    assertTriangleBudget(positions.length / 9);
    return { positions };
}

// Dispatches on file extension. Resolves to { positions, format, unitsMm } where unitsMm is
// how many millimetres one unit of `positions` is — STL and OBJ are assumed to be in mm, the
// convention Holodeck's own STL export uses, so a file round-trips at its original size.
export async function importFile(file, { svgDepthMm } = {}) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    switch (ext) {
        case 'stl': return { ...parseSTL(await file.arrayBuffer()), format: 'STL', unitsMm: 1 };
        case 'obj': return { ...parseOBJ(await file.text()), format: 'OBJ', unitsMm: 1 };
        case 'svg': return { ...parseSVG(await file.text(), svgDepthMm), format: 'SVG', unitsMm: 1 };
        default: throw new ImportError(`Unsupported file type ".${ext}". Use STL, OBJ or SVG.`);
    }
}

// Float32Array <-> base64, for embedding imported meshes in a project file.
export function encodePositions(positions) {
    const bytes = new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
}

export function decodePositions(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Float32Array(bytes.buffer);
}
