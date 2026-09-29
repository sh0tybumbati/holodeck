// Small UI helpers shared by the tools.

// A modal form. Resolves to { fieldId: value } on OK, or null on cancel/Escape.
//
//   fields: [{ id, label, type: 'select'|'number'|'text'|'checkbox', value, options: [[value, label]],
//              min, max, step, unit, hint, showIf: values => boolean }]
//
// Controls get the ids dlg-<field id>, and the buttons dlg-ok / dlg-cancel, so tests and
// scripts can drive them. Dialogs are queued: opening one while another is up waits its turn.
let queue = Promise.resolve();

export function showFormDialog({ title, message = '', fields = [], confirmLabel = 'OK' }) {
    const run = () => new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'dialog-overlay';
        const box = document.createElement('form');
        box.className = 'dialog glass-panel';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        box.setAttribute('aria-labelledby', 'dlg-title');
        box.noValidate = true;

        const h = document.createElement('h3'); h.id = 'dlg-title'; h.textContent = title; box.appendChild(h);
        if (message) { const p = document.createElement('p'); p.className = 'dialog-message'; p.textContent = message; box.appendChild(p); }

        const rows = new Map();
        const read = () => {
            const values = {};
            fields.forEach(f => {
                const el = box.querySelector('#dlg-' + f.id);
                values[f.id] = f.type === 'checkbox' ? el.checked : f.type === 'number' ? parseFloat(el.value) : el.value;
            });
            return values;
        };
        const refresh = () => {
            const values = read();
            fields.forEach(f => { if (f.showIf) rows.get(f.id).style.display = f.showIf(values) ? '' : 'none'; });
        };

        fields.forEach(f => {
            const row = document.createElement('div'); row.className = 'dialog-row';
            const label = document.createElement('label'); label.htmlFor = 'dlg-' + f.id;
            label.textContent = f.label + (f.unit ? ` (${f.unit})` : '');
            let el;
            if (f.type === 'select') {
                el = document.createElement('select');
                f.options.forEach(([value, text]) => {
                    const o = document.createElement('option'); o.value = value; o.textContent = text; el.appendChild(o);
                });
                el.value = f.value;
            } else {
                el = document.createElement('input');
                el.type = f.type === 'number' ? 'number' : f.type === 'checkbox' ? 'checkbox' : 'text';
                if (f.type === 'checkbox') el.checked = !!f.value; else el.value = f.value ?? '';
                if (f.min !== undefined) el.min = f.min;
                if (f.max !== undefined) el.max = f.max;
                if (f.step !== undefined) el.step = f.step;
            }
            el.id = 'dlg-' + f.id;
            el.addEventListener('input', refresh); el.addEventListener('change', refresh);
            row.append(label, el);
            if (f.hint) { const s = document.createElement('small'); s.textContent = f.hint; row.appendChild(s); }
            box.appendChild(row); rows.set(f.id, row);
        });

        const actions = document.createElement('div'); actions.className = 'dialog-actions';
        const cancel = document.createElement('button'); cancel.type = 'button'; cancel.id = 'dlg-cancel'; cancel.className = 'tool-btn'; cancel.textContent = 'Cancel';
        const ok = document.createElement('button'); ok.type = 'submit'; ok.id = 'dlg-ok'; ok.className = 'tool-btn primary'; ok.textContent = confirmLabel;
        actions.append(cancel, ok); box.appendChild(actions);

        const previouslyFocused = document.activeElement;
        const close = value => {
            overlay.remove();
            window.removeEventListener('keydown', onKey, true);
            if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
            resolve(value);
        };
        const onKey = e => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
            // Keep app shortcuts (Delete, arrows, Ctrl+Z...) from firing while a dialog is up.
            else if (e.key !== 'Tab' && e.key !== 'Enter') e.stopPropagation();
        };
        window.addEventListener('keydown', onKey, true);
        cancel.addEventListener('click', () => close(null));
        overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(null); });
        box.addEventListener('submit', e => {
            e.preventDefault();
            const values = read();
            if (fields.some(f => f.type === 'number' && (!isFinite(values[f.id]) || (f.min !== undefined && values[f.id] < f.min) || (f.max !== undefined && values[f.id] > f.max)))) {
                box.classList.add('invalid'); return;
            }
            close(values);
        });

        overlay.appendChild(box); document.body.appendChild(overlay);
        refresh();
        (box.querySelector('input,select') || ok).focus();
    });
    const result = queue.then(run);
    queue = result.catch(() => {});
    return result;
}

// A read-only dialog: sections of [keys, description] rows. Closes on Escape, Enter or click.
export function showInfoDialog({ title, sections }) {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    const box = document.createElement('div');
    box.className = 'dialog glass-panel wide';
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', title);
    const h = document.createElement('h3'); h.textContent = title; box.appendChild(h);
    sections.forEach(({ heading, rows }) => {
        const sh = document.createElement('h4'); sh.textContent = heading; box.appendChild(sh);
        const dl = document.createElement('dl'); dl.className = 'shortcut-list';
        rows.forEach(([keys, text]) => {
            const dt = document.createElement('dt');
            keys.split(' / ').forEach((combo, i) => {
                if (i) dt.append(' / ');
                combo.split('+').forEach((k, j) => { if (j) dt.append('+'); const kbd = document.createElement('kbd'); kbd.textContent = k; dt.appendChild(kbd); });
            });
            const dd = document.createElement('dd'); dd.textContent = text;
            dl.append(dt, dd);
        });
        box.appendChild(dl);
    });
    const close = document.createElement('button');
    close.type = 'button'; close.id = 'dlg-ok'; close.className = 'tool-btn primary'; close.textContent = 'Close';
    const actions = document.createElement('div'); actions.className = 'dialog-actions'; actions.appendChild(close); box.appendChild(actions);
    const previouslyFocused = document.activeElement;
    const done = () => { overlay.remove(); window.removeEventListener('keydown', onKey, true); if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus(); };
    const onKey = e => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(); } else if (e.key !== 'Tab') e.stopPropagation(); };
    window.addEventListener('keydown', onKey, true);
    close.addEventListener('click', done);
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) done(); });
    overlay.appendChild(box); document.body.appendChild(overlay);
    close.focus();
}

// Remembers a dialog's last answers between uses.
export function loadPrefs(key, defaults) {
    try { return { ...defaults, ...JSON.parse(localStorage.getItem('holodeck.' + key) || '{}') }; } catch (e) { return { ...defaults }; }
}
export function savePrefs(key, values) {
    try { localStorage.setItem('holodeck.' + key, JSON.stringify(values)); } catch (e) { /* private mode */ }
}

// The readout shown beside the cursor while a transform gizmo is being dragged, so the exact
// value being snapped to is visible. Positions and sizes arrive in cm and are shown in mm.
export function describeTransform(mode, { position, rotationDeg, size }, snap) {
    const mm = v => (Math.round(v * 100) / 10).toFixed(1).replace(/^-0\.0$/, '0.0');
    const deg = v => (Math.round(v * 10) / 10).toFixed(1).replace(/^-0\.0$/, '0.0');
    const snapText = snap.enabled ? `snap ${snap.label}` : 'snap off';
    if (mode === 'rotate') return `X ${deg(rotationDeg[0])}°  Y ${deg(rotationDeg[1])}°  Z ${deg(rotationDeg[2])}°  · ${snap.enabled ? 'snap 5°' : 'snap off'}`;
    if (mode === 'scale') return `${mm(size[0])} × ${mm(size[1])} × ${mm(size[2])} mm  · ${snapText}`;
    return `X ${mm(position[0])}  Y ${mm(position[1])}  Z ${mm(position[2])} mm  · ${snapText}`;
}

// Straight-line distance between two points (cm in, mm out) with its axis components.
export function describeMeasurement(a, b) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]].map(v => v * 10);
    const dist = Math.hypot(...d);
    const f = v => Math.abs(v) < 0.005 ? '0.00' : v.toFixed(2);
    return { distanceMm: dist, text: `${dist.toFixed(2)} mm`, detail: `Δx ${f(d[0])}  Δy ${f(d[1])}  Δz ${f(d[2])} mm` };
}
