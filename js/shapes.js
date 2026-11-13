// The parametric shape library. Each entry describes one shape: its parameters (stored in cm,
// edited in mm), and a pure builder that returns a triangle soup { positions, normals? }
// centred on its bounding box. Nothing here touches the scene, so it runs under plain node
// (test/test-shapes.mjs) and a shape can be rebuilt from its saved parameters on undo/load.
import { revolveMesh, signedVolume, flipWinding } from './modeling.js';

// --- 2D helpers ------------------------------------------------------------------------------

const area2 = pts => { let a = 0; for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; a += x1 * y2 - x2 * y1; } return a / 2; };

// Ear-clipping triangulation of a simple polygon (convex or concave). Returns index triples
// that wind counter-clockwise.
export function triangulate(poly) {
    const n = poly.length;
    if (n < 3) return [];
    const idx = poly.map((_, i) => i);
    if (area2(poly) < 0) idx.reverse();
    const cross = (a, b, c) => (poly[b][0] - poly[a][0]) * (poly[c][1] - poly[a][1]) - (poly[b][1] - poly[a][1]) * (poly[c][0] - poly[a][0]);
    const inside = (p, a, b, c) => cross(a, b, p) >= -1e-12 && cross(b, c, p) >= -1e-12 && cross(c, a, p) >= -1e-12;
    const out = [];
    let guard = 0;
    while (idx.length > 3 && guard++ < n * n) {
        let clipped = false;
        for (let i = 0; i < idx.length; i++) {
            const a = idx[(i + idx.length - 1) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length];
            if (cross(a, b, c) <= 1e-12) continue; // reflex or flat: not an ear
            if (idx.some(p => p !== a && p !== b && p !== c && inside(p, a, b, c))) continue;
            out.push([a, b, c]); idx.splice(i, 1); clipped = true; break;
        }
        if (!clipped) break; // degenerate polygon: stop rather than loop forever
    }
    if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
    return out;
}

// A polygon in the XY plane extruded along +Z from 0 to depth.
export function extrudePolygon(pts, depth) {
    const tris = triangulate(pts);
    if (tris.length === 0) throw new Error('The outline could not be filled in.');
    const P = [];
    const v = (i, z) => [pts[i][0], pts[i][1], z];
    const push = (...vs) => vs.forEach(p => P.push(...p));
    for (const [a, b, c] of tris) {
        push(v(a, depth), v(b, depth), v(c, depth)); // front, counter-clockwise from +Z
        push(v(a, 0), v(c, 0), v(b, 0));             // back, reversed
    }
    const ccw = area2(pts) >= 0;
    for (let i = 0; i < pts.length; i++) {
        const j = (i + 1) % pts.length;
        const a = ccw ? i : j, b = ccw ? j : i;
        push(v(a, 0), v(b, 0), v(b, depth)); push(v(a, 0), v(b, depth), v(a, depth));
    }
    const out = Float32Array.from(P);
    return signedVolume(out) < 0 ? flipWinding(out) : out;
}

// (x, y, z) -> (x, z, -y): stands an XY-plane extrusion upright so +Z becomes +Y (a rotation, so
// winding is kept) and the outline reads the right way round from above.
function standUp(p) {
    const o = new Float32Array(p.length);
    for (let i = 0; i < p.length; i += 3) { o[i] = p[i]; o[i + 1] = p[i + 2]; o[i + 2] = -p[i + 1]; }
    return o;
}

const ngon = (sides, radius, phase = 0) => Array.from({ length: sides }, (_, i) => {
    const a = phase + (i / sides) * Math.PI * 2;
    return [radius * Math.cos(a), radius * Math.sin(a)];
});

// --- builders ----------------------------------------------------------------------------------

const need = (cond, message) => { if (!cond) throw new Error(message); };

const BUILDERS = {
    wedge: ({ width, depth, height }) => ({ positions: extrudePolygon([[0, 0], [width, 0], [0, height]], depth) }),

    roof: ({ width, depth, height }) => ({ positions: extrudePolygon([[-width / 2, 0], [width / 2, 0], [0, height]], depth) }),

    prism: ({ sides, radius, height }) => {
        need(sides >= 3, 'A prism needs at least 3 sides.');
        return { positions: standUp(extrudePolygon(ngon(Math.round(sides), radius, Math.PI / sides), height)) };
    },

    pyramid: ({ sides, radius, height }) => {
        need(sides >= 3, 'A pyramid needs at least 3 sides.');
        const n = Math.round(sides), ring = ngon(n, radius, Math.PI / n);
        const apex = [0, height, 0], centre = [0, 0, 0];
        const P = [];
        const at = i => [ring[i % n][0], 0, -ring[i % n][1]];
        for (let i = 0; i < n; i++) {
            P.push(...at(i), ...at(i + 1), ...apex);   // side
            P.push(...at(i + 1), ...at(i), ...centre); // base
        }
        const out = Float32Array.from(P);
        return { positions: signedVolume(out) < 0 ? flipWinding(out) : out };
    },

    dome: ({ radius, steps }) => {
        const n = Math.max(3, Math.round(steps));
        const profile = [[0, 0], [radius, 0]];
        for (let i = 1; i <= n; i++) { const a = (i / n) * Math.PI / 2; profile.push([radius * Math.cos(a), radius * Math.sin(a)]); }
        profile[profile.length - 1] = [0, radius];
        return revolveMesh(profile, Math.max(16, n * 4));
    },

    tube: ({ outer, inner, height, steps }) => {
        need(inner > 0 && inner < outer, 'The inner radius must be above zero and smaller than the outer radius.');
        const h = height / 2;
        return revolveMesh([[inner, -h], [outer, -h], [outer, h], [inner, h]], Math.max(8, Math.round(steps)));
    },

    paraboloid: ({ radius, height, steps }) => {
        const n = Math.max(4, Math.round(steps));
        const profile = [];
        for (let i = 0; i <= n; i++) { const r = radius * i / n; profile.push([r, height * (r / radius) ** 2]); }
        profile.push([0, height]);
        return revolveMesh(profile, Math.max(16, n * 3));
    },

    torus: ({ radius, tube, steps }) => {
        need(tube > 0 && radius > tube, 'The ring radius must be larger than the tube radius.');
        const M = Math.max(6, Math.round(steps)), N = Math.max(6, Math.round(steps / 2));
        const vert = (i, j) => {
            const u = (i % M) / M * Math.PI * 2, v = (j % N) / N * Math.PI * 2;
            const cu = Math.cos(u), su = Math.sin(u), cv = Math.cos(v), sv = Math.sin(v);
            return { p: [(radius + tube * cv) * cu, tube * sv, -(radius + tube * cv) * su], n: [cv * cu, sv, -cv * su] };
        };
        const P = [], Nn = [];
        const emit = (...vs) => vs.forEach(q => { P.push(...q.p); Nn.push(...q.n); });
        for (let i = 0; i < M; i++) for (let j = 0; j < N; j++) {
            const a = vert(i, j), b = vert(i + 1, j), c = vert(i + 1, j + 1), d = vert(i, j + 1);
            emit(a, b, c); emit(a, c, d);
        }
        let positions = Float32Array.from(P);
        if (signedVolume(positions) < 0) positions = flipWinding(positions);
        return { positions, normals: Float32Array.from(Nn) };
    },

    star: ({ points, outer, inner, height }) => {
        need(points >= 3, 'A star needs at least 3 points.');
        need(inner > 0 && inner < outer, 'The inner radius must be above zero and smaller than the outer radius.');
        const n = Math.round(points), pts = [];
        for (let i = 0; i < n * 2; i++) {
            const a = (i / (n * 2)) * Math.PI * 2 + Math.PI / 2, r = i % 2 === 0 ? outer : inner;
            pts.push([r * Math.cos(a), r * Math.sin(a)]);
        }
        return { positions: standUp(extrudePolygon(pts, height)) };
    },

    heart: ({ width, height, steps }) => {
        const n = Math.max(16, Math.round(steps)), pts = [];
        for (let i = 0; i < n; i++) {
            const t = (i / n) * Math.PI * 2;
            pts.push([16 * Math.sin(t) ** 3, 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)]);
        }
        const xs = pts.map(p => p[0]), span = Math.max(...xs) - Math.min(...xs);
        const k = width / span;
        return { positions: standUp(extrudePolygon(pts.map(([x, y]) => [x * k, y * k]), height)) };
    }
};

// --- registry ----------------------------------------------------------------------------------
// Lengths are cm in storage and mm in the UI; `count` fields are plain numbers. `icon` is the
// inside of a 24x24 SVG drawn with the current text colour.
const L = (key, label, min = 0.1, max = 500) => ({ key, label, min, max, step: 1 });
const C = (key, label, min, max) => ({ key, label, min, max, step: 1, count: true });
const S = (inner) => `<g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">${inner}</g>`;

export const SHAPES = {
    wedge: { label: 'Wedge', defaults: { width: 2, depth: 2, height: 2 },
        fields: [L('width', 'Width'), L('depth', 'Depth'), L('height', 'Height')],
        icon: S('<path d="M3 19 L21 19 L3 6 Z"/><path d="M3 19 L7 22 L21 22 L21 19"/>') },
    roof: { label: 'Roof', defaults: { width: 3, depth: 2, height: 1.5 },
        fields: [L('width', 'Width'), L('depth', 'Depth'), L('height', 'Height')],
        icon: S('<path d="M3 17 L12 6 L21 17 Z"/><path d="M3 17 L3 20 L21 20 L21 17"/>') },
    pyramid: { label: 'Pyramid', defaults: { sides: 4, radius: 1.5, height: 2 },
        fields: [C('sides', 'Sides', 3, 32), L('radius', 'Radius'), L('height', 'Height')],
        icon: S('<path d="M12 3 L3 19 L12 22 L21 19 Z"/><path d="M12 3 L12 22"/>') },
    prism: { label: 'Polygon', defaults: { sides: 6, radius: 1.5, height: 2 },
        fields: [C('sides', 'Sides', 3, 64), L('radius', 'Radius'), L('height', 'Height')],
        icon: S('<path d="M12 3 L20 8 L20 16 L12 21 L4 16 L4 8 Z"/><path d="M4 8 L12 13 L20 8 M12 13 L12 21"/>') },
    dome: { label: 'Half sphere', defaults: { radius: 1.5, steps: 12 },
        fields: [L('radius', 'Radius'), C('steps', 'Steps', 3, 48)],
        icon: S('<path d="M3 17 A9 9 0 0 1 21 17 Z"/><path d="M3 17 Q12 22 21 17"/>') },
    torus: { label: 'Torus', defaults: { radius: 1.5, tube: 0.5, steps: 24 },
        fields: [L('radius', 'Ring radius'), L('tube', 'Tube radius'), C('steps', 'Steps', 6, 96)],
        icon: S('<ellipse cx="12" cy="12" rx="9.5" ry="6.5"/><ellipse cx="12" cy="12.5" rx="4" ry="2.2"/>') },
    tube: { label: 'Tube', defaults: { outer: 1.5, inner: 1, height: 2, steps: 32 },
        fields: [L('outer', 'Outer radius'), L('inner', 'Inner radius'), L('height', 'Height'), C('steps', 'Steps', 8, 96)],
        icon: S('<ellipse cx="12" cy="7" rx="8" ry="3.5"/><ellipse cx="12" cy="7" rx="4.5" ry="1.8"/><path d="M4 7 L4 17 A8 3.5 0 0 0 20 17 L20 7"/>') },
    star: { label: 'Star', defaults: { points: 5, outer: 1.5, inner: 0.65, height: 1 },
        fields: [C('points', 'Points', 3, 24), L('outer', 'Outer radius'), L('inner', 'Inner radius'), L('height', 'Height')],
        icon: S('<path d="M12 3 L14.6 9 L21 9.4 L16 13.6 L17.6 20 L12 16.6 L6.4 20 L8 13.6 L3 9.4 L9.4 9 Z"/>') },
    heart: { label: 'Heart', defaults: { width: 3, height: 1, steps: 48 },
        fields: [L('width', 'Width'), L('height', 'Height'), C('steps', 'Smoothness', 16, 128)],
        icon: S('<path d="M12 20 C3 14 3 7 7.5 5.5 C10 4.7 11.5 6.2 12 8 C12.5 6.2 14 4.7 16.5 5.5 C21 7 21 14 12 20 Z"/>') },
    paraboloid: { label: 'Paraboloid', defaults: { radius: 1.5, height: 2, steps: 12 },
        fields: [L('radius', 'Radius'), L('height', 'Height'), C('steps', 'Steps', 4, 48)],
        icon: S('<path d="M12 21 C12 21 4 17 3.5 5 L20.5 5 C20 17 12 21 12 21 Z"/><ellipse cx="12" cy="5" rx="8.5" ry="2"/>') }
};

export const SHAPE_ORDER = ['wedge', 'roof', 'pyramid', 'prism', 'dome', 'torus', 'tube', 'star', 'heart', 'paraboloid'];

// Builds a shape from its parameters, centred on the middle of its bounding box.
export function buildShape(id, params) {
    const shape = SHAPES[id], build = BUILDERS[id];
    if (!shape || !build) throw new Error(`Unknown shape "${id}".`);
    const p = { ...shape.defaults, ...params };
    for (const f of shape.fields) {
        if (!(p[f.key] > 0) || !isFinite(p[f.key])) throw new Error(`${f.label} must be a number above zero.`);
    }
    const mesh = build(p);
    const a = mesh.positions;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < a.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], a[i + k]); max[k] = Math.max(max[k], a[i + k]); }
    for (let i = 0; i < a.length; i += 3) for (let k = 0; k < 3; k++) a[i + k] -= (min[k] + max[k]) / 2;
    return mesh;
}
