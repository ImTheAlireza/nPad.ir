/**
 * Boots the real rendered page in jsdom, loads the actual ES modules, and
 * drives the UI. Syntax checks prove the files parse; this proves they work.
 */

import { PHP } from '@php-wasm/universal';
import { loadNodeRuntime } from '@php-wasm/node';
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function renderIndex() {
    const rt = await loadNodeRuntime("8.2", { emscriptenOptions: { processId: 1 } });
    const php = new PHP(rt);
    (function mirror(host, vfs) {
        php.mkdir(vfs);
        for (const e of fs.readdirSync(host, { withFileTypes: true })) {
            if (['.git', 'node_modules', 'tests'].includes(e.name)) continue;
            const h = path.join(host, e.name);
            const v = `${vfs}/${e.name}`;
            if (e.isDirectory()) mirror(h, v);
            else php.writeFile(v, fs.readFileSync(h));
        }
    })(ROOT, '/site');

    const r = await php.run({
        scriptPath: '/site/index.php',
        $_SERVER: { REQUEST_METHOD: 'GET', REQUEST_URI: '/', HTTP_HOST: 'npad.ir', HTTPS: 'on' },
    });
    return r.text;
}

/** Minimal IndexedDB stub: storage.js must fall back to localStorage. */
function installEnvironment(dom) {
    const { window } = dom;
    window.indexedDB = undefined;
    window.matchMedia = window.matchMedia || ((q) => ({
        matches: false, media: q, addEventListener() {}, removeEventListener() {},
        addListener() {}, removeListener() {},
    }));
    if (!window.HTMLDialogElement.prototype.showModal) {
        window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
        window.HTMLDialogElement.prototype.close = function () {
            this.open = false;
            this.dispatchEvent(new window.Event('close'));
        };
    }
    window.navigator.sendBeacon = () => true;
    document.execCommand = document.execCommand || (() => true);
}

export default async function run(check, group) {
    const html = await renderIndex();

    const virtualConsole = new VirtualConsole();
    const consoleErrors = [];
    virtualConsole.on('jsdomError', (e) => consoleErrors.push(e.message));
    virtualConsole.on('error', (m) => consoleErrors.push(String(m)));
    const dom = new JSDOM(html, {
        url: 'https://npad.ir/',
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        virtualConsole,
    });

    const { window } = dom;
    global.window = window;
    global.document = window.document;
    global.HTMLElement = window.HTMLElement;
    global.Node = window.Node;
    global.Event = window.Event;
    global.localStorage = window.localStorage;
    global.indexedDB = undefined;

    // Node 22 exposes globalThis.navigator as a getter-only property.
    Object.defineProperty(global, 'navigator', {
        value: window.navigator,
        configurable: true,
        writable: true,
    });

    installEnvironment(dom);
    const { document } = window;

    group('behaviour: pre-paint theme script');

    check('inline theme script executed without error', () => {
        assert.equal(consoleErrors.length, 0, consoleErrors[0]);
    });

    group('behaviour: module wiring');

    // Import the real modules against the real DOM.
    const url = (p) => pathToFileURL(path.join(ROOT, p)).href + `?t=${Date.now()}`;
    const { initMenus, showDialog, toast } = await import(url('assets/js/ui.js'));
    const { initTheme, currentTheme } = await import(url('assets/js/theme.js'));
    const { initEditor } = await import(url('assets/js/editor.js'));
    const { sanitizeHtml } = await import(url('assets/js/sanitize.js'));

    check('modules import cleanly', () => {
        assert.equal(typeof initMenus, 'function');
        assert.equal(typeof initTheme, 'function');
        assert.equal(typeof initEditor, 'function');
    });

    const strings = JSON.parse(document.getElementById('i18n').textContent);
    const tracked = [];

    check('initMenus / initTheme / initEditor run without throwing', () => {
        initMenus();
        initTheme({ onChange: (e) => tracked.push(e) });
        initEditor({ strings, onEvent: (e) => tracked.push(e) });
    });

    // Multi-note storage boots asynchronously. Let the initial note finish
    // loading before UI tests begin editing it.
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    group('behaviour: menus (the old build was hover-only)');

    const trigger = document.getElementById('fileMenuTrigger');
    const panel = document.getElementById('fileMenuPanel');

    check('menu opens on click', () => {
        trigger.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.equal(panel.dataset.open, 'true', 'panel did not open');
        assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    });

    check('menu closes on Escape', () => {
        document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        assert.equal(panel.dataset.open, 'false', 'panel did not close');
        assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    });

    check('menu closes on outside click', () => {
        trigger.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.equal(panel.dataset.open, 'true');
        document.body.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.equal(panel.dataset.open, 'false', 'outside click did not close');
    });

    check('ArrowDown from trigger opens and focuses first item', () => {
        trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        assert.equal(panel.dataset.open, 'true');
        const first = panel.querySelector('.menu__item');
        assert.equal(document.activeElement, first, 'focus not moved into menu');
        document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    const subTrigger = document.getElementById('fileMenuExportTrigger');
    const subPanel = document.getElementById('fileMenuExportPanel');

    check('all export formats live in the Export-as flyout, none at top level', () => {
        assert.ok(subTrigger && subPanel, 'flyout markup missing');
        const flyoutActions = [...subPanel.querySelectorAll('[data-action]')].map((b) => b.dataset.action);
        assert.deepEqual(flyoutActions, [
            'save', 'save-html', 'save-markdown', 'save-json', 'save-docx', 'save-pdf', 'save-rtf',
        ]);
        const topActions = [...panel.querySelectorAll(':scope > button[data-action]')].map((b) => b.dataset.action);
        assert.deepEqual(topActions, ['new', 'open', 'print', 'details', 'backups', 'clear'],
            'exports still exposed at the top level');
        assert.equal(subTrigger.getAttribute('aria-haspopup'), 'menu');
        // The renderer marks panels that contain a flyout so CSS can stop
        // the parent from clipping/scrolling the submenu (layout containment).
        assert.ok(panel.classList.contains('menu__panel--has-submenu'),
            'parent panel missing the has-submenu containment class');
    });

    check('flyout opens on click and keeps the parent menu open', () => {
        trigger.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        subTrigger.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.equal(subPanel.dataset.open, 'true', 'flyout did not open');
        assert.equal(subTrigger.getAttribute('aria-expanded'), 'true');
        assert.equal(panel.dataset.open, 'true', 'parent menu closed unexpectedly');
    });

    check('Escape closes the flyout first, then the menu', () => {
        subTrigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        assert.equal(subPanel.dataset.open, 'false', 'flyout did not close');
        assert.equal(panel.dataset.open, 'true', 'menu should survive the first Escape');
        assert.equal(document.activeElement, subTrigger, 'focus not returned to the flyout trigger');
        subTrigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        assert.equal(panel.dataset.open, 'false', 'second Escape did not close the menu');
    });

    check('ArrowRight opens the flyout; ArrowLeft returns to the trigger', () => {
        trigger.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        subTrigger.focus();
        subTrigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        assert.equal(subPanel.dataset.open, 'true', 'ArrowRight did not open the flyout');
        const firstItem = subPanel.querySelector('[data-action]');
        assert.equal(document.activeElement, firstItem, 'focus not moved into the flyout');
        firstItem.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        assert.equal(subPanel.dataset.open, 'false', 'ArrowLeft did not close the flyout');
        assert.equal(document.activeElement, subTrigger, 'focus not returned to the trigger');
        document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    check('activating a flyout export closes the whole menu and fires the action', () => {
        window.URL.createObjectURL = () => 'blob:mock';
        window.URL.revokeObjectURL = () => {};
        // jsdom tries (and fails loudly) to navigate on anchor clicks.
        const nativeAnchorClick = window.HTMLAnchorElement.prototype.click;
        window.HTMLAnchorElement.prototype.click = function () {
            if (String(this.href || '').startsWith('blob:')) return;
            nativeAnchorClick.call(this);
        };
        try {
            trigger.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
            subTrigger.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
            subPanel.querySelector('[data-action="save-html"]')
                .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
            assert.equal(panel.dataset.open, 'false', 'menu did not close after export');
            assert.equal(subPanel.dataset.open, 'false', 'flyout did not close after export');
            assert.ok(tracked.includes('download_html'), 'export action did not run');
        } finally {
            delete window.URL.createObjectURL;
            delete window.URL.revokeObjectURL;
            window.HTMLAnchorElement.prototype.click = nativeAnchorClick;
        }
    });

    let fileAccept = '';
    const nativeInputClick = window.HTMLInputElement.prototype.click;
    window.HTMLInputElement.prototype.click = function () {
        if (this.type === 'file') fileAccept = this.accept;
        else nativeInputClick.call(this);
    };
    document.querySelector('[data-action="open"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    window.HTMLInputElement.prototype.click = nativeInputClick;
    check('Open accepts every supported local document format', () => {
        ['.txt', '.html', '.md', '.json', '.docx', '.pdf', '.rtf'].forEach((extension) => {
            assert.ok(fileAccept.includes(extension), `${extension} missing from ${fileAccept}`);
        });
    });

    document.querySelector('[data-action="save-pdf"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    check('PDF export explains the browser Save as PDF flow', () => {
        const dialog = document.getElementById('appDialog');
        assert.equal(dialog.open, true);
        assert.ok(dialog.textContent.includes(strings.pdfExportBody));
        assert.ok(dialog.querySelector('[data-action="print-pdf"]'));
    });
    document.querySelector('#appDialog [data-action="cancel"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    group('behaviour: theme toggle');

    check('toggling flips data-theme and persists', () => {
        const before = currentTheme();
        document.querySelector('[data-theme-toggle]')
            .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        const after = currentTheme();
        assert.notEqual(before, after, 'theme did not change');
        assert.equal(window.localStorage.getItem('npad:theme'), after, 'not persisted');
    });

    check('toggle reports the change for analytics', () => {
        assert.ok(tracked.some((e) => e.startsWith('dark_mode_')), `tracked: ${tracked}`);
    });

    group('behaviour: custom formatting controls');

    const executedCommands = [];
    document.execCommand = (...args) => {
        executedCommands.push(args);
        return true;
    };

    check('font popup opens, filters the bilingual list and applies a font', () => {
        const trigger = document.getElementById('fontPickerTrigger');
        const popup = document.getElementById('fontPickerPopup');
        const search = document.getElementById('fontPickerSearch');

        trigger.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.equal(popup.hidden, false, 'font popup did not open');
        assert.equal(trigger.getAttribute('aria-expanded'), 'true');

        search.value = 'Nastaliq';
        search.dispatchEvent(new window.Event('input', { bubbles: true }));
        const visible = [...popup.querySelectorAll('[data-font-option]')].filter((el) => !el.hidden);
        assert.equal(visible.length, 1, `expected one result, got ${visible.length}`);
        assert.equal(visible[0].dataset.font, 'IranNastaliq');

        visible[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.equal(popup.hidden, true, 'font popup did not close after selection');
        assert.equal(trigger.dataset.currentFont, 'IranNastaliq');
        assert.ok(executedCommands.some(([command, , value]) =>
            command === 'fontName' && value.includes('IranNastaliq')));
    });

    check('manual font size accepts an arbitrary pixel value', () => {
        const input = document.querySelector('[data-font-size]');
        input.value = '27';
        input.dispatchEvent(new window.KeyboardEvent('keydown', {
            key: 'Enter', bubbles: true, cancelable: true,
        }));
        assert.ok(executedCommands.some(([command, , value]) =>
            command === 'fontSize' && value === '7'));
        assert.equal(input.value, '27');
    });

    check('custom colour modal applies a preset without a native colour input', async () => {
        const trigger = document.querySelector('[data-color-command="foreColor"]');
        trigger.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

        const dialog = document.getElementById('appDialog');
        assert.ok(dialog.open, 'colour dialog did not open');
        assert.ok(dialog.querySelector('.colour-picker__area'), 'custom colour area missing');
        assert.equal(dialog.querySelectorAll('input[type="color"]').length, 0);

        dialog.querySelector('[data-preset="#dc2626"]')
            .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        dialog.querySelector('[data-action="apply"]')
            .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        await new Promise((resolve) => window.setTimeout(resolve, 0));

        assert.equal(trigger.dataset.color, '#dc2626');
        assert.ok(executedCommands.some(([command, , value]) =>
            command === 'foreColor' && value === '#dc2626'));
    });

    group('behaviour: word count (was frozen inside a 3s debounce)');

    const editor = document.getElementById('editor');
    const counts = document.getElementById('statusCounts');

    check('count updates immediately on input', () => {
        editor.textContent = 'hello world foo';
        editor.dispatchEvent(new window.Event('input', { bubbles: true }));
        const text = counts.textContent;
        assert.ok(/3/.test(text), `expected 3 words, got: ${text}`);
    });

    check('count reflects further edits synchronously', () => {
        editor.textContent = 'one two three four five';
        editor.dispatchEvent(new window.Event('input', { bubbles: true }));
        assert.ok(/5/.test(counts.textContent), counts.textContent);
    });

    check('empty editor reports zero', () => {
        editor.textContent = '';
        editor.dispatchEvent(new window.Event('input', { bubbles: true }));
        assert.ok(/\b0\b/.test(counts.textContent), counts.textContent);
    });

    group('behaviour: multiple notes');

    const notesList = document.getElementById('notesList');
    const notesSearch = document.getElementById('notesSearch');
    const noteTitle = document.getElementById('noteTitle');
    const noteItems = () => [...notesList.querySelectorAll('.note-item')];
    const noteByTitle = (title) => noteItems().find((item) =>
        item.querySelector('.note-item__title').textContent === title);
    const documentTabs = document.getElementById('documentTabs');
    const tabItems = () => [...documentTabs.querySelectorAll('.document-tab')];
    const tabByTitle = (title) => tabItems().find((tab) =>
        tab.querySelector('.document-tab__title').textContent === title);
    const settle = () => new Promise((resolve) => window.setTimeout(resolve, 20));

    check('responsive sidebar exposes named create, search and note controls', () => {
        assert.ok(document.getElementById('notesSidebar'), 'notes sidebar missing');
        assert.ok(notesSearch.getAttribute('placeholder'), 'notes search has no placeholder');
        assert.ok(document.querySelector('[data-action="new"]'), 'new-note control missing');
        assert.equal(noteItems().length, 1, 'initial note was not created');
    });

    noteTitle.value = 'Original';
    noteTitle.dispatchEvent(new window.Event('input', { bubbles: true }));
    editor.textContent = 'Original note body';
    editor.dispatchEvent(new window.Event('input', { bubbles: true }));
    document.querySelector('.notes-sidebar [data-action="new"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();

    check('New creates and selects a separate note without clearing the first', () => {
        assert.equal(noteItems().length, 2);
        assert.equal(noteTitle.value, strings.noteUntitled);
        assert.equal(noteItems().filter((item) => item.classList.contains('note-item--active')).length, 1);
    });

    noteTitle.value = 'Project';
    noteTitle.dispatchEvent(new window.Event('input', { bubbles: true }));
    editor.textContent = 'Project draft';
    editor.dispatchEvent(new window.Event('input', { bubbles: true }));
    noteByTitle('Project').querySelector('[data-note-action="duplicate"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();

    check('duplicate copies content and activates the copy', () => {
        assert.equal(noteItems().length, 3);
        assert.equal(noteTitle.value, `Project ${strings.noteCopySuffix}`);
        assert.equal(editor.textContent, 'Project draft');
    });

    const copyTitle = noteTitle.value;
    noteByTitle(copyTitle).querySelector('[data-note-action="pin"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();

    check('pin toggles state and sorts the pinned note first', () => {
        const first = noteItems()[0];
        assert.equal(first.querySelector('.note-item__title').textContent, copyTitle);
        assert.equal(first.querySelector('[data-note-action="pin"]').getAttribute('aria-pressed'), 'true');
    });

    notesSearch.value = 'Original';
    notesSearch.dispatchEvent(new window.Event('input', { bubbles: true }));
    check('sidebar search filters by title and note content', () => {
        assert.equal(noteItems().length, 1);
        assert.equal(noteItems()[0].querySelector('.note-item__title').textContent, 'Original');
    });
    notesSearch.value = '';
    notesSearch.dispatchEvent(new window.Event('input', { bubbles: true }));

    noteByTitle('Original').querySelector('[data-note-action="open"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();
    check('switching notes restores the saved title and content', () => {
        assert.equal(noteTitle.value, 'Original');
        assert.equal(editor.textContent, 'Original note body');
    });

    noteByTitle('Original').querySelector('[data-note-action="rename"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();
    const renameInput = document.getElementById('renameNoteInput');
    renameInput.value = 'Renamed original';
    document.querySelector('#appDialog [data-action="rename"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();
    check('rename updates both the title field and sidebar', () => {
        assert.equal(noteTitle.value, 'Renamed original');
        assert.ok(noteByTitle('Renamed original'));
    });

    const project = noteByTitle('Project');
    project.querySelector('[data-note-action="delete"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();
    document.querySelector('#appDialog [data-action="confirm"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();
    check('delete removes only the chosen note', () => {
        assert.equal(noteItems().length, 2);
        assert.ok(!noteByTitle('Project'));
        assert.ok(noteByTitle('Renamed original'));
        assert.ok(noteByTitle(copyTitle));
    });

    group('behaviour: document tabs');

    check('opened notes stay available as document tabs', () => {
        assert.equal(tabItems().length, 2);
        assert.ok(tabByTitle('Renamed original'));
        assert.ok(tabByTitle(copyTitle));
        assert.equal(tabByTitle('Renamed original').classList.contains('document-tab--active'), true);
    });

    tabByTitle(copyTitle).querySelector('[data-tab-action="open"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();
    check('tabs switch documents without opening the notes sidebar', () => {
        assert.equal(noteTitle.value, copyTitle);
        assert.equal(editor.textContent, 'Project draft');
        assert.equal(document.getElementById('notesWorkspace').dataset.notesOpen, 'false');
        assert.equal(tabByTitle(copyTitle).querySelector('[role="tab"]').getAttribute('aria-selected'), 'true');
    });

    tabByTitle(copyTitle).querySelector('[data-tab-action="open"]')
        .dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await settle();
    check('arrow keys move between tabs and preserve tab focus', () => {
        assert.equal(noteTitle.value, 'Renamed original');
        const activeTab = tabByTitle('Renamed original').querySelector('[role="tab"]');
        assert.equal(activeTab.getAttribute('aria-selected'), 'true');
        assert.equal(document.activeElement, activeTab);
    });

    tabByTitle(copyTitle).querySelector('[data-tab-action="open"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();
    tabByTitle(copyTitle).querySelector('[data-tab-action="close"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();
    check('closing the active tab selects its neighbour without deleting the note', () => {
        assert.equal(tabItems().length, 1);
        assert.equal(noteTitle.value, 'Renamed original');
        assert.ok(noteByTitle(copyTitle), 'closing a tab deleted its note');
        assert.equal(JSON.parse(localStorage.getItem('npad:open-tabs')).length, 1);
    });

    noteByTitle(copyTitle).querySelector('[data-note-action="open"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();
    check('a closed tab reopens from the note list', () => {
        assert.equal(tabItems().length, 2);
        assert.equal(noteTitle.value, copyTitle);
        assert.equal(tabByTitle(copyTitle).classList.contains('document-tab--active'), true);
    });

    tabByTitle('Renamed original').querySelector('[data-tab-action="open"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();

    group('behaviour: folders and tags');

    document.querySelector('[data-action="manage-note-tags"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();
    check('an empty tag manager offers OK instead of an inapplicable Apply action', () => {
        const buttons = [...document.querySelectorAll('#appDialog .dialog__footer button')];
        assert.equal(buttons.length, 1);
        assert.equal(buttons[0].textContent, strings.ok);
        assert.equal(buttons[0].dataset.action, 'ok');
    });
    document.querySelector('#appDialog [data-action="ok"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();

    document.querySelector('[data-organization-action="add-folder"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();
    document.getElementById('folderNameInput').value = 'Work';
    document.querySelector('#appDialog [data-action="save-folder"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();

    check('folders can be created and appear in the note folder picker', () => {
        const folderRow = document.querySelector('#foldersList .organization-row');
        assert.equal(folderRow.querySelector('.organization-filter__name').textContent, 'Work');
        assert.ok([...document.querySelectorAll('#noteFolderOptions [role="option"]')]
            .some((option) => option.textContent.includes('Work')));
    });

    const folderPicker = document.getElementById('noteFolder');
    folderPicker.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    check('the custom folder picker opens an accessible styled menu', () => {
        assert.equal(folderPicker.getAttribute('aria-expanded'), 'true');
        assert.equal(document.getElementById('noteFolderMenu').hidden, false);
        assert.equal(document.getElementById('noteFolderOptions').getAttribute('role'), 'listbox');
    });
    [...document.querySelectorAll('#noteFolderOptions [role="option"]')]
        .find((option) => option.textContent.includes('Work'))
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    check('the active note can be assigned to a folder', () => {
        assert.equal(noteByTitle('Renamed original').querySelector('.note-item__folder').textContent, 'Work');
        assert.equal(document.querySelector('#foldersList .organization-filter__count').textContent, '1');
    });

    document.querySelector('#foldersList [data-organization-action="rename-folder"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();
    document.getElementById('folderNameInput').value = 'Projects';
    document.querySelector('#appDialog [data-action="save-folder"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();
    check('folders can be renamed without losing their notes', () => {
        assert.equal(document.querySelector('#foldersList .organization-filter__name').textContent, 'Projects');
        assert.equal(document.getElementById('noteFolderValue').textContent, 'Projects');
    });

    document.querySelector('[data-organization-action="add-tag"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();
    document.getElementById('tagNameInput').value = 'Important';
    document.querySelector('[data-tag-color="#dc2626"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    document.querySelector('#appDialog [data-action="save-tag"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();

    check('color-coded tags can be created', () => {
        const tagFilter = document.querySelector('#tagsList [data-filter-type="tag"]');
        assert.equal(tagFilter.querySelector('.organization-filter__name').textContent, 'Important');
        assert.equal(tagFilter.style.getPropertyValue('--tag-color'), '#dc2626');
    });

    document.querySelector('#tagsList [data-organization-action="edit-tag"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();
    document.getElementById('tagNameInput').value = 'Priority';
    document.querySelector('[data-tag-color="#7c3aed"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    document.querySelector('#appDialog [data-action="save-tag"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();
    check('tags can be renamed and recolored', () => {
        const tagFilter = document.querySelector('#tagsList [data-filter-type="tag"]');
        assert.equal(tagFilter.querySelector('.organization-filter__name').textContent, 'Priority');
        assert.equal(tagFilter.style.getPropertyValue('--tag-color'), '#7c3aed');
    });

    document.querySelector('[data-action="manage-note-tags"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();
    const tagCheckbox = document.querySelector('#tagChecklist input');
    tagCheckbox.checked = true;
    document.querySelector('#appDialog [data-action="apply-tags"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();

    check('tags can be assigned and are shown on the note card and document', () => {
        assert.equal(document.querySelector('#currentNoteTags .tag-chip').textContent, 'Priority');
        assert.equal(noteByTitle('Renamed original').querySelector('.tag-chip').textContent, 'Priority');
        assert.equal(document.querySelector('#tagsList .organization-filter__count').textContent, '1');
    });

    document.querySelector('#foldersList [data-filter-type="folder"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    check('folder filters show only notes in that folder', () => {
        assert.equal(noteItems().length, 1);
        assert.equal(noteItems()[0].querySelector('.note-item__title').textContent, 'Renamed original');
    });
    document.querySelector('[data-filter-type="all"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    document.querySelector('#tagsList [data-filter-type="tag"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    check('tag filters show only notes with that tag', () => {
        assert.equal(noteItems().length, 1);
        assert.equal(noteItems()[0].querySelector('.note-item__title').textContent, 'Renamed original');
    });
    document.querySelector('[data-filter-type="all"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    document.querySelector('#foldersList [data-organization-action="delete-folder"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();
    document.querySelector('#appDialog [data-action="confirm"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();
    check('deleting a folder moves its notes to Unfiled', () => {
        assert.equal(document.querySelectorAll('#foldersList .organization-row').length, 0);
        assert.equal(folderPicker.dataset.folderId, '');
        assert.equal(document.getElementById('noteFolderValue').textContent, strings.noFolder);
        assert.ok(noteByTitle('Renamed original'));
    });

    document.querySelector('#tagsList [data-organization-action="delete-tag"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();
    document.querySelector('#appDialog [data-action="confirm"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();
    check('deleting a tag removes it from notes without deleting notes', () => {
        assert.equal(document.querySelectorAll('#tagsList .organization-row').length, 0);
        assert.equal(document.querySelectorAll('#currentNoteTags .tag-chip').length, 0);
        assert.ok(noteByTitle('Renamed original'));
    });

    group('behaviour: automatic backups and recovery');

    document.querySelector('[data-action="backups"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();
    let deletedProjectBackup;
    check('the recovery screen lists timestamped automatic and deletion backups', () => {
        const dialog = document.getElementById('backupDialog');
        const items = [...dialog.querySelectorAll('.backup-item')];
        deletedProjectBackup = items.find((item) =>
            item.querySelector('.backup-item__title').textContent === 'Project'
            && item.querySelector('.backup-item__reason').textContent === strings.backupDeleted);
        assert.equal(dialog.open, true);
        assert.ok(items.length >= 2, `expected backups, got ${items.length}`);
        assert.ok(deletedProjectBackup, 'deleted Project snapshot missing');
        assert.ok(deletedProjectBackup.querySelector('time').dateTime);
        assert.equal(deletedProjectBackup.querySelector('.backup-item__missing').textContent, strings.backupMissing);
    });

    deletedProjectBackup.querySelector('[data-backup-action="restore"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();
    const restoredTitle = `Project ${strings.backupRestoredSuffix}`;
    check('restoring a backup creates a separate active note', () => {
        assert.equal(document.getElementById('backupDialog').open, false);
        assert.equal(noteTitle.value, restoredTitle);
        assert.equal(editor.textContent, 'Project draft');
        assert.ok(noteByTitle(restoredTitle));
        assert.ok(noteByTitle('Renamed original'), 'restore overwrote another note');
        assert.equal(tabByTitle(restoredTitle).classList.contains('document-tab--active'), true);
    });

    document.querySelector('[data-action="backups"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();
    const backupsBeforeDelete = document.querySelectorAll('#backupList .backup-item').length;
    const backupToDelete = [...document.querySelectorAll('#backupList .backup-item')]
        .find((item) => item.querySelector('.backup-item__reason').textContent === strings.backupDeleted);
    const deletedBackupId = backupToDelete.dataset.backupId;
    backupToDelete.querySelector('[data-backup-action="delete"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();
    document.querySelector('#appDialog [data-action="confirm"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();
    check('recovery snapshots can be permanently removed without deleting notes', () => {
        assert.equal(document.getElementById('backupDialog').open, true);
        assert.equal(document.querySelectorAll('#backupList .backup-item').length, backupsBeforeDelete - 1);
        assert.equal(document.querySelector(`[data-backup-id="${deletedBackupId}"]`), null);
        assert.ok(noteByTitle(restoredTitle));
    });
    document.querySelector('#backupDialog [data-backup-action="close"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();

    group('behaviour: tables (Insert menu, dialog, contextual toolbar)');

    const tablePaneBase = document.getElementById('toolbarPaneBase');
    const tablePaneTable = document.getElementById('toolbarPaneTable');
    const tableContextMenu = document.getElementById('tableContextMenu');
    const insertMenuTrigger = document.getElementById('insertMenuTrigger');
    const insertMenuPanel = document.getElementById('insertMenuPanel');
    const clickMenu = (action) => {
        insertMenuTrigger.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        insertMenuPanel.querySelector(`[data-action="${action}"]`)
            .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    };
    const clickTool = (action) => {
        tablePaneTable.querySelector(`[data-table-action="${action}"]`)
            .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    };
    const putCaretInCell = (node, atEnd = false) => {
        const range = document.createRange();
        if (atEnd) {
            range.selectNodeContents(node);
            range.collapse(false);
        } else {
            range.setStart(node, 0);
            range.collapse(true);
        }
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    };

    check('Insert menu opens next to Edit and reveals the table item', () => {
        insertMenuTrigger.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.equal(insertMenuPanel.dataset.open, 'true', 'Insert menu did not open');
        assert.ok(insertMenuPanel.querySelector('[data-action="insert-table"]'), 'table item missing');
        assert.ok(insertMenuPanel.querySelector('[data-action="insert-hr"]'), 'hr item missing');
        document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    check('table dialog opens with presets, steppers and a live preview', () => {
        editor.innerHTML = '<p>before</p><p><br></p>';
        putCaretInCell(editor.querySelector('p:last-child'));
        clickMenu('insert-table');

        const dialog = document.getElementById('appDialog');
        assert.equal(dialog.open, true, 'table dialog did not open');
        assert.ok(dialog.querySelector('[data-table-rows]'), 'rows stepper missing');
        assert.ok(dialog.querySelector('[data-table-cols]'), 'columns stepper missing');
        assert.ok(dialog.querySelector('[data-table-preset="header"]'), 'presets missing');
        assert.ok(dialog.querySelector('[data-table-preview] table'), 'live preview missing');
        dialog.close();
    });

    // The full click-insert flow (dialog -> settings -> table in the editor)
    // is covered by tests/tables-ui.test.mjs, which awaits the asynchronous
    // dialog continuations. Here we place the caret and drive the toolbar,
    // which is fully synchronous once the table exists in the editor.
    check('caret inside a table swaps the toolbar to table tools', () => {
        editor.innerHTML = '<p>before</p>'
            + '<table><thead><tr><th scope="col">A</th><th scope="col">B</th></tr></thead>'
            + '<tbody><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></tbody></table>'
            + '<p><br></p>';
        const table = editor.querySelector('table');
        putCaretInCell(table.tBodies[0].rows[1].cells[0], true);
        document.dispatchEvent(new window.Event('selectionchange'));

        assert.equal(tablePaneBase.hidden, true, 'base toolbar still visible inside a table');
        assert.equal(tablePaneTable.hidden, false, 'table toolbar not shown');
        const headerRowBtn = tablePaneTable.querySelector('[data-table-action="header-row"]');
        const headerColBtn = tablePaneTable.querySelector('[data-table-action="header-col"]');
        assert.equal(headerRowBtn.getAttribute('aria-pressed'), 'true', 'header row state not reflected');
        assert.equal(headerColBtn.getAttribute('aria-pressed'), 'false');
    });

    check('text selected inside one cell returns to the default toolbar', () => {
        const table = editor.querySelector('table');
        const cell = table.tBodies[0].rows[0].cells[0];
        cell.textContent = 'highlight me';
        putCaretInCell(cell, true);
        document.dispatchEvent(new window.Event('selectionchange'));
        assert.equal(tablePaneTable.hidden, false, 'collapsed caret should show table tools');

        // Select a word inside the cell: text formatting needs the base toolbar.
        const textNode = cell.firstChild;
        const range = document.createRange();
        range.setStart(textNode, 0);
        range.setEnd(textNode, 4);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new window.Event('selectionchange'));

        assert.equal(tablePaneTable.hidden, true, 'text selection kept the table toolbar');
        assert.equal(tablePaneBase.hidden, false, 'default toolbar not restored for text selection');

        // Selection spanning two cells is a table operation again.
        const other = table.tBodies[0].rows[0].cells[1];
        const range2 = document.createRange();
        range2.setStart(textNode, 0);
        range2.setEnd(other, 0);
        selection.removeAllRanges();
        selection.addRange(range2);
        document.dispatchEvent(new window.Event('selectionchange'));
        assert.equal(tablePaneTable.hidden, false, 'multi-cell selection should show table tools');

        // Reset to a collapsed caret for the following checks.
        putCaretInCell(cell, true);
        document.dispatchEvent(new window.Event('selectionchange'));
    });

    check('table toolbar exposes the common cell options', () => {
        const actions = [
            'merge', 'split', 'clear-cells', 'select-table',
            'v-align-top', 'v-align-middle', 'v-align-bottom',
            'cell-dir-ltr', 'cell-dir-rtl', 'cell-colour',
        ];
        actions.forEach((action) => {
            assert.ok(tablePaneTable.querySelector(`[data-table-action="${action}"]`),
                `${action} missing from the table toolbar`);
        });
        const morePanel = document.getElementById('tableMorePanel');
        assert.ok(morePanel.querySelector('[data-table-action="sort-asc"]'), 'sort ascending missing');
        assert.ok(morePanel.querySelector('[data-table-action="sort-desc"]'), 'sort descending missing');
    });

    check('merge and split affordances follow the selection', () => {
        const table = editor.querySelector('table');
        putCaretInCell(table.tBodies[0].rows[0].cells[0], true);
        document.dispatchEvent(new window.Event('selectionchange'));
        const mergeBtn = tablePaneTable.querySelector('[data-table-action="merge"]');
        const splitBtn = tablePaneTable.querySelector('[data-table-action="split"]');
        assert.equal(mergeBtn.disabled, true, 'merge should be disabled for a collapsed caret');
        assert.equal(splitBtn.disabled, true, 'split should be disabled for a plain cell');

        const first = table.tBodies[0].rows[0].cells[0];
        const second = table.tBodies[0].rows[0].cells[1];
        const range = document.createRange();
        range.setStart(first, 0);
        range.setEnd(second, 0);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new window.Event('selectionchange'));
        assert.equal(mergeBtn.disabled, false, 'merge should be enabled for a multi-cell selection');

        putCaretInCell(first, true);
        document.dispatchEvent(new window.Event('selectionchange'));
    });

    check('row and column controls mutate a real table grid', () => {
        const table = editor.querySelector('table');
        clickTool('row-above');
        assert.equal(table.rows.length, 4, 'row-above did nothing');
        clickTool('row-below');
        assert.equal(table.rows.length, 5, 'row-below did nothing');
        clickTool('col-right');
        assert.equal(table.rows[0].cells.length, 3, 'col-right did nothing');
        clickTool('row-delete');
        assert.equal(table.rows.length, 4, 'row-delete did nothing');
        clickTool('col-delete');
        assert.equal(table.rows[0].cells.length, 2, 'col-delete did nothing');
        assert.ok(tracked.includes('table_tool_used'), 'table_tool_used not tracked');
    });

    check('header, merge and split controls work on the live table', () => {
        const table = editor.querySelector('table');
        const body = table.tBodies[0];
        putCaretInCell(body.rows[0].cells[0], true);
        const headerColBtn = tablePaneTable.querySelector('[data-table-action="header-col"]');
        headerColBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.equal(body.rows[0].cells[0].tagName, 'TH', 'header column not applied');
        assert.equal(body.rows[0].cells[0].getAttribute('scope'), 'row');
        assert.equal(headerColBtn.getAttribute('aria-pressed'), 'true');

        const headerRowBtn = tablePaneTable.querySelector('[data-table-action="header-row"]');
        headerRowBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.equal(table.tHead, null, 'header row did not unwrap');
        headerRowBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.ok(table.tHead, 'header row did not re-wrap');

        const [first, second] = [...table.tBodies[0].rows[0].cells].slice(0, 2);
        const range = document.createRange();
        range.setStart(first, 0);
        range.setEnd(second, 0);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        clickTool('merge');
        assert.equal(table.tBodies[0].rows[0].cells[0].getAttribute('colspan'), '2', 'cells did not merge');
        clickTool('split');
        assert.equal(table.tBodies[0].rows[0].cells[0].getAttribute('colspan'), null, 'cells did not split');
    });

    check('Tab walks cells and appends a row at the end', () => {
        const table = editor.querySelector('table');
        const cells = [...table.querySelectorAll('td, th')].filter((c) => c.closest('table') === table);
        putCaretInCell(cells[cells.length - 1], true);
        const before = table.rows.length;

        editor.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
        assert.equal(table.rows.length, before + 1, 'Tab did not append a row');
        const anchor = window.getSelection().anchorNode;
        const anchorCell = anchor?.nodeType === 1 ? anchor : anchor?.parentElement;
        assert.ok(anchorCell?.closest('table'), 'caret did not move into the appended row');

        editor.dispatchEvent(new window.KeyboardEvent('keydown', {
            key: 'Tab', shiftKey: true, bubbles: true, cancelable: true,
        }));
        assert.ok(window.getSelection().anchorNode, 'Shift+Tab left no caret');
    });

    check('right-click opens the table context menu and Escape closes it', () => {
        const table = editor.querySelector('table');
        table.querySelector('td, th').dispatchEvent(new window.MouseEvent('contextmenu', {
            bubbles: true, cancelable: true, clientX: 30, clientY: 30,
        }));
        assert.equal(tableContextMenu.hidden, false, 'context menu did not open');
        assert.ok(tableContextMenu.querySelector('[data-table-action="merge"]'), 'context menu missing actions');
        document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        assert.equal(tableContextMenu.hidden, true, 'Escape did not close the context menu');
    });

    check('properties button opens the table settings dialog', () => {
        clickTool('properties');
        const dialog = document.getElementById('appDialog');
        assert.equal(dialog.open, true, 'properties dialog did not open');
        assert.ok(dialog.querySelector('[data-prop-caption]'), 'caption field missing');
        assert.ok(dialog.querySelector('[data-prop-borders]'), 'borders checkbox missing');
        dialog.close();
    });

    check('delete table asks for confirmation', () => {
        clickTool('delete-table');
        const dialog = document.getElementById('appDialog');
        assert.equal(dialog.open, true, 'delete confirmation did not open');
        dialog.close();
    });

    check('horizontal rule inserts straight from the menu', () => {
        const range = document.createRange();
        range.setStart(editor, editor.childNodes.length);
        range.collapse(true);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        clickMenu('insert-hr');
        assert.ok(editor.querySelector('hr'), 'horizontal rule not inserted');
    });

    group('behaviour: find & replace');

    // The custom spell checker re-wraps words on input; switch it off first
    // so the find/replace assertions see a stable DOM.
    const spellToggle = document.querySelector('[data-action="toggle-spellcheck"]');
    spellToggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    const findBar = document.getElementById('findBar');
    const findInput = document.getElementById('findInput');
    const replaceInput = document.getElementById('replaceInput');
    const findCount = document.getElementById('findCount');
    const pressKey = (target, opts) =>
        target.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...opts }));

    // jsdom keeps focus where it is when Selection.addRange() points into a
    // contenteditable; Chromium focuses that contenteditable. Emulate the
    // browser behaviour so focus-retention regressions are testable here.
    const withChromiumRangeFocus = (fn) => {
        const proto = Object.getPrototypeOf(window.getSelection());
        const original = proto.addRange;
        proto.addRange = function (range) {
            const result = original.call(this, range);
            if (editor.contains(range.startContainer)) editor.focus();
            return result;
        };
        try {
            return fn();
        } finally {
            proto.addRange = original;
        }
    };

    check('Ctrl+F opens the find bar and reports the event', () => {
        pressKey(document, { key: 'f', ctrlKey: true });
        assert.equal(findBar.hidden, false, 'find bar did not open');
        assert.ok(tracked.includes('find_used'), 'find_used not tracked');
    });

    check('find shows no replace row; find & replace shows it', () => {
        const findBtn = document.querySelector('[data-action="find"]');
        const findReplaceBtn = document.querySelector('[data-action="find-replace"]');
        const row = document.getElementById('findReplaceRow');
        assert.ok(findBtn && findReplaceBtn, 'toolbar find buttons missing');

        findBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.equal(row.hidden, true, 'replace row visible in plain find');

        findReplaceBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.equal(row.hidden, false, 'replace row hidden in find & replace');
        assert.equal(findBar.hidden, false, 'find bar did not open');
    });

    check('matches span text nodes and count is shown', () => {
        // Three "hello" occurrences, one split across <b> markup.
        editor.innerHTML = '<p>Hello world, hello again.</p><p>H<b>ello</b> there.</p>';
        findInput.value = 'hello';
        findInput.dispatchEvent(new window.Event('input', { bubbles: true }));
        assert.match(findCount.textContent, /1 of 3/, findCount.textContent);
        const marks = [...editor.querySelectorAll('.npad-find-match')];
        const matchIds = new Set(marks.map((mark) => mark.dataset.findMatch));
        assert.equal(matchIds.size, 3, `only ${matchIds.size} highlighted matches`);
        assert.ok(marks.some((mark) => mark.classList.contains('npad-find-match--current')),
            'active match is not visually distinct');
    });

    check('typing a query keeps focus and the caret in the Find field', () => {
        findInput.focus();
        findInput.setSelectionRange(findInput.value.length, findInput.value.length);

        withChromiumRangeFocus(() => {
            findInput.dispatchEvent(new window.Event('input', { bubbles: true }));
        });

        assert.equal(document.activeElement, findInput, 'focus jumped into the editor');
        assert.equal(findInput.selectionStart, findInput.value.length, 'input caret moved');
    });

    check('case, whole-word and regular-expression options refine results', () => {
        const option = (name) => findBar.querySelector(`[data-find-option="${name}"]`);
        const toggle = (name) => option(name)
            .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

        editor.innerHTML = '<p>Cat cat concatenate</p>';
        findInput.value = 'cat';
        findInput.dispatchEvent(new window.Event('input', { bubbles: true }));
        assert.match(findCount.textContent, /1 of 3/, findCount.textContent);

        toggle('case');
        assert.match(findCount.textContent, /1 of 2/, `case: ${findCount.textContent}`);
        toggle('whole');
        assert.match(findCount.textContent, /1 of 1/, `whole: ${findCount.textContent}`);
        toggle('case');
        assert.match(findCount.textContent, /1 of 2/, `case off: ${findCount.textContent}`);

        toggle('regex');
        findInput.value = 'c.t';
        findInput.dispatchEvent(new window.Event('input', { bubbles: true }));
        assert.match(findCount.textContent, /1 of 2/, `regex: ${findCount.textContent}`);
        findInput.value = '[';
        findInput.dispatchEvent(new window.Event('input', { bubbles: true }));
        assert.equal(findInput.getAttribute('aria-invalid'), 'true');
        assert.equal(findCount.textContent, strings.findInvalidRegex);

        toggle('regex');
        toggle('whole');
        findInput.value = 'hello';
        editor.innerHTML = '<p>Hello world, hello again.</p><p>H<b>ello</b> there.</p>';
        findInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    });

    check('Enter and Shift+Enter step through matches', () => {
        pressKey(findInput, { key: 'Enter' });
        assert.match(findCount.textContent, /2 of 3/, findCount.textContent);
        pressKey(findInput, { key: 'Enter', shiftKey: true });
        assert.match(findCount.textContent, /1 of 3/, findCount.textContent);
        assert.equal(window.getSelection().toString().toLowerCase(), 'hello');
    });

    check('replace swaps the current match and triggers autosave', () => {
        // Caret sits inside the first match, so a fresh query starts one
        // match in; step back onto the very first occurrence.
        findInput.value = 'hello';
        findInput.dispatchEvent(new window.Event('input', { bubbles: true }));
        let guard = 0;
        while (!/1 of 3/.test(findCount.textContent) && guard++ < 5) {
            pressKey(findInput, { key: 'Enter', shiftKey: true });
        }
        replaceInput.value = 'hi';
        replaceInput.focus();
        replaceInput.setSelectionRange(2, 2);
        withChromiumRangeFocus(() => pressKey(replaceInput, { key: 'Enter' }));

        assert.ok(editor.innerHTML.includes('hi world'), editor.innerHTML.slice(0, 80));
        assert.equal(document.activeElement, replaceInput, 'focus left the replacement field');
        assert.equal(replaceInput.selectionStart, 2, 'replacement caret moved');
    });

    check('replace all replaces every occurrence', () => {
        findInput.value = 'hello';
        findInput.dispatchEvent(new window.Event('input', { bubbles: true }));
        const replaceAllBtn = [...findBar.querySelectorAll('[data-find-action]')]
            .find((b) => b.dataset.findAction === 'replace-all');
        replaceAllBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.ok(!/hello/i.test(editor.textContent), editor.textContent);
    });

    check('regular-expression replacements expand capture groups', () => {
        const regex = findBar.querySelector('[data-find-option="regex"]');
        regex.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        editor.innerHTML = '<p>item-12 item-34</p>';
        findInput.value = 'item-(\\d+)';
        replaceInput.value = '$1:item';
        findInput.dispatchEvent(new window.Event('input', { bubbles: true }));
        findBar.querySelector('[data-find-action="replace-all"]')
            .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.equal(editor.textContent, '12:item 34:item');
        regex.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    check('replace in selection never changes matching text outside the selection', () => {
        findBar.querySelector('[data-find-action="close"]')
            .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        editor.innerHTML = '<p>one one one</p>';
        const text = editor.querySelector('p').firstChild;
        const range = document.createRange();
        range.setStart(text, 0);
        range.setEnd(text, 7);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);

        document.querySelector('[data-action="find-replace"]')
            .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        const inSelection = findBar.querySelector('[data-find-option="selection"]');
        assert.equal(inSelection.disabled, false, 'selection scope was not captured');
        inSelection.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        findInput.value = 'one';
        replaceInput.value = 'X';
        findInput.dispatchEvent(new window.Event('input', { bubbles: true }));
        assert.match(findCount.textContent, /1 of 2/, findCount.textContent);
        findBar.querySelector('[data-find-action="replace-all"]')
            .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.equal(editor.textContent, 'X X one');
    });

    check('no-results message and Escape close', () => {
        findInput.value = 'zzz-not-here';
        findInput.dispatchEvent(new window.Event('input', { bubbles: true }));
        assert.equal(findCount.textContent, strings.findNoResults);
        pressKey(findInput, { key: 'Escape' });
        assert.equal(findBar.hidden, true, 'find bar did not close');
    });

    group('behaviour: view toggles');

    check('focus mode toggles, persists and shows the exit button', () => {
        const focusBtn = document.querySelector('[data-action="toggle-focus"]');
        focusBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.ok(document.body.classList.contains('focus-mode'), 'focus class missing');
        assert.equal(focusBtn.getAttribute('aria-pressed'), 'true');
        assert.equal(window.localStorage.getItem('npad.focusMode'), '1');
        assert.equal(document.querySelector('.focus-exit').hidden, false);
        assert.ok(tracked.includes('focus_mode_enabled'), 'focus_mode_enabled not tracked');
        document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        assert.ok(!document.body.classList.contains('focus-mode'), 'Escape did not exit focus');
    });

    check('RTL and LTR buttons sit in the toolbar and switch direction', () => {
        const rtlBtn = document.querySelector('[data-action="dir-rtl"]');
        const ltrBtn = document.querySelector('[data-action="dir-ltr"]');
        assert.ok(rtlBtn && ltrBtn, 'direction buttons missing');
        assert.ok(rtlBtn.closest('[role="group"]'), 'not inside a toolbar group');

        rtlBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.equal(editor.getAttribute('dir'), 'rtl', 'rtl not applied');
        assert.equal(rtlBtn.getAttribute('aria-pressed'), 'true');
        assert.equal(ltrBtn.getAttribute('aria-pressed'), 'false');
        assert.equal(window.localStorage.getItem('npad.editorDir'), 'rtl');
        assert.ok(tracked.includes('dir_toggled'), 'dir_toggled not tracked');

        ltrBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.equal(editor.getAttribute('dir'), 'ltr', 'ltr not applied');
        assert.equal(ltrBtn.getAttribute('aria-pressed'), 'true');
    });

    group('behaviour: custom spell checker');

    check('misspelled words are flagged with the custom mark', async () => {
        // Earlier groups may have switched the checker off; make sure it is on.
        if (spellToggle.getAttribute('aria-pressed') !== 'true') {
            spellToggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        }
        editor.dataset.spellDebounce = '10';
        // Two paragraphs: the walker must not stop after the first replaced
        // node (the live-DOM bug that only showed up in real browsers).
        editor.innerHTML = '<p>hellow wrld and correct</p><p>secon para</p>';
        editor.dispatchEvent(new window.Event('input', { bubbles: true }));
        await new Promise((resolve) => window.setTimeout(resolve, 60));
        const marks = editor.querySelectorAll('.spell-err');
        assert.equal(marks.length, 3, `expected 3 marks, got ${marks.length}`);
        assert.equal(marks[0].textContent, 'hellow');
        assert.equal(marks[1].textContent, 'wrld');
        assert.equal(marks[2].textContent, 'secon');
        assert.equal(marks[0].tabIndex, 0);
        assert.equal(marks[0].getAttribute('role'), 'button');
        assert.equal(marks[0].getAttribute('aria-haspopup'), 'dialog');
        assert.ok(marks[0].getAttribute('aria-label').includes('hellow'));
    });

    check('tap and keyboard activation open navigable spelling corrections', () => {
        editor.innerHTML = '<p>hellow world</p>';
        const nativeSetTimeout = global.setTimeout;
        global.setTimeout = (callback) => {
            callback();
            return 1;
        };
        let mark;
        try {
            editor.dispatchEvent(new window.Event('input', { bubbles: true }));
            mark = editor.querySelector('.spell-err');
        } finally {
            global.setTimeout = nativeSetTimeout;
        }
        assert.ok(mark, 'no spelling mark available for activation');
        mark.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        const tip = document.querySelector('.spell-tip');
        assert.ok(tip && !tip.hidden, 'tap did not open suggestions');
        assert.equal(tip.getAttribute('role'), 'dialog');
        assert.equal(mark.getAttribute('aria-expanded'), 'true');

        document.body.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.equal(tip.hidden, true, 'outside tap did not close suggestions');
        mark.focus();
        mark.dispatchEvent(new window.KeyboardEvent('keydown', {
            key: 'Enter', bubbles: true, cancelable: true,
        }));
        const buttons = [...tip.querySelectorAll('button')];
        assert.equal(document.activeElement, buttons[0], 'keyboard open did not focus a suggestion');
        buttons[0].dispatchEvent(new window.KeyboardEvent('keydown', {
            key: 'ArrowDown', bubbles: true, cancelable: true,
        }));
        assert.equal(document.activeElement, buttons[1], 'ArrowDown did not move through corrections');
        buttons[1].dispatchEvent(new window.KeyboardEvent('keydown', {
            key: 'Escape', bubbles: true, cancelable: true,
        }));
        assert.equal(tip.hidden, true);
        assert.equal(document.activeElement, mark, 'Escape did not return focus to the word');
    });

    check('toggle disables the checker, clears marks and persists', () => {
        spellToggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.equal(editor.querySelectorAll('.spell-err').length, 0, 'marks not cleared');
        assert.equal(spellToggle.getAttribute('aria-pressed'), 'false');
        assert.equal(window.localStorage.getItem('npad.spellcheck'), '0');
        assert.ok(tracked.includes('spellcheck_toggled'), 'spellcheck_toggled not tracked');

        spellToggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.equal(spellToggle.getAttribute('aria-pressed'), 'true');
        assert.equal(window.localStorage.getItem('npad.spellcheck'), '1');
    });

    check('a delayed spell pass cannot steal focus from another field', () => {
        editor.innerHTML = '<p>uniquefocuss misspelingg</p>';
        const text = editor.querySelector('p').firstChild;
        const range = document.createRange();
        range.setStart(text, text.length);
        range.collapse(true);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);

        const field = document.createElement('input');
        field.value = 'typing';
        document.body.appendChild(field);
        field.focus();
        field.setSelectionRange(6, 6);

        // Run the normally delayed pass synchronously and emulate Chromium's
        // contenteditable focus side effect when the editor caret is restored.
        const nativeSetTimeout = global.setTimeout;
        global.setTimeout = (callback) => {
            callback();
            return 1;
        };
        try {
            withChromiumRangeFocus(() => {
                editor.dispatchEvent(new window.Event('input', { bubbles: true }));
            });
        } finally {
            global.setTimeout = nativeSetTimeout;
        }

        assert.equal(document.activeElement, field, 'spell marking focused the editor');
        assert.equal(field.selectionStart, 6, 'field caret was not restored');
        field.remove();
    });

    check('hovering a flag opens a correction popup that stays reachable', () => {
        editor.dataset.spellDelay = '10';
        editor.innerHTML = '<p>hellow world</p>';

        // Execute the two UI delays immediately so every assertion remains
        // inside the synchronous test runner.
        const nativeSetTimeout = global.setTimeout;
        global.setTimeout = (callback) => {
            callback();
            return 1;
        };
        let mark;
        try {
            editor.dispatchEvent(new window.Event('input', { bubbles: true }));
            mark = editor.querySelector('.spell-err');
            assert.ok(mark, 'no flag to hover');
            mark.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true, relatedTarget: null }));
        } finally {
            global.setTimeout = nativeSetTimeout;
        }

        const tip = document.querySelector('.spell-tip');
        assert.ok(tip && !tip.hidden, 'tooltip did not appear');
        const items = tip.querySelectorAll('.spell-tip__item');
        assert.ok(items.length >= 1, 'no suggestions offered');
        assert.equal(items[0].textContent, 'hello');

        // Moving directly from the word into the popup is still inside the
        // combined hover region and must not even schedule a close.
        let hideWasScheduled = false;
        global.setTimeout = (callback, delay, ...args) => {
            hideWasScheduled = true;
            return nativeSetTimeout(callback, delay, ...args);
        };
        try {
            mark.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true, relatedTarget: tip }));
        } finally {
            global.setTimeout = nativeSetTimeout;
        }
        assert.ok(!tip.hidden, 'tooltip closed on pointer leaving the word');
        assert.equal(hideWasScheduled, false, 'tooltip scheduled a close while pointer entered it');

        items[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.ok(editor.textContent.includes('hello world'), editor.textContent);
        assert.ok(tracked.includes('spell_replace_used'), 'spell_replace_used not tracked');
        assert.ok(tip.hidden, 'tooltip did not close after replace');
    });

    check('add to dictionary stops the word being flagged and persists', async () => {
        editor.innerHTML = '<p>npadd note</p>';
        editor.dispatchEvent(new window.Event('input', { bubbles: true }));
        await new Promise((resolve) => window.setTimeout(resolve, 60));
        const mark = editor.querySelector('.spell-err');
        assert.ok(mark, 'npadd was not flagged');

        mark.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true, relatedTarget: null }));
        await new Promise((resolve) => window.setTimeout(resolve, 60));
        const tip = document.querySelector('.spell-tip');
        const add = [...tip.querySelectorAll('.spell-tip__action')]
            .find((b) => b.textContent === strings.spellAdd);
        add.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

        assert.ok(!editor.querySelector('.spell-err'), 'mark still present after add');
        assert.ok(window.localStorage.getItem('npad.customWords').includes('npadd'));
        assert.ok(tracked.includes('spell_add_word'), 'spell_add_word not tracked');

        // A fresh re-mark pass must not flag it again.
        editor.innerHTML = '<p>npadd again</p>';
        editor.dispatchEvent(new window.Event('input', { bubbles: true }));
        await new Promise((resolve) => window.setTimeout(resolve, 60));
        assert.ok(!editor.querySelector('.spell-err'), 'custom word re-flagged');
    });

    group('behaviour: save state');

    check('status bar advertises a save state', () => {
        const bar = document.getElementById('statusbar');
        assert.ok(['saved', 'saving', 'unsaved'].includes(bar.dataset.saveState),
            `unexpected: ${bar.dataset.saveState}`);
    });

    check('pagehide flush persists content without transient search highlights', () => {
        editor.textContent = 'work in progress';
        editor.dispatchEvent(new window.Event('input', { bubbles: true }));
        pressKey(document, { key: 'f', ctrlKey: true });
        findInput.value = 'work';
        findInput.dispatchEvent(new window.Event('input', { bubbles: true }));
        assert.ok(editor.querySelector('.npad-find-match'), 'search highlight missing before flush');
        window.dispatchEvent(new window.Event('beforeprint'));
        assert.equal(editor.querySelector('.npad-find-match'), null, 'search highlight leaked into print');
        window.dispatchEvent(new window.Event('afterprint'));
        assert.ok(editor.querySelector('.npad-find-match'), 'search highlight was not restored after print');
        window.dispatchEvent(new window.Event('pagehide'));
        const raw = window.localStorage.getItem('npad:pending-note');
        assert.ok(raw, 'nothing flushed on pagehide — this is the data-loss bug');
        const html = JSON.parse(raw).html;
        assert.ok(html.includes('work in progress'), 'flushed content wrong');
        assert.ok(!html.includes('npad-find-match'), 'search highlights leaked into storage');
        pressKey(findInput, { key: 'Escape' });
    });

    check('autosave timer persists without spell marks', async () => {
        editor.textContent = 'autosave works';
        editor.dispatchEvent(new window.Event('input', { bubbles: true }));
        await new Promise((resolve) => window.setTimeout(resolve, 950));
        const raw = window.localStorage.getItem('npad:notes');
        assert.ok(raw, 'autosave did not persist');
        const stored = JSON.parse(raw).notes;
        const html = stored.find((note) => note.id === window.localStorage.getItem('npad:active-note'))?.html || '';
        assert.ok(html.includes('autosave works'), 'autosave content wrong');
        assert.ok(!html.includes('spell-err'), 'spell marks leaked into storage');
    });

    group('behaviour: dialog');

    check('showDialog opens the native dialog and resolves', async () => {
        const dialog = document.getElementById('appDialog');
        const promise = showDialog({
            title: 'T', bodyHtml: '<p>b</p>',
            buttons: [{ label: 'OK', action: 'ok', variant: 'btn--primary' }],
        });
        assert.ok(dialog.open, 'dialog did not open');
        dialog.querySelector('[data-action="ok"]')
            .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        const result = await promise;
        assert.equal(result, 'ok');
        assert.equal(dialog.open, false, 'dialog did not close');
    });

    check('dialog close button is reachable and labelled', () => {
        const btn = document.querySelector('.dialog__close');
        assert.ok(btn, 'no close button');
        assert.ok(btn.getAttribute('aria-label'), 'close button unlabelled');
    });

    group('behaviour: toast');

    check('toast appends to the live region and is announced', () => {
        toast('hello', 'error');
        const region = document.getElementById('toastRegion');
        assert.equal(region.getAttribute('aria-live'), 'polite');
        assert.ok(region.querySelector('.toast'), 'no toast rendered');
        assert.ok(region.textContent.includes('hello'));
    });

    group('behaviour: sanitiser is wired into the editor path');

    check('restored malicious HTML is neutralised', () => {
        const dirty = '<p>ok</p><script>window.__pwned = true;</script>';
        editor.innerHTML = sanitizeHtml(dirty);
        assert.equal(window.__pwned, undefined, 'script executed');
        assert.ok(editor.textContent.includes('ok'));
    });

    check('no uncaught errors during the whole run', () => {
        assert.deepEqual(consoleErrors, [], consoleErrors[0]);
    });

    window.close();
}
