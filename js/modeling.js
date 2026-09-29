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
