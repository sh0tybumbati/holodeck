// Runs inside the page, after js/app.js has initialised. Drives the real DOM controls and
// reports results into <pre id="HOLODECK_RESULT"> for the node runner to read.
//
// Everything here goes through buttons and canvas events on purpose: app.js is a module with
// no exports, so the only honest way to test it is the way a user drives it.
//
// Assertions compare the exported STL, using two signals with different strengths:
//   * vertex bounds  - exact. This is what catches geometry coming back in the wrong place;
//                      a facet count cannot see a translation.
//   * facet count    - exact for primitives and single groups. NOT a stable property for a
//                      nested group: re-evaluating a group that is itself an input to another
//                      CSG runs the BSP over float-shifted vertices, so coplanar splits get
//                      classified differently. Observed drift across runs is 0 to 2% (the
//                      shapes are placed randomly, so each run tessellates differently) while
//                      the bounds stay identical every time. Nested checks therefore assert
//                      bounds exactly and keep only a loose facet guard against gross
//                      corruption, such as a group restoring as an empty mesh.

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
// For comparisons that re-run a nested CSG: exact placement, plus a loose sanity bound on
// tessellation. The 10% is a corruption guard, not a precision claim — see the header note.
const sameSolid = (a, b) => samePlace(a, b) && Math.abs(a.facets - b.facets) <= Math.max(12, b.facets * 0.1);

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

    // 6b. The hardware dropdowns write to whatever the panel is showing, so re-selecting a
    //     restored motor and changing its NEMA size must regenerate that part's geometry.
    boxSelectAll();
    const nema = byId('hw-motor-type');
    nema.value = '23';
    nema.dispatchEvent(new Event('change', { bubbles: true }));
    const bigger = await exportSignature();
    check('hardware-dropdown-regenerates-geometry', bigger && bigger.bounds !== motor.bounds,
        `nema17 "${fmt(motor)}" nema23 "${fmt(bigger)}"`);

    // 7. The properties panel must read the node it was handed, not whatever is selected.
    //    Editing a variable with nothing selected used to throw, because selectPropertyNode
    //    dereferenced the global selectedShape and currentPropertyNode was never cleared.
    clearScene();
    const errorsBefore = uncaught.length;
    byId('add-var-btn').click();
    const varValue = document.querySelectorAll('#variables-list input')[1];
    varValue.value = '5';
    varValue.dispatchEvent(new Event('input', { bubbles: true }));
    check('variable-edit-with-nothing-selected-does-not-throw', uncaught.length === errorsBefore,
        uncaught.slice(errorsBefore).join(' ;; ') || 'no errors');

    // 7b. Each sub-part of a group must show its own colour, not the group's.
    const setColour = hex => {
        const picker = byId('obj-color');
        picker.value = hex;
        picker.dispatchEvent(new Event('input', { bubbles: true }));
    };
    document.querySelector('[data-shape="cube"]').click();
    setColour('#ff0000');
    document.querySelector('[data-shape="sphere"]').click();
    setColour('#00ff00');
    boxSelectAll();
    byId('group-shapes').click();

    const parts = byId('obj-part');
    const partColours = [];
    for (const opt of [...parts.options].slice(1)) {
        parts.value = opt.value;
        parts.dispatchEvent(new Event('change', { bubbles: true }));
        partColours.push(byId('obj-color').value);
    }
    check('subpart-shows-its-own-colour',
        partColours.length === 2 && partColours[0] !== partColours[1],
        `parts=${parts.options.length} colours=${partColours.join(',')}`);

    // 8. A thumbnail belongs to the saved file, not to every history state. It used to be
    //    captured on every saveState, costing a synchronous full-canvas render plus
    //    toDataURL per action and writing ~33 KB into each entry of the saved stack.
    clearScene();
    for (let i = 0; i < 8; i++) document.querySelector('[data-shape="cube"]').click();
    byId('btn-save').click();
    const saved = JSON.parse(await lastBlobText());
    const savedBytes = (await lastBlobText()).length;

    check('save-has-one-thumbnail-not-one-per-state',
        typeof saved.thumbnail === 'string' && saved.thumbnail.startsWith('data:image')
        && saved.undoStack.every(s => s.thumbnail === undefined),
        `fileThumbnail=${typeof saved.thumbnail === 'string' ? saved.thumbnail.length + 'b' : 'missing'} ` +
        `statesCarryingOne=${saved.undoStack.filter(s => s.thumbnail !== undefined).length}/${saved.undoStack.length}`);

    const perState = Math.round((savedBytes - (saved.thumbnail || '').length) / saved.undoStack.length);
    check('history-state-is-small', perState < 2000,
        `${perState} bytes/state over ${saved.undoStack.length} states (was ~33000)`);

    // The thumbnail is now downscaled off the WebGL canvas, which only reads back in the same
    // task as the render — so check it decodes and actually carries picture, not a blank card.
    const img = new Image();
    const loaded = await new Promise(resolve => {
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = saved.thumbnail || '';
    });
    let distinctPixels = 0;
    if (loaded) {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const px = ctx.getImageData(0, 0, c.width, c.height).data;
        const seen = new Set();
        for (let i = 0; i < px.length; i += 4 * 97) seen.add(`${px[i]},${px[i + 1]},${px[i + 2]},${px[i + 3]}`);
        distinctPixels = seen.size;
    }
    check('thumbnail-is-a-real-image',
        loaded && img.naturalWidth === 320 && distinctPixels > 1,
        `loaded=${loaded} size=${img.naturalWidth}x${img.naturalHeight} distinctSampledPixels=${distinctPixels}`);

    // 8b. The stack is bounded, so a long session cannot grow it (and the saved file) forever.
    //     Arrow-key nudges are the cheapest action that saves state.
    clearScene();
    document.querySelector('[data-shape="cube"]').click();
    for (let i = 0; i < 260; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    }
    byId('btn-save').click();
    const capped = JSON.parse(await lastBlobText());
    check('history-stack-is-bounded', capped.undoStack.length === 200,
        `undoStack=${capped.undoStack.length} after 260+ actions (cap 200)`);

    // Undo must still work against a stack that has been trimmed.
    const beforeUndo = await exportSignature();
    byId('btn-undo').click();
    const afterUndo = await exportSignature();
    check('undo-works-on-trimmed-stack', beforeUndo && afterUndo && beforeUndo.bounds !== afterUndo.bounds,
        `before "${fmt(beforeUndo)}" after "${fmt(afterUndo)}"`);

    check('no-uncaught-errors', uncaught.length === 0, uncaught.join(' ;; ') || 'none');
}

// Report back to the runner's own server rather than leaving the results in the DOM for it
// to scrape: the run does several megabyte-scale STL exports whose blob reads are real async
// work, and racing that against a fixed browser time budget made the suite flake.
function report() {
    out.textContent = JSON.stringify(results, null, 1);
    fetch('/__results', { method: 'POST', body: out.textContent }).catch(() => {});
}

setTimeout(() => {
    run().then(report).catch(err => {
        results.push({ name: 'harness-crashed', pass: false, detail: String(err && err.stack || err) });
        report();
    });
}, 3000);
