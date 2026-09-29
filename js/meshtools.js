// Mesh health checks for triangle soups (flat Float32Array, three vertices per triangle).
// Boolean operations (grouping, holes) assume closed, consistently wound solids; an imported
// mesh often is not, so it is worth saying so before a union quietly produces something odd.
import { signedVolume, flipWinding } from './modeling.js';

const QUANT = 1e4; // vertices closer than 0.1 µm (positions are in cm) count as the same point

function weldIds(p) {
    const ids = new Uint32Array(p.length / 3);
    const seen = new Map();
    for (let i = 0; i < p.length; i += 3) {
        const key = `${Math.round(p[i] * QUANT)},${Math.round(p[i + 1] * QUANT)},${Math.round(p[i + 2] * QUANT)}`;
        let id = seen.get(key);
        if (id === undefined) { id = seen.size; seen.set(key, id); }
        ids[i / 3] = id;
    }
    return ids;
}

const isDegenerate = (p, i, ids, t) => {
    if (ids[t * 3] === ids[t * 3 + 1] || ids[t * 3 + 1] === ids[t * 3 + 2] || ids[t * 3] === ids[t * 3 + 2]) return true;
    const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2];
    const vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
    return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < 1e-12;
};

export function analyzeMesh(p) {
    const n = p.length / 9;
    const ids = weldIds(p);
    const edges = new Map(); // "lo,hi" -> [forward uses, backward uses]
    let degenerate = 0;
    for (let t = 0; t < n; t++) {
        if (isDegenerate(p, t * 9, ids, t)) { degenerate++; continue; }
        for (let k = 0; k < 3; k++) {
            const a = ids[t * 3 + k], b = ids[t * 3 + (k + 1) % 3];
            const key = a < b ? `${a},${b}` : `${b},${a}`;
            let e = edges.get(key);
            if (!e) edges.set(key, e = [0, 0]);
            e[a < b ? 0 : 1]++;
        }
    }
    let open = 0, nonManifold = 0, inconsistent = 0;
    edges.forEach(([f, b]) => {
        const total = f + b;
        if (total === 1) open++;
        else if (total > 2) nonManifold++;
        else if (f === 2 || b === 2) inconsistent++;
    });
    const watertight = open === 0 && nonManifold === 0;
    return { triangles: n, degenerate, openEdges: open, nonManifoldEdges: nonManifold, inconsistentEdges: inconsistent,
        watertight, volume: signedVolume(p) };
}

// Fixes what can be fixed without guessing: drops zero-area triangles, and turns an
// inside-out closed solid the right way round. Holes and non-manifold edges are left alone.
export function repairMesh(p) {
    const ids = weldIds(p);
    const kept = [];
    let removed = 0;
    for (let t = 0; t < p.length / 9; t++) {
        if (isDegenerate(p, t * 9, ids, t)) { removed++; continue; }
        for (let k = 0; k < 9; k++) kept.push(p[t * 9 + k]);
    }
    let positions = removed ? Float32Array.from(kept) : p;
    let flipped = false;
    const health = analyzeMesh(positions);
    if (health.watertight && health.inconsistentEdges === 0 && health.volume < 0) { positions = flipWinding(positions); flipped = true; }
    return { positions, removedDegenerate: removed, flipped };
}

// One-line summary for the status bar, or '' when the mesh is fine.
export function describeHealth(h, { removedDegenerate = 0, flipped = false } = {}) {
    const notes = [];
    if (flipped) notes.push('it was inside-out, so it was flipped');
    if (removedDegenerate) notes.push(`${removedDegenerate} zero-area triangle(s) were removed`);
    let warning = '';
    if (!h.watertight) {
        warning = h.nonManifoldEdges && !h.openEdges
            ? `⚠ ${h.nonManifoldEdges} non-manifold edge(s)`
            : `⚠ not watertight (${h.openEdges} open edge(s))`;
        warning += ' — grouping and holes may give gaps or fail';
    } else if (h.inconsistentEdges) {
        warning = `⚠ ${h.inconsistentEdges} edge(s) with inconsistent winding — grouping may misbehave`;
    }
    return [notes.length ? 'Note: ' + notes.join('; ') : '', warning].filter(Boolean).join('. ');
}
