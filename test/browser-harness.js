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

// Waits for a form dialog, sets fields by id, then confirms (or cancels) it.
async function driveDialog(options = {}, { cancel = false } = {}) {
    for (let i = 0; i < 40 && !byId('dlg-ok'); i++) await new Promise(r => setTimeout(r, 50));
    if (!byId('dlg-ok')) return false;
    for (const [id, value] of Object.entries(options)) {
        const el = byId('dlg-' + id);
        if (!el) continue; // e.g. the selection-only box only exists when something is selected
        if (el.type === 'checkbox') el.checked = value; else el.value = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    byId(cancel ? 'dlg-cancel' : 'dlg-ok').click();
    await new Promise(r => setTimeout(r, 60));
    return true;
}

// Exports the scene and summarises the STL. Returns null when the export was refused.
async function exportSignature() {
    const before = blobs.length;
    byId('export-stl').click();
    // Empty scenes are refused before any dialog opens.
    if (!(await driveDialog({ format: 'stl-ascii', selectionOnly: false })) && blobs.length === before) return null;
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
    document.querySelector('[data-shape="cone"]').click();
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
    // Alternate directions so the cube stays in frame. clearScene() selects by dragging a box
    // over the viewport, so anything nudged off-screen would survive it and pollute later
    // tests — 260 nudges in one direction put it 26 units up and out of view.
    for (let i = 0; i < 260; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: i % 2 ? 'ArrowDown' : 'ArrowUp', bubbles: true }));
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

    // 9. BOM rows follow the meshes they were created for.
    const bomRows = () => byId('bom-list').children.length;
    const bomTotal = () => byId('bom-total').textContent.trim();

    clearScene();
    byId('add-invisible-btn').click(); // a hand-added row, must survive everything below
    byId('add-motor').click();
    const stocked = `${bomRows()} rows ${bomTotal()}`;
    byId('delete-selected').click(); // the motor is selected right after being added
    check('bom-drops-deleted-hardware', bomRows() === 1 && bomTotal() === '$0.00',
        `with motor: ${stocked} -> after delete: ${bomRows()} rows ${bomTotal()}`);

    // 9b. Grouping moves a part out of `shapes` but it is still in the assembly, so its row
    //     must stay. Deleting the group takes the row with it.
    byId('add-motor').click();
    document.querySelector('[data-shape="cube"]').click();
    boxSelectAll();
    byId('group-shapes').click();
    const groupedBom = `${bomRows()} rows ${bomTotal()}`;
    check('bom-keeps-grouped-hardware', bomRows() === 2 && bomTotal() === '$12.00', groupedBom);

    byId('delete-selected').click(); // the group is selected right after grouping
    check('bom-drops-contents-of-deleted-group', bomRows() === 1 && bomTotal() === '$0.00',
        `grouped: ${groupedBom} -> after deleting group: ${bomRows()} rows ${bomTotal()}`);

    // 9c. A pasted part is a real part, so it goes on the bill — and its row must be linked
    //     to the new mesh, not the one it was copied from.
    const pressKey = (key, opts = {}) =>
        window.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key, bubbles: true }, opts)));

    byId('add-motor').click();
    const oneMotor = `${bomRows()} rows ${bomTotal()}`;
    pressKey('c', { ctrlKey: true });
    pressKey('v', { ctrlKey: true });
    check('bom-bills-pasted-hardware', bomRows() === 3 && bomTotal() === '$24.00',
        `one motor: ${oneMotor} -> after paste: ${bomRows()} rows ${bomTotal()}`);

    byId('delete-selected').click(); // paste leaves only the copy selected
    check('bom-drops-deleted-paste', bomRows() === 2 && bomTotal() === '$12.00',
        `${bomRows()} rows ${bomTotal()}`);

    // 9d. Pasting a group bills the parts inside it.
    document.querySelector('[data-shape="cube"]').click();
    boxSelectAll();
    byId('group-shapes').click();
    const groupedMotor = `${bomRows()} rows ${bomTotal()}`;
    pressKey('c', { ctrlKey: true });
    pressKey('v', { ctrlKey: true });
    check('bom-bills-parts-of-pasted-group', bomRows() === 3 && bomTotal() === '$24.00',
        `grouped: ${groupedMotor} -> after paste: ${bomRows()} rows ${bomTotal()}`);

    // 9e. One copy, two pastes: the clipboard entry has no row of its own, so cloning it must
    //     keep the template rather than look one up and find nothing.
    pressKey('v', { ctrlKey: true });
    check('bom-bills-every-paste', bomRows() === 4 && bomTotal() === '$36.00',
        `${bomRows()} rows ${bomTotal()}`);

    // 9f. Cut deletes the source — and its row — between capturing the template and pasting.
    pressKey('x', { ctrlKey: true });
    const afterCut = `${bomRows()} rows ${bomTotal()}`;
    pressKey('v', { ctrlKey: true });
    check('bom-survives-cut-and-paste', bomRows() === 4 && bomTotal() === '$36.00',
        `after cut: ${afterCut} -> after paste: ${bomRows()} rows ${bomTotal()}`);

    // 10. Typing in a variable must not re-cut every group once per keystroke. Bind a group's
    //     sub-part to a variable, then type a value one character at a time and measure what
    //     that costs synchronously.
    clearScene();
    document.querySelector('[data-shape="cube"]').click();
    document.querySelector('[data-shape="sphere"]').click();
    boxSelectAll();
    byId('group-shapes').click();

    byId('add-var-btn').click();
    const varInputs = document.querySelectorAll('#variables-list input');
    const varName = varInputs[varInputs.length - 2].value;
    const varField = varInputs[varInputs.length - 1];

    const partPicker = byId('obj-part');
    partPicker.value = partPicker.options[1].value;
    partPicker.dispatchEvent(new Event('change', { bubbles: true }));
    const widthField = byId('obj-w');
    widthField.value = varName; // bind this part's width to the variable
    widthField.dispatchEvent(new Event('change', { bubbles: true }));

    const typed = '3.75';
    const typingStart = performance.now();
    for (let i = 1; i <= typed.length; i++) {
        varField.value = typed.slice(0, i);
        varField.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const typingMs = Math.round(performance.now() - typingStart);
    check('typing-a-variable-does-not-rebuild-per-keystroke', typingMs < 60,
        `${typingMs}ms for ${typed.length} keystrokes with a group bound`);

    // ...and the value must still land once typing stops.
    await new Promise(resolve => setTimeout(resolve, 400));
    partPicker.value = partPicker.options[1].value;
    partPicker.dispatchEvent(new Event('change', { bubbles: true }));
    check('variable-value-still-applies', byId('obj-w').value === varName,
        `bound expression shown as "${byId('obj-w').value}", variable=${varName}=${varField.value}`);

    // 11. Deleting shapes must release their GPU resources. The runner records the renderers
    //     the app creates so info.memory is readable here; the main one is the first.
    const mainRenderer = (window.__renderers || [])[0];
    clearScene();
    await new Promise(requestAnimationFrame);
    const baseline = mainRenderer.info.memory.geometries;

    for (let i = 0; i < 20; i++) document.querySelector('[data-shape="cube"]').click();
    await new Promise(requestAnimationFrame);
    const withCubes = mainRenderer.info.memory.geometries;

    clearScene();
    await new Promise(requestAnimationFrame);
    const afterDelete = mainRenderer.info.memory.geometries;

    check('deleting-shapes-releases-geometries', afterDelete <= baseline,
        `baseline=${baseline} with20cubes=${withCubes} afterDelete=${afterDelete}`);

    // Cut keeps a clone on the clipboard that must survive its source being disposed.
    document.querySelector('[data-shape="cube"]').click();
    pressKey('x', { ctrlKey: true });
    pressKey('v', { ctrlKey: true });
    const pastedAfterCut = await exportSignature();
    check('cut-then-paste-keeps-its-geometry', pastedAfterCut && pastedAfterCut.facets === 12,
        fmt(pastedAfterCut));

    // 12. Marking a part of a group as a hole must cut it out of the assembly. The toggle used
    //     to write to the selection, so it flagged the whole group instead of the part shown.
    clearScene();
    document.querySelector('[data-shape="cube"]').click();
    document.querySelector('[data-shape="sphere"]').click();
    boxSelectAll();
    byId('group-shapes').click();
    const solidAssembly = await exportSignature();

    const holePicker = byId('obj-part');
    holePicker.value = holePicker.options[1].value;
    holePicker.dispatchEvent(new Event('change', { bubbles: true }));
    byId('type-hole').checked = true;
    byId('type-hole').dispatchEvent(new Event('change', { bubbles: true }));
    const cutAssembly = await exportSignature();

    check('marking-a-part-as-hole-recuts-the-group',
        solidAssembly && cutAssembly && solidAssembly.bounds !== cutAssembly.bounds,
        `solid "${fmt(solidAssembly)}" -> hole "${fmt(cutAssembly)}"`);

    // 13. Importing. A model goes in through the real file input, so this covers the parser,
    //     the unit conversion, and the save/undo round trip of geometry that no primitive
    //     type can regenerate.
    async function importViaInput(name, content, options = {}, { cancel = false } = {}) {
        options = { units: 'mm', up: 'y', recenter: true, ...options }; // the dialog remembers its last answers
        const input = byId('file-import');
        const dt = new DataTransfer();
        dt.items.add(new File([content], name));
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        if (!await driveDialog(options, { cancel })) return false;
        for (let i = 0; i < 40 && !/Imported|Import failed|cancelled/.test(status()); i++) await new Promise(r => setTimeout(r, 50));
        return true;
    }
    // Outward-wound box triangles (a mesh that winds inward is "inside-out" to the importer).
    const box = (x, y, z) => [
        [0,0,0, x,0,0, x,y,0], [0,0,0, x,y,0, 0,y,0], [0,0,z, x,y,z, x,0,z], [0,0,z, 0,y,z, x,y,z],
        [0,0,0, 0,y,z, 0,0,z], [0,0,0, 0,y,0, 0,y,z], [x,0,0, x,0,z, x,y,z], [x,0,0, x,y,z, x,y,0],
        [0,0,0, x,0,z, x,0,0], [0,0,0, 0,0,z, x,0,z], [0,y,0, x,y,0, x,y,z], [0,y,0, x,y,z, 0,y,z]]
        .map(t => [...t.slice(0, 3), ...t.slice(6, 9), ...t.slice(3, 6)]);
    const asciiStl = tris => 'solid t\n' + tris.map(t => 'facet normal 0 0 0\nouter loop\n'
        + [0, 3, 6].map(i => `vertex ${t[i] + 100} ${t[i + 1] + 100} ${t[i + 2] + 100}\n`).join('')
        + 'endloop\nendfacet\n').join('') + 'endsolid t\n';

    clearScene();
    await importViaInput('block.stl', asciiStl(box(20, 10, 30))); // mm, far from the origin
    const importedStl = await exportSignature();
    check('import-stl-lands-at-size-in-mm-on-the-grid',
        importedStl && importedStl.facets === 12 && importedStl.bounds === '[-10.000,0.000,-15.000]..[10.000,10.000,15.000]',
        `${fmt(importedStl)} status="${status()}"`);

    const savedImport = await saveAndParse();
    check('import-is-embedded-once-in-the-save-file',
        Object.keys(savedImport.assets || {}).length === 1
            && !JSON.stringify(savedImport.undoStack).includes('positions'),
        `assets=${Object.keys(savedImport.assets || {}).length}`);

    document.querySelector('[data-shape="cube"]').click();
    byId('btn-undo').click();
    const afterImportUndo = await exportSignature();
    check('import-survives-undo', sameMesh(afterImportUndo, importedStl), `${fmt(importedStl)} -> ${fmt(afterImportUndo)}`);

    clearScene();
    const loadInput = byId('file-load');
    const dt = new DataTransfer();
    dt.items.add(new File([JSON.stringify(savedImport)], 'project.holo'));
    loadInput.files = dt.files;
    loadInput.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 500));
    check('import-survives-save-and-load', sameMesh(await exportSignature(), importedStl), `status="${status()}"`);

    clearScene();
    await importViaInput('quad.obj', 'v 0 0 0\nv 40 0 0\nv 40 0 40\nv 0 0 40\nv 20 30 20\nf 1 2 3 4\nf 1 2 5\nf 2 3 5\nf 3 4 5\nf 4 1 5\n');
    const importedObj = await exportSignature();
    check('import-obj-pyramid', importedObj && importedObj.facets === 6 && importedObj.bounds === '[-20.000,0.000,-20.000]..[20.000,30.000,20.000]',
        fmt(importedObj));

    clearScene();
    await importViaInput('frame.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">'
        + '<path fill-rule="evenodd" d="M0 0H100V100H0Z M25 25V75H75V25Z"/></svg>');
    const importedSvg = await exportSignature();
    // 100px = 26.458mm, extruded 5mm. A square with a square hole is 8 wall quads + top + bottom rings.
    check('import-svg-extrudes-a-frame-with-its-hole',
        importedSvg && importedSvg.bounds === '[-13.229,0.000,-13.229]..[13.229,5.000,13.229]' && importedSvg.facets > 12,
        fmt(importedSvg));

    clearScene();
    await importViaInput('bad.stl', 'this is not an stl');
    check('import-rejects-garbage-without-adding-a-shape', /Import failed/.test(status()) && (await exportSignature()) === null,
        `status="${status()}"`);

    clearScene();
    await importViaInput('zup.stl', asciiStl(box(20, 10, 30)), { up: 'z' });
    const zUp = await exportSignature();
    check('import-z-up-rotates-z-to-y', zUp && zUp.bounds === '[-10.000,0.000,-5.000]..[10.000,30.000,5.000]', fmt(zUp));

    clearScene();
    await importViaInput('inch.stl', asciiStl(box(1, 1, 1)), { units: 'in' });
    const inch = await exportSignature();
    check('import-units-inches', inch && inch.bounds === '[-12.700,0.000,-12.700]..[12.700,25.400,12.700]', fmt(inch));

    clearScene();
    await importViaInput('deep.svg', '<svg xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100"/></svg>', { depth: 10 });
    const deep = await exportSignature();
    check('import-svg-depth-is-adjustable', deep && deep.bounds === '[-13.229,0.000,-13.229]..[13.229,10.000,13.229]', fmt(deep));

    clearScene();
    await importViaInput('nope.stl', asciiStl(box(5, 5, 5)), {}, { cancel: true });
    const cancelStatus = status();
    check('import-dialog-cancel-adds-nothing', /cancelled/.test(cancelStatus) && (await exportSignature()) === null, `status="${cancelStatus}"`);

    check('no-uncaught-errors-after-import', uncaught.length === 0, uncaught.join(' ;; ') || 'none');

    // 14. Modelling tools.
    const sigOf = async () => exportSignature();
    clearScene();
    await importViaInput('far.stl', asciiStl(box(20, 10, 30)), { recenter: false }); // x 100..120mm, z 100..130mm
    const farOne = await sigOf();
    check('import-without-recentring-keeps-file-coordinates',
        farOne && farOne.bounds === '[100.000,100.000,100.000]..[120.000,110.000,130.000]', fmt(farOne));

    const keys = (key, extra = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...extra }));
    keys('d', { ctrlKey: true });
    const dup = await sigOf();
    check('duplicate-adds-an-offset-copy', dup && dup.facets === 24 && dup.bounds !== farOne.bounds, fmt(dup));

    clearScene();
    await importViaInput('far.stl', asciiStl(box(20, 10, 30)), { recenter: false });
    byId('mirror-selected').click();
    await driveDialog({ axis: 'x' });
    const mirrored = await sigOf();
    check('mirror-adds-a-reflected-copy', mirrored && mirrored.facets === 24
        && mirrored.bounds === '[-120.000,100.000,100.000]..[120.000,110.000,130.000]', fmt(mirrored));

    clearScene();
    await importViaInput('far.stl', asciiStl(box(20, 10, 30)), { recenter: false });
    byId('array-selected').click();
    await driveDialog({ kind: 'polar', count: 4, axis: 'y', angle: 360 });
    const polar = await sigOf();
    check('polar-array-spreads-copies-round-the-axis', polar && polar.facets === 48
        && polar.bounds === '[-130.000,100.000,-130.000]..[130.000,110.000,130.000]', fmt(polar));

    clearScene();
    await importViaInput('block.stl', asciiStl(box(20, 10, 30)));
    byId('array-selected').click();
    await driveDialog({ kind: 'linear', count: 3, dx: 30, dy: 0, dz: 0 });
    const linear = await sigOf();
    check('linear-array', linear && linear.facets === 36 && linear.bounds === '[-10.000,0.000,-15.000]..[70.000,10.000,15.000]', fmt(linear));

    clearScene();
    document.querySelector('[data-shape="cube"]').click();
    byId('round-edges').click();
    await driveDialog({ size: 2, steps: 1 });
    const chamfered = await sigOf();
    check('chamfer-edges-of-a-cube', chamfered && chamfered.facets === 108, fmt(chamfered));
    const chamferSize = chamfered.bounds.match(/\[(.*?)\]\.\.\[(.*?)\]/).slice(1).map(x => x.split(',').map(Number));
    check('chamfer-keeps-the-cube-size', chamferSize[1].every((v, i) => Math.abs(v - chamferSize[0][i] - 20) < 0.01), chamfered.bounds);
    document.querySelector('[data-shape="sphere"]').click();
    byId('btn-undo').click();
    check('rounded-edges-survive-undo', sameMesh(await sigOf(), chamfered), 'after undo');
    const savedEdge = await saveAndParse();
    const lastState = JSON.stringify(savedEdge.undoStack[savedEdge.undoStack.length - 1]);
    check('edge-parameters-are-saved-not-vertices', lastState.includes('"steps":1') && !lastState.includes('"importId":"'),
        `state has chamfer=${lastState.includes('"steps":1')}`);
    check('save-only-embeds-meshes-history-still-uses',
        Object.keys(savedEdge.assets || {}).length > 0 && Object.keys(savedEdge.assets || {}).every(id => JSON.stringify(savedEdge.undoStack).includes(id)),
        `assets=${Object.keys(savedEdge.assets || {}).length}`);
    boxSelectAll();
    byId('round-edges').click();
    await driveDialog({ size: 0, steps: 1 });
    const sharp = await sigOf();
    check('sharp-removes-the-rounding', sharp && sharp.facets === 12, fmt(sharp));

    // Sketch: click ground points chosen through a replica of the app camera.
    const clickGround = (x, z) => {
        const cam = window.__camera; // the camera the app last rendered with (see run-regression.mjs)
        cam.updateMatrixWorld(true);
        cam.matrixWorldInverse.copy(cam.matrixWorld).invert(); // the renderer only refreshes this at draw time
        const v = new THREE.Vector3(x, 0, z).project(cam);
        const canvas = document.querySelector('#canvas-container canvas');
        const at = { clientX: (v.x + 1) / 2 * window.innerWidth, clientY: (1 - v.y) / 2 * window.innerHeight, bubbles: true };
        canvas.dispatchEvent(new PointerEvent('pointerdown', at));
        window.dispatchEvent(new PointerEvent('pointerup', at));
    };
    clearScene();
    await new Promise(r => setTimeout(r, 900)); // let any camera centring animation finish
    byId('sketch-tool').click();
    [[3, 2], [6, 2], [6, 5], [3, 5]].forEach(([x, z]) => clickGround(x, z));
    keys('Enter');
    await driveDialog({ op: 'extrude', depth: 10 });
    const extruded = await sigOf();
    check('sketch-extrude', extruded && extruded.facets === 12 && extruded.bounds === '[30.000,0.000,20.000]..[60.000,10.000,50.000]', fmt(extruded));

    clearScene();
    byId('sketch-tool').click();
    [[2, 0], [4, 0], [4, -6], [2, -6]].forEach(([x, z]) => clickGround(x, z));
    keys('Enter');
    await driveDialog({ op: 'revolve', segments: 32 });
    const revolved = await sigOf();
    check('sketch-revolve-makes-a-ring', revolved && revolved.bounds === '[-40.000,0.000,-40.000]..[40.000,60.000,40.000]' && revolved.facets === 4 * 32 * 2, fmt(revolved));

    clearScene();
    byId('sketch-tool').click();
    clickGround(1, 1); clickGround(4, 1);
    keys('Escape');
    check('sketch-escape-cancels', /Sketch cancelled/.test(status()) && !byId('sketch-tool').classList.contains('active'), status());

    check('no-uncaught-errors-after-modelling', uncaught.length === 0, uncaught.join(' ;; ') || 'none');

    // 15. Export formats (each goes through the real dialog).
    clearScene();
    document.querySelector('[data-shape="cube"]').click();
    document.querySelector('[data-shape="sphere"]').click();
    async function exportAs(format, opts = {}) {
        const before = blobs.length;
        byId('export-stl').click();
        await driveDialog({ format, ...opts });
        return blobs.length > before ? blobs[blobs.length - 1] : null;
    }
    const binBlob = await exportAs('stl-binary');
    const binBuf = binBlob && await binBlob.arrayBuffer();
    const binCount = binBuf && new DataView(binBuf).getUint32(80, true);
    check('export-binary-stl-is-well-formed', binBuf && binBuf.byteLength === 84 + 50 * binCount && binCount > 12,
        `bytes=${binBuf && binBuf.byteLength} triangles=${binCount}`);

    const objBlob = await exportAs('obj');
    const objText = objBlob && await objBlob.text();
    check('export-obj-has-both-objects', objText && (objText.match(/^o /gm) || []).length === 2 && /^f \d+ \d+ \d+$/m.test(objText),
        objText && objText.slice(0, 60));

    const mfBlob = await exportAs('3mf');
    const mfBytes = mfBlob && new Uint8Array(await mfBlob.arrayBuffer());
    check('export-3mf-is-a-zip-with-a-model', mfBytes && mfBytes[0] === 0x50 && mfBytes[1] === 0x4b
        && new TextDecoder().decode(mfBytes).includes('3D/3dmodel.model') && new TextDecoder().decode(mfBytes).includes('unit="millimeter"'),
        `bytes=${mfBytes && mfBytes.length}`);

    clearScene();
    document.querySelector('[data-shape="cube"]').click();
    document.querySelector('[data-shape="sphere"]').click(); // sphere is selected
    const onlySelected = await exportAs('stl-ascii', { selectionOnly: true });
    const onlyText = onlySelected && await onlySelected.text();
    const onlyFacets = onlyText && (onlyText.match(/facet normal/g) || []).length;
    check('export-selection-only', onlyFacets > 12 && (onlyText.match(/^solid /gm) || []).length === 1, `facets=${onlyFacets}`);

    byId('export-stl').click();
    await driveDialog({}, { cancel: true });
    check('export-cancel-writes-nothing', /cancelled/.test(status()), status());

    check('no-uncaught-errors-after-export', uncaught.length === 0, uncaught.join(' ;; ') || 'none');

    // 16. Precision: numeric transforms, snap toggle, measuring.
    clearScene();
    await importViaInput('block.stl', asciiStl(box(20, 10, 30)));
    const setField = (id, value) => { const el = byId(id); el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); };
    check('position-fields-show-the-selection', byId('obj-py').value === '0.5', `py="${byId('obj-py').value}"`);
    setField('obj-px', '5'); setField('obj-pz', '2*3');
    const moved = await sigOf();
    check('typing-a-position-moves-the-shape-and-accepts-expressions',
        moved && moved.bounds === '[40.000,0.000,45.000]..[60.000,10.000,75.000]', fmt(moved));
    setField('obj-px', '0'); setField('obj-pz', '0'); setField('obj-ry', '90');
    const turned = await sigOf();
    check('typing-a-rotation-turns-the-shape', turned && turned.bounds === '[-15.000,0.000,-10.000]..[15.000,10.000,10.000]', fmt(turned));
    setField('obj-px', 'nonsense');
    check('a-bad-position-is-refused-not-applied', /not a number/.test(status()) && (await sigOf()).bounds === turned.bounds, status());
    byId('btn-undo').click();
    check('numeric-edits-are-undoable', (await sigOf()).bounds !== turned.bounds, 'after undo');

    byId('snap-toggle').click();
    check('snap-toggle-turns-snapping-off', /Snapping off/.test(status()) && !byId('snap-toggle').classList.contains('active'), status());
    byId('snap-toggle').click();
    check('snap-toggle-turns-snapping-back-on', /Snapping on/.test(status()) && byId('snap-toggle').classList.contains('active'), status());

    clearScene();
    await new Promise(r => setTimeout(r, 900));
    byId('measure-tool').click();
    clickGround(0, 0); clickGround(3, 4);
    await new Promise(r => setTimeout(r, 200)); // the label is attached to the DOM at the next draw
    const label = document.querySelector('.measure-label');
    check('measure-two-ground-points-is-50mm', label && /^50\.00 mm/.test(label.textContent) && /Δx 30\.00\s+Δy 0\.00\s+Δz 40\.00/.test(label.textContent),
        label ? label.textContent : `no label; status="${status()}"`);
    keys('Escape');
    check('escape-finishes-measuring-and-clears-it', !document.querySelector('.measure-label') && !byId('measure-tool').classList.contains('active'), status());

    document.querySelector('[data-shape="cube"]').click();
    await new Promise(r => setTimeout(r, 900));
    byId('measure-tool').click();
    check('measure-mode-does-not-select-or-add-shapes', /Measure:/.test(status()), status());
    keys('Escape');

    check('no-uncaught-errors-after-precision', uncaught.length === 0, uncaught.join(' ;; ') || 'none');

    // 17. Robustness: mesh health, boolean failures, and the CSG worker.
    const openTri = 'solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 10 0\nendloop\nendfacet\nendsolid t\n';
    clearScene();
    await importViaInput('open.stl', openTri);
    check('import-warns-about-an-open-mesh', /not watertight \(3 open edge/.test(status()), status());

    clearScene();
    await importViaInput('closed.stl', asciiStl(box(10, 10, 10)));
    check('import-of-a-clean-mesh-has-no-warning', !/⚠|Note:/.test(status()), status());

    const insideOut = asciiStl(box(10, 10, 10).map(t => [...t.slice(0, 3), ...t.slice(6, 9), ...t.slice(3, 6)])); // reversed again = inward
    clearScene();
    await importViaInput('inside-out.stl', insideOut);
    check('import-flips-an-inside-out-solid', /flipped/.test(status()) && !/⚠/.test(status()), status());

    // A hole larger than the solid removes everything: that must fail cleanly, not corrupt the scene.
    clearScene();
    await importViaInput('small.stl', asciiStl(box(10, 10, 10)));
    await importViaInput('big.stl', asciiStl(box(30, 30, 30)));
    byId('type-hole').checked = true;
    byId('type-hole').dispatchEvent(new Event('change', { bubbles: true }));
    boxSelectAll();
    byId('group-shapes').click();
    check('a-group-that-cuts-away-everything-fails-cleanly', /Grouping failed/.test(status()) && /left nothing/.test(status()), status());
    const afterFailure = await exportSignature();
    check('failed-grouping-leaves-the-solid-in-place', afterFailure && afterFailure.facets === 12, fmt(afterFailure));

    // The worker must produce the same solid as the inline path.
    async function crossGroup(threshold) {
        window.HOLODECK_CSG_WORKER_THRESHOLD = threshold;
        clearScene();
        await importViaInput('a.stl', asciiStl(box(20, 10, 30)));
        await importViaInput('b.stl', asciiStl(box(10, 20, 10)));
        boxSelectAll();
        byId('group-shapes').click();
        for (let i = 0; i < 100 && !/Grouped|failed/.test(status()); i++) await new Promise(r => setTimeout(r, 50));
        return { status: status(), sig: await exportSignature() };
    }
    const inline = await crossGroup(1e9);
    const viaWorker = await crossGroup(0);
    check('inline-group-union-is-a-cross', inline.sig && inline.sig.bounds === '[-10.000,0.000,-15.000]..[10.000,20.000,15.000]', `${inline.status} ${fmt(inline.sig)}`);
    check('worker-group-matches-inline-exactly', viaWorker.sig && sameMesh(viaWorker.sig, inline.sig), `${fmt(viaWorker.sig)} vs ${fmt(inline.sig)}`);

    // Editing a member of a worker-computed group re-cuts it in the background.
    window.HOLODECK_CSG_WORKER_THRESHOLD = 0;
    const workerPartPicker = byId('obj-part');
    workerPartPicker.value = workerPartPicker.options[1].value;
    workerPartPicker.dispatchEvent(new Event('change', { bubbles: true }));
    const workerW = byId('obj-w'); workerW.value = '4'; workerW.dispatchEvent(new Event('change', { bubbles: true }));
    for (let i = 0; i < 100 && !/recomputed/.test(status()); i++) await new Promise(r => setTimeout(r, 50));
    const edited = await exportSignature();
    check('editing-a-worker-group-part-recomputes-it', /recomputed/.test(status()) || edited, `status="${status()}" ${fmt(edited)}`);
    check('worker-edit-changed-the-solid', edited && edited.bounds !== viaWorker.sig.bounds, `${fmt(edited)} vs ${fmt(viaWorker.sig)}`);
    window.HOLODECK_CSG_WORKER_THRESHOLD = undefined;

    check('no-uncaught-errors-after-robustness', uncaught.length === 0, uncaught.join(' ;; ') || 'none');

    // 18. Polish: shortcut sheet, unsaved-changes guard, autosave and restore, accessibility.
    keys('?', { shiftKey: true });
    check('question-mark-opens-the-shortcut-sheet', !!document.querySelector('[role="dialog"][aria-label="Keyboard shortcuts"] kbd'), 'dialog present');
    keys('Escape');
    check('escape-closes-the-shortcut-sheet', !document.querySelector('[role="dialog"]'), 'closed');
    byId('btn-help').click();
    check('help-button-opens-the-shortcut-sheet', !!document.querySelector('[role="dialog"]'), 'dialog present');
    byId('dlg-ok').click();

    clearScene();
    document.querySelector('[data-shape="cube"]').click();
    document.querySelector('[data-shape="sphere"]').click();
    keys('Escape');
    keys('a', { ctrlKey: true });
    check('ctrl-a-selects-everything', /2 shapes selected/.test(status()), status());

    const leaving = () => { const ev = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(ev); return ev.defaultPrevented; };
    check('unsaved-changes-ask-before-leaving', leaving() && document.title.startsWith('•'), `title="${document.title}"`);
    byId('btn-save').click();
    check('saving-clears-the-unsaved-guard', !leaving() && !document.title.startsWith('•'), `title="${document.title}"`);
    document.querySelector('[data-shape="cone"]').click();
    check('editing-after-a-save-is-unsaved-again', leaving(), 'guard on');

    const idbGet = () => new Promise(resolve => {
        const req = indexedDB.open('holodeck', 1);
        req.onerror = () => resolve(undefined);
        req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('kv')) { db.close(); resolve(undefined); return; }
            const get = db.transaction('kv').objectStore('kv').get('autosave');
            get.onsuccess = () => { db.close(); resolve(get.result); };
            get.onerror = () => { db.close(); resolve(undefined); };
        };
    });
    window.HOLODECK_AUTOSAVE_MS = 100;
    clearScene();
    await importViaInput('auto.stl', asciiStl(box(20, 10, 30)));
    await new Promise(r => setTimeout(r, 600));
    const record = await idbGet();
    const recordState = record && JSON.parse(record.json);
    const recordShapes = recordState && recordState.undoStack[recordState.undoStack.length - 1].shapes.length;
    check('edits-are-autosaved-to-indexeddb', recordShapes === 1 && Object.keys(recordState.assets).length >= 1, `shapes=${recordShapes}`);

    // A second copy of the app (no harness) must offer the session back.
    async function loadFrame() {
        const f = document.createElement('iframe');
        f.style.cssText = 'position:fixed;left:-10000px;top:0;width:900px;height:700px;';
        f.src = 'index.html?noharness=1';
        document.body.appendChild(f);
        await new Promise(r => f.addEventListener('load', r));
        for (let i = 0; i < 80 && !f.contentDocument.getElementById('restore-banner')?.classList.contains('active'); i++) await new Promise(r => setTimeout(r, 100));
        return f;
    }
    const frame = await loadFrame();
    const fdoc = frame.contentDocument;
    const banner = fdoc.getElementById('restore-banner');
    check('a-second-session-offers-to-restore', banner.classList.contains('active') && /1 shape/.test(fdoc.getElementById('restore-text').textContent),
        fdoc.getElementById('restore-text').textContent);
    fdoc.getElementById('restore-yes').click();
    await new Promise(r => setTimeout(r, 800));
    const restoreStatus = fdoc.getElementById('status-bar').innerText.trim();
    const fblobs = [];
    frame.contentWindow.URL.createObjectURL = b => { fblobs.push(b); return 'blob:x'; };
    frame.contentWindow.HTMLAnchorElement.prototype.click = () => {};
    fdoc.getElementById('export-stl').click();
    for (let i = 0; i < 40 && !fdoc.getElementById('dlg-ok'); i++) await new Promise(r => setTimeout(r, 50));
    fdoc.getElementById('dlg-format').value = 'stl-ascii';
    fdoc.getElementById('dlg-ok').click();
    await new Promise(r => setTimeout(r, 300));
    const restoredText = fblobs.length ? await fblobs[0].text() : '';
    check('restore-brings-the-imported-shape-back', /Previous session restored/.test(restoreStatus) && (restoredText.match(/facet normal/g) || []).length === 12,
        `status="${fdoc.getElementById('status-bar').innerText.trim()}" facets=${(restoredText.match(/facet normal/g) || []).length}`);
    check('a-restored-session-counts-as-unsaved', (() => { const ev = new frame.contentWindow.Event('beforeunload', { cancelable: true }); frame.contentWindow.dispatchEvent(ev); return ev.defaultPrevented; })(), 'guard on');
    frame.remove();

    const frame2 = await loadFrame();
    frame2.contentDocument.getElementById('restore-no').click();
    await new Promise(r => setTimeout(r, 400));
    check('discarding-removes-the-autosave', (await idbGet()) === undefined && !frame2.contentDocument.getElementById('restore-banner').classList.contains('active'), 'record gone');
    frame2.remove();
    window.HOLODECK_AUTOSAVE_MS = undefined;

    const unnamed = [...document.querySelectorAll('button')].filter(b => !((b.getAttribute('aria-label') || b.textContent || '').trim()));
    check('every-button-has-an-accessible-name', unnamed.length === 0, unnamed.map(b => b.outerHTML.slice(0, 120)).join(' | ') || 'all named');
    check('status-bar-is-a-live-region', byId('status-bar').getAttribute('aria-live') === 'polite', 'aria-live=polite');

    check('no-uncaught-errors-after-polish', uncaught.length === 0, uncaught.join(' ;; ') || 'none');

    // 19. Cone / cylinder tool and bevels.
    const setBox = (id, v) => { const el = byId(id); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); };
    check('cylinder-button-is-gone', !document.querySelector('[data-shape="cylinder"]'), 'merged into the cone tool');
    clearScene();
    document.querySelector('[data-shape="cone"]').click();
    check('cone-panel-shows-top-height-bottom',
        byId('cone-properties').style.display === 'flex' && byId('obj-cone-top').value === '5' && byId('obj-cone-height').value === '20' && byId('obj-cone-bottom').value === '15',
        `${byId('obj-cone-top').value}/${byId('obj-cone-height').value}/${byId('obj-cone-bottom').value}`);
    const b3 = s => s.bounds.replace(/[\[\]]/g, ' ').replace('..', ',').split(',').map(Number); // [minx,miny,minz, maxx,maxy,maxz]
    const frustumSig = await sigOf();
    const fb = b3(frustumSig);
    check('default-cone-is-30mm-wide-and-20mm-tall', Math.abs(fb[3] - fb[0] - 30) < 0.01 && Math.abs(fb[4] - fb[1] - 20) < 0.01, fmt(frustumSig));

    setBox('obj-cone-top', '10'); setBox('obj-cone-bottom', '10'); setBox('obj-cone-height', '30');
    const cyl = await sigOf(); const cb = b3(cyl);
    check('equal-radii-make-a-cylinder', Math.abs(cb[3] - cb[0] - 20) < 0.01 && Math.abs(cb[4] - cb[1] - 30) < 0.01 && Math.abs(cb[5] - cb[2] - 20) < 0.01, fmt(cyl));

    setBox('obj-cone-top', '0');
    const pointed = await sigOf();
    check('zero-top-radius-makes-a-cone', pointed && pointed.facets < cyl.facets, fmt(pointed));
    setBox('obj-cone-top', '0'); setBox('obj-cone-bottom', '0');
    check('both-radii-zero-is-refused-and-changes-nothing', /needs a height above zero/.test(status()) && sameMesh(await sigOf(), pointed), status());

    setBox('obj-cone-top', '10'); setBox('obj-cone-bottom', '10');
    const plainCyl = await sigOf();
    setBox('obj-bevel-size', '2'); setBox('obj-bevel-steps', '3');
    const bevelled = await sigOf();
    const bb = b3(bevelled);
    check('bevelling-a-cylinder-adds-facets-and-keeps-its-size',
        bevelled.facets > plainCyl.facets && Math.abs(bb[3] - bb[0] - 20) < 0.01 && Math.abs(bb[4] - bb[1] - 30) < 0.01, `${plainCyl.facets} -> ${bevelled.facets} ${bevelled.bounds}`);
    setBox('obj-bevel-steps', '1');
    const chamf = await sigOf();
    check('one-step-is-a-flat-chamfer-with-fewer-facets', chamf.facets < bevelled.facets && chamf.facets > plainCyl.facets, `${chamf.facets}`);
    const savedCone = await saveAndParse();
    const coneState = JSON.stringify(savedCone.undoStack[savedCone.undoStack.length - 1]);
    check('cone-parameters-are-saved-not-vertices', coneState.includes('"cone":{') && coneState.includes('"steps":1') && !coneState.includes('"importId":"'), 'params in state');
    document.querySelector('[data-shape="sphere"]').click();
    byId('btn-undo').click();
    check('cone-and-bevel-survive-undo', sameMesh(await sigOf(), chamf), 'after undo');

    // A cube takes the same panel fields.
    clearScene();
    document.querySelector('[data-shape="cube"]').click();
    check('cube-panel-shows-bevel-but-not-cone-fields', byId('bevel-properties').style.display === 'flex' && byId('cone-properties').style.display === 'none', 'panel rows');
    setBox('obj-bevel-size', '3'); setBox('obj-bevel-steps', '4');
    const cubeBev = await sigOf();
    check('cube-bevel-with-steps', cubeBev.facets > 12, fmt(cubeBev));
    setBox('obj-bevel-size', '0');
    check('bevel-size-zero-restores-the-sharp-cube', (await sigOf()).facets === 12, 'sharp again');

    // The toolbar button opens the same controls as a dialog, for a cone too.
    clearScene();
    document.querySelector('[data-shape="cone"]').click();
    byId('round-edges').click();
    await driveDialog({ size: 2, steps: 2 });
    check('toolbar-bevel-dialog-works-on-a-cone', /Beveled: 2 mm in 2 steps/.test(status()), status());

    // Projects saved before the merge held separate cylinder and cone shapes.
    const legacyShape = type => ({ uuid: 'legacy-' + type, name: type, position: [0, 1, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1],
        material: { color: 0xff0000, transparent: true, opacity: 0.85, roughness: 0.4, metalness: 0.1 },
        userData: { type, bindings: {}, isComposite: false, isHole: false } });
    async function loadLegacy(type) {
        clearScene();
        const project = { version: '2.1', undoStack: [{ shapes: [legacyShape(type)], variables: {}, metadata: {}, bom: [] }], redoStack: [] };
        const dt2 = new DataTransfer(); dt2.items.add(new File([JSON.stringify(project)], 'old.holo'));
        byId('file-load').files = dt2.files;
        byId('file-load').dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 500));
        return sigOf();
    }
    const oldCyl = await loadLegacy('cylinder'); const oc = b3(oldCyl);
    check('an-old-cylinder-loads-as-a-cone-shape-with-equal-radii', Math.abs(oc[3] - oc[0] - 20) < 0.01 && Math.abs(oc[4] - oc[1] - 20) < 0.01, fmt(oldCyl));
    const oldCone = await loadLegacy('cone'); const ok2 = b3(oldCone);
    check('an-old-cone-loads-at-its-old-size', Math.abs(ok2[3] - ok2[0] - 30) < 0.01 && Math.abs(ok2[4] - ok2[1] - 20) < 0.01, fmt(oldCone));

    check('no-uncaught-errors-after-cone', uncaught.length === 0, uncaught.join(' ;; ') || 'none');

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
