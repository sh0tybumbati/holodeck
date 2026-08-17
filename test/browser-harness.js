// Runs inside the page, after js/app.js has initialised. Drives the real DOM controls and
// reports results into <pre id="HOLODECK_RESULT"> for the node runner to read.
//
// Everything here goes through buttons and canvas events on purpose: app.js is a module with
// no exports, so the only honest way to test it is the way a user drives it.
//
// Assertions compare the exported STL, using two signals with different strengths:
//   * vertex bounds  - exact. This is what catches geometry coming back in the wrong place;
//                      a facet count cannot see a translation.
//   * facet count    - exact for primitives and single groups, tolerant for nested groups.
//                      Re-evaluating a group that is itself an input to another CSG runs the
//                      BSP over float-shifted vertices, so coplanar splits get classified
//                      differently and the tessellation drifts by ~0.2% while the solid and
//                      its bounds stay identical. Measured across repeated runs.

const out = document.createElement('pre');
out.id = 'HOLODECK_RESULT';
document.body.appendChild(out);

const results = [];
const uncaught = [];

window.addEventListener('error', e => {
    // Synthetic PointerEvents carry no real pointer id, so OrbitControls/TransformControls
    // throw on setPointerCapture. That is an artefact of the harness, not of the app.
    if (/setPointerCapture/.test(e.message || '')) return;
    uncaught.push((e.message || '') + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno);
});

function check(name, pass, detail) {
    results.push({ name, pass: !!pass, detail: String(detail) });
}

const status = () => document.getElementById('status-bar').innerText.trim();
const byId = id => document.getElementById(id);

// --- capture downloads instead of performing them -------------------------------------
const blobs = [];
const realCreateObjectURL = URL.createObjectURL.bind(URL);
URL.createObjectURL = blob => { blobs.push(blob); return realCreateObjectURL(blob); };
HTMLAnchorElement.prototype.click = function () { /* suppressed */ };

async function lastBlobText() {
    if (blobs.length === 0) return '';
    return await blobs[blobs.length - 1].text();
}

// Exports the scene and summarises the STL. Returns null when the export was refused.
async function exportSignature() {
    const before = blobs.length;
    byId('export-stl').click();
    if (blobs.length === before) return null;

    const text = await lastBlobText();
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        for (let i = 0; i < 3; i++) {
            const v = parseFloat(m[i + 1]);
            if (v < min[i]) min[i] = v;
            if (v > max[i]) max[i] = v;
        }
    }
    const r = n => (Number.isFinite(n) ? n.toFixed(3) : 'na');
    return {
        facets: (text.match(/facet normal/g) || []).length,
        bounds: `[${min.map(r)}]..[${max.map(r)}]`
    };
}

const fmt = sig => (sig ? `facets=${sig.facets} bounds=${sig.bounds}` : 'nothing-to-export');
const samePlace = (a, b) => !!a && !!b && a.bounds === b.bounds;
const sameMesh = (a, b) => samePlace(a, b) && a.facets === b.facets;
// Tolerant form, for comparisons that re-run a nested CSG. See the header note.
const sameSolid = (a, b) => samePlace(a, b) && Math.abs(a.facets - b.facets) <= Math.max(2, b.facets * 0.01);

async function saveAndParse() {
    byId('btn-save').click();
    return JSON.parse(await lastBlobText());
}

// --- selection helpers ----------------------------------------------------------------
function boxSelectAll() {
    const canvas = document.querySelector('#canvas-container canvas');
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 2, clientY: 2, shiftKey: true, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: innerWidth - 2, clientY: innerHeight - 2, bubbles: true }));
}

function clearScene() {
    boxSelectAll();
    byId('delete-selected').click();
}

// --- tests ----------------------------------------------------------------------------
async function run() {
    // 1. An empty scene must not produce an STL full of gizmo geometry.
    const empty = await exportSignature();
    check('stl-empty-scene-exports-nothing', empty === null, `${fmt(empty)} status="${status()}"`);

    // 2. One cube is 12 triangles. Anything more is gizmo/helper leakage.
    document.querySelector('[data-shape="cube"]').click();
    const cube = await exportSignature();
    check('stl-one-cube-is-12-facets', cube && cube.facets === 12, fmt(cube));

    // 3. Grouping must actually report success.
    document.querySelector('[data-shape="sphere"]').click();
    boxSelectAll();
    byId('group-shapes').click();
    check('group-succeeds', /Grouped shapes/.test(status()), `status="${status()}"`);

    // 4. History must still work after a group exists (serializeShape used to throw here,
    //    which silently froze the undo stack for the rest of the session). One state per
    //    action: init, cube, sphere, group, cone.
    document.querySelector('[data-shape="cone"]').click();
    const afterGroup = await saveAndParse();
    check('history-survives-grouping', afterGroup.undoStack.length === 5,
        `undoStack=${afterGroup.undoStack.length} (expected 5)`);

    // 5. A group must round-trip through the history as a group, not as an empty mesh.
    const groups = afterGroup.undoStack[afterGroup.undoStack.length - 1]
        .shapes.filter(s => s.userData.isComposite);
    check('group-serialises-children', groups.length === 1 && groups[0].userData.groupChildren.length === 2,
        `groups=${groups.length} children=${groups.length ? groups[0].userData.groupChildren.length : 'n/a'}`);

    const grouped = await exportSignature();
    byId('btn-undo').click();
    byId('btn-redo').click();
    const regrouped = await exportSignature();
    check('group-survives-undo-redo', sameMesh(grouped, regrouped),
        `before "${fmt(grouped)}" after "${fmt(regrouped)}"`);

    // 5b. A group inside a group: the outer CSG consumes the inner group's rebuilt geometry,
    //     so any drift in rebuildCSG's frame handling lands the whole solid somewhere else.
    document.querySelector('[data-shape="cylinder"]').click();
    boxSelectAll();
    byId('group-shapes').click();
    const nested = await exportSignature();
    byId('btn-undo').click();
    byId('btn-redo').click();
    const renested = await exportSignature();
    check('nested-group-survives-undo-redo', sameSolid(nested, renested),
        `before "${fmt(nested)}" after "${fmt(renested)}"`);

    // 5c. The same rebuild runs interactively when a dimension inside a group is edited.
    //     Re-entering a sub-part's current width must not move the group.
    boxSelectAll();
    const partSelect = byId('obj-part');
    const beforeEdit = await exportSignature();
    if (partSelect.options.length > 1) {
        partSelect.value = partSelect.options[1].value;
        partSelect.dispatchEvent(new Event('change', { bubbles: true }));
        const w = byId('obj-w');
        w.value = w.value; // re-enter the value already shown
        w.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const afterEdit = await exportSignature();
    check('group-rebuild-does-not-move-group',
        partSelect.options.length > 1 && samePlace(beforeEdit, afterEdit),
        `parts=${partSelect.options.length} before "${fmt(beforeEdit)}" after "${fmt(afterEdit)}"`);

    // 6. Hardware must survive undo/redo as hardware. It used to come back as a 2x2x2 cube
    //    because deserializeShape had no branch for it.
    clearScene();
    byId('add-motor').click();
    // Exact count: the NEMA 17 body/flange/shaft merge is deterministic for a pinned three.js.
    // A 2x2x2 cube (what a broken restore produces) is 12.
    const motor = await exportSignature();
    check('motor-has-real-geometry', motor && motor.facets === 268, `${fmt(motor)} (expected 268 facets)`);

    const savedMotor = await saveAndParse();
    const motorState = savedMotor.undoStack[savedMotor.undoStack.length - 1].shapes.find(s => s.userData.type === 'motor');
    check('hardware-serialises-props',
        !!motorState && motorState.userData.isHardware === true && motorState.userData.hwProps.nema === '17',
        JSON.stringify(motorState ? motorState.userData.hwProps : null));

    byId('btn-undo').click();
    byId('btn-redo').click();
    const remotor = await exportSignature();
    check('hardware-survives-undo-redo', sameMesh(motor, remotor),
        `before "${fmt(motor)}" after "${fmt(remotor)}"`);

    check('no-uncaught-errors', uncaught.length === 0, uncaught.join(' ;; ') || 'none');

    out.textContent = JSON.stringify(results, null, 1);
}

setTimeout(() => {
    run().catch(err => {
        results.push({ name: 'harness-crashed', pass: false, detail: String(err && err.stack || err) });
        out.textContent = JSON.stringify(results, null, 1);
    });
}, 3000);
