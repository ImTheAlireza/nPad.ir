/**
 * AI buttons — regression tests for the Apply flow.
 *
 * Covers the failure class behind "Smart Formatting does nothing / Apply
 * does nothing":
 *   1. execCommand for an Apply on a selection must run while the editor
 *      holds focus, with the exact saved selection restored (a modal dialog
 *      hands focus back to the trigger button, not the editor).
 *   2. Oversized full-note runs must abort with a message instead of
 *      replacing the whole note with a partial rewrite.
 *   3. Markdown answers to the Smart-Formatting prompt must be converted
 *      to HTML before the preview/apply.
 *   4. The cleanInput truncation callback must actually fire (it drives the
 *      "trimmed to N words" warning).
 *   5. api/ai-proxy.php must not 403 same-origin requests whose Host header
 *      carries a port (dev/preview hosts), and must 403 foreign origins.
 */

import { JSDOM } from 'jsdom';
import { PHP } from '@php-wasm/universal';
import { loadNodeRuntime } from '@php-wasm/node';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ── jsdom boot ─────────────────────────────────────────────────────────── */

function bootDom() {
    const dom = new JSDOM(`<!DOCTYPE html><html lang="en"><body>
        <div id="toastRegion"></div>
        <dialog id="appDialog">
            <h2 class="dialog__title"></h2>
            <button class="dialog__close" type="button">✕</button>
            <div class="dialog__body"></div>
            <div class="dialog__footer"></div>
        </dialog>
        <button id="aiMenuTrigger">AI</button>
        <div id="editor" contenteditable="true"><p>Hello world of editing</p></div>
    </body></html>`, { url: 'https://npad.ir/', pretendToBeVisual: true });

    const { window } = dom;

    // jsdom does not implement innerText; ai.js reads editor.innerText.
    Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
        get() { return this.textContent; },
        configurable: true,
    });

    window.HTMLDialogElement.prototype.showModal = function () {
        if (!this.open) {
            this._focusBeforeModal = window.document.activeElement;
            this.open = true;
        }
    };
    window.HTMLDialogElement.prototype.close = function () {
        if (this.open) {
            this.open = false;
            this.dispatchEvent(new window.Event('close'));
            if (this._focusBeforeModal?.isConnected) this._focusBeforeModal.focus();
        }
    };

    // Emulate the browser rule: editing commands only take effect when the
    // active element belongs to the editable host of the selection.
    window.__execCalls = [];
    window.document.execCommand = (cmd, ui, value) => {
        const editor = window.document.getElementById('editor');
        const active = window.document.activeElement;
        const inEditor = active === editor || editor.contains(active);
        window.__execCalls.push({ cmd, value, inEditor, active: active?.id || active?.tagName });
        return inEditor;
    };

    return dom;
}

/** Fake a live, non-collapsed selection inside the editor element. */
function fakeSelection(window, text = 'Hello') {
    const editor = window.document.getElementById('editor');
    const saved = {
        collapsed: false,
        startContainer: editor.firstChild,
        endContainer: editor.firstChild,
        startOffset: 0,
        endOffset: 5,
        toString: () => text,
    };
    const range = { ...saved, cloneRange: () => ({ ...saved, cloneRange: undefined }) };
    const selection = {
        rangeCount: 1,
        isCollapsed: false,
        anchorNode: editor.firstChild,
        focusNode: editor.firstChild,
        getRangeAt: () => range,
        toString: () => text,
        removeAllRanges() {},
        addRange() {},
    };
    window.getSelection = () => selection;
    return range;
}

async function loadModules(window) {
    global.window = window;
    global.document = window.document;
    global.HTMLElement = window.HTMLElement;
    global.Node = window.Node;
    global.Event = window.Event;
    global.localStorage = window.localStorage;
    global.requestAnimationFrame = (cb) => setTimeout(cb, 0);

    // Modules resolve bare `fetch` from the Node global → stub both realms.
    window.fetch = async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: AI_REPLY } }] }),
    });
    global.fetch = window.fetch;

    const ui = await import(pathToFileURL(path.join(ROOT, 'assets/js/ui.js')));
    const ai = await import(pathToFileURL(path.join(ROOT, 'assets/js/ai.js')));
    return { ui, ai };
}

let AI_REPLY = '<h2>Formatted</h2><p>Nice text.</p>';
const strings = new Proxy({}, { get: (_t, k) => String(k) });

function grantConfig(window) {
    window.localStorage.setItem('npad:ai-base-url', 'https://api.example.com/v1');
    window.localStorage.setItem('npad:ai-api-key', 'sk-test');
    window.localStorage.setItem('npad:ai-model', 'test-model');
    window.localStorage.setItem('npad:ai-consent', '1');
}

const settle = (ms = 50) => new Promise((r) => setTimeout(r, ms));

export default async function run(check, group) {
    group('ai: selection Apply must reach the editor');

    await check('smart format: Apply re-focuses editor, restores selection, inserts HTML', async () => {
        const dom = bootDom();
        const { window } = dom;
        grantConfig(window);
        fakeSelection(window);
        const { ui, ai } = await loadModules(window);
        const toasts = [];

        window.document.getElementById('aiMenuTrigger').focus(); // menu click state
        const done = ai.runSmartFormat(
            window.document.getElementById('editor'), strings, ui.showDialog, (m, v) => toasts.push(`${v}:${m}`));
        await settle();

        const apply = window.document.querySelector('#appDialog [data-action="apply"]');
        assert.ok(apply, 'result dialog with Apply opened');
        apply.click();
        await done;
        await settle(10);

        const inserts = window.__execCalls.filter((c) => c.cmd === 'insertHTML');
        assert.equal(inserts.length, 1, 'insertHTML called once');
        assert.equal(inserts[0].inEditor, true, `insert ran with editor focused (active=${inserts[0].active})`);
        assert.match(inserts[0].value, /<h2>Formatted<\/h2>/);
    });

    await check('tone rewrite: Apply re-focuses editor and replaces the selection', async () => {
        const dom = bootDom();
        const { window } = dom;
        grantConfig(window);
        fakeSelection(window, 'Some drafted sentence');
        AI_REPLY = 'Rewritten sentence.';
        const { ui, ai } = await loadModules(window);
        const toasts = [];

        window.document.getElementById('aiMenuTrigger').focus();
        const done = ai.runToneRewrite(
            window.document.getElementById('editor'), strings, ui.showDialog, (m, v) => toasts.push(`${v}:${m}`));
        await settle();

        const rewrite = window.document.querySelector('#appDialog [data-action="rewrite"]');
        assert.ok(rewrite, 'tone picker opened');
        rewrite.click();
        await settle();

        const apply = window.document.querySelector('#appDialog [data-action="apply"]');
        assert.ok(apply, 'result dialog opened');
        apply.click();
        await done;
        await settle(10);

        const inserts = window.__execCalls.filter((c) => c.cmd === 'insertText');
        assert.equal(inserts.length, 1, 'insertText called once');
        assert.equal(inserts[0].inEditor, true, `insert ran with editor focused (active=${inserts[0].active})`);
        assert.equal(inserts[0].value, 'Rewritten sentence.');
        AI_REPLY = '<h2>Formatted</h2><p>Nice text.</p>';
    });

    group('ai: oversized full-note runs must refuse, not wipe content');

    await check('smart format aborts with a message on a 40k-char note', async () => {
        const dom = bootDom();
        const { window } = dom;
        grantConfig(window);
        // No selection → full-note mode.
        window.getSelection = () => ({ rangeCount: 1, isCollapsed: true, anchorNode: null, getRangeAt: () => null, toString: () => '' });
        const { ui, ai } = await loadModules(window);
        const editor = window.document.getElementById('editor');
        editor.textContent = 'word '.repeat(8_000); // 40 000 chars
        const toasts = [];
        window.document.getElementById('aiMenuTrigger').focus();

        await ai.runSmartFormat(editor, strings, ui.showDialog, (m, v) => toasts.push(`${v}:${m}`));
        await settle(10);

        assert.equal(window.document.getElementById('appDialog').open, false, 'no result dialog opened');
        assert.equal(window.__execCalls.length, 0, 'no execCommand (content untouched)');
        assert.ok(toasts.some((t) => t.startsWith('info:')), 'user was told why');
    });

    await check('tone rewrite aborts with a message on a 40k-char note', async () => {
        const dom = bootDom();
        const { window } = dom;
        grantConfig(window);
        window.getSelection = () => ({ rangeCount: 1, isCollapsed: true, anchorNode: null, getRangeAt: () => null, toString: () => '' });
        const { ui, ai } = await loadModules(window);
        const editor = window.document.getElementById('editor');
        editor.textContent = 'word '.repeat(8_000);
        const toasts = [];

        await ai.runToneRewrite(editor, strings, ui.showDialog, (m, v) => toasts.push(`${v}:${m}`));
        await settle(10);

        assert.equal(window.document.getElementById('appDialog').open, false);
        assert.equal(window.__execCalls.length, 0, 'no execCommand — no silent wipe');
        assert.ok(toasts.some((t) => t.startsWith('info:')));
    });

    group('ai: markdown answers still produce formatted HTML');

    await check('smart format converts a markdown-only reply to HTML before preview/apply', async () => {
        const dom = bootDom();
        const { window } = dom;
        grantConfig(window);
        window.getSelection = () => ({ rangeCount: 1, isCollapsed: true, anchorNode: null, getRangeAt: () => null, toString: () => '' });
        AI_REPLY = '## Heading\n- first point\n- second point\n\nNormal **bold** paragraph.';
        const { ui, ai } = await loadModules(window);
        const editor = window.document.getElementById('editor');
        editor.textContent = 'a sentence about something. '.repeat(400); // ~11k chars, under the limit
        const toasts = [];
        window.document.getElementById('aiMenuTrigger').focus();

        const done = ai.runSmartFormat(editor, strings, ui.showDialog, (m, v) => toasts.push(`${v}:${m}`));
        await settle();

        const body = window.document.querySelector('#appDialog .dialog__body');
        assert.ok(window.document.getElementById('appDialog').open, 'dialog opened');
        assert.match(body.innerHTML, /<h3>Heading<\/h3>/, 'markdown heading became an element');
        assert.match(body.innerHTML.replace(/\n/g, ''), /<ul><li>first point<\/li><li>second point<\/li><\/ul>/, 'markdown list became elements');
        assert.match(body.innerHTML, /<strong>bold<\/strong>/, 'bold became an element');

        const apply = window.document.querySelector('#appDialog [data-action="apply"]');
        apply.click();
        await done;
        await settle(10);

        const inserts = window.__execCalls.filter((c) => c.cmd === 'insertHTML');
        assert.equal(inserts.length, 1);
        assert.match(inserts[0].value, /<h3>Heading<\/h3>/);
        AI_REPLY = '<h2>Formatted</h2><p>Nice text.</p>';
    });

    group('ai: truncation warning wiring');

    await check('cleanInput fires the onTruncate callback when a cut happens', async () => {
        // Indirect, through the real module: summarize uses limit 200_000.
        const dom = bootDom();
        const { window } = dom;
        grantConfig(window);
        window.getSelection = () => ({ rangeCount: 1, isCollapsed: true, anchorNode: null, getRangeAt: () => null, toString: () => '' });
        AI_REPLY = '## Summary\n- ok';
        const { ui, ai } = await loadModules(window);
        const editor = window.document.getElementById('editor');
        editor.textContent = 'Sentence ends here. '.repeat(12_000); // ~240k chars > limit
        const toasts = [];

        const done = ai.runSummarize(
            editor, strings, ui.showDialog, (m, v) => toasts.push(`${v}:${m}`),
            () => {},
        );
        await settle();
        // Close the result dialog — the assertion is about the warning toast.
        window.document.querySelector('#appDialog [data-action="cancel"]')?.click();
        await done;
        await settle(10);

        assert.ok(
            toasts.some((t) => t.startsWith('info:')),
            'truncation toast fired for the oversized note',
        );
        AI_REPLY = '<h2>Formatted</h2><p>Nice text.</p>';
    });

    group('ai: proxy same-origin check');

    await check('ai-proxy.php accepts a same-origin request whose Host carries a port', async () => {
        // Must get past the origin check to the endpoint validation, i.e.
        // "Only HTTPS endpoints…" — not "Forbidden". (Regression for the
        // HTTP_HOST-with-port vs parse_url-host mismatch.)
        const status = await runProxy({
            HTTP_HOST: 'localhost:8787',
            HTTP_ORIGIN: 'http://localhost:8787',
        }, JSON.stringify({ endpoint: 'http://example.com/v1', apiKey: 'k', payload: {} }));
        assert.equal(status.status, 400);
        assert.match(status.body, /Only HTTPS/);
    });

    await check('ai-proxy.php still rejects a foreign origin', async () => {
        const status = await runProxy({
            HTTP_HOST: 'npad.ir',
            HTTP_ORIGIN: 'https://evil.example',
        }, JSON.stringify({ endpoint: 'https://api.example.com/v1', apiKey: 'k', payload: {} }));
        assert.equal(status.status, 403);
        assert.match(status.body, /Forbidden/);
    });

    await check('ai-proxy.php rejects plain-HTTP upstreams on public hosts', async () => {
        const status = await runProxy({
            HTTP_HOST: 'npad.ir',
            'Sec-Fetch-Site': 'same-origin',
        }, JSON.stringify({ endpoint: 'http://example.com/v1', apiKey: 'k', payload: {} }));
        assert.equal(status.status, 400);
        assert.match(status.body, /Only HTTPS/);
    });
}

/* ── helpers ────────────────────────────────────────────────────────────── */

let _php = null;
async function getPhp() {
    if (_php) return _php;
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
    _php = php;
    return php;
}

/** Run api/ai-proxy.php in php-wasm with explicit $_SERVER + raw body. */
async function runProxy(server, rawBody) {
    const php = await getPhp();
    const r = await php.run({
        scriptPath: '/site/api/ai-proxy.php',
        $_SERVER: {
            REQUEST_METHOD: 'POST',
            REQUEST_URI: '/api/ai-proxy.php',
            CONTENT_TYPE: 'application/json',
            HTTPS: 'on',
            ...server,
        },
        body: rawBody,
    });
    return { status: r.httpStatusCode, body: r.text };
}
