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

// Remembers a dialog's last answers between uses.
export function loadPrefs(key, defaults) {
    try { return { ...defaults, ...JSON.parse(localStorage.getItem('holodeck.' + key) || '{}') }; } catch (e) { return { ...defaults }; }
}
export function savePrefs(key, values) {
    try { localStorage.setItem('holodeck.' + key, JSON.stringify(values)); } catch (e) { /* private mode */ }
}
