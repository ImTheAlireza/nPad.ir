/**
 * Inline autocomplete — unit tests over the real module.
 *
 * jsdom cannot lay out text (no real rects), so positioning is not asserted
 * here; the pure logic is: word extraction at the caret, prefix→suffix
 * suggestion, casing, repeat suppression, code/math suppression, Tab and
 * ArrowRight acceptance, and dismiss-on-other-keys.
 */

import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const strings = new Proxy({ autocompleteOn: 'on', autocompleteOff: 'off' }, { get: (t, k) => (k in t ? t[k] : String(k)) });

function boot() {
    const dom = new JSDOM(`<!DOCTYPE html><html lang="en"><body>
        <div id="toastRegion"></div>
        <div id="editor" contenteditable="true"><p><br></p></div>
    </body></html>`, { url: 'https://npad.ir/', pretendToBeVisual: true });
    const { window } = dom;
    global.window = window;
    global.document = window.document;
    global.HTMLElement = window.HTMLElement;
    global.Node = window.Node;
    global.Event = window.Event;
    global.localStorage = window.localStorage;
    return dom;
}

async function loadModule() {
    return import(pathToFileURL(path.join(ROOT, 'assets/js/autocomplete.js')));
}

/** Place a collapsed caret in the editor's first text node at `offset`. */
function caret(window, editor, offset) {
    const first = editor.firstChild.firstChild || editor.firstChild;
    // Ensure a text node exists.
    if (first.nodeType !== 3) {
        editor.firstChild.textContent = editor.firstChild.textContent || '';
    }
    const node = (editor.firstChild.firstChild.nodeType === 3) ? editor.firstChild.firstChild : editor.firstChild;
    const range = window.document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return node;
}

function ghostText(window) {
    return window.document.querySelector('.ai-autocomplete-ghost')?.textContent ?? '';
}

function makeKey(key, extra = {}) {
    return { key, preventDefault() { this.defaulted = true; }, stopPropagation() {}, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...extra };
}

export default async function run(check, group) {
    group('autocomplete: suggestion logic');

    await check('ghost completes a typed prefix (hel → p)', async () => {
        const dom = boot();
        const { window } = dom;
        const { initAutocomplete } = await loadModule();
        const editor = window.document.getElementById('editor');
        editor.firstChild.textContent = 'he';
        caret(window, editor, 2);

        const ac = initAutocomplete({ editor, strings, onEvent: () => {} });
        // The module evaluates on input with a 60ms debounce; trigger via key handler path.
        editor.dispatchEvent(new window.Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 120));

        const ghost = window.document.querySelector('.ai-autocomplete-ghost');
        assert.ok(ghost, 'ghost element created');
        assert.equal(ghost.textContent, 're', 'ghost shows the most frequent completion for "he" (→ here)');
    });

    await check('Tab accepts: ghost text is inserted at the caret', async () => {
        const dom = boot();
        const { window } = dom;
        const { initAutocomplete } = await loadModule();
        const editor = window.document.getElementById('editor');
        editor.firstChild.textContent = 'hel';
        caret(window, editor, 3);
        const ac = initAutocomplete({ editor, strings, onEvent: () => {} });

        let accepted = 0;
        window.document.execCommand = (cmd, ui, value) => {
            if (cmd === 'insertText') {
                editor.firstChild.textContent += value;
                accepted++;
            }
            return true;
        };

        editor.dispatchEvent(new window.Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 120));
        const key = makeKey('Tab');
        editor.dispatchEvent(Object.assign(new window.Event('keydown', { bubbles: true, cancelable: true }), { key: 'Tab' }));
        await new Promise((r) => setTimeout(r, 10));

        assert.equal(editor.firstChild.textContent, 'help', 'completion inserted after the typed prefix');
    });

    await check('another key dismisses the ghost without inserting', async () => {
        const dom = boot();
        const { window } = dom;
        const { initAutocomplete } = await loadModule();
        const editor = window.document.getElementById('editor');
        editor.firstChild.textContent = 'hel';
        caret(window, editor, 3);
        const ac = initAutocomplete({ editor, strings, onEvent: () => {} });
        window.document.execCommand = () => { throw new Error('must not insert'); };

        editor.dispatchEvent(new window.Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 120));
        editor.dispatchEvent(Object.assign(new window.Event('keydown', { bubbles: true, cancelable: true }), { key: 'x' }));
        await new Promise((r) => setTimeout(r, 10));

        const ghost = window.document.querySelector('.ai-autocomplete-ghost');
        assert.equal(ghost.textContent, '', 'ghost cleared on other keys');
    });

    await check('no suggestion for 1-char input or unknown prefixes', async () => {
        const dom = boot();
        const { window } = dom;
        const { initAutocomplete } = await loadModule();
        const editor = window.document.getElementById('editor');
        const ac = initAutocomplete({ editor, strings, onEvent: () => {} });
        window.document.execCommand = () => true;

        editor.firstChild.textContent = 'x';
        caret(window, editor, 1);
        editor.dispatchEvent(new window.Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 120));
        assert.equal(ghostText(window), '', '1 char → nothing');

        editor.firstChild.textContent = 'zzq';
        caret(window, editor, 3);
        editor.dispatchEvent(new window.Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 120));
        assert.equal(ghostText(window), '', 'unknown prefix → nothing');
    });

    await check('inside a code block the ghost never appears', async () => {
        const dom = boot();
        const { window } = dom;
        const { initAutocomplete } = await loadModule();
        const editor = window.document.getElementById('editor');
        editor.innerHTML = '<pre><code>hel</code></pre>';
        const node = editor.querySelector('code').firstChild;
        const range = window.document.createRange();
        range.setStart(node, 3);
        range.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        const ac = initAutocomplete({ editor, strings, onEvent: () => {} });

        editor.dispatchEvent(new window.Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 120));
        assert.equal(ghostText(window), '', 'code blocks are exempt');
    });

    await check('toggle persists and is reflected by isEnabled', async () => {
        const dom = boot();
        const { window } = dom;
        const { initAutocomplete } = await loadModule();
        const editor = window.document.getElementById('editor');
        const ac = initAutocomplete({ editor, strings, onEvent: () => {} });
        assert.equal(ac.isEnabled(), true, 'default on');
        ac.setEnabled(false);
        assert.equal(ac.isEnabled(), false);
        assert.equal(window.localStorage.getItem('npad:autocomplete-off'), '1');
        ac.setEnabled(true);
        assert.equal(ac.isEnabled(), true);
        assert.equal(window.localStorage.getItem('npad:autocomplete-off'), '0');
    });
}
