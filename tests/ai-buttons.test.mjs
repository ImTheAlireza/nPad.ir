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
