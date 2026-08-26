/**
 * End-to-end coverage for the code block feature: Insert menu -> code block
 * in the editor -> runtime chrome (language chip + copy button) -> language
 * dialog -> Tab/Enter editing -> autosave stores the plain form.
 *
 * Same harness as tables-ui: the real page is rendered by PHP 8.2 under
 * php-wasm, booted in jsdom with the actual ES modules, and the flow is
 * awaited step by step. The vendored Prism bundle is pre-loaded into the
 * window (manual mode) so highlighting runs synchronously without network.
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
    const rt = await loadNodeRuntime('8.2', { emscriptenOptions: { processId: 4 } });
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
    // jsdom has no execCommand; stub insertText for real so the editor's
    // primary insertion path (used by Tab/Enter inside code) is exercised.
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

    // Manual-mode Prism before the editor boots: the module then never tries
    // to inject a script tag (jsdom cannot fetch file:// URLs).
    window.Prism = { manual: true };
    window.eval(fs.readFileSync(path.join(ROOT, 'assets/js/vendor/prism-1.30.0.min.js'), 'utf8'));

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

    // Let the asynchronous note boot (IndexedDB fallback) finish.
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    const editor = document.getElementById('editor');
    const dialog = document.getElementById('appDialog');
    const insertMenuTrigger = document.getElementById('insertMenuTrigger');
    const insertMenuPanel = document.getElementById('insertMenuPanel');
    const flush = () => new Promise((resolve) => queueMicrotask(resolve));
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

    group('codeblocks-ui: end-to-end');

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
            console.log(`        ${String(err.message).split('\n')[0]}`);
        }
    };

    await step('Insert menu -> code block appears with chrome and caret inside', async () => {
        editor.innerHTML = '<p>before</p><p><br></p>';
        putCaret(editor.querySelector('p:last-child'));
        clickMenuItem('insert-code');
        await flush();

        const pre = editor.querySelector('pre');
        assert.ok(pre, 'code block not inserted');
        assert.equal(pre.parentNode, editor, 'code block not a top-level block');
        const code = pre.querySelector('code');
        assert.ok(code, 'no code element inside pre');
        assert.ok(!code.getAttribute('class'), 'new block should start plain');

        const chrome = pre.querySelector('[data-codeblock-chrome]');
        assert.ok(chrome, 'chrome not mounted');
        assert.equal(chrome.querySelector('.codeblock-lang').dataset.langLabel, 'Plain text');
        assert.ok(chrome.querySelector('.codeblock-copy'), 'copy button missing');

        const selection = window.getSelection();
        assert.ok(code.contains(selection.anchorNode), 'caret not placed inside the code');
        assert.ok(tracked.includes('code_block_inserted'), 'code_block_inserted not tracked');
    });

    await step('typing code and switching language highlights it', async () => {
        const pre = editor.querySelector('pre');
        const code = pre.querySelector('code');
        code.textContent = 'const answer = 42;';

        // Language chip -> dialog -> pick JavaScript -> apply.
        click(pre.querySelector('.codeblock-lang'));
        await flush();
        assert.equal(dialog.open, true, 'language dialog did not open');
        const select = dialog.querySelector('[data-code-lang-select]');
        assert.ok(select, 'language select missing');
        select.value = 'javascript';
        select.dispatchEvent(new window.Event('change', { bubbles: true }));
        click(dialog.querySelector('[data-action="apply"]'));
        await flush();

        assert.equal(code.getAttribute('class'), 'language-javascript', 'class not applied');
        assert.equal(pre.querySelector('.codeblock-lang').dataset.langLabel, 'JavaScript');

        // The caret was inside the block, so it stays plain (edit mode) and
        // paints when the selection moves elsewhere — as after clicking away.
        putCaret(editor.querySelector('p'), 0);
        document.dispatchEvent(new window.Event('selectionchange'));
        await new Promise((resolve) => window.setTimeout(resolve, 150));
        assert.match(code.innerHTML, /<span class="token keyword">const<\/span>/, 'not highlighted');
    });

    await step('copy button writes the plain code text', async () => {
        const written = [];
        window.navigator.clipboard = {
            writeText: (text) => { written.push(text); return Promise.resolve(); },
        };
        const pre = editor.querySelector('pre');
        click(pre.querySelector('.codeblock-copy'));
        await flush();
        await tick();

        assert.deepEqual(written, ['const answer = 42;'], 'clipboard text is not the plain code');
        assert.ok(tracked.includes('code_copied'), 'code_copied not tracked');
        assert.ok(
            document.getElementById('toastRegion').textContent.includes('Code copied'),
            'no success toast',
        );
    });

    await step('Tab inserts a tab inside the block', () => {
        const code = editor.querySelector('pre code');
        putCaret(code, 0);
        const event = new window.KeyboardEvent('keydown', {
            key: 'Tab', bubbles: true, cancelable: true,
        });
        editor.dispatchEvent(event);
        assert.equal(event.defaultPrevented, true, 'Tab default not prevented');
        assert.equal(code.textContent, '\tconst answer = 42;');
    });

    await step('selection leaving the block re-highlights, save stores plain', async () => {
        const pre = editor.querySelector('pre');
        const code = pre.querySelector('code');

        // Caret into the code: block drops to plain (edit mode).
        putCaret(code.firstChild, 2);
        document.dispatchEvent(new window.Event('selectionchange'));
        await new Promise((resolve) => window.setTimeout(resolve, 150));
        assert.equal(code.querySelectorAll('span.token').length, 0, 'still highlighted in edit mode');

        // Caret out: re-highlighted.
        putCaret(editor.querySelector('p'), 0);
        document.dispatchEvent(new window.Event('selectionchange'));
        await new Promise((resolve) => window.setTimeout(resolve, 150));
        assert.ok(code.querySelector('span.token'), 'not re-highlighted after leaving');

        // Autosave stores the plain stored form: no tokens, no chrome.
        editor.dispatchEvent(new window.Event('input', { bubbles: true }));
        await new Promise((resolve) => window.setTimeout(resolve, 900)); // autosave 800ms
        const saved = window.localStorage.getItem('npad:notes');
        assert.ok(saved, 'nothing saved to storage');
        const notes = JSON.parse(saved);
        const storedHtml = notes?.notes?.map((n) => n.html).join('') ?? '';
        assert.match(storedHtml, /<pre><code class="language-javascript">/, 'stored form lacks language class');
        assert.ok(!storedHtml.includes('span class="token'), 'token spans leaked into storage');
        assert.ok(!storedHtml.includes('data-codeblock-chrome'), 'chrome leaked into storage');
        assert.ok(storedHtml.includes('\tconst answer = 42;'), 'code text not stored faithfully');
        console.log('        [debug] stored:', storedHtml.slice(0, 600));
    });

    await step('markdown-rendered paste gains language, highlight and chrome', async () => {
        // The File > Open markdown path stores markdownToHtml output; pasting
        // exercises the same sanitise -> normalise -> highlight pipeline.
        editor.innerHTML = '<p>x</p>';
        const { markdownToHtml } = await import(url('assets/js/formats.js'));
        const rendered = markdownToHtml('```python\ndef f():\n    return 1\n```\n');
        const paste = new window.Event('paste', { bubbles: true, cancelable: true });
        paste.clipboardData = { getData: (type) => (type === 'text/html' ? rendered : '') };
        editor.dispatchEvent(paste);
        await tick();
        await tick();

        const code = editor.querySelector('pre code');
        assert.ok(code, 'markdown code block missing');
        assert.equal(code.getAttribute('class'), 'language-python', 'language class missing');
        assert.match(code.innerHTML, /token/, 'python not highlighted');
        assert.ok(editor.querySelector('pre [data-codeblock-chrome]'), 'chrome not mounted on paste');
    });

    await step('spellcheck skips code but marks prose', async () => {
        editor.innerHTML = '<p>definately wrd</p><pre><code class="language-js">const fixd = 1;</code></pre>';
        editor.dispatchEvent(new window.Event('input', { bubbles: true }));
        await new Promise((resolve) => window.setTimeout(resolve, 700)); // remark timer

        const marks = [...editor.querySelectorAll('.spell-err')].map((el) => el.textContent);
        assert.ok(marks.includes('definately'), 'prose typo not marked');
        assert.equal(editor.querySelector('pre .spell-err, code .spell-err'), null, 'code marked');
    });

    await step('no uncaught page errors', () => {
        assert.deepEqual(consoleErrors, [], consoleErrors[0]);
    });

    check('all codeblocks-ui steps pass', () => {
        assert.ok(stepFailures.length === 0, `failed: ${stepFailures.join(', ')}`);
    });

    // Let every pending page timer run while the window is still open —
    // autosave, spell remarks and toasts (4200ms) — because a timer firing
    // after window.close() crashes the process.
    await new Promise((resolve) => window.setTimeout(resolve, 5000));
    window.close();
}
