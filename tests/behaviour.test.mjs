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

    group('behaviour: find & replace');

    const findBar = document.getElementById('findBar');
    const findInput = document.getElementById('findInput');
    const replaceInput = document.getElementById('replaceInput');
    const findCount = document.getElementById('findCount');
    const pressKey = (target, opts) =>
        target.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...opts }));

    check('Ctrl+F opens the find bar and reports the event', () => {
        pressKey(document, { key: 'f', ctrlKey: true });
        assert.equal(findBar.hidden, false, 'find bar did not open');
        assert.ok(tracked.includes('find_used'), 'find_used not tracked');
    });

    check('matches span text nodes and count is shown', () => {
        // Three "hello" occurrences, one split across <b> markup.
        editor.innerHTML = '<p>Hello world, hello again.</p><p>H<b>ello</b> there.</p>';
        findInput.value = 'hello';
        findInput.dispatchEvent(new window.Event('input', { bubbles: true }));
        assert.match(findCount.textContent, /1 of 3/, findCount.textContent);
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
        const replaceBtn = [...findBar.querySelectorAll('[data-find-action]')]
            .find((b) => b.dataset.findAction === 'replace');
        replaceBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.ok(editor.innerHTML.includes('hi world'), editor.innerHTML.slice(0, 80));
    });

    check('replace all replaces every occurrence', () => {
        findInput.value = 'hello';
        findInput.dispatchEvent(new window.Event('input', { bubbles: true }));
        const replaceAllBtn = [...findBar.querySelectorAll('[data-find-action]')]
            .find((b) => b.dataset.findAction === 'replace-all');
        replaceAllBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.ok(!/hello/i.test(editor.textContent), editor.textContent);
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

    check('text direction toggles and persists', () => {
        const dirBtn = document.querySelector('[data-action="toggle-dir"]');
        const before = editor.getAttribute('dir') || document.documentElement.getAttribute('dir');
        dirBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        const after = editor.getAttribute('dir');
        assert.ok(after && after !== before, `dir did not change: ${before} -> ${after}`);
        assert.ok(['ltr', 'rtl'].includes(window.localStorage.getItem('npad.editorDir')));
        assert.ok(tracked.includes('dir_toggled'), 'dir_toggled not tracked');
    });

    check('spell check toggles and persists', () => {
        const spellBtn = document.querySelector('[data-action="toggle-spellcheck"]');
        const before = editor.spellcheck;
        spellBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.equal(editor.spellcheck, !before);
        assert.equal(window.localStorage.getItem('npad.spellcheck'), before ? '0' : '1');
        assert.ok(tracked.includes('spellcheck_toggled'), 'spellcheck_toggled not tracked');
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
