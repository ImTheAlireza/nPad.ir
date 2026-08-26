/**
 * End-to-end coverage for collapsible sections, the outline navigator,
 * checklists and the cross-note task overview: Insert menu flows, live
 * toggling, outline jumps, autosave of the stored forms and the Tasks
 * dialog across two notes.
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
    const rt = await loadNodeRuntime('8.2', { emscriptenOptions: { processId: 6 } });
    const php = new PHP(rt);
    (function mirror(host, vfs) {
        php.mkdir(vfs);
        for (const entry of fs.readdirSync(host, { withFileTypes: true })) {
            if (['.git', 'node_modules', 'tests'].includes(entry.name)) continue;
            const h = path.join(host, entry.name);
            const v = `${vfs}/${entry.name}`;
            if (entry.isDirectory()) mirror(h, v);
            else php.writeFile(v, fs.readFileSync(h));
        }
    })(ROOT, '/site');

    const result = await php.run({
        scriptPath: '/site/index.php',
        $_SERVER: { REQUEST_METHOD: 'GET', REQUEST_URI: '/', HTTP_HOST: 'npad.ir', HTTPS: 'on' },
    });
    return result.text;
}

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
    document.execCommand = document.execCommand || ((command, _ui, value) => {
        if (command !== 'insertText') return true;
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) return false;
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(String(value ?? '')));
        range.collapse(false);
        return true;
    });
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
    Object.defineProperty(global, 'navigator', { value: window.navigator, configurable: true, writable: true });
    installEnvironment(dom);

    const url = (p) => pathToFileURL(path.join(ROOT, p)).href + `?t=${Date.now()}`;
    const { initMenus } = await import(url('assets/js/ui.js'));
    const { initTheme } = await import(url('assets/js/theme.js'));
    const { initEditor } = await import(url('assets/js/editor.js'));

    initMenus();
    initTheme({ onChange: () => {} });
    const tracked = [];
    initEditor({
        strings: JSON.parse(document.getElementById('i18n').textContent),
        onEvent: (e) => tracked.push(e),
    });

    await new Promise((resolve) => window.setTimeout(resolve, 0));

    const editor = document.getElementById('editor');
    const dialog = document.getElementById('appDialog');
    const insertMenuTrigger = document.getElementById('insertMenuTrigger');
    const insertMenuPanel = document.getElementById('insertMenuPanel');
    const fileMenuTrigger = document.getElementById('fileMenuTrigger');
    const fileMenuPanel = document.getElementById('fileMenuPanel');
    const outlinePanel = document.getElementById('outlinePanel');
    const tick = () => new Promise((resolve) => window.setTimeout(resolve, 5));
    const flush = () => new Promise((resolve) => queueMicrotask(resolve));

    const click = (target) => target.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const clickMenu = (trigger, panel, action) => {
        click(trigger);
        click(panel.querySelector(`[data-action="${action}"]`));
    };
    const putCaret = (node, atEnd = false) => {
        const range = document.createRange();
        if (atEnd) { range.selectNodeContents(node); range.collapse(false); }
        else { range.setStart(node, 0); range.collapse(true); }
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    };

    group('structure-ui: end-to-end');

    const steps = [];
    const stepFailures = [];
    const step = async (name, fn) => {
        try {
            await fn();
            console.log(`  ok    ${name}`);
            steps.push(name);
        } catch (err) {
            stepFailures.push(name);
            console.log(`  FAIL  ${name}`);
            console.log(`        ${String(err.message).split('\n').slice(0, 4).join(' | ')}`);
        }
    };

    await step('Insert menu -> collapsible section with caret in the summary', async () => {
        editor.innerHTML = '<p><br></p>';
        putCaret(editor.querySelector('p'));
        document.dispatchEvent(new window.Event('selectionchange'));
        clickMenu(insertMenuTrigger, insertMenuPanel, 'insert-section');
        await tick();

        const details = editor.querySelector('details');
        assert.ok(details, 'section not inserted');
        assert.equal(details.open, true, 'section not open for editing');
        const summary = details.querySelector('summary');
        assert.ok(summary, 'summary missing');
        assert.ok(summary.textContent.trim().length > 0, 'summary placeholder missing');
        assert.ok(summary.contains(window.getSelection().anchorNode), 'caret not in the summary');
        assert.ok(tracked.includes('section_inserted'), 'section_inserted not tracked');
    });

    await step('clicking the summary toggles the section', async () => {
        const details = editor.querySelector('details');
        click(details.querySelector('summary'));
        await tick();
        assert.equal(details.open, false, 'did not collapse');
        click(details.querySelector('summary'));
        await tick();
        assert.equal(details.open, true, 'did not expand');
    });

    await step('the outline panel lists headings and sections and jumps', async () => {
        editor.innerHTML = '<h2>Plan</h2><p>text</p><details open><summary>Boxed</summary><p>in box</p></details><h1>Fin</h1>';
        editor.dispatchEvent(new window.Event('input', { bubbles: true }));
        await tick();

        const outlineButton = document.querySelector('[data-action="outline"]');
        assert.ok(outlineButton, 'outline toolbar button missing');
        click(outlineButton);
        await tick();
        assert.equal(outlinePanel.hidden, false, 'panel did not open');

        const entries = [...outlinePanel.querySelectorAll('.outline-panel__entry')];
        assert.deepEqual(entries.map((el) => el.textContent.replace('▸', '').trim()), ['Plan', 'Boxed', 'Fin']);

        entries[2].click();
        await tick();
        const selection = window.getSelection();
        assert.ok(editor.querySelector('h1').contains(selection.anchorNode), 'caret not at the jumped heading');
        assert.equal(outlinePanel.hidden, true, 'panel did not close');
        assert.ok(tracked.includes('outline_used'), 'outline_used not tracked');
    });

    await step('Insert menu -> checklist; toggling persists the checked state', async () => {
        editor.innerHTML = '<p><br></p>';
        putCaret(editor.querySelector('p'));
        document.dispatchEvent(new window.Event('selectionchange'));
        clickMenu(insertMenuTrigger, insertMenuPanel, 'insert-checklist');
        await tick();

        const list = editor.querySelector('ul.checklist');
        assert.ok(list, 'checklist not inserted');
        const input = list.querySelector('input[type="checkbox"]');
        assert.ok(input, 'checkbox missing');
        const item = list.querySelector('li');
        assert.ok(item.contains(window.getSelection().anchorNode), 'caret not in the item');

        input.checked = true;
        input.dispatchEvent(new window.Event('change', { bubbles: true }));
        assert.ok(item.classList.contains('task-checked'), 'class not synced');
        assert.ok(tracked.includes('task_toggled'), 'task_toggled not tracked');

        editor.dispatchEvent(new window.Event('input', { bubbles: true }));
        await new Promise((resolve) => window.setTimeout(resolve, 900));
        const saved = window.localStorage.getItem('npad:notes');
        const storedHtml = (JSON.parse(saved)?.notes || []).map((n) => n.html).join('');
        assert.match(storedHtml, /<ul class="checklist"><li class="task-checked"><input type="checkbox" checked[^>]*>/,
            'stored form lost the checklist');
    });

    await step('the Tasks dialog aggregates across notes and toggles them', async () => {
        // Second note with a completed task.
        clickMenu(fileMenuTrigger, fileMenuPanel, 'new');
        await new Promise((resolve) => window.setTimeout(resolve, 50));
        editor.innerHTML = '<ul class="checklist"><li><input type="checkbox">report</li></ul>';
        editor.dispatchEvent(new window.Event('input', { bubbles: true }));
        await new Promise((resolve) => window.setTimeout(resolve, 900));

        // Back to the first note.
        const firstTab = [...document.querySelectorAll('[data-tab-action="open"]')][0];
        click(firstTab);
        await new Promise((resolve) => window.setTimeout(resolve, 50));

        const editMenuTrigger = document.getElementById('editMenuTrigger');
        const editMenuPanel = document.getElementById('editMenuPanel');
        clickMenu(editMenuTrigger, editMenuPanel, 'tasks-overview');
        await tick();
        assert.equal(dialog.open, true, 'tasks dialog did not open');

        const rows = [...dialog.querySelectorAll('.task-overview__row')];
        assert.equal(rows.length, 2, `expected two tasks, got ${rows.length}`);
        assert.ok(tracked.includes('tasks_opened'), 'tasks_opened not tracked');

        // Toggle the open task from the dialog (this is the first note's task).
        const toggle = rows.find((row) => !row.querySelector('[data-task-toggle]').checked)
            ?.querySelector('[data-task-toggle]');
        assert.ok(toggle, 'no open task row');
        toggle.checked = true;
        toggle.dispatchEvent(new window.Event('change', { bubbles: true }));
        await new Promise((resolve) => window.setTimeout(resolve, 20));

        const liveItem = editor.querySelector('ul.checklist li');
        assert.ok(liveItem.classList.contains('task-checked'), 'source note not updated');

        // Sections re-rendered: everything completed now.
        assert.ok(dialog.querySelector('[data-task-overview]'), 'overview still rendered');
        click(dialog.querySelector('[data-action="close"]'));
        await tick();
    });

    await step('per-note direction: the toolbar writes it on the active note', async () => {
        const rtlButton = document.querySelector('[data-action="dir-rtl"]');
        assert.ok(rtlButton, 'dir button missing');
        click(rtlButton);
        editor.dispatchEvent(new window.Event('input', { bubbles: true }));
        await new Promise((resolve) => window.setTimeout(resolve, 900));
        await tick();
        assert.equal(editor.getAttribute('dir'), 'rtl', 'editor dir not applied');

        const saved = JSON.parse(window.localStorage.getItem('npad:notes'));
        assert.ok((saved?.notes || []).some((n) => n.dir === 'rtl'), 'direction not persisted on the note');

        // A new note falls back to auto (the page direction), not the override.
        clickMenu(fileMenuTrigger, fileMenuPanel, 'new');
        await new Promise((resolve) => window.setTimeout(resolve, 50));
        assert.notEqual(editor.getAttribute('dir'), 'rtl', 'override leaked to the new note');

        // Back to the first note: its direction is restored.
        const firstTab = [...document.querySelectorAll('[data-tab-action="open"]')][0];
        click(firstTab);
        await new Promise((resolve) => window.setTimeout(resolve, 50));
        assert.equal(editor.getAttribute('dir'), 'rtl', 'per-note direction not restored');
    });

    await step('spellcheck skips nothing here and page stays clean', () => {
        assert.deepEqual(consoleErrors.filter((e) => !/scrollIntoView|Not implemented/.test(e)), [],
            consoleErrors[0]);
    });

    check(`structure-ui: ${steps.length} steps`, () => {
        assert.ok(stepFailures.length === 0, `failed: ${stepFailures.join(', ')}`);
    });

    await new Promise((resolve) => window.setTimeout(resolve, 5000));
    window.close();
}
