/**
 * Durable multi-note persistence.
 *
 * IndexedDB is the primary store. Browsers without IndexedDB use one compact
 * localStorage collection, while pagehide writes the active note to a small
 * synchronous recovery record. Existing v2 single-document records and the
 * old `npad:document` fallback are migrated without losing content.
 */

const DB_NAME = 'npad';
const DB_VERSION = 2;
const STORE = 'documents';
const LEGACY_ID = 'current';
const LEGACY_KEY = 'npad:document';
const FALLBACK_KEY = 'npad:notes';
const PENDING_KEY = 'npad:pending-note';
const ACTIVE_KEY = 'npad:active-note';

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
            if (event.oldVersion < 2 && db.objectStoreNames.contains('editorContent')) {
                try { db.deleteObjectStore('editorContent'); } catch { /* already absent */ }
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

function newId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }
    return `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normaliseNote(record = {}) {
    const now = Date.now();
    return {
        id: String(record.id || newId()),
        title: String(record.title || ''),
        html: String(record.html ?? record.content ?? ''),
        pinned: !!record.pinned,
        createdAt: Number(record.createdAt) || Number(record.updatedAt) || now,
        updatedAt: Number(record.updatedAt) || now,
    };
}

function parse(key) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function readFallbackNotes() {
    const stored = parse(FALLBACK_KEY);
    let notes = [];
    if (Array.isArray(stored)) notes = stored;
    else if (stored && Array.isArray(stored.notes)) notes = stored.notes;

    // The old app persisted one { id:'current', html, updatedAt } object.
    const legacy = parse(LEGACY_KEY);
    if (legacy && (legacy.html !== undefined || legacy.content !== undefined)) {
        notes.push({ ...legacy, id: legacy.id || LEGACY_ID });
    }

    const pending = parse(PENDING_KEY);
    if (pending && pending.id) notes.push(pending);
    return notes.map(normaliseNote);
}

function mergeNotes(...collections) {
    const merged = new Map();
    for (const collection of collections) {
        for (const raw of collection || []) {
            const note = normaliseNote(raw);
            const previous = merged.get(note.id);
            if (!previous || note.updatedAt >= previous.updatedAt) merged.set(note.id, note);
        }
    }
    return [...merged.values()];
}

function writeFallbackCollection(notes) {
    try {
        localStorage.setItem(FALLBACK_KEY, JSON.stringify({ version: 1, notes }));
        localStorage.removeItem(LEGACY_KEY);
        return true;
    } catch {
        return false;
    }
}

function upsertFallback(note) {
    const notes = mergeNotes(readFallbackNotes().filter((item) => item.id !== note.id), [note]);
    return writeFallbackCollection(notes);
}

function clearRecovery(id, savedAt = Infinity) {
    try {
        const pending = parse(PENDING_KEY);
        if (pending && pending.id === id && Number(pending.updatedAt) <= savedAt) {
            localStorage.removeItem(PENDING_KEY);
        }
    } catch {
        /* storage disabled */
    }
}

function getAllFromDatabase(db) {
    return new Promise((resolve) => {
        let tx;
        try {
            tx = db.transaction(STORE, 'readonly');
        } catch {
            resolve([]);
            return;
        }
        const request = tx.objectStore(STORE).getAll();
        request.onsuccess = () => resolve((request.result || []).map(normaliseNote));
        request.onerror = () => resolve([]);
    });
}

function putIntoDatabase(db, notes) {
    return new Promise((resolve) => {
        let tx;
        try {
            tx = db.transaction(STORE, 'readwrite');
            for (const note of notes) tx.objectStore(STORE).put(note);
        } catch {
            resolve(false);
            return;
        }
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
    });
}

/** Load every note, merging any synchronous recovery/legacy records. */
export async function listNotes() {
    const fallback = readFallbackNotes();
    const db = await openDatabase();
    if (!db) return mergeNotes(fallback);

    const databaseNotes = await getAllFromDatabase(db);
    const merged = mergeNotes(databaseNotes, fallback);

    // Complete migration/recovery in the background store, then remove the
    // old local payload so large note collections remain in IndexedDB.
    if (fallback.length && await putIntoDatabase(db, merged)) {
        try {
            localStorage.removeItem(FALLBACK_KEY);
            localStorage.removeItem(LEGACY_KEY);
            localStorage.removeItem(PENDING_KEY);
        } catch { /* storage disabled */ }
    }
    return merged;
}

/** Create an in-memory note record. Call saveNote() to persist it. */
export function createNoteRecord({ title = '', html = '', pinned = false } = {}) {
    const now = Date.now();
    return normaliseNote({ id: newId(), title, html, pinned, createdAt: now, updatedAt: now });
}

/** Insert or update one complete note. */
export async function saveNote(record) {
    const note = normaliseNote(record);
    const db = await openDatabase();
    if (!db) {
        const ok = upsertFallback(note);
        if (ok) clearRecovery(note.id, note.updatedAt);
        return ok;
    }

    const ok = await putIntoDatabase(db, [note]);
    if (ok) clearRecovery(note.id, note.updatedAt);
    else upsertFallback(note);
    return ok || !!readFallbackNotes().find((item) => item.id === note.id);
}

/** Delete one note from every possible persistence path. */
export async function deleteNote(id) {
    const noteId = String(id);
    const fallback = readFallbackNotes().filter((note) => note.id !== noteId);
    writeFallbackCollection(fallback);
    try {
        const pending = parse(PENDING_KEY);
        if (pending && pending.id === noteId) localStorage.removeItem(PENDING_KEY);
    } catch { /* storage disabled */ }

    const db = await openDatabase();
    if (!db) return true;
    return new Promise((resolve) => {
        let tx;
        try {
            tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).delete(noteId);
        } catch {
            resolve(false);
            return;
        }
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
    });
}

/** Permanently delete all notes. */
export async function clearNotes() {
    try {
        localStorage.removeItem(FALLBACK_KEY);
        localStorage.removeItem(LEGACY_KEY);
        localStorage.removeItem(PENDING_KEY);
        localStorage.removeItem(ACTIVE_KEY);
    } catch { /* storage disabled */ }

    const db = await openDatabase();
    if (!db) return true;
    return new Promise((resolve) => {
        let tx;
        try {
            tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).clear();
        } catch {
            resolve(false);
            return;
        }
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
    });
}

/** Synchronous best-effort recovery write for pagehide. */
export function saveNoteSync(record) {
    try {
        localStorage.setItem(PENDING_KEY, JSON.stringify(normaliseNote(record)));
        return true;
    } catch {
        return false;
    }
}

export function getActiveNoteId() {
    try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; }
}

export function setActiveNoteId(id) {
    try {
        if (id) localStorage.setItem(ACTIVE_KEY, String(id));
        else localStorage.removeItem(ACTIVE_KEY);
    } catch { /* storage disabled */ }
}
