/**
 * End-to-end coverage for math typesetting: Insert menu -> dialog with live
 * preview -> formula in the editor -> paint and raw-source editing -> autosave
 * stores the LaTeX source -> magic typing -> double-click edit.
 *
 * Same harness as the other UI suites: the real page is rendered by PHP 8.2
 * under php-wasm, booted in jsdom with the actual ES modules. The vendored
 * KaTeX is pre-loaded into the window so painting runs without network.
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
    const rt = await loadNodeRuntime('8.2', { emscriptenOptions: { processId: 5 } });
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

    // Vendored KaTeX in manual mode before the editor boots.
    window.eval(fs.readFileSync(path.join(ROOT, 'assets/js/vendor/katex-0.18.4.min.js'), 'utf8'));

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
    const tick = () => new Promise((resolve) => window.setTimeout(resolve, 5));

    const click = (target) => target.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const clickMenuItem = (action) => {
        click(insertMenuTrigger);
        click(insertMenuPanel.querySelector(`[data-action="${action}"]`));
    };
    const putCaret = (node, atEnd = false) => {
        const range = document.createRange();
        if (atEnd) { range.selectNodeContents(node); range.collapse(false); }
        else { range.setStart(node, 0); range.collapse(true); }
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    };

    group('math-ui: end-to-end');

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

    await step('Insert menu -> Math dialog with live preview -> block formula', async () => {
        editor.innerHTML = '<p>before</p><p><br></p>';
        putCaret(editor.querySelector('p:last-child'));
        document.dispatchEvent(new window.Event('selectionchange'));
        clickMenuItem('insert-math');
        await tick();

        assert.equal(dialog.open, true, 'math dialog did not open');
        const texField = dialog.querySelector('[data-math-tex]');
        assert.ok(texField, 'LaTeX field missing');
        texField.value = 'x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}';
        texField.dispatchEvent(new window.Event('input', { bubbles: true }));
        await tick();
        assert.ok(dialog.querySelector('[data-math-preview] .katex'), 'preview did not render');
        assert.equal(dialog.querySelector('[data-math-error]').hidden, true, 'error shown for valid input');

        await tick();
        click(dialog.querySelector('[data-action="apply"]'));
        await tick();

        const el = editor.querySelector('math-block');
        assert.ok(el, 'formula not inserted');
        assert.equal(el.textContent, 'x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}', 'wrong source');
        assert.ok(el.classList.contains('math--editing'), 'raw mode not active');
        assert.ok(editor.contains(window.getSelection().anchorNode), 'caret outside the editor');
        assert.ok(tracked.includes('math_inserted'), 'math_inserted not tracked');
    });

    await step('leaving the formula paints KaTeX and carries the source', async () => {
        const el = editor.querySelector('math-block');
        putCaret(editor.querySelector('p'), 0);
        document.dispatchEvent(new window.Event('selectionchange'));
        await new Promise((resolve) => window.setTimeout(resolve, 150));

        assert.equal(el.dataset.tex, 'x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}', 'source not carried');
        assert.ok(el.querySelector('.katex'), 'KaTeX output missing');
        assert.ok(el.querySelector('math'), 'MathML for screen readers missing');
        assert.ok(!el.classList.contains('math--editing'), 'still in raw mode');
    });

    await step('autosave stores the plain LaTeX source', async () => {
        editor.dispatchEvent(new window.Event('input', { bubbles: true }));
        await new Promise((resolve) => window.setTimeout(resolve, 900));
        const saved = window.localStorage.getItem('npad:notes');
        assert.ok(saved, 'nothing saved');
        const storedHtml = (JSON.parse(saved)?.notes || []).map((n) => n.html).join('');
        assert.match(storedHtml, /<math-block>x = \\frac\{-b \\pm \\sqrt\{b\^2-4ac\}\}\{2a\}<\/math-block>/,
            'stored form is not the plain source');
        assert.ok(!storedHtml.includes('data-tex'), 'runtime attribute leaked into storage');
        assert.ok(!storedHtml.includes('katex'), 'KaTeX markup leaked into storage');
    });

    await step('magic typing converts $$x^2$$ into a block formula', () => {
        editor.innerHTML = '<p>Euler said </p>';
        const p = editor.querySelector('p');
        p.firstChild.nodeValue = 'Euler said $$x^2$$';
        putCaret(p.firstChild, p.firstChild.length);
        editor.dispatchEvent(new window.InputEvent('input', {
            data: '$', inputType: 'insertText', bubbles: true,
        }));

        const el = editor.querySelector('math-block');
        assert.ok(el, 'block formula not created');
        assert.equal(el.textContent, 'x^2', 'wrong source');
        assert.ok(tracked.includes('math_inserted'), 'not tracked');
    });

    await step('money text stays prose while typing', () => {
        editor.innerHTML = '<p>I paid </p>';
        const p = editor.querySelector('p');
        p.firstChild.nodeValue = 'I paid $5 and $';
        putCaret(p.firstChild, p.firstChild.length);
        editor.dispatchEvent(new window.InputEvent('input', {
            data: '$', inputType: 'insertText', bubbles: true,
        }));
        assert.equal(editor.querySelector('math-inline'), null, 'money converted');
    });

    await step('double-click edits a legacy inline formula into a block', async () => {
        editor.innerHTML = '<p>text <math-inline>a^2 + b^2</math-inline> more</p>';
        editor.dispatchEvent(new window.Event('input', { bubbles: true }));
        await tick();
        const el = editor.querySelector('math-inline');
        el.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
        await tick();

        assert.equal(dialog.open, true, 'edit dialog did not open');
        const texField = dialog.querySelector('[data-math-tex]');
        assert.equal(texField.value, 'a^2 + b^2', 'dialog not prefilled');
        texField.value = 'a^2 + b^2 = c^2';
        texField.dispatchEvent(new window.Event('input', { bubbles: true }));
        await tick();
        click(dialog.querySelector('[data-action="apply"]'));
        await tick();

        const updated = editor.querySelector('math-block');
        assert.ok(updated, 'block formula missing');
        assert.equal(updated.dataset.tex, 'a^2 + b^2 = c^2', 'edit not applied');
        assert.equal(updated.parentNode.tagName, 'DIV', 'block should sit outside the paragraph');
        await tick();
        assert.ok(updated.querySelector('.katex'), 'edited formula not painted');
        assert.ok(tracked.includes('math_edited'), 'math_edited not tracked');
    });

    await step('block insertion survives a dropped selection', async () => {
        // Firefox and Safari drop the editor selection when a modal takes
        // focus; the editor's remembered range must still place it.
        editor.innerHTML = '<p>before</p><p><br></p>';
        putCaret(editor.querySelector('p:last-child'));
        document.dispatchEvent(new window.Event('selectionchange'));
        clickMenuItem('insert-math');
        await tick();
        assert.equal(dialog.open, true, 'dialog did not open');
        const selection = window.getSelection();
        selection.removeAllRanges(); // the engine dropped it mid-dialog
        const texField = dialog.querySelector('[data-math-tex]');
        texField.value = 'e = mc^2';
        texField.dispatchEvent(new window.Event('input', { bubbles: true }));
        await tick();
        click(dialog.querySelector('[data-action="apply"]'));
        await tick();

        const el = editor.querySelector('math-block');
        assert.ok(el, 'block formula not inserted');
        assert.equal(el.textContent, 'e = mc^2', 'wrong source');
        assert.equal(el.parentNode, editor, 'formula not placed at the remembered range');
    });

    await step('the formula keyboard inserts at the textarea caret', async () => {
        editor.innerHTML = '<p>x</p>';
        clickMenuItem('insert-math');
        await tick();
        assert.equal(dialog.open, true, 'dialog did not open');
        const texField = dialog.querySelector('[data-math-tex]');
        const keys = [...dialog.querySelectorAll('[data-math-key]')];
        assert.ok(keys.length >= 20, 'keyboard keys missing');
        const sqrtKey = keys.find((k) => k.dataset.mathKey.includes('sqrt'));
        assert.equal(sqrtKey.textContent, String.fromCharCode(8730), 'label not rendered as a symbol');
        assert.ok(!keys.some((k) => k.textContent.includes('%')), 'percent-escaped label found');
        const fracKey = keys.find((k) => (k.dataset.mathKey || '').includes('frac'));

        assert.ok(fracKey, 'frac key missing');
        fracKey.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        await tick();
        assert.ok(texField.value.startsWith('\\frac{'), 'snippet not inserted: ' + texField.value);

        // A second key appends at the caret; the preview keeps re-rendering.
        const piKey = keys.find((k) => k.dataset.mathKey === '\\pi');
        assert.ok(piKey, 'pi key missing');
        texField.setSelectionRange(texField.value.length, texField.value.length);
        piKey.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        await tick();
        assert.equal(texField.value, '\\frac{}{}\\pi', 'insert at caret failed: ' + texField.value);
        assert.ok(dialog.querySelector('[data-math-preview]'), 'preview present');
        click(dialog.querySelector('[data-action="cancel"]'));
        await tick();
    });

    await step('formulas expose a delete button that removes them', async () => {
        const paste = new window.Event('paste', { bubbles: true, cancelable: true });
        paste.clipboardData = { getData: (type) => (type === 'text/html' ? '<p>keep</p><math-block>x^2</math-block>' : '') };
        editor.dispatchEvent(paste);
        await tick();
        await tick();
        const el = editor.querySelector('math-block');
        const chrome = el.querySelector('[data-math-chrome]');
        assert.ok(chrome, 'chrome not mounted');
        assert.equal(chrome.getAttribute('contenteditable'), 'false');
        const btn = chrome.querySelector('.math-delete');
        assert.equal(btn.getAttribute('aria-label'), 'Delete formula');

        click(btn);
        await tick();
        assert.equal(dialog.open, true, 'confirmation did not open');
        click(dialog.querySelector('[data-action="confirm"]'));
        await tick();
        assert.equal(editor.querySelector('math-block'), null, 'formula not removed');
        assert.equal(window.getSelection().anchorNode.tagName, 'P', 'caret not parked in a paragraph');
    });

    await step('spellcheck skips formulas', async () => {
        editor.innerHTML = '<p>definately wrd</p><math-inline>x^2</math-inline>';
        editor.dispatchEvent(new window.Event('input', { bubbles: true }));
        await new Promise((resolve) => window.setTimeout(resolve, 700));

        const marks = [...editor.querySelectorAll('.spell-err')].map((el) => el.textContent);
        assert.ok(marks.includes('definately'), 'prose typo not marked');
        assert.equal(editor.querySelector('math-inline .spell-err'), null, 'formula marked');
    });

    await step('no uncaught page errors', () => {
        assert.deepEqual(consoleErrors, [], consoleErrors[0]);
    });

    check(`math-ui: ${steps.length} steps`, () => {
        assert.ok(stepFailures.length === 0, `failed: ${stepFailures.join(', ')}`);
    });

    // Let pending page timers run while the window is still open.
    await new Promise((resolve) => window.setTimeout(resolve, 5000));
    window.close();
}
