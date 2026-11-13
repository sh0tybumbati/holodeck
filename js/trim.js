// Trim: sweep a 2D profile along a path, the way a moulding is run along a cabinet. Pure code —
// no scene access — so it runs under node (test/test-trim.mjs).
//
// A profile is a closed outline in (a, b): `a` is how far it stands out from the surface
// (negative values tuck into the body so the trim overlaps it), `b` runs along the "side"
// direction (up for a moulding wrapped round a body, across the band for a strip up a face).
// A path is a polyline with an outward normal per segment; at each corner the profile is
// mitred so the two runs meet cleanly.
import { triangulate } from './shapes.js';

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const area2D = pts => { let s = 0; for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; s += x1 * y2 - x2 * y1; } return s / 2; };

// --- profiles ------------------------------------------------------------------------------------

// A staircase: `count` tiers each `height` tall, stepping out by `depth` per tier. The widest
// tier is at the bottom unless widestAtBottom is false. `embed` tucks the back into the body.
export function stepsProfile({ count, height, depth, embed = 0, widestAtBottom = true }) {
    const n = Math.max(1, Math.round(count));
    const out = [[-embed, 0], [n * depth, 0]];
    for (let i = 1; i <= n; i++) {
        out.push([(n - i + 1) * depth, i * height]);
        if (i < n) out.push([(n - i) * depth, i * height]);
    }
    out.push([-embed, n * height]);
    if (!widestAtBottom) return out.map(([a, b]) => [a, n * height - b]);
    return out;
}

// Parallel ribs on a backing plate, centred on b = 0. `fill` is the rib's share of its pitch;
// ribs are flat-topped, or rounded when `round` (an arc of `steps` facets).
export function reededProfile({ count, pitch, fill = 0.6, depth, base = 0.1, embed = 0, round = false, steps = 6 }) {
    const n = Math.max(1, Math.round(count));
    const W = n * pitch, w = Math.min(Math.max(fill, 0.05), 0.98) * pitch;
    const pts = [[-embed, -W / 2], [base, -W / 2]];
    for (let i = 0; i < n; i++) {
        const c = -W / 2 + (i + 0.5) * pitch;
        if (round) {
            for (let k = 0; k <= steps; k++) {
                const t = (k / steps) * Math.PI;
                pts.push([base + depth * Math.sin(t), c - (w / 2) * Math.cos(t)]);
            }
        } else {
            pts.push([base, c - w / 2], [base + depth, c - w / 2], [base + depth, c + w / 2], [base, c + w / 2]);
        }
    }
    pts.push([base, W / 2], [-embed, W / 2]);
    return dedupe(pts);
}

function dedupe(pts) {
    const out = [];
    for (const p of pts) { const q = out[out.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-9) out.push(p); }
    if (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-9) out.pop();
    return out;
}

export const shiftProfile = (profile, db) => profile.map(([a, b]) => [a, b + db]);

// --- sweep ---------------------------------------------------------------------------------------

// Sweeps `profile` along `points`. `normals` holds one outward unit vector per segment (n-1 for an
// open path, n for a closed loop); `side` is the constant unit vector that profile `b` runs along.
export function sweepProfile(profile, points, normals, side, closed = false) {
    const n = points.length, m = profile.length;
    const segs = closed ? n : n - 1;
    if (m < 3) throw new Error('The profile needs at least three points.');
    if (n < 2 || normals.length < segs) throw new Error('The path needs at least two points.');

    const mitre = i => {
        const n1 = normals[closed ? (i - 1 + n) % n : Math.max(i - 1, 0)];
        const n2 = normals[closed ? i : Math.min(i, segs - 1)];
        return mul(add(n1, n2), 1 / Math.max(1 + dot(n1, n2), 0.2));
    };
    const rings = points.map((p, i) => {
        const M = mitre(i);
        return profile.map(([a, b]) => add(add(p, mul(M, a)), mul(side, b)));
    });

    const sgn = area2D(profile) >= 0 ? 1 : -1;
    const tris = [];
    let flip = null;
    for (let j = 0; j < segs; j++) {
        const i2 = (j + 1) % n;
        for (let k = 0; k < m; k++) {
            const k2 = (k + 1) % m;
            const A = rings[j][k], B = rings[i2][k], C = rings[i2][k2], D = rings[j][k2];
            if (flip === null) {
                const nrm = cross(sub(B, A), sub(C, A));
                if (Math.hypot(...nrm) > 1e-14) {
                    const da = profile[k2][0] - profile[k][0], db = profile[k2][1] - profile[k][1];
                    const outward = add(mul(normals[j], sgn * db), mul(side, -sgn * da));
                    flip = dot(nrm, outward) < 0;
                }
            }
            tris.push(A, B, C, A, C, D);
        }
    }
    if (flip === null) flip = false;

    const P = [];
    const pushTri = (a, b, c, reverse) => (reverse ? P.push(...a, ...c, ...b) : P.push(...a, ...b, ...c));
    for (let t = 0; t < tris.length; t += 3) pushTri(tris[t], tris[t + 1], tris[t + 2], flip);

    if (!closed) { // flat caps at both ends, facing away along the path
        const capTris = triangulate(profile);
        const cap = (ring, away) => {
            for (const [i, j, k] of capTris) {
                const a = ring[i], b = ring[j], c = ring[k];
                pushTri(a, b, c, dot(cross(sub(b, a), sub(c, a)), away) < 0);
            }
        };
        cap(rings[0], mul(unit(sub(points[1], points[0])), -1));
        cap(rings[n - 1], unit(sub(points[n - 1], points[n - 2])));
    }
    return Float32Array.from(P);
}

// --- paths ---------------------------------------------------------------------------------------

// The outline of a mesh where the horizontal plane y = height cuts it: the largest closed loop of
// [x, z] points, counter-clockwise, with collinear points removed. Needs a closed solid.
export function sliceOutline(positions, height) {
    const key = (x, z) => Math.round(x * 1e5) + ',' + Math.round(z * 1e5);
    const segs = [];
    const side = v => (v - height >= 1e-9 ? 1 : -1);
    for (let i = 0; i < positions.length; i += 9) {
        const V = [0, 1, 2].map(k => [positions[i + k * 3], positions[i + k * 3 + 1], positions[i + k * 3 + 2]]);
        const s = V.map(v => side(v[1]));
        if (s[0] === s[1] && s[1] === s[2]) continue;
        const hits = [];
        for (let k = 0; k < 3; k++) {
            const a = V[k], b = V[(k + 1) % 3];
            if (side(a[1]) === side(b[1])) continue;
            const t = (height - a[1]) / (b[1] - a[1]);
            hits.push([a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t]);
        }
        if (hits.length === 2 && key(...hits[0]) !== key(...hits[1])) segs.push(hits);
    }
    if (segs.length === 0) throw new Error('The selection has nothing at that height to trace.');

    const at = new Map();
    segs.forEach((s, idx) => s.forEach(p => { const k = key(...p); if (!at.has(k)) at.set(k, []); at.get(k).push(idx); }));
    const used = new Uint8Array(segs.length), loops = [];
    for (let start = 0; start < segs.length; start++) {
        if (used[start]) continue;
        used[start] = 1;
        const loop = [segs[start][0]];
        let tip = segs[start][1], guard = 0;
        while (guard++ < segs.length + 2) {
            const k = key(...tip);
            if (k === key(...loop[0])) break;
            loop.push(tip);
            const next = (at.get(k) || []).find(idx => !used[idx]);
            if (next === undefined) { loop.length = 0; break; }
            used[next] = 1;
            const [p, q] = segs[next];
            tip = key(...p) === k ? q : p;
        }
        if (loop.length >= 3) loops.push(loop);
    }
    if (loops.length === 0) throw new Error('The outline at that height is not a closed loop — is the selection a closed solid?');

    let best = loops[0], bestArea = 0;
    for (const l of loops) { const a = Math.abs(area2D(l)); if (a > bestArea) { bestArea = a; best = l; } }
    let loop = area2D(best) < 0 ? best.slice().reverse() : best.slice();

    // Drop points that sit on a straight line (a triangulated flat face leaves many).
    for (let changed = true; changed && loop.length > 3;) {
        changed = false;
        for (let i = 0; i < loop.length; i++) {
            const p = loop[(i + loop.length - 1) % loop.length], q = loop[i], r = loop[(i + 1) % loop.length];
            const l1 = Math.hypot(q[0] - p[0], q[1] - p[1]), l2 = Math.hypot(r[0] - q[0], r[1] - q[1]);
            const cr = (q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]);
            if (l1 < 1e-6 || l2 < 1e-6 || Math.abs(cr) <= 1e-6 * l1 * l2) { loop.splice(i, 1); changed = true; break; }
        }
    }
    if (loop.length < 3) throw new Error('The outline at that height is too small to trim.');
    return loop;
}

// A closed path round the loop at height y, normals pointing out of it.
export function footprintPath(loop, y) {
    const points = loop.map(([x, z]) => [x, y, z]);
    const normals = loop.map((p, i) => { const q = loop[(i + 1) % loop.length]; return unit([q[1] - p[1], 0, -(q[0] - p[0])]); });
    return { points, normals, side: [0, 1, 0], closed: true };
}

// A straight run across one face of a bounding box ({min, max}, each [x, y, z]).
//   face      'front' (+Z) | 'back' (-Z) | 'right' (+X) | 'left' (-X) | 'top' (+Y)
//   along     'vertical' — up the face (front-to-back across the top) | 'horizontal' — across it
//   position  0..1 across the face, measured at right angles to the run
export function facePath(box, face, along, position) {
    const F = {
        front: { n: [0, 0, 1], plane: box.max[2], h: 0, v: 1 }, back: { n: [0, 0, -1], plane: box.min[2], h: 0, v: 1 },
        right: { n: [1, 0, 0], plane: box.max[0], h: 2, v: 1 }, left: { n: [-1, 0, 0], plane: box.min[0], h: 2, v: 1 },
        top: { n: [0, 1, 0], plane: box.max[1], h: 0, v: 2 }
    }[face];
    if (!F) throw new Error(`Unknown face "${face}".`);
    const axisN = F.n.findIndex(c => c !== 0);
    const run = along === 'vertical' ? F.v : F.h, across = along === 'vertical' ? F.h : F.v;
    const at = box.min[across] + Math.min(Math.max(position, 0), 1) * (box.max[across] - box.min[across]);
    const p0 = [0, 0, 0], p1 = [0, 0, 0];
    p0[axisN] = p1[axisN] = F.plane; p0[across] = p1[across] = at; p0[run] = box.min[run]; p1[run] = box.max[run];
    const side = [0, 0, 0]; side[across] = 1;
    return { points: [p0, p1], normals: [F.n], side, closed: false };
}

// Moves a straight face path onto the actual surface of the mesh. A bounding box is only as good
// as its widest part — a flange or a base moulding pushes it out — so the surface is found by
// firing a ray inward at the middle of the run and the whole band is placed there. Paths that miss
// the mesh are left where the bounding box put them.
export function snapPathToSurface(path, positions) {
    if (path.closed || path.points.length !== 2) return path;
    const n = path.normals[0];
    const mid = [0, 1, 2].map(k => (path.points[0][k] + path.points[1][k]) / 2);
    const origin = add(mid, mul(n, 1e4)), dir = mul(n, -1);
    let best = Infinity;
    for (let i = 0; i < positions.length; i += 9) {
        const a = [positions[i], positions[i + 1], positions[i + 2]];
        const e1 = sub([positions[i + 3], positions[i + 4], positions[i + 5]], a), e2 = sub([positions[i + 6], positions[i + 7], positions[i + 8]], a);
        const pv = cross(dir, e2), det = dot(e1, pv);
        if (Math.abs(det) < 1e-14) continue;
        const tv = sub(origin, a), u = dot(tv, pv) / det;
        if (u < 0 || u > 1) continue;
        const qv = cross(tv, e1), v = dot(dir, qv) / det;
        if (v < 0 || u + v > 1) continue;
        const t = dot(e2, qv) / det;
        if (t > 0 && t < best) best = t;
    }
    if (!isFinite(best)) return path;
    const axis = n.findIndex(c => c !== 0);
    const target = origin[axis] + dir[axis] * best;
    const points = path.points.map(p => { const q = p.slice(); q[axis] = target; return q; });
    return { ...path, points };
}
