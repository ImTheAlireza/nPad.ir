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
    // active element belongs to the editable host of the selection. The
    // insert commands also mutate the DOM so undo/redo can be asserted.
    window.__execCalls = [];
    window.document.execCommand = (cmd, ui, value) => {
        const editor = window.document.getElementById('editor');
        const active = window.document.activeElement;
        const inEditor = active === editor || editor.contains(active);
        window.__execCalls.push({ cmd, value, inEditor, active: active?.id || active?.tagName });
        if (!inEditor) return false;
        if (cmd === 'insertHTML') editor.innerHTML = value;
        else if (cmd === 'insertText') editor.textContent = value;
        return true;
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

/**
 * Install a fake selection with explicit offsets — used to simulate making
 * a new selection (different offsets ⇒ different selection identity).
 */
function setSelection(window, { anchorOffset = 0, focusOffset = 5, text = 'Hello' } = {}) {
    const editor = window.document.getElementById('editor');
    const first = editor.firstChild;
    const range = {
        collapsed: false,
        startContainer: first,
        endContainer: first,
        startOffset: anchorOffset,
        endOffset: focusOffset,
        toString: () => text,
        cloneRange() { return { ...this, cloneRange: undefined }; },
    };
    window.getSelection = () => ({
        rangeCount: 1,
        isCollapsed: false,
        anchorNode: first,
        focusNode: first,
        anchorOffset,
        focusOffset,
        getRangeAt: () => range,
        toString: () => text,
        removeAllRanges() {},
        addRange() {},
    });
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
    // The default responder returns AI_REPLY as a 200 JSON chat completion;
    // tests can replace window.__aiResponder(requestBody) to simulate any
    // provider/proxy behaviour. The request payload is recorded on
    // window.__lastAiPayload for assertions.
    window.__aiResponder = null;
    window.__lastAiPayload = null;
    window.fetch = async (_url, opts = {}) => {
        const requestBody = opts.body ? JSON.parse(opts.body) : null;
        window.__lastAiPayload = requestBody?.payload ?? null;
        const reply = window.__aiResponder
            ? window.__aiResponder(requestBody)
            : { status: 200, body: { choices: [{ message: { content: AI_REPLY } }] } };
        const text = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body);
        const status = reply.status ?? 200;
        return {
            ok: status >= 200 && status < 300,
            status,
            text: async () => text,
            json: async () => JSON.parse(text),
        };
    };
    global.fetch = window.fetch;

    const ui = await import(pathToFileURL(path.join(ROOT, 'assets/js/ui.js')));
    const ai = await import(pathToFileURL(path.join(ROOT, 'assets/js/ai.js')));
    return { ui, ai };
}

let AI_REPLY = '<h2>Formatted</h2><p>Nice text.</p>';
const strings = new Proxy({
    // Real English copy for the diagnostic keys so assertions exercise the
    // actual user-facing messages (mirrors lang/en.php).
    aiHtmlResponse: 'The server returned an HTML page instead of a JSON API response (HTTP {status}). The Base URL probably points at a website, not an API — it should look like https://api.deepseek.com/v1',
    aiEmptyLength: 'The model hit its token limit before producing any text (finish reason "length"). Try again, select less text, or use a standard chat model instead of a reasoning model.',
    aiReasoningOnly: 'The model returned only internal reasoning and no answer text. Use a standard chat model (e.g. deepseek-chat, gpt-4o-mini) for these features.',
    aiWrongShape: "The endpoint answered in a non-OpenAI format. Use the provider's OpenAI-compatible Base URL — for Gemini: https://generativelanguage.googleapis.com/v1beta/openai",
    aiEmptyResponse: 'The AI returned an empty response.',
}, { get: (t, k) => (k in t ? t[k] : String(k)) });

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
        await done;
        await settle(10);

        assert.equal(window.document.getElementById('appDialog').open, false, 'no confirmation dialog');
        const inserts = window.__execCalls.filter((c) => c.cmd === 'insertHTML');
        assert.equal(inserts.length, 1, 'insertHTML called once');
        assert.equal(inserts[0].inEditor, true, `insert ran with editor focused (active=${inserts[0].active})`);
        assert.match(inserts[0].value, /<h2>Formatted<\/h2>/);
        assert.ok(window.document.querySelector('.ai-applied-toast'), 'applied toast with undo is shown');
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

        await done;
        await settle(10);

        assert.equal(window.document.getElementById('appDialog').open, false, 'no result dialog — applied directly');
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

        await done;
        await settle(10);

        const inserts = window.__execCalls.filter((c) => c.cmd === 'insertHTML');
        assert.equal(inserts.length, 1, 'inserted directly, no confirmation dialog');
        const inserted = inserts[0].value.replace(/\n/g, '');
        assert.match(inserted, /<h3>Heading<\/h3>/, 'markdown heading became an element');
        assert.match(inserted, /<ul><li>first point<\/li><li>second point<\/li><\/ul>/, 'markdown list became elements');
        assert.match(inserted, /<strong>bold<\/strong>/, 'bold became an element');
        AI_REPLY = '<h2>Formatted</h2><p>Nice text.</p>';
    });

    group('ai: truncation warning wiring');

    await check('summarize creates the note directly and the toast undo removes it', async () => {
        const dom = bootDom();
        const { window } = dom;
        grantConfig(window);
        window.getSelection = () => ({ rangeCount: 1, isCollapsed: true, anchorNode: null, getRangeAt: () => null, toString: () => '' });
        AI_REPLY = '## Summary\n- ok';
        const { ui, ai } = await loadModules(window);
        const editor = window.document.getElementById('editor');
        editor.textContent = 'Sentence ends here. '.repeat(400);
        const toasts = [];
        let created = null;
        const handle = {
            undoCalls: 0, redoCalls: 0,
            undo() { this.undoCalls++; }, redo() { this.redoCalls++; },
        };

        const done = ai.runSummarize(
            editor, strings, ui.showDialog, (m, v) => toasts.push(`${v}:${m}`),
            async (title, content) => {
                created = { title, content };
                return handle;
            },
        );
        await settle();
        await done;
        await settle(10);

        assert.equal(window.document.getElementById('appDialog').open, false, 'no confirmation dialog');
        assert.ok(created, 'note created directly without a confirm round');
        assert.match(created.content, /## Summary/, 'summary content passed through');

        const undoBtn = window.document.querySelector('.ai-applied-toast__action');
        assert.ok(undoBtn, 'applied toast carries an undo button');
        undoBtn.click();
        assert.equal(handle.undoCalls, 1, 'toast undo removes the created note');
        assert.ok(undoBtn.textContent.length > 0, 'button flips to redo');
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

    group('ai: provider response parsing is diagnosable');

    await check('callAI returns text for a normal chat completion', async () => {
        const dom = bootDom();
        const { window } = dom;
        grantConfig(window);
        const { ai } = await loadModules(window);
        const text = await ai.callAI('sys', 'user', strings);
        assert.equal(text, '<h2>Formatted</h2><p>Nice text.</p>');
        assert.equal(window.__lastAiPayload.max_completion_tokens, window.__lastAiPayload.max_tokens,
            'max_completion_tokens sent alongside max_tokens (o-series compat)');
    });

    await check('HTML reply with HTTP 200 produces the Base-URL hint, not a SyntaxError', async () => {
        const dom = bootDom();
        const { window } = dom;
        grantConfig(window);
        const { ai } = await loadModules(window);
        window.__aiResponder = () => ({
            status: 200,
            body: '<!DOCTYPE html><html><head><title>Sign in</title></head><body>Login page</body></html>',
        });
        await assert.rejects(
            () => ai.callAI('sys', 'user', strings),
            (err) => /HTML page instead of a JSON API response \(HTTP 200\)/.test(err.message)
                && /Base URL/.test(err.message),
        );
    });

    await check('HTML reply with HTTP 404 also produces the Base-URL hint', async () => {
        const dom = bootDom();
        const { window } = dom;
        grantConfig(window);
        const { ai } = await loadModules(window);
        window.__aiResponder = () => ({ status: 404, body: '<!doctype html><html><body>not found</body></html>' });
        await assert.rejects(
            () => ai.callAI('sys', 'user', strings),
            (err) => /HTML page instead of a JSON API response \(HTTP 404\)/.test(err.message),
        );
    });

    await check('provider error body with HTTP 200 surfaces the provider message', async () => {
        const dom = bootDom();
        const { window } = dom;
        grantConfig(window);
        const { ai } = await loadModules(window);
        window.__aiResponder = () => ({
            status: 200,
            body: { error: { message: 'Insufficient balance' } },
        });
        await assert.rejects(
            () => ai.callAI('sys', 'user', strings),
            (err) => err.message === 'AI provider error: Insufficient balance',
        );
    });

    await check('finish_reason "length" with empty content explains the token cap', async () => {
        const dom = bootDom();
        const { window } = dom;
        grantConfig(window);
        const { ai } = await loadModules(window);
        window.__aiResponder = () => ({
            status: 200,
            body: { choices: [{ message: { content: '' }, finish_reason: 'length' }] },
        });
        await assert.rejects(
            () => ai.callAI('sys', 'user', strings),
            (err) => /token limit/.test(err.message) && /reasoning model/.test(err.message),
        );
    });

    await check('reasoning-only answers point at standard chat models', async () => {
        const dom = bootDom();
        const { window } = dom;
        grantConfig(window);
        const { ai } = await loadModules(window);
        window.__aiResponder = () => ({
            status: 200,
            body: { choices: [{ message: { content: '', reasoning_content: 'Let me think…' }, finish_reason: 'stop' }] },
        });
        await assert.rejects(
            () => ai.callAI('sys', 'user', strings),
            (err) => /internal reasoning/.test(err.message),
        );
    });

    await check('non-OpenAI shapes (Gemini candidates) hint at the compat Base URL', async () => {
        const dom = bootDom();
        const { window } = dom;
        grantConfig(window);
        const { ai } = await loadModules(window);
        window.__aiResponder = () => ({
            status: 200,
            body: { candidates: [{ content: { parts: [{ text: 'hi' }] } }] },
        });
        await assert.rejects(
            () => ai.callAI('sys', 'user', strings),
            (err) => /non-OpenAI format/.test(err.message) && /v1beta\/openai/.test(err.message),
        );
    });

    await check('legacy completions shape (choices[0].text) still works', async () => {
        const dom = bootDom();
        const { window } = dom;
        grantConfig(window);
        const { ai } = await loadModules(window);
        window.__aiResponder = () => ({ status: 200, body: { choices: [{ text: 'Legacy reply' }] } });
        const text = await ai.callAI('sys', 'user', strings);
        assert.equal(text, 'Legacy reply');
    });

    await check('non-JSON error body without HTML falls back to status + snippet', async () => {
        const dom = bootDom();
        const { window } = dom;
        grantConfig(window);
        const { ai } = await loadModules(window);
        window.__aiResponder = () => ({ status: 502, body: 'Bad gateway' });
        await assert.rejects(
            () => ai.callAI('sys', 'user', strings),
            (err) => /HTTP 502/.test(err.message) && /Bad gateway/.test(err.message),
        );
    });

    await check('provider errors carry HTTP status and error code for billing issues', async () => {
        const dom = bootDom();
        const { window } = dom;
        grantConfig(window);
        const { ai } = await loadModules(window);
        window.__aiResponder = () => ({
            status: 402,
            body: { error: { message: 'Insufficient Balance', type: 'insufficient_balance' } },
        });
        await assert.rejects(
            () => ai.callAI('sys', 'user', strings),
            (err) => err.message === 'AI provider error (HTTP 402) [insufficient_balance]: Insufficient Balance',
        );
    });

    group('ai: reasoning models work instead of erroring');

    await check('empty-length triggers one automatic retry with a bigger budget and succeeds', async () => {
        const dom = bootDom();
        const { window } = dom;
        grantConfig(window);
        const { ai } = await loadModules(window);
        const budgets = [];
        let calls = 0;
        window.__aiResponder = (req) => {
            calls++;
            budgets.push(req.payload.max_tokens);
            if (calls === 1) {
                return { status: 200, body: { choices: [{ message: { content: '' }, finish_reason: 'length' }] } };
            }
            return { status: 200, body: { choices: [{ message: { content: 'Recovered answer' } }] } };
        };
        const text = await ai.callAI('sys', 'user', strings, { maxTokens: 80 });
        assert.equal(text, 'Recovered answer');
        assert.equal(calls, 2, 'exactly one retry');
        assert.ok(budgets[1] >= 4096, `retry budget should be >= 4096, got ${budgets[1]}`);
        assert.equal(budgets[1], window.__lastAiPayload.max_completion_tokens);
    });

    await check('persistent empty-length still surfaces the guidance error', async () => {
        const dom = bootDom();
        const { window } = dom;
        grantConfig(window);
        const { ai } = await loadModules(window);
        let calls = 0;
        window.__aiResponder = () => {
            calls++;
            return { status: 200, body: { choices: [{ message: { content: '' }, finish_reason: 'length' }] } };
        };
        await assert.rejects(() => ai.callAI('sys', 'user', strings, { maxTokens: 80 }), /token limit/);
        assert.equal(calls, 2, 'only one retry before failing');
    });

    await check('reasoning-model names start with a larger budget', async () => {
        const dom = bootDom();
        const { window } = dom;
        window.localStorage.setItem('npad:ai-user-base-url', 'https://api.example.com/v1');
        window.localStorage.setItem('npad:ai-user-api-key', 'sk-u');
        window.localStorage.setItem('npad:ai-user-model', 'deepseek-reasoner');
        window.localStorage.setItem('npad:ai-consent', '1');
        const { ai } = await loadModules(window);
        window.__aiResponder = () => ({ status: 200, body: { choices: [{ message: { content: 'ok' } }] } });
        await ai.callAI('sys', 'user', strings, { maxTokens: 80 });
        assert.ok(
            window.__lastAiPayload.max_tokens >= 2048,
            `reasoning model budget should be >= 2048, got ${window.__lastAiPayload.max_tokens}`,
        );
    });

    await check('strict OpenAI reasoning models drop custom temperature', async () => {
        const dom = bootDom();
        const { window } = dom;
        window.localStorage.setItem('npad:ai-user-base-url', 'https://api.openai.com/v1');
        window.localStorage.setItem('npad:ai-user-api-key', 'sk-u');
        window.localStorage.setItem('npad:ai-user-model', 'o3-mini');
        window.localStorage.setItem('npad:ai-consent', '1');
        const { ai } = await loadModules(window);
        window.__aiResponder = () => ({ status: 200, body: { choices: [{ message: { content: 'ok' } }] } });
        await ai.callAI('sys', 'user', strings, { maxTokens: 80, temperature: 0.5 });
        assert.equal(window.__lastAiPayload.temperature, undefined,
            'temperature must be omitted for o-series models');
    });

    group('ai: direct apply is reversible via undo/redo');

    await check('applied content is restored by aiUndo and re-applied by aiRedo', async () => {
        const dom = bootDom();
        const { window } = dom;
        grantConfig(window);
        window.getSelection = () => ({ rangeCount: 1, isCollapsed: true, anchorNode: null, getRangeAt: () => null, toString: () => '' });
        const { ui, ai } = await loadModules(window);
        const editor = window.document.getElementById('editor');
        editor.textContent = 'Original plain text that will be reformatted by the AI action soon.';
        const before = editor.innerHTML;

        const done = ai.runSmartFormat(editor, strings, ui.showDialog, () => {});
        await settle();
        await done;
        await settle(10);

        assert.notEqual(editor.innerHTML, before, 'apply mutated the content');
        assert.match(editor.innerHTML, /<h2>Formatted<\/h2>/);

        assert.equal(ai.aiHasUndo(), true);
        ai.aiUndo(editor);
        assert.equal(editor.innerHTML, before, 'undo restored the original content');

        assert.equal(ai.aiHasRedo(), true);
        ai.aiRedo(editor);
        assert.match(editor.innerHTML, /<h2>Formatted<\/h2>/, 'redo re-applied the formatted content');
    });

    await check('toast undo button restores content, redo button re-applies it', async () => {
        const dom = bootDom();
        const { window } = dom;
        grantConfig(window);
        fakeSelection(window, 'Some drafted sentence');
        AI_REPLY = 'Rewritten sentence.';
        const { ui, ai } = await loadModules(window);
        const editor = window.document.getElementById('editor');
        const before = editor.innerHTML;

        window.document.getElementById('aiMenuTrigger').focus();
        const done = ai.runToneRewrite(editor, strings, ui.showDialog, () => {});
        await settle();
        const picker = window.document.querySelector('#appDialog [data-action="rewrite"]');
        picker.click();
        await done;
        await settle(10);

        assert.equal(editor.textContent, 'Rewritten sentence.');

        const undoBtn = window.document.querySelector('.ai-applied-toast__action');
        undoBtn.click(); // Undo
        assert.equal(editor.innerHTML, before, 'toast undo restored the content');
        assert.equal(undoBtn.textContent, strings.aiRedo, 'button flipped to redo');
        undoBtn.click(); // Redo
        assert.equal(editor.textContent, 'Rewritten sentence.', 'toast redo re-applied');
        // Dismissal animates out over 200ms; the leaving class proves it fired.
        assert.ok(
            window.document.querySelector('.ai-applied-toast')?.classList.contains('toast--leaving'),
            'toast dismissed after redo',
        );
        AI_REPLY = '<h2>Formatted</h2><p>Nice text.</p>';
    });

    group('ai: selection summarize replaces the selection (no new note)');

    await check('selection toolbar summarize inserts in place and never creates a note', async () => {
        const dom = bootDom();
        const { window } = dom;
        grantConfig(window);
        AI_REPLY = '- bullet one\n- bullet two';
        const { ui, ai } = await loadModules(window);
        ai.__resetSelectionToolbarForTests();
        const editor = window.document.getElementById('editor');
        // Content must exist BEFORE the fake selection captures its node.
        editor.textContent = 'Before. A long passage the user highlighted for summarization. After.';
        const range = fakeSelection(window, 'A long passage the user highlighted for summarization.');
        const before = editor.innerHTML;

        // Move focus like a real click on the floating toolbar would.
        window.document.getElementById('aiMenuTrigger').focus();
        ai.handleSelectionAI(editor, strings, ui.showDialog, () => {}, 40, 40);
        await settle(20);

        const btn = window.document.querySelector('[data-ai-sel="sel-summarize"]');
        assert.ok(btn, 'selection toolbar rendered with a summarize action');
        btn.click();
        await settle(30);

        assert.match(editor.textContent, /bullet one/, 'summary inserted into the note');
        assert.notEqual(editor.innerHTML, before, 'selection was replaced');
        assert.equal(window.document.getElementById('appDialog').open, false, 'no dialog, no note creation');
        assert.ok(window.document.querySelector('.ai-applied-toast'), 'applied toast with undo shown');
        // Undo returns the exact pre-apply content.
        window.document.querySelector('.ai-applied-toast__action').click();
        assert.equal(editor.innerHTML, before, 'undo restored the original content');
        assert.ok(range, 'saved range existed');
        AI_REPLY = '<h2>Formatted</h2><p>Nice text.</p>';
    });

    group('ai: text → table');

    await check('statistical selection becomes a real table, applied directly', async () => {
        const dom = bootDom();
        const { window } = dom;
        grantConfig(window);
        AI_REPLY = [
            '| محصول | فروش (میلیون) | رشد |',
            '|-------|--------------|-----|',
            '| الف | ۱۲۰ | ٪۱۵ |',
            '| ب | ۹۵ | ٪۸ |',
        ].join('\n');
        const { ui, ai } = await loadModules(window);
        const editor = window.document.getElementById('editor');
        // Statistical-looking content must exist BEFORE the selection capture.
        editor.textContent = 'گزارش فروش:\nالف ۱۲۰ میلیون ٪۱۵\nب ۹۵ میلیون ٪۸\nپایان گزارش.';
        fakeSelection(window, editor.textContent.split('\n').slice(0, 3).join('\n'));
        const before = editor.innerHTML;
        const toasts = [];

        const done = ai.runTextToTable(editor, strings, ui.showDialog, (m, v) => toasts.push(`${v}:${m}`));
        await settle();
        await done;
        await settle(10);

        const table = editor.querySelector('table');
        assert.ok(table, 'a real <table> replaced the selection');
        assert.equal(table.querySelectorAll('thead th').length, 3, 'header cells built');
        assert.equal(table.querySelectorAll('tbody tr').length, 2, 'data rows built');
        assert.match(table.textContent, /۱۲۰/, 'Persian digits preserved');
        assert.equal(window.document.getElementById('appDialog').open, false, 'applied directly, no dialog');
        // Undo restores the pre-table content.
        ai.aiUndo(editor);
        assert.equal(editor.innerHTML, before, 'undo removed the table');
        AI_REPLY = '<h2>Formatted</h2><p>Nice text.</p>';
    });

    await check('prose selection is rejected before spending tokens', async () => {
        const dom = bootDom();
        const { window } = dom;
        grantConfig(window);
        const { ui, ai } = await loadModules(window);
        const editor = window.document.getElementById('editor');
        editor.textContent = 'این یک پاراگراف معمولی درباره‌ی وضعیت هوا است و هیچ داده آماری در آن نیست. دیروز بارانی بود و امروز آفتابی.';
        fakeSelection(window, editor.textContent);
        const toasts = [];
        const fetchCalls = [];
        window.__aiResponder = null;
        const realFetch = window.fetch;
        window.fetch = (...args) => { fetchCalls.push(args[0]); return realFetch(...args); };

        const done = ai.runTextToTable(editor, strings, ui.showDialog, (m, v) => toasts.push(`${v}:${m}`));
        await settle();
        await done;
        await settle(10);

        assert.equal(fetchCalls.length, 0, 'no AI call for obvious prose');
        assert.equal(editor.querySelector('table'), null, 'no table inserted');
        assert.ok(toasts.some((t) => t.startsWith('error:')), 'user told why it was rejected');
    });

    await check('a NOT_TABLE reply is rejected with a clear message', async () => {
        const dom = bootDom();
        const { window } = dom;
        grantConfig(window);
        AI_REPLY = 'NOT_TABLE';
        const { ui, ai } = await loadModules(window);
        const editor = window.document.getElementById('editor');
        editor.textContent = 'فروش الف ۱۲۰ میلیون\nفروش ب ۹۵ میلیون\nفروش پ ۸۸ میلیون';
        fakeSelection(window, editor.textContent);
        const toasts = [];

        const done = ai.runTextToTable(editor, strings, ui.showDialog, (m, v) => toasts.push(`${v}:${m}`));
        await settle();
        await done;
        await settle(10);

        assert.equal(editor.querySelector('table'), null, 'no table inserted');
        assert.ok(toasts.some((t) => t.startsWith('error:')), 'rejection message shown');
        AI_REPLY = '<h2>Formatted</h2><p>Nice text.</p>';
    });

    await check('a non-table reply (prose back from the model) is rejected', async () => {
        const dom = bootDom();
        const { window } = dom;
        grantConfig(window);
        AI_REPLY = 'متاسفم، نمی‌توانم این را به جدول تبدیل کنم چون داده کافی نیست.';
        const { ui, ai } = await loadModules(window);
        const editor = window.document.getElementById('editor');
        editor.textContent = 'درآمد ۱۰۰\nهزینه ۶۰\nسود ۴۰';
        fakeSelection(window, editor.textContent);
        const toasts = [];

        const done = ai.runTextToTable(editor, strings, ui.showDialog, (m, v) => toasts.push(`${v}:${m}`));
        await settle();
        await done;
        await settle(10);

        assert.equal(editor.querySelector('table'), null, 'garbage reply must not insert a table');
        assert.ok(toasts.some((t) => t.startsWith('error:')));
    });

    await check('no selection tells the user what to do', async () => {
        const dom = bootDom();
        const { window } = dom;
        grantConfig(window);
        window.getSelection = () => ({ rangeCount: 1, isCollapsed: true, anchorNode: null, getRangeAt: () => null, toString: () => '' });
        const { ui, ai } = await loadModules(window);
        const editor = window.document.getElementById('editor');
        editor.textContent = 'هرچی';
        const toasts = [];

        await ai.runTextToTable(editor, strings, ui.showDialog, (m, v) => toasts.push(`${v}:${m}`));
        await settle(10);

        assert.ok(toasts.some((t) => t.startsWith('info:')), 'guidance toast shown');
    });

    await check('a pure numeric column is accepted and becomes a single-value table', async () => {
        const dom = bootDom();
        const { window } = dom;
        grantConfig(window);
        AI_REPLY = '| مقدار |\n|-------|\n| ۱۲۳ |\n| ۴۵۶ |';
        const { ui, ai } = await loadModules(window);
        const editor = window.document.getElementById('editor');
        editor.textContent = '۱۲۳\n۴۵۶\n۷۸۹';
        fakeSelection(window, editor.textContent);

        const done = ai.runTextToTable(editor, strings, ui.showDialog, () => {});
        await settle();
        await done;
        await settle(10);

        const table = editor.querySelector('table');
        assert.ok(table, 'numeric column became a table');
        assert.match(table.textContent, /۴۵۶/);
        AI_REPLY = '<h2>Formatted</h2><p>Nice text.</p>';
    });

    await check('an absurd 600-row reply is refused instead of freezing the editor', async () => {
        const dom = bootDom();
        const { window } = dom;
        grantConfig(window);
        const row = (i) => `| ردیف ${i} | ۱ |`;
        AI_REPLY = ['| عنوان | مقدار |', '|-------|-------|', ...Array.from({ length: 600 }, (_, i) => row(i + 1))].join('\n');
        const { ui, ai } = await loadModules(window);
        const editor = window.document.getElementById('editor');
        editor.textContent = 'ردیف ۱ مقدار ۱\nردیف ۲ مقدار ۲\nردیف ۳ مقدار ۳';
        fakeSelection(window, editor.textContent);
        const toasts = [];

        const done = ai.runTextToTable(editor, strings, ui.showDialog, (m, v) => toasts.push(`${v}:${m}`));
        await settle();
        await done;
        await settle(10);

        assert.equal(editor.querySelector('table'), null, 'garbage 600-row reply must not insert');
        assert.ok(toasts.some((t) => t.startsWith('error:')), 'rejected with a message');
        AI_REPLY = '<h2>Formatted</h2><p>Nice text.</p>';
    });

    await check('a table the browser nests in a paragraph is lifted to a top-level block', async () => {
        const dom = bootDom();
        const { window } = dom;
        grantConfig(window);
        AI_REPLY = '| عنوان | مقدار |\n|-------|-------|\n| الف | ۱ |';
        const { ui, ai } = await loadModules(window);
        const editor = window.document.getElementById('editor');
        editor.textContent = 'درآمد ۱۰۰\nهزینه ۶۰\nسود ۴۰';
        fakeSelection(window, editor.textContent);
        // Simulate a browser heuristic that wraps the inserted table in a <p>.
        window.document.execCommand = (cmd, ui2, value) => {
            const active = window.document.activeElement;
            const inEditor = active === editor || editor.contains(active);
            if (inEditor && cmd === 'insertHTML') editor.innerHTML = `<p>${value}</p>`;
            return inEditor;
        };

        const done = ai.runTextToTable(editor, strings, ui.showDialog, () => {});
        await settle();
        await done;
        await settle(10);

        const table = editor.querySelector('table');
        assert.ok(table, 'table inserted');
        assert.equal(table.parentElement, editor, 'table lifted out of the paragraph to a top-level child');
        assert.equal(table.nextElementSibling?.tagName, 'P', 'spacer paragraph added below the table');
        assert.ok(editor.contains(table.querySelector('td')), 'cells intact after the lift');
        AI_REPLY = '<h2>Formatted</h2><p>Nice text.</p>';
    });

    group('ai: floating popup stays hidden after toolbar clicks');

    await check('clicking a main-toolbar button must not pop the AI selection popup back up', async () => {
        const dom = bootDom();
        const { window } = dom;
        const { ui, ai } = await loadModules(window);
        ai.__resetSelectionToolbarForTests();
        const editor = window.document.getElementById('editor');
        editor.textContent = 'Hello world of editing';

        // 1. User makes a selection → popup appears.
        setSelection(window, { anchorOffset: 0, focusOffset: 5, text: 'Hello' });
        ai.handleSelectionAI(editor, strings, ui.showDialog, () => {}, 40, 40);
        await settle(20); // visibility applies one rAF later
        const tb = window.document.querySelector('.ai-sel-toolbar');
        assert.ok(tb, 'popup element exists');
        assert.equal(tb.classList.contains('ai-sel-toolbar--visible'), true, 'popup shown for the selection');

        // 2. User clicks a main-toolbar button: pointerdown outside the
        //    popup hides it (formatting buttons keep the selection alive).
        const trigger = window.document.getElementById('aiMenuTrigger');
        trigger.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
        assert.equal(tb.classList.contains('ai-sel-toolbar--visible'), false, 'hidden on outside pointerdown');

        // 3. The document pointerup handler re-evaluates with the SAME
        //    (still-live) selection — it must NOT pop back up.
        ai.handleSelectionAI(editor, strings, ui.showDialog, () => {}, 40, 40);
        await settle(20);
        assert.equal(
            tb.classList.contains('ai-sel-toolbar--visible'),
            false,
            'same selection must not re-surface the popup after a toolbar click',
        );

        // 4. Re-clicks keep it hidden while the selection is unchanged.
        ai.handleSelectionAI(editor, strings, ui.showDialog, () => {}, 40, 40);
        await settle(20);
        assert.equal(tb.classList.contains('ai-sel-toolbar--visible'), false);

        // 5. A genuinely new selection brings the popup back.
        setSelection(window, { anchorOffset: 6, focusOffset: 11, text: 'world' });
        ai.handleSelectionAI(editor, strings, ui.showDialog, () => {}, 40, 40);
        await settle(20);
        assert.equal(tb.classList.contains('ai-sel-toolbar--visible'), true, 'new selection shows the popup again');

        // 6. Collapsing the selection hides it and re-arming works again.
        window.getSelection = () => ({ rangeCount: 1, isCollapsed: true, anchorNode: editor.firstChild, getRangeAt: () => null, toString: () => '' });
        ai.handleSelectionAI(editor, strings, ui.showDialog, () => {}, 40, 40);
        await settle(10);
        assert.equal(tb.classList.contains('ai-sel-toolbar--visible'), false, 'collapsed selection hides the popup');
        setSelection(window, { anchorOffset: 0, focusOffset: 5, text: 'Hello' });
        ai.handleSelectionAI(editor, strings, ui.showDialog, () => {}, 40, 40);
        await settle(20);
        assert.equal(tb.classList.contains('ai-sel-toolbar--visible'), true, 're-selecting the same text works after a collapse');
    });

    group('ai: option-based features keep their modals');

    await check('smart title still shows its picker and applies the chosen title', async () => {
        const dom = bootDom();
        const { window } = dom;
        grantConfig(window);
        window.getSelection = () => ({ rangeCount: 1, isCollapsed: true, anchorNode: null, getRangeAt: () => null, toString: () => '' });
        AI_REPLY = 'Title One\nTitle Two\nTitle Three';
        const { ui, ai } = await loadModules(window);
        const editor = window.document.getElementById('editor');
        editor.textContent = 'A reasonably long note body so the title suggestion has something to work with. '.repeat(2);
        let applied = null;

        const done = ai.runSmartTitle(editor, strings, ui.showDialog, () => {}, (t) => { applied = t; });
        await settle();

        const dlg = window.document.getElementById('appDialog');
        assert.equal(dlg.open, true, 'title picker modal opened');
        const radios = dlg.querySelectorAll('input[name="ai-title"]');
        assert.equal(radios.length, 3, 'three title options offered');
        radios[1].checked = true;

        dlg.querySelector('[data-action="apply"]').click();
        await done;
        await settle(10);
        assert.equal(applied, 'Title Two', 'the chosen option was applied');
        AI_REPLY = '<h2>Formatted</h2><p>Nice text.</p>';
    });

    group('ai: admin dashboard shares the diagnostics');

    await check('menu summarize stores note.html and opens the notes sidebar', () => {
        const ed = fs.readFileSync(path.join(ROOT, 'assets/js/editor.js'), 'utf8');
        assert.match(ed, /note\.html = content\.replace\(/, 'summary must be stored in the html field');
        assert.doesNotMatch(ed, /note\.content\s*=/, 'the legacy note.content write must be gone');
        const summarizeIdx = ed.indexOf("'ai-summarize':");
        const sidebarIdx = ed.indexOf('setSidebarOpen(true)', summarizeIdx);
        assert.ok(sidebarIdx > -1, 'creating a summary must open the notes sidebar so it is visible');
        assert.ok(ed.slice(summarizeIdx, sidebarIdx).includes('renderNotes()'), 'sidebar opens after the list re-renders');
        // renderNotes() draws the in-memory `notes` array: the created note
        // must be registered there, otherwise it appears only after reload.
        assert.match(
            ed.slice(summarizeIdx, sidebarIdx),
            /notes\.push\(note\)[\s\S]*renderNotes\(\)/,
            'the created note must be added to the in-memory list before re-render',
        );
        assert.match(ed.slice(summarizeIdx), /notes = notes\.filter\(\(item\) => item\.id !== note\.id\)/,
            'undo must also remove the note from the in-memory list');
        // Selection summarize must not create notes anymore.
        const selCall = ed.slice(ed.indexOf('handleSelectionAI('), ed.indexOf('x,') + 40);
        assert.doesNotMatch(selCall, /createNoteRecord/, 'selection summarize must not create notes');
    });

    await check('ai-panel.js imports the shared wrapper and dashboard loads it as a module', () => {
        const panel = fs.readFileSync(path.join(ROOT, 'admin/ai-panel.js'), 'utf8');
        assert.match(panel, /import \{ requestChatCompletion \} from '\.\.\/assets\/js\/ai-parse\.js'/,
            'admin panel must use the shared request wrapper');
        assert.doesNotMatch(panel, /\(empty\)/, "the old '(empty)' success path must be gone");
        const dash = fs.readFileSync(path.join(ROOT, 'admin/dashboard.php'), 'utf8');
        assert.ok(
            dash.includes('<script type="module" src="' + "<?= e(asset('admin/ai-panel.js')) ?>"),
            'dashboard must load ai-panel.js as a module',
        );
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
