// Pure geometry generators for the modelling tools. Everything takes and returns flat
// Float32Array triangle soups (x,y,z per vertex, three vertices per triangle), so it runs
// under plain node and can be stored in a project the same way imported meshes are.

// Signed volume of a closed triangle soup: positive when the triangles wind outward.
export function signedVolume(p) {
    let v = 0;
    for (let i = 0; i < p.length; i += 9) {
        v += (p[i] * (p[i + 4] * p[i + 8] - p[i + 5] * p[i + 7])
            - p[i + 1] * (p[i + 3] * p[i + 8] - p[i + 5] * p[i + 6])
            + p[i + 2] * (p[i + 3] * p[i + 7] - p[i + 4] * p[i + 6])) / 6;
    }
    return v;
}

// Swaps the 2nd and 3rd vertex of every triangle, reversing which side is "outside".
export function flipWinding(p) {
    const o = Float32Array.from(p);
    for (let i = 0; i < o.length; i += 9) {
        for (let k = 0; k < 3; k++) { const t = o[i + 3 + k]; o[i + 3 + k] = o[i + 6 + k]; o[i + 6 + k] = t; }
    }
    return o;
}

// Reflects across the plane axis = 0. A reflection turns a mesh inside out, so the winding
// is flipped back to keep normals pointing outward.
export function mirrorPositions(p, axis) {
    const k = { x: 0, y: 1, z: 2 }[axis];
    const o = Float32Array.from(p);
    for (let i = k; i < o.length; i += 3) o[i] = -o[i];
    return flipWinding(o);
}

// Box with rounded (fillet) or bevelled (chamfer) edges, centred on the origin.
//   style 'fillet'  - quarter-round edges with `segments` steps per edge
//   style 'chamfer' - a single flat bevel
// radius is the size of the round/bevel, clamped below half the smallest side.
// Returns { positions, normals } — normals are smooth for a fillet, null for a chamfer.
export function roundedBox(w, h, d, radius, style = 'fillet', segments = 4) {
    const half = [w / 2, h / 2, d / 2];
    const r = Math.max(0, Math.min(radius, Math.min(...half) * 0.98));
    const s = style === 'chamfer' ? 1 : Math.max(1, Math.round(segments));
    const coords = half.map(hk => {
        if (r === 0) return [-hk, hk]; // a plain box needs no grid
        const c = [];
        for (let i = 0; i <= s; i++) c.push(-hk + r * i / s);
        for (let i = 0; i <= s; i++) c.push(hk - r + r * i / s);
        return c;
    });
    const smooth = style !== 'chamfer';

    const point = (p) => {
        const q = p.map((v, k) => Math.max(-(half[k] - r), Math.min(half[k] - r, v)));
        const dv = p.map((v, k) => v - q[k]);
        const len = smooth ? Math.hypot(...dv) : Math.abs(dv[0]) + Math.abs(dv[1]) + Math.abs(dv[2]);
        if (len < 1e-12 || r === 0) return { pos: p, normal: null };
        const scale = r / len;
        const pos = q.map((v, k) => v + dv[k] * scale);
        const nl = Math.hypot(...dv);
        return { pos, normal: dv.map(v => v / nl) };
    };

    const P = [], N = [];
    const emit = (a, b, c, faceNormal) => {
        for (const v of [a, b, c]) {
            P.push(...v.pos);
            N.push(...(smooth && v.normal ? v.normal : faceNormal));
        }
    };
    for (let k = 0; k < 3; k++) {
        const u = (k + 1) % 3, v = (k + 2) % 3;
        for (const sign of [1, -1]) {
            const grid = coords[u].map(cu => coords[v].map(cv => {
                const p = [0, 0, 0]; p[k] = sign * half[k]; p[u] = cu; p[v] = cv;
                return point(p);
            }));
            const fn = [0, 0, 0]; fn[k] = sign;
            for (let i = 0; i < coords[u].length - 1; i++) {
                for (let j = 0; j < coords[v].length - 1; j++) {
                    const p00 = grid[i][j], p10 = grid[i + 1][j], p11 = grid[i + 1][j + 1], p01 = grid[i][j + 1];
                    if (sign > 0) { emit(p00, p10, p11, fn); emit(p00, p11, p01, fn); }
                    else { emit(p00, p11, p10, fn); emit(p00, p01, p11, fn); }
                }
            }
        }
    }
    return { positions: Float32Array.from(P), normals: smooth ? Float32Array.from(N) : null };
}

// Lathe: sweeps a closed profile polygon [[radius, height], ...] around the Y axis.
// Radii must not be negative. Faces that would collapse to a line on the axis are skipped.
export function revolveProfile(profile, segments = 48) {
    if (profile.length < 3) throw new Error('A profile needs at least three points.');
    if (profile.some(([r]) => r < -1e-9)) throw new Error('The profile crosses the axis: every point must be at or right of it.');
    const out = [];
    const ring = (pt, j) => {
        const a = (j / segments) * Math.PI * 2;
        return [Math.max(0, pt[0]) * Math.cos(a), pt[1], -Math.max(0, pt[0]) * Math.sin(a)];
    };
    for (let i = 0; i < profile.length; i++) {
        const A = profile[i], B = profile[(i + 1) % profile.length];
        if (A[0] < 1e-9 && B[0] < 1e-9) continue;
        for (let j = 0; j < segments; j++) {
            const a0 = ring(A, j), a1 = ring(A, j + 1), b0 = ring(B, j), b1 = ring(B, j + 1);
            if (A[0] >= 1e-9) out.push(...a0, ...b0, ...a1);
            if (B[0] >= 1e-9) out.push(...a1, ...b0, ...b1);
        }
    }
    const positions = Float32Array.from(out);
    return signedVolume(positions) < 0 ? flipWinding(positions) : positions;
}

// --- Bevel parameters --------------------------------------------------------------------
// A bevel is { radius, steps }: `radius` is how far the cut reaches along each face from the
// original edge (cm), `steps` how many facets it is made of — 1 is a flat chamfer, more give a
// progressively rounder edge. Older files stored { style, radius, segments }; both load.
export function normalizeEdge(e) {
    if (!e || !(e.radius > 0)) return null;
    if (e.steps !== undefined) return { radius: e.radius, steps: Math.max(1, Math.round(e.steps)) };
    return { radius: e.radius, steps: e.style === 'chamfer' ? 1 : Math.max(2, Math.round(e.segments || 4)) };
}

export function beveledBox(w, h, d, edge) {
    const e = normalizeEdge(edge);
    return roundedBox(w, h, d, e ? e.radius : 0, e && e.steps === 1 ? 'chamfer' : 'fillet', e ? e.steps : 1);
}

// --- Cone / cylinder ----------------------------------------------------------------------
// One shape covers both: a frustum with a bottom radius, a top radius and a height. Equal
// radii make a cylinder, a zero top radius a cone. The rim edges (where a flat end meets the
// side) can be beveled; a point (zero radius) has no rim to bevel.
const unit = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };

export function frustumProfile(topRadius, bottomRadius, height, edge) {
    const rt = Math.max(0, topRadius), rb = Math.max(0, bottomRadius), hh = height / 2;
    if (rt < 1e-9 && rb < 1e-9) throw new Error('At least one radius must be greater than zero.');
    if (!(height > 0)) throw new Error('The height must be greater than zero.');
    const bevel = normalizeEdge(edge);
    const side = Math.hypot(rb - rt, height);
    const d = bevel ? Math.min(bevel.radius, side * 0.49) : 0;
    const steps = bevel ? bevel.steps : 1;

    const pts = [];
    if (rb < 1e-9) pts.push([0, -hh]);
    else {
        pts.push([0, -hh]);
        addCorner(pts, [0, -hh], [rb, -hh], [rt, hh], Math.min(d, rb * 0.98), steps);
    }
    if (rt < 1e-9) pts.push([0, hh]);
    else {
        addCorner(pts, [rb, -hh], [rt, hh], [0, hh], Math.min(d, rt * 0.98), steps);
        pts.push([0, hh]);
    }
    return pts;
}

// Replaces `corner` with an arc from a point `d` back along the previous edge to a point `d`
// along the next edge (a quadratic curve tangent to both; a straight cut when steps is 1).
function addCorner(pts, prev, corner, next, d, steps) {
    if (!(d > 1e-9)) { pts.push(corner); return; }
    const a = unit(prev[0] - corner[0], prev[1] - corner[1]), b = unit(next[0] - corner[0], next[1] - corner[1]);
    const p1 = [corner[0] + a[0] * d, corner[1] + a[1] * d], p2 = [corner[0] + b[0] * d, corner[1] + b[1] * d];
    for (let i = 0; i <= steps; i++) {
        const t = i / steps, u = 1 - t;
        pts.push([u * u * p1[0] + 2 * u * t * corner[0] + t * t * p2[0], u * u * p1[1] + 2 * u * t * corner[1] + t * t * p2[1]]);
    }
}

// Like revolveProfile, but also returns smooth normals: shared across profile vertices whose
// two edges meet at a shallow angle, split at a sharp corner so flat ends stay flat.
export function revolveMesh(profile, segments = 48, smoothDeg = 35) {
    if (profile.length < 3) throw new Error('A profile needs at least three points.');
    if (profile.some(([r]) => r < -1e-9)) throw new Error('The profile crosses the axis: every point must be at or right of it.');
    const n = profile.length;
    let area = 0;
    for (let i = 0; i < n; i++) { const [x1, y1] = profile[i], [x2, y2] = profile[(i + 1) % n]; area += x1 * y2 - x2 * y1; }
    const sign = area >= 0 ? 1 : -1; // outward normal of an edge (dx,dy) is (dy,-dx) for a counter-clockwise loop
    const edgeNormal = i => { const [x1, y1] = profile[i], [x2, y2] = profile[(i + 1) % n]; return unit(sign * (y2 - y1), -sign * (x2 - x1)); };
    const cosLimit = Math.cos(smoothDeg * Math.PI / 180);
    // normalAt(i, e): normal at profile vertex i as seen from edge e (e is i-1 or i)
    const normalAt = (i, e) => {
        const prev = edgeNormal((i - 1 + n) % n), next = edgeNormal(i);
        if (prev[0] * next[0] + prev[1] * next[1] >= cosLimit) return unit(prev[0] + next[0], prev[1] + next[1]);
        return e === i ? next : prev;
    };
    const P = [], N = [];
    const push = (pt, nrm, j) => {
        const a = (j / segments) * Math.PI * 2, r = Math.max(0, pt[0]);
        P.push(r * Math.cos(a), pt[1], -r * Math.sin(a));
        N.push(nrm[0] * Math.cos(a), nrm[1], -nrm[0] * Math.sin(a));
    };
    for (let i = 0; i < n; i++) {
        const A = profile[i], B = profile[(i + 1) % n];
        if (A[0] < 1e-9 && B[0] < 1e-9) continue;
        const nA = normalAt(i, i), nB = normalAt((i + 1) % n, i);
        for (let j = 0; j < segments; j++) {
            if (A[0] >= 1e-9) { push(A, nA, j); push(B, nB, j); push(A, nA, j + 1); }
            if (B[0] >= 1e-9) { push(A, nA, j + 1); push(B, nB, j); push(B, nB, j + 1); }
        }
    }
    let positions = Float32Array.from(P), normals = Float32Array.from(N);
    if (signedVolume(positions) < 0) positions = flipWinding(positions);
    return { positions, normals };
}

export function frustum(topRadius, bottomRadius, height, edge, segments = 48) {
    return revolveMesh(frustumProfile(topRadius, bottomRadius, height, edge), segments);
}
