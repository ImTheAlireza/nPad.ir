/**
 * IndexedDB persistence for the note document.
 *
 * The previous implementation opened a fresh connection on every read and
 * write, never surfaced errors, and used store.put() without awaiting the
 * transaction — so a failed write was silent. This version keeps one shared
 * connection, resolves on transaction completion, and degrades to
 * localStorage when IndexedDB is unavailable (private windows, old browsers).
 */

const DB_NAME = 'npad';
const DB_VERSION = 2;
const STORE = 'documents';
const DOC_ID = 'current';
const FALLBACK_KEY = 'npad:document';

/** @type {Promise<IDBDatabase|null>|null} */
let connection = null;

function openDatabase() {
    if (connection) return connection;

    connection = new Promise((resolve) => {
        if (typeof indexedDB === 'undefined') {
            resolve(null);
            return;
        }

        let request;
        try {
            request = indexedDB.open(DB_NAME, DB_VERSION);
        } catch {
            resolve(null);
            return;
        }

        request.onupgradeneeded = (event) => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE)) {
                db.createObjectStore(STORE, { keyPath: 'id' });
            }
            // v1 stored { id, content, theme }; theme now lives in
            // localStorage so it can be read before first paint.
            if (event.oldVersion < 2 && db.objectStoreNames.contains('editorContent')) {
                try {
                    db.deleteObjectStore('editorContent');
                } catch {
                    /* store may not exist in this browser's copy */
                }
            }
        };

        request.onsuccess = () => {
            request.result.onversionchange = () => request.result.close();
            resolve(request.result);
        };

        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
    });

    return connection;
}

function readFallback() {
    try {
        const raw = localStorage.getItem(FALLBACK_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function writeFallback(record) {
    try {
        localStorage.setItem(FALLBACK_KEY, JSON.stringify(record));
        return true;
    } catch {
        return false;
    }
}

/**
 * Persist the document.
 * @param {string} html
 * @returns {Promise<boolean>} true when the write is durable
 */
export async function saveDocument(html) {
    const record = { id: DOC_ID, html, updatedAt: Date.now() };
    const db = await openDatabase();

    if (!db) return writeFallback(record);

    return new Promise((resolve) => {
        let tx;
        try {
            tx = db.transaction(STORE, 'readwrite');
        } catch {
            resolve(writeFallback(record));
            return;
        }

        tx.objectStore(STORE).put(record);
        // Resolve on complete, not on request success — only then is the
        // data actually committed to disk.
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(writeFallback(record));
        tx.onabort = () => resolve(writeFallback(record));
    });
}

/**
 * Load the stored document.
 * @returns {Promise<{html: string, updatedAt: number}|null>}
 */
export async function loadDocument() {
    const db = await openDatabase();

    if (!db) {
        const record = readFallback();
        return record ? { html: record.html ?? '', updatedAt: record.updatedAt ?? 0 } : null;
    }

    return new Promise((resolve) => {
        let tx;
        try {
            tx = db.transaction(STORE, 'readonly');
        } catch {
            resolve(null);
            return;
        }

        const request = tx.objectStore(STORE).get(DOC_ID);
        request.onsuccess = () => {
            const record = request.result;
            resolve(record ? { html: record.html ?? '', updatedAt: record.updatedAt ?? 0 } : null);
        };
        request.onerror = () => resolve(null);
    });
}

/**
 * Remove the stored document.
 * @returns {Promise<boolean>}
 */
export async function clearDocument() {
    try {
        localStorage.removeItem(FALLBACK_KEY);
    } catch {
        /* storage disabled */
    }

    const db = await openDatabase();
    if (!db) return true;

    return new Promise((resolve) => {
        let tx;
        try {
            tx = db.transaction(STORE, 'readwrite');
        } catch {
            resolve(false);
            return;
        }

        tx.objectStore(STORE).delete(DOC_ID);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
    });
}

/**
 * Synchronous best-effort write for pagehide, where async work is unreliable.
 * @param {string} html
 */
export function saveDocumentSync(html) {
    writeFallback({ id: DOC_ID, html, updatedAt: Date.now() });
}
