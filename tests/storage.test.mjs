/** Multi-note, tab-session, fallback, recovery, and legacy migration persistence. */

import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default async function run(check, group) {
    const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://npad.ir/' });
    const { window } = dom;
    global.window = window;
    global.localStorage = window.localStorage;
    global.indexedDB = undefined;

    const moduleUrl = pathToFileURL(path.join(ROOT, 'assets/js/storage.js')).href + `?t=${Date.now()}`;
    const storage = await import(moduleUrl);

    group('storage: legacy single-note migration');

    localStorage.setItem('npad:document', JSON.stringify({
        id: 'current',
        html: '<p>Existing note survives</p>',
        updatedAt: 100,
    }));
    const migrated = await storage.listNotes();

    check('old single document loads as the first note', () => {
        assert.equal(migrated.length, 1);
        assert.equal(migrated[0].id, 'current');
        assert.equal(migrated[0].html, '<p>Existing note survives</p>');
    });

    migrated[0].title = 'Migrated';
    migrated[0].updatedAt = 200;
    await storage.saveNote(migrated[0]);

    check('saving migration writes the collection and retires the old key', () => {
        const state = JSON.parse(localStorage.getItem('npad:notes'));
        assert.equal(state.notes[0].title, 'Migrated');
        assert.equal(localStorage.getItem('npad:document'), null);
    });

    group('storage: multiple notes');

    const second = storage.createNoteRecord({ title: 'Second', html: '<p>Two</p>' });
    await storage.saveNote(second);
    let notes = await storage.listNotes();

    check('separate records persist together', () => {
        assert.equal(notes.length, 2);
        assert.deepEqual(new Set(notes.map((note) => note.title)), new Set(['Migrated', 'Second']));
    });

    storage.setActiveNoteId(second.id);
    check('active note id persists independently', () => {
        assert.equal(storage.getActiveNoteId(), second.id);
    });

    storage.setOpenNoteIds([migrated[0].id, second.id, second.id]);
    check('open document tabs persist in order without duplicates', () => {
        assert.deepEqual(storage.getOpenNoteIds(), [migrated[0].id, second.id]);
    });

    const folder = storage.createFolderRecord('Work');
    const tag = storage.createTagRecord('Urgent', '#dc2626');
    await storage.saveOrganization({ folders: [folder], tags: [tag] });
    const savedOrganization = await storage.loadOrganization();

    check('folder and color-coded tag metadata persist', () => {
        assert.equal(savedOrganization.folders[0].name, 'Work');
        assert.equal(savedOrganization.tags[0].name, 'Urgent');
        assert.equal(savedOrganization.tags[0].color, '#dc2626');
    });

    second.folderId = folder.id;
    second.tags = [tag.id];
    second.updatedAt = Date.now();
    await storage.saveNote(second);
    notes = await storage.listNotes();
    check('notes retain folder and tag relationships', () => {
        const categorized = notes.find((note) => note.id === second.id);
        assert.equal(categorized.folderId, folder.id);
        assert.deepEqual(categorized.tags, [tag.id]);
    });

    const recovered = { ...second, html: '<p>Recovered at pagehide</p>', updatedAt: Date.now() + 1000 };
    storage.saveNoteSync(recovered);
    notes = await storage.listNotes();

    check('newer synchronous recovery wins over an older stored copy', () => {
        assert.equal(notes.find((note) => note.id === second.id).html, recovered.html);
    });

    await storage.deleteNote(second.id);
    notes = await storage.listNotes();
    check('deleting one note leaves all other notes intact', () => {
        assert.equal(notes.length, 1);
        assert.equal(notes[0].title, 'Migrated');
        assert.deepEqual(storage.getOpenNoteIds(), [migrated[0].id]);
    });

    await storage.clearNotes();
    notes = await storage.listNotes();
    check('clear removes notes and the active selection', () => {
        assert.equal(notes.length, 0);
        assert.equal(storage.getActiveNoteId(), null);
        assert.deepEqual(storage.getOpenNoteIds(), []);
    });

    dom.window.close();
}
