/**
 * Durable multi-note persistence.
 *
 * IndexedDB is the primary store. Browsers without IndexedDB use one compact
 * localStorage collection, while pagehide writes the active note to a small
 * synchronous recovery record. Timestamped backups use a dedicated IndexedDB
 * store with a bounded localStorage fallback. The ordered open-tab session is
 * tiny and stays beside the active note ID. Existing records migrate safely.
 */

const DB_NAME = 'npad';
const DB_VERSION = 7;
const STORE = 'documents';
const META_STORE = 'metadata';
const BACKUP_STORE = 'backups';
const RETIRED_ATTACHMENT_STORE = 'images';
const RETIRED_ATTACHMENT_KEY_PREFIX = 'npad:img:';
const IMAGE_ASSET_STORE = 'imageAssets';
const IMAGE_ASSET_KEY_PREFIX = 'npad:image-asset:';
const LEGACY_ID = 'current';
const LEGACY_KEY = 'npad:document';
const FALLBACK_KEY = 'npad:notes';
const PENDING_KEY = 'npad:pending-note';
const ACTIVE_KEY = 'npad:active-note';
const OPEN_TABS_KEY = 'npad:open-tabs';
const ORGANIZATION_KEY = 'npad:organization';
const BACKUP_KEY = 'npad:backups';
const ORGANIZATION_ID = 'organization';
const BACKUP_INTERVAL = 5 * 60 * 1000;
const MAX_BACKUPS_PER_NOTE = 30;
const MAX_BACKUPS_TOTAL = 120;

/** @type {Promise<IDBDatabase|null>|null} */
let connection = null;
let retiredAttachmentFallbackPurged = false;

/** Remove payloads written by the retired attachment feature. */
function purgeRetiredAttachmentFallback() {
    if (retiredAttachmentFallbackPurged) return;
    retiredAttachmentFallbackPurged = true;
    try {
        const keys = [];
        for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index);
            if (key?.startsWith(RETIRED_ATTACHMENT_KEY_PREFIX)) keys.push(key);
        }
        keys.forEach((key) => localStorage.removeItem(key));
    } catch { /* storage disabled */ }
}

function openDatabase() {
    purgeRetiredAttachmentFallback();
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
            if (!db.objectStoreNames.contains(META_STORE)) {
                db.createObjectStore(META_STORE, { keyPath: 'key' });
            }
            if (!db.objectStoreNames.contains(BACKUP_STORE)) {
                const backups = db.createObjectStore(BACKUP_STORE, { keyPath: 'id' });
                backups.createIndex('noteId', 'noteId', { unique: false });
                backups.createIndex('createdAt', 'createdAt', { unique: false });
            }
            // Version 6 intentionally retired the old image-payload store.
            if (db.objectStoreNames.contains(RETIRED_ATTACHMENT_STORE)) {
                db.deleteObjectStore(RETIRED_ATTACHMENT_STORE);
            }
            if (!db.objectStoreNames.contains(IMAGE_ASSET_STORE)) {
                const assets = db.createObjectStore(IMAGE_ASSET_STORE, { keyPath: 'id' });
                assets.createIndex('noteId', 'noteId', { unique: false });
                assets.createIndex('createdAt', 'createdAt', { unique: false });
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
        folderId: record.folderId ? String(record.folderId) : null,
        tags: [...new Set(Array.isArray(record.tags) ? record.tags.map(String).filter(Boolean) : [])],
        createdAt: Number(record.createdAt) || Number(record.updatedAt) || now,
        updatedAt: Number(record.updatedAt) || now,
    };
}

function normaliseBackup(record = {}) {
    const now = Date.now();
    const reasons = new Set(['automatic', 'deleted', 'cleared']);
    const validTime = (value) => {
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? number : now;
    };
    return {
        id: String(record.id || `backup-${newId()}`),
        noteId: String(record.noteId || record.id || newId()),
        title: String(record.title || ''),
        html: String(record.html ?? record.content ?? ''),
        pinned: !!record.pinned,
        folderId: record.folderId ? String(record.folderId) : null,
        tags: [...new Set(Array.isArray(record.tags) ? record.tags.map(String).filter(Boolean) : [])],
        noteCreatedAt: validTime(record.noteCreatedAt ?? record.createdAt),
        sourceUpdatedAt: validTime(record.sourceUpdatedAt ?? record.updatedAt),
        createdAt: validTime(record.backedUpAt ?? record.createdAt),
        reason: reasons.has(record.reason) ? record.reason : 'automatic',
    };
}

function normaliseColour(value) {
    return /^#[\da-f]{6}$/i.test(String(value || '')) ? String(value).toLowerCase() : '#0e7490';
}


function normaliseImageAsset(record = {}) {
    const now = Date.now();
    const candidate = record.blob;
    const tag = candidate ? Object.prototype.toString.call(candidate) : '';
    const isBlob = tag === '[object Blob]' || tag === '[object File]';
    return {
        id: String(record.id || ''),
        noteId: String(record.noteId || ''),
        type: String(record.type || '').toLowerCase(),
        size: Number(record.size) || 0,
        name: String(record.name || '').slice(0, 240),
        width: Number.isInteger(Number(record.width)) ? Number(record.width) : 0,
        height: Number.isInteger(Number(record.height)) ? Number(record.height) : 0,
        createdAt: Number(record.createdAt) || now,
        blob: isBlob ? candidate : null,
        dataUrl: typeof record.dataUrl === 'string' ? record.dataUrl : '',
    };
}

function normaliseOrganization(record = {}) {
    const now = Date.now();
    const folders = Array.isArray(record.folders) ? record.folders : [];
    const tags = Array.isArray(record.tags) ? record.tags : [];
    return {
        key: ORGANIZATION_ID,
        folders: folders.map((folder) => ({
            id: String(folder.id || newId()),
            name: String(folder.name || '').trim(),
            createdAt: Number(folder.createdAt) || now,
            updatedAt: Number(folder.updatedAt) || now,
        })).filter((folder) => folder.name),
        tags: tags.map((tag) => ({
            id: String(tag.id || newId()),
            name: String(tag.name || '').trim(),
            color: normaliseColour(tag.color),
            createdAt: Number(tag.createdAt) || now,
            updatedAt: Number(tag.updatedAt) || now,
        })).filter((tag) => tag.name),
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

function readFallbackBackups() {
    const stored = parse(BACKUP_KEY);
    const backups = Array.isArray(stored) ? stored : stored?.backups;
    return (Array.isArray(backups) ? backups : [])
        .map(normaliseBackup)
        .sort((a, b) => b.createdAt - a.createdAt);
}

function mergeBackups(...collections) {
    const merged = new Map();
    for (const collection of collections) {
        for (const raw of collection || []) {
            const backup = normaliseBackup(raw);
            const previous = merged.get(backup.id);
            if (!previous || backup.createdAt >= previous.createdAt) merged.set(backup.id, backup);
        }
    }
    return [...merged.values()].sort((a, b) => b.createdAt - a.createdAt);
}

function pruneBackups(backups) {
    const counts = new Map();
    const kept = [];
    for (const backup of mergeBackups(backups)) {
        const count = counts.get(backup.noteId) || 0;
        if (kept.length >= MAX_BACKUPS_TOTAL || count >= MAX_BACKUPS_PER_NOTE) continue;
        kept.push(backup);
        counts.set(backup.noteId, count + 1);
    }
    return kept;
}

function writeFallbackBackups(backups) {
    const kept = pruneBackups(backups);
    while (kept.length) {
        try {
            localStorage.setItem(BACKUP_KEY, JSON.stringify({ version: 1, backups: kept }));
            return true;
        } catch {
            // Quota pressure: discard the oldest snapshot and try again.
            kept.pop();
        }
    }
    return false;
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

function getAllBackupsFromDatabase(db) {
    return new Promise((resolve) => {
        let tx;
        try {
            tx = db.transaction(BACKUP_STORE, 'readonly');
        } catch {
            resolve([]);
            return;
        }
        const request = tx.objectStore(BACKUP_STORE).getAll();
        request.onsuccess = () => resolve((request.result || []).map(normaliseBackup));
        request.onerror = () => resolve([]);
    });
}

function putBackupsIntoDatabase(db, backups) {
    return new Promise((resolve) => {
        let tx;
        try {
            tx = db.transaction(BACKUP_STORE, 'readwrite');
            for (const backup of backups) tx.objectStore(BACKUP_STORE).put(backup);
        } catch {
            resolve(false);
            return;
        }
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
    });
}

function removeBackupsFromDatabase(db, ids = null) {
    return new Promise((resolve) => {
        let tx;
        try {
            tx = db.transaction(BACKUP_STORE, 'readwrite');
            const store = tx.objectStore(BACKUP_STORE);
            if (ids === null) store.clear();
            else for (const id of ids) store.delete(String(id));
        } catch {
            resolve(false);
            return;
        }
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
    });
}

function readMetadata(db, key) {
    return new Promise((resolve) => {
        let tx;
        try {
            tx = db.transaction(META_STORE, 'readonly');
        } catch {
            resolve(null);
            return;
        }
        const request = tx.objectStore(META_STORE).get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => resolve(null);
    });
}

function writeMetadata(db, record) {
    return new Promise((resolve) => {
        let tx;
        try {
            tx = db.transaction(META_STORE, 'readwrite');
            tx.objectStore(META_STORE).put(record);
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
export function createNoteRecord({
    title = '',
    html = '',
    pinned = false,
    folderId = null,
    tags = [],
    createdAt = null,
    updatedAt = null,
} = {}) {
    const now = Date.now();
    const validTime = (value, fallback) => {
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? number : fallback;
    };
    const importedUpdatedAt = validTime(updatedAt, now);
    const importedCreatedAt = validTime(createdAt, importedUpdatedAt);
    return normaliseNote({
        id: newId(),
        title,
        html,
        pinned,
        folderId,
        tags,
        createdAt: importedCreatedAt,
        updatedAt: importedUpdatedAt,
    });
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

/** List timestamped local snapshots, newest first. */
export async function listBackups() {
    const fallback = readFallbackBackups();
    const db = await openDatabase();
    if (!db) return pruneBackups(fallback);

    const stored = await getAllBackupsFromDatabase(db);
    const all = mergeBackups(stored, fallback);
    const merged = pruneBackups(all);
    const keptIds = new Set(merged.map((backup) => backup.id));
    const expiredIds = stored.filter((backup) => !keptIds.has(backup.id)).map((backup) => backup.id);
    if (expiredIds.length) await removeBackupsFromDatabase(db, expiredIds);
    if (fallback.length && await putBackupsIntoDatabase(db, merged)) {
        try { localStorage.removeItem(BACKUP_KEY); } catch { /* storage disabled */ }
    }
    return merged;
}

function backupMatchesNote(backup, note) {
    return backup.title === note.title
        && backup.html === note.html
        && backup.pinned === note.pinned
        && backup.folderId === note.folderId
        && backup.tags.length === note.tags.length
        && backup.tags.every((id, index) => id === note.tags[index]);
}

/** Save a throttled automatic snapshot, or force one before destructive work. */
export async function saveBackup(record, { reason = 'automatic', force = false } = {}) {
    const note = normaliseNote(record);
    const existing = await listBackups();
    const latest = existing.find((backup) => backup.noteId === note.id);
    const now = Date.now();

    if (latest && latest.reason === reason && backupMatchesNote(latest, note)) return latest;
    if (!force && latest && now - latest.createdAt < BACKUP_INTERVAL) return null;

    const backup = normaliseBackup({
        id: `backup-${newId()}`,
        noteId: note.id,
        title: note.title,
        html: note.html,
        pinned: note.pinned,
        folderId: note.folderId,
        tags: note.tags,
        noteCreatedAt: note.createdAt,
        sourceUpdatedAt: note.updatedAt,
        createdAt: now,
        reason,
    });
    const kept = pruneBackups([backup, ...existing]);
    const keptIds = new Set(kept.map((item) => item.id));
    const removedIds = existing.filter((item) => !keptIds.has(item.id)).map((item) => item.id);
    const db = await openDatabase();

    if (!db) return writeFallbackBackups(kept) ? backup : null;
    const saved = await putBackupsIntoDatabase(db, [backup]);
    if (saved && removedIds.length) await removeBackupsFromDatabase(db, removedIds);
    if (saved) return backup;
    return writeFallbackBackups(kept) ? backup : null;
}

/** Permanently delete one snapshot without touching its source note. */
export async function deleteBackup(id) {
    const backupId = String(id);
    const fallback = readFallbackBackups().filter((backup) => backup.id !== backupId);
    if (fallback.length) writeFallbackBackups(fallback);
    else {
        try { localStorage.removeItem(BACKUP_KEY); } catch { /* storage disabled */ }
    }
    const db = await openDatabase();
    return db ? removeBackupsFromDatabase(db, [backupId]) : true;
}

/** Permanently delete every local snapshot. */
export async function clearBackups() {
    try { localStorage.removeItem(BACKUP_KEY); } catch { /* storage disabled */ }
    const db = await openDatabase();
    return db ? removeBackupsFromDatabase(db, null) : true;
}

/* -------------------------------------------------------------------------
   Image assets.

   Image bytes live outside note HTML. IndexedDB stores a Blob directly;
   localStorage fallback stores a data URI only when IndexedDB is unavailable.
   ------------------------------------------------------------------------- */

function assetDataUrlToBlob(dataUrl) {
    const match = String(dataUrl || '').match(/^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i);
    if (!match) return null;
    try {
        const decode = globalThis.atob || globalThis.window?.atob;
        if (!decode) return null;
        const binary = decode(match[2].replace(/\s+/g, ''));
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        return new Blob([bytes], { type: match[1].toLowerCase() });
    } catch {
        return null;
    }
}

async function assetBlobToDataUrl(blob) {
    if (!blob) return '';
    if (typeof blob.arrayBuffer !== 'function') {
        const Reader = globalThis.FileReader || globalThis.window?.FileReader;
        if (!Reader) return '';
        return new Promise((resolve) => {
            const reader = new Reader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => resolve('');
            reader.readAsDataURL(blob);
        });
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    const encode = globalThis.btoa || globalThis.window?.btoa;
    return encode ? `data:${blob.type || 'application/octet-stream'};base64,${encode(binary)}` : '';
}

function readFallbackImageAsset(id) {
    try {
        const raw = localStorage.getItem(IMAGE_ASSET_KEY_PREFIX + id);
        return raw ? normaliseImageAsset(JSON.parse(raw)) : null;
    } catch {
        return null;
    }
}

function writeFallbackImageAsset(asset) {
    try {
        localStorage.setItem(IMAGE_ASSET_KEY_PREFIX + asset.id, JSON.stringify({
            ...asset,
            blob: null,
        }));
        return true;
    } catch {
        return false;
    }
}

function listFallbackImageAssets(noteId = null) {
    const assets = [];
    try {
        for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index);
            if (!key?.startsWith(IMAGE_ASSET_KEY_PREFIX)) continue;
            const asset = readFallbackImageAsset(key.slice(IMAGE_ASSET_KEY_PREFIX.length));
            if (asset && (!noteId || asset.noteId === String(noteId))) assets.push(asset);
        }
    } catch { /* storage disabled */ }
    return assets;
}

function removeFallbackImageAssets(ids) {
    try {
        for (const id of ids || []) localStorage.removeItem(IMAGE_ASSET_KEY_PREFIX + String(id));
    } catch { /* storage disabled */ }
}

function getImageAssetFromDatabase(db, id) {
    return new Promise((resolve) => {
        let tx;
        try {
            tx = db.transaction(IMAGE_ASSET_STORE, 'readonly');
        } catch {
            resolve(null);
            return;
        }
        const request = tx.objectStore(IMAGE_ASSET_STORE).get(String(id));
        request.onsuccess = () => resolve(request.result ? normaliseImageAsset(request.result) : null);
        request.onerror = () => resolve(null);
    });
}

function listImageAssetsFromDatabase(db, noteId = null) {
    return new Promise((resolve) => {
        let tx;
        try {
            tx = db.transaction(IMAGE_ASSET_STORE, 'readonly');
        } catch {
            resolve([]);
            return;
        }
        const store = tx.objectStore(IMAGE_ASSET_STORE);
        const request = noteId ? store.index('noteId').getAll(String(noteId)) : store.getAll();
        request.onsuccess = () => resolve((request.result || []).map(normaliseImageAsset));
        request.onerror = () => resolve([]);
    });
}

function putImageAssetsIntoDatabase(db, assets) {
    return new Promise((resolve) => {
        let tx;
        try {
            tx = db.transaction(IMAGE_ASSET_STORE, 'readwrite');
            const store = tx.objectStore(IMAGE_ASSET_STORE);
            for (const asset of assets) store.put(normaliseImageAsset(asset));
        } catch {
            resolve(false);
            return;
        }
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
    });
}

function removeImageAssetsFromDatabase(db, ids = null) {
    return new Promise((resolve) => {
        let tx;
        try {
            tx = db.transaction(IMAGE_ASSET_STORE, 'readwrite');
            const store = tx.objectStore(IMAGE_ASSET_STORE);
            if (ids === null) store.clear();
            else for (const id of ids) store.delete(String(id));
        } catch {
            resolve(false);
            return;
        }
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
    });
}

/** Store one validated local image asset. */
export async function saveImageAsset(record) {
    const asset = normaliseImageAsset(record);
    if (!asset.id || !asset.noteId || !asset.blob || !asset.type || !asset.size || !asset.width || !asset.height) {
        return false;
    }
    const db = await openDatabase();
    if (!db) {
        asset.dataUrl = asset.dataUrl || await assetBlobToDataUrl(asset.blob);
        return !!asset.dataUrl && writeFallbackImageAsset(asset);
    }
    const saved = await putImageAssetsIntoDatabase(db, [asset]);
    if (saved) return true;
    asset.dataUrl = asset.dataUrl || await assetBlobToDataUrl(asset.blob);
    return !!asset.dataUrl && writeFallbackImageAsset(asset);
}

/** Load one asset, including its intrinsic dimensions and Blob. */
export async function loadImageAsset(id) {
    const assetId = String(id || '');
    if (!assetId) return null;
    const db = await openDatabase();
    if (db) {
        const asset = await getImageAssetFromDatabase(db, assetId);
        if (asset) {
            asset.blob = asset.blob || assetDataUrlToBlob(asset.dataUrl);
            return asset.blob ? asset : null;
        }
    }
    const fallback = readFallbackImageAsset(assetId);
    if (!fallback) return null;
    fallback.blob = fallback.blob || assetDataUrlToBlob(fallback.dataUrl);
    return fallback.blob ? fallback : null;
}

/** List records owned by a note; used for garbage collection and copies. */
export async function listImageAssetsByNote(noteId) {
    const owner = String(noteId || '');
    const fallback = listFallbackImageAssets(owner);
    const db = await openDatabase();
    if (!db) return fallback;
    const stored = await listImageAssetsFromDatabase(db, owner);
    const merged = new Map();
    for (const asset of [...stored, ...fallback]) merged.set(asset.id, asset);
    return [...merged.values()];
}

export async function listAllImageAssets() {
    const fallback = listFallbackImageAssets();
    const db = await openDatabase();
    if (!db) return fallback;
    const stored = await listImageAssetsFromDatabase(db);
    const merged = new Map();
    for (const asset of [...stored, ...fallback]) merged.set(asset.id, asset);
    return [...merged.values()];
}

export async function deleteImageAssets(ids) {
    const list = (Array.isArray(ids) ? ids : [ids]).map(String).filter(Boolean);
    removeFallbackImageAssets(list);
    const db = await openDatabase();
    return db ? removeImageAssetsFromDatabase(db, list) : true;
}

export async function deleteImageAssetsByNote(noteId) {
    const owner = String(noteId || '');
    const fallback = listFallbackImageAssets(owner);
    removeFallbackImageAssets(fallback.map((asset) => asset.id));
    const db = await openDatabase();
    if (!db) return true;
    const stored = await listImageAssetsFromDatabase(db, owner);
    return removeImageAssetsFromDatabase(db, stored.map((asset) => asset.id));
}

export async function clearImageAssets() {
    removeFallbackImageAssets(listFallbackImageAssets().map((asset) => asset.id));
    const db = await openDatabase();
    return db ? removeImageAssetsFromDatabase(db, null) : true;
}

/** Delete one note from every possible persistence path. */
export async function deleteNote(id) {
    const noteId = String(id);
    // Assets may still be referenced by a recovery snapshot. Editor-level
    // garbage collection removes them only after notes and backups agree.
    setOpenNoteIds(getOpenNoteIds().filter((openId) => openId !== noteId));
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
    // Recovery snapshots survive Clear all, so their assets must survive too.
    try {
        localStorage.removeItem(FALLBACK_KEY);
        localStorage.removeItem(LEGACY_KEY);
        localStorage.removeItem(PENDING_KEY);
        localStorage.removeItem(ACTIVE_KEY);
        localStorage.removeItem(OPEN_TABS_KEY);
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

/** Load folder and tag metadata. The tiny local copy is also a sync backup. */
export async function loadOrganization() {
    const fallbackRaw = parse(ORGANIZATION_KEY);
    const fallback = fallbackRaw ? normaliseOrganization(fallbackRaw) : null;
    const db = await openDatabase();
    if (!db) return fallback || normaliseOrganization({ updatedAt: 0 });

    const storedRaw = await readMetadata(db, ORGANIZATION_ID);
    const stored = storedRaw ? normaliseOrganization(storedRaw) : null;
    const organization = !stored || (fallback && fallback.updatedAt > stored.updatedAt)
        ? (fallback || stored)
        : stored;
    const result = organization || normaliseOrganization({ updatedAt: 0 });
    if (!stored || (fallback && fallback.updatedAt > stored.updatedAt)) {
        await writeMetadata(db, result);
    }
    return result;
}

export async function saveOrganization(record) {
    const organization = normaliseOrganization({ ...record, updatedAt: Date.now() });
    let fallbackOk = false;
    try {
        localStorage.setItem(ORGANIZATION_KEY, JSON.stringify(organization));
        fallbackOk = true;
    } catch { /* storage disabled */ }

    const db = await openDatabase();
    if (!db) return fallbackOk;
    return (await writeMetadata(db, organization)) || fallbackOk;
}

export function createFolderRecord(name) {
    const now = Date.now();
    return { id: newId(), name: String(name || '').trim(), createdAt: now, updatedAt: now };
}

export function createTagRecord(name, color) {
    const now = Date.now();
    return {
        id: newId(),
        name: String(name || '').trim(),
        color: normaliseColour(color),
        createdAt: now,
        updatedAt: now,
    };
}

export function getOpenNoteIds() {
    const stored = parse(OPEN_TABS_KEY);
    if (!Array.isArray(stored)) return [];
    return [...new Set(stored.map(String).filter(Boolean))];
}

export function setOpenNoteIds(ids) {
    try {
        const unique = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter(Boolean))];
        localStorage.setItem(OPEN_TABS_KEY, JSON.stringify(unique));
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
