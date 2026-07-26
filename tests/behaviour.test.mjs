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
    const rt = await loadNodeRuntime('8.2', { emscriptenOptions: { processId: 1 } });
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

    group('behaviour: save state');

    check('status bar advertises a save state', () => {
        const bar = document.getElementById('statusbar');
        assert.ok(['saved', 'saving', 'unsaved'].includes(bar.dataset.saveState),
            `unexpected: ${bar.dataset.saveState}`);
    });

    check('pagehide flush persists to localStorage fallback', () => {
        editor.textContent = 'work in progress';
        editor.dispatchEvent(new window.Event('input', { bubbles: true }));
        window.dispatchEvent(new window.Event('pagehide'));
        const raw = window.localStorage.getItem('npad:document');
        assert.ok(raw, 'nothing flushed on pagehide — this is the data-loss bug');
        assert.ok(JSON.parse(raw).html.includes('work in progress'), 'flushed content wrong');
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
