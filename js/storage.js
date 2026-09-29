// Tiny IndexedDB wrapper for the autosave slot. Every call resolves (never rejects) so a
// browser that blocks storage — a private window, say — simply loses autosave, silently.
const DB = 'holodeck', STORE = 'kv';

function open() {
    return new Promise((resolve, reject) => {
        let req;
        try { req = indexedDB.open(DB, 1); } catch (e) { reject(e); return; }
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function run(mode, fn) {
    try {
        const db = await open();
        return await new Promise(resolve => {
            const tx = db.transaction(STORE, mode);
            const req = fn(tx.objectStore(STORE));
            tx.oncomplete = () => { db.close(); resolve(req ? req.result : undefined); };
            tx.onerror = tx.onabort = () => { db.close(); resolve(undefined); };
        });
    } catch (e) { return undefined; }
}

export const kvGet = key => run('readonly', s => s.get(key));
export const kvPut = (key, value) => run('readwrite', s => s.put(value, key));
export const kvDelete = key => run('readwrite', s => s.delete(key));
