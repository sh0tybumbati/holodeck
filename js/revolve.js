// Revolve an existing solid (a shape, or a group's boolean result) around an axis.
//
// Spinning a solid a full turn sweeps out exactly the volume you get by lathing its
// "meridian outline": the set of (r, h) pairs — r the distance from the axis, h the position
// along it — that any point of the solid has. So this works out that outline from the mesh and
// lathes it, rather than trying to union many rotated copies. Pure code, no scene access, so it
// runs under node (test/test-revolve.mjs).
import { revolveMesh, flipWinding } from './modeling.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// Any unit vector perpendicular to d.
function perpendicular(d) {
    const helper = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    return norm(cross(d, helper));
}

// Parity test along an arbitrary ray: is `p` inside the closed mesh?
function pointInside(positions, p) {
    const dir = norm([0.5773, 0.3511, 0.7339]);
    let hits = 0;
    for (let i = 0; i < positions.length; i += 9) {
        const a = [positions[i], positions[i + 1], positions[i + 2]];
        const e1 = sub([positions[i + 3], positions[i + 4], positions[i + 5]], a);
        const e2 = sub([positions[i + 6], positions[i + 7], positions[i + 8]], a);
        const pv = cross(dir, e2), det = dot(e1, pv);
        if (Math.abs(det) < 1e-14) continue;
        const tv = sub(p, a), u = dot(tv, pv) / det;
        if (u < 0 || u > 1) continue;
        const qv = cross(tv, e1), v = dot(dir, qv) / det;
        if (v < 0 || u + v > 1) continue;
        if (dot(e2, qv) / det > 1e-12) hits++;
    }
    return hits % 2 === 1;
}

// The meridian outline of a mesh about an axis, as closed loops in (r, h) — outer boundaries
// counter-clockwise, holes clockwise — plus the cell size used.
export function meridianOutline(positions, axis, { resolution = 480 } = {}) {
    const d = norm(axis.dir), A = axis.point;
    const n = positions.length / 3;
    if (n < 3) throw new Error('There is nothing to revolve.');
    const R = new Float64Array(n), H = new Float64Array(n);
    let rmin = Infinity, rmax = -Infinity, hmin = Infinity, hmax = -Infinity;
    for (let i = 0; i < n; i++) {
        const v = [positions[i * 3] - A[0], positions[i * 3 + 1] - A[1], positions[i * 3 + 2] - A[2]];
        const h = dot(v, d), r = Math.hypot(v[0] - h * d[0], v[1] - h * d[1], v[2] - h * d[2]);
        R[i] = r; H[i] = h;
        rmin = Math.min(rmin, r); rmax = Math.max(rmax, r); hmin = Math.min(hmin, h); hmax = Math.max(hmax, h);
    }
    // Subdivide every triangle until the distance-to-axis curve across it is nearly straight,
    // keeping the pieces as flat triangles in (r, h). (A face can pass nearer the axis than any
    // of its corners, so the outline's extent has to come from the pieces, not the vertices.)
    const rOf = p => { const v = sub(p, A), h = dot(v, d); return Math.hypot(v[0] - h * d[0], v[1] - h * d[1], v[2] - h * d[2]); };
    const hOf = p => dot(sub(p, A), d);
    const approxCell = Math.max(rmax - rmin, hmax - hmin) / resolution;
    if (!(approxCell > 1e-12)) throw new Error('The selection is too small to revolve.');
    const leaves = [];
    const split = (a, b, c, depth) => {
        const pts = [a, b, c], rs = pts.map(rOf);
        let bends = false;
        for (let k = 0; k < 3 && !bends; k++) {
            const m = [(pts[k][0] + pts[(k + 1) % 3][0]) / 2, (pts[k][1] + pts[(k + 1) % 3][1]) / 2, (pts[k][2] + pts[(k + 1) % 3][2]) / 2];
            if (Math.abs(rOf(m) - (rs[k] + rs[(k + 1) % 3]) / 2) > 0.3 * approxCell) bends = true;
        }
        if (bends && depth < 12) {
            const m01 = a.map((v, k) => (v + b[k]) / 2), m12 = b.map((v, k) => (v + c[k]) / 2), m20 = c.map((v, k) => (v + a[k]) / 2);
            split(a, m01, m20, depth + 1); split(m01, b, m12, depth + 1); split(m20, m12, c, depth + 1); split(m01, m12, m20, depth + 1);
            return;
        }
        for (let k = 0; k < 3; k++) { leaves.push(rs[k], hOf(pts[k])); rmin = Math.min(rmin, rs[k]); hmin = Math.min(hmin, hOf(pts[k])); hmax = Math.max(hmax, hOf(pts[k])); }
    };
    for (let i = 0; i < positions.length; i += 9) {
        split([positions[i], positions[i + 1], positions[i + 2]], [positions[i + 3], positions[i + 4], positions[i + 5]],
            [positions[i + 6], positions[i + 7], positions[i + 8]], 0);
    }

    const extent = Math.max(rmax - rmin, hmax - hmin);
    if (!(extent > 1e-9)) throw new Error('The selection is too small to revolve.');
    const cell = extent / resolution;
    const r0 = rmin < 2 * cell ? 0 : rmin - 2 * cell, h0 = hmin - 2 * cell;
    const nx = Math.ceil((rmax - r0) / cell) + 3, ny = Math.ceil((hmax - h0) / cell) + 3;
    const grid = new Uint8Array(nx * ny);
    const mark = (ix, iy) => { if (ix >= 0 && iy >= 0 && ix < nx && iy < ny) grid[iy * nx + ix] = 1; };

    for (let t = 0; t < leaves.length; t += 6) {
        const gx = [(leaves[t] - r0) / cell, (leaves[t + 2] - r0) / cell, (leaves[t + 4] - r0) / cell];
        const gy = [(leaves[t + 1] - h0) / cell, (leaves[t + 3] - h0) / cell, (leaves[t + 5] - h0) / cell];
        const area2 = (gx[1] - gx[0]) * (gy[2] - gy[0]) - (gy[1] - gy[0]) * (gx[2] - gx[0]);
        const x0 = Math.floor(Math.min(...gx)), x1 = Math.ceil(Math.max(...gx)), y0 = Math.floor(Math.min(...gy)), y1 = Math.ceil(Math.max(...gy));
        if (Math.abs(area2) > 1e-9) {
            const inv = 1 / area2;
            for (let iy = y0; iy <= y1; iy++) for (let ix = x0; ix <= x1; ix++) {
                const px = ix + 0.5, py = iy + 0.5;
                const w0 = ((gx[1] - px) * (gy[2] - py) - (gy[1] - py) * (gx[2] - px)) * inv;
                const w1 = ((gx[2] - px) * (gy[0] - py) - (gy[2] - py) * (gx[0] - px)) * inv;
                if (w0 >= 0 && w1 >= 0 && w0 + w1 <= 1) mark(ix, iy);
            }
        }
        // A triangle thinner than a cell (an edge-on face, or a tall narrow strip) can slip between
        // cell centres yet still bounds the outline, so its edges are marked too.
        const longest = Math.max(...[0, 1, 2].map(k => Math.hypot(gx[(k + 1) % 3] - gx[k], gy[(k + 1) % 3] - gy[k])));
        if (Math.abs(area2) / (longest || 1) < 1) {
            for (let k = 0; k < 3; k++) {
                const ax = gx[k], ay = gy[k], bx = gx[(k + 1) % 3], by = gy[(k + 1) % 3];
                const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
                for (let s = 0; s <= steps; s++) mark(Math.floor(ax + (bx - ax) * s / steps), Math.floor(ay + (by - ay) * s / steps));
            }
        }
    }

    // Uncovered cells enclosed by covered ones are either genuine holes in the outline, or space
    // that circles all the way round inside the solid (a ring wrapped around the axis). A circle
    // that never meets the surface is wholly inside or wholly outside, so one test per enclosed
    // region decides it.
    const label = new Int32Array(nx * ny); // 0 unvisited, otherwise region id
    const flood = (start, id) => {
        const stack = [start], cells = [];
        label[start] = id;
        while (stack.length) {
            const c = stack.pop(); cells.push(c);
            const x = c % nx, y = (c / nx) | 0;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const X = x + dx, Y = y + dy;
                if (X < 0 || Y < 0 || X >= nx || Y >= ny) continue;
                const j = Y * nx + X;
                if (grid[j] === 0 && label[j] === 0) { label[j] = id; stack.push(j); }
            }
        }
        return cells;
    };
    flood(0, 1); // the padded corner is always outside
    const u = perpendicular(d);
    let id = 2;
    for (let c = 0; c < nx * ny; c++) {
        if (grid[c] !== 0 || label[c] !== 0) continue;
        const cells = flood(c, id++);
        const x = cells[0] % nx, y = (cells[0] / nx) | 0;
        const r = r0 + (x + 0.5) * cell, h = h0 + (y + 0.5) * cell;
        const p = [A[0] + h * d[0] + r * u[0], A[1] + h * d[1] + r * u[1], A[2] + h * d[2] + r * u[2]];
        if (pointInside(positions, p)) cells.forEach(j => { grid[j] = 1; });
    }

    // Trace the boundary of the filled cells: every exposed cell side becomes a directed edge with
    // the filled cell on its left, and edges chain into loops (outer boundaries counter-clockwise,
    // holes clockwise). At a pinch point the left-most turn is taken so diagonal neighbours stay
    // separate shapes.
    const filled = (x, y) => x >= 0 && y >= 0 && x < nx && y < ny && grid[y * nx + x] === 1;
    const out = new Map(); // "x,y" -> [[toX, toY, used]]
    const addEdge = (x0, y0, x1, y1) => { const k = x0 + ',' + y0; if (!out.has(k)) out.set(k, []); out.get(k).push({ x: x1, y: y1, used: false }); };
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
        if (!filled(x, y)) continue;
        if (!filled(x, y - 1)) addEdge(x, y, x + 1, y);
        if (!filled(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1);
        if (!filled(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1);
        if (!filled(x - 1, y)) addEdge(x, y + 1, x, y);
    }
    const loops = [];
    for (const [key, edges] of out) {
        for (const first of edges) {
            if (first.used) continue;
            const [sx, sy] = key.split(',').map(Number);
            const pts = [[sx, sy]];
            let cx = sx, cy = sy, e = first;
            for (;;) {
                e.used = true; cx = e.x; cy = e.y;
                if (cx === sx && cy === sy) break;
                pts.push([cx, cy]);
                const next = (out.get(cx + ',' + cy) || []).filter(q => !q.used);
                if (next.length === 0) break;
                if (next.length > 1) {
                    const dx = cx - pts[pts.length - 2][0], dy = cy - pts[pts.length - 2][1];
                    const turn = q => { const ex = q.x - cx, ey = q.y - cy; return dx * ey - dy * ex; }; // >0 left, 0 straight, <0 right
                    next.sort((p, q) => turn(q) - turn(p));
                }
                e = next[0];
            }
            loops.push(pts);
        }
    }

    // Straight runs and stair-steps collapse under a Douglas-Peucker pass of about half a cell.
    const tol = 0.6;
    const simplifyClosed = pts => {
        if (pts.length < 4) return pts;
        let far = 0, best = -1;
        for (let i = 1; i < pts.length; i++) { const dd = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (dd > best) { best = dd; far = i; } }
        const half = (a, b) => { // keeps pts[a] .. pts[b] inclusive, simplified
            const stack = [[a, b]], keep = new Set([a, b]);
            while (stack.length) {
                const [i, j] = stack.pop();
                let md = 0, mk = -1;
                const [x1, y1] = pts[i % pts.length], [x2, y2] = pts[j % pts.length];
                const len = Math.hypot(x2 - x1, y2 - y1) || 1e-12;
                for (let k = i + 1; k < j; k++) {
                    const [x, y] = pts[k % pts.length];
                    const dist = Math.abs((x2 - x1) * (y1 - y) - (x1 - x) * (y2 - y1)) / len;
                    if (dist > md) { md = dist; mk = k; }
                }
                if (md > tol) { keep.add(mk); stack.push([i, mk], [mk, j]); }
            }
            return [...keep].sort((p, q) => p - q);
        };
        const first = half(0, far), second = half(far, pts.length);
        return [...first, ...second.slice(1, -1)].map(i => pts[i % pts.length]);
    };

    const result = [];
    for (const raw of loops) {
        let a2 = 0;
        for (let i = 0; i < raw.length; i++) { const [x1, y1] = raw[i], [x2, y2] = raw[(i + 1) % raw.length]; a2 += x1 * y2 - x2 * y1; }
        if (Math.abs(a2) / 2 < 4) continue; // specks of a few cells are noise
        const simple = simplifyClosed(raw);
        if (simple.length < 3) continue;
        result.push({ hole: a2 < 0, points: simple.map(([x, y]) => [r0 + x * cell, h0 + y * cell]) });
    }
    if (!result.some(l => !l.hole)) throw new Error('Nothing could be revolved from this selection.');
    return { loops: result, cell };
}

// Lathe the outline's loops (full turn). A hole in the outline becomes a cavity, built as a
// separate inside-out shell, so the result is a closed solid with the voids kept.
export function revolveOutline(loops, segments = 64) {
    const P = [], N = [];
    for (const loop of loops) {
        if (loop.points.length < 3) continue;
        const clamped = loop.points.map(([r, h]) => [Math.max(0, r), h]);
        let { positions, normals } = revolveMesh(clamped, segments);
        if (loop.hole) { positions = flipWinding(positions); normals = normals.map(v => -v); }
        for (let i = 0; i < positions.length; i++) { P.push(positions[i]); N.push(normals[i]); }
    }
    return { positions: Float32Array.from(P), normals: Float32Array.from(N) };
}

// Everything at once: positions in world space, axis { point, dir }, result in world space.
export function revolveAroundAxis(positions, axis, { segments = 64, resolution = 480 } = {}) {
    const { loops, cell } = meridianOutline(positions, axis, { resolution });
    const local = revolveOutline(loops, segments);
    const d = norm(axis.dir), u = perpendicular(d), w = cross(u, d); // (u, d, w) is right-handed
    const place = arr => {
        const o = new Float32Array(arr.length);
        for (let i = 0; i < arr.length; i += 3) {
            const x = arr[i], y = arr[i + 1], z = arr[i + 2];
            o[i] = x * u[0] + y * d[0] + z * w[0]; o[i + 1] = x * u[1] + y * d[1] + z * w[1]; o[i + 2] = x * u[2] + y * d[2] + z * w[2];
        }
        return o;
    };
    const pos = place(local.positions);
    for (let i = 0; i < pos.length; i += 3) { pos[i] += axis.point[0]; pos[i + 1] += axis.point[1]; pos[i + 2] += axis.point[2]; }
    return { positions: pos, normals: place(local.normals), cell, loops: loops.length };
}
