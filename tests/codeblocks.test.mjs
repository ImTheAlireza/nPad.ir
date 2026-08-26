/**
 * Unit coverage for code blocks with syntax highlighting: the sanitiser's
 * bounded language classes, the Markdown fence round trip, and the runtime
 * module (chrome, highlight/unhighlight cycle, normalisation, editing keys,
 * copy) against the real vendored Prism bundle in jsdom.
 *
 * The shared check() harness is synchronous; like tables-ui, asynchronous
 * steps report through a local helper that funnels one summary into it.
 */

import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dom = new JSDOM('<!DOCTYPE html><body></body>', {
    url: 'https://npad.ir/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
});
const { window } = dom;
global.window = window;
global.document = window.document;
global.Node = window.Node;
global.DOMParser = window.DOMParser;
global.Event = window.Event;
global.HTMLElement = window.HTMLElement;
// Node 22 exposes globalThis.navigator as a getter-only property.
Object.defineProperty(global, 'navigator', { value: window.navigator, configurable: true, writable: true });

// The vendored bundle, in manual mode, before the module under test loads:
// codeblock.js then picks it up instead of injecting a script tag.
window.Prism = { manual: true };
window.eval(fs.readFileSync(
    path.join(ROOT, 'assets/js/vendor/prism-1.30.0.min.js'),
    'utf8',
));
assert.ok(window.Prism.highlightElement, 'Prism bundle did not initialise');

const { sanitizeHtml } = await import(`file://${path.join(ROOT, 'assets/js/sanitize.js')}`);
const formats = await import(`file://${path.join(ROOT, 'assets/js/formats.js')}`);
const { initCodeblocks } = await import(`file://${path.join(ROOT, 'assets/js/codeblock.js')}`);
const { initSpellcheck } = await import(`file://${path.join(ROOT, 'assets/js/spellcheck.js')}`);
const tick = () => new Promise((resolve) => window.setTimeout(resolve, 5));

const STRINGS = {
    codeCopy: 'Copy code', codeCopied: 'Code copied', codePlainText: 'Plain text',
    codeLangChip: 'Language: {lang}', codeLangChange: 'Change language',
    codeLangDialogTitle: 'Code language', codeLangLabel: 'Language',
    codeLangHint: 'hint', codeGroupWeb: 'Web', codeGroupData: 'Data',
    codeGroupApps: 'Programming', cancel: 'Cancel', apply: 'Apply',
};

/** Fresh editor with a wired module. */
function makeEditor(html, { strings = {}, tracked = [], edits = [] } = {}) {
    const editor = document.createElement('div');
    editor.innerHTML = html;
    document.body.appendChild(editor);
    const api = initCodeblocks({
        editor,
        strings: { ...STRINGS, ...strings },
        onEvent: (event) => tracked.push(event),
        onEdit: () => edits.push(1),
    });
    return { editor, api };
}

const caretIn = (node, offset = 0) => {
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
};

/** Caret inside the code's first text node (tokens may wrap the text). */
const caretInCode = (code, offset = 0) => {
    const walker = document.createTreeWalker(code, 4);
    caretIn(walker.nextNode(), offset);
};

export default async function run(check, group) {
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

    group('codeblocks: sanitiser');
    await step('language class on code is kept', () => {
        const html = sanitizeHtml('<pre><code class="language-js">const a;</code></pre>');
        assert.match(html, /<code class="language-js">/);
    });

    await step('language ids are bounded', () => {
        const bad = sanitizeHtml('<pre><code class="language-!!bad!!">x</code></pre>');
        assert.ok(!/language-!!/.test(bad), bad);
        const long = sanitizeHtml(`<pre><code class="language-${'x'.repeat(40)}">x</code></pre>`);
        assert.ok(!/language-x{25,}/.test(long), 'overlong id kept');
    });

    await step('foreign class lists on code are dropped', () => {
        const html = sanitizeHtml('<pre><code class="token spell-err">x</code></pre>');
        assert.ok(!/spell-err/.test(html), html);
        const multi = sanitizeHtml('<pre><code class="language-js language-python">x</code></pre>');
        assert.ok(!/language-python/.test(multi), multi);
    });

    await step('plain-text marker class is allowed', () => {
        const html = sanitizeHtml('<pre><code class="language-plain">x</code></pre>');
        assert.match(html, /<code class="language-plain">/);
    });

    await step('class stays forbidden everywhere else', () => {
        const html = sanitizeHtml('<p class="evil"><span class="token">x</span></p>');
        assert.ok(!/class=/.test(html), html);
    });

    group('codeblocks: markdown pairing');
    await step('fence info strings become language classes', () => {
        const html = formats.markdownToHtml('```js\nconst a = 1;\n```\n');
        assert.match(html, /<pre><code class="language-js">const a = 1;<\/code><\/pre>/);
        const tilde = formats.markdownToHtml('~~~python\nx = 1\n~~~\n');
        assert.match(tilde, /<code class="language-python">/);
    });

    await step('fences without a language stay plain', () => {
        const html = formats.markdownToHtml('```\nplain\n```\n');
        assert.match(html, /<pre><code>plain<\/code><\/pre>/);
    });

    await step('highlighted code exports its language into the fence', () => {
        const md = formats.htmlToMarkdown('<pre><code class="language-python">x = 1</code></pre>');
        assert.match(md, /```python\nx = 1\n```/);
    });

    await step('markdown code round trip keeps content and language', () => {
        const source = 'Before\n\n```javascript\nconst a = "<b>";\n// keep\n```\n\nAfter';
        const html = formats.markdownToHtml(source);
        const md = formats.htmlToMarkdown(html);
        assert.equal(md.trim(), source);
        const again = formats.markdownToHtml(md);
        assert.match(again, /<code class="language-javascript">/);
    });

    group('codeblocks: runtime module');
    await step('refreshAll mounts chrome and highlights with Prism', async () => {
        const tracked = [];
        const { editor, api } = makeEditor(
            '<p>hi</p><pre><code class="language-js">const x = 1; // note</code></pre>',
            { tracked },
        );
        api.refreshAll();
        await tick();

        const pre = editor.querySelector('pre');
        const chrome = pre.querySelector('[data-codeblock-chrome]');
        assert.ok(chrome, 'chrome not mounted');
        assert.equal(chrome.getAttribute('contenteditable'), 'false');
        const chip = chrome.querySelector('.codeblock-lang');
        assert.equal(chip.dataset.langLabel, 'JavaScript');
        assert.equal(chip.getAttribute('aria-label'), 'Language: JavaScript');
        const copyBtn = chrome.querySelector('.codeblock-copy');
        assert.equal(copyBtn.getAttribute('aria-label'), 'Copy code');
        assert.match(editor.querySelector('code').innerHTML, /<span class="token keyword">const<\/span>/);

        // The chip label is not a text node, so textContent is pure code.
        assert.equal(editor.querySelector('code').textContent, 'const x = 1; // note');
        editor.remove();
    });

    await step('stripRuntime restores the exact stored form', async () => {
        const stored = '<pre><code class="language-javascript">const x = 1;</code></pre>';
        const { editor, api } = makeEditor(`<p>hi</p>${stored}`);
        api.refreshAll();
        await tick();
        assert.ok(editor.querySelector('span.token'), 'not highlighted');

        const clone = editor.cloneNode(true);
        api.stripRuntime(clone);
        assert.equal(clone.querySelector('pre').outerHTML, stored);
        assert.equal(clone.querySelector('[data-codeblock-chrome]'), null);
        editor.remove();
    });

    await step('entering a block de-highlights it, leaving re-highlights', async () => {
        const { editor, api } = makeEditor(
            '<pre><code class="language-js">const x = 1;</code></pre><p>after</p>',
        );
        api.refreshAll();
        await tick();
        const code = editor.querySelector('code');
        assert.ok(editor.querySelector('span.token'), 'not highlighted');

        caretInCode(code, 3);
        api.syncSelection();
        await new Promise((resolve) => window.setTimeout(resolve, 140));
        assert.equal(editor.querySelectorAll('span.token').length, 0, 'still highlighted inside');
        assert.ok(editor.querySelector('pre').classList.contains('codeblock--editing'));

        caretIn(editor.querySelector('p').firstChild, 1);
        api.syncSelection();
        await new Promise((resolve) => window.setTimeout(resolve, 150));
        assert.ok(editor.querySelector('span.token'), 'not re-highlighted after leaving');
        editor.remove();
    });

    await step('Tab and Enter insert literal characters inside code', () => {
        const edits = [];
        const { editor, api } = makeEditor('<pre><code class="language-js">ab</code></pre>', { edits });
        api.refreshAll();
        const code = editor.querySelector('code');
        caretIn(code.firstChild, 1);

        const tab = new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
        assert.equal(api.insertKeydown(tab), true, 'Tab not handled');
        assert.equal(tab.defaultPrevented, true);
        assert.equal(code.textContent, 'a\tb');

        const enter = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        assert.equal(api.insertKeydown(enter), true, 'Enter not handled');
        assert.equal(code.textContent, 'a\t\nb');
        assert.equal(edits.length, 2, 'onEdit not called');

        // Outside code the keys keep their default behaviour.
        const p = document.createElement('p');
        p.textContent = 'text';
        editor.appendChild(p);
        caretIn(p.firstChild, 0);
        const outside = new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
        assert.equal(api.insertKeydown(outside), false, 'Tab handled outside code');
        editor.remove();
    });

    await step('normalise flattens pasted markup into plain code', () => {
        const { editor, api } = makeEditor(
            '<div><pre style="color:red"><code class="language-js"><div>line1</div>const <span class="token keyword">let</span> x;<br>line3</code></pre></div>',
        );
        api.normalise(editor);
        const code = editor.querySelector('pre code');
        assert.equal(code.textContent, 'line1\nconst let x;\nline3', JSON.stringify(code.textContent));
        assert.equal(code.getAttribute('class'), 'language-javascript');
        assert.equal(editor.querySelector('pre code span'), null);
        editor.remove();
    });

    await step('normalise canonicalises aliases', () => {
        const { editor, api } = makeEditor('<pre><code class="language-js">x</code></pre>');
        api.normalise(editor);
        assert.equal(editor.querySelector('code').getAttribute('class'), 'language-javascript');
        editor.remove();
    });

    await step('setBlockLanguage switches and re-highlights', async () => {
        const edits = [];
        const { editor, api } = makeEditor('<pre><code class="language-js">def f(): pass</code></pre>', { edits });
        api.refreshAll();
        await tick();
        const pre = editor.querySelector('pre');

        api.setBlockLanguage(pre, 'py');
        const code = editor.querySelector('code');
        assert.equal(code.getAttribute('class'), 'language-python');
        await tick();
        assert.match(code.innerHTML, /token\s+keyword|class="token keyword"/, 'python not highlighted');
        assert.equal(edits.length, 1, 'onEdit not called');
        assert.equal(pre.querySelector('.codeblock-lang').dataset.langLabel, 'Python', 'chip label not updated');

        api.setBlockLanguage(pre, '');
        assert.equal(code.getAttribute('class'), null);
        assert.equal(pre.querySelector('.codeblock-lang').dataset.langLabel, 'Plain text');
        editor.remove();
    });

    await step('copy button writes the code text and reports success', async () => {
        const tracked = [];
        const written = [];
        window.navigator.clipboard = {
            writeText: (text) => { written.push(text); return Promise.resolve(); },
        };
        const { editor, api } = makeEditor(
            '<pre><code class="language-js">const x = 1;</code></pre>',
            { tracked },
        );
        const region = document.createElement('div');
        region.id = 'toastRegion';
        document.body.appendChild(region);

        api.refreshAll();
        await tick();
        editor.querySelector('.codeblock-copy')
            .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        await tick();

        assert.deepEqual(written, ['const x = 1;']);
        assert.ok(tracked.includes('code_copied'), 'code_copied not tracked');
        assert.equal(region.textContent, 'Code copied');
        region.remove();
        editor.remove();
    });

    await step('spellcheck never marks inside code blocks', async () => {
        const editor = document.createElement('div');
        editor.innerHTML = '<p>definately wrd</p><pre><code class="language-js">definately const</code></pre>';
        document.body.appendChild(editor);
        const spell = initSpellcheck({ editor, strings: {}, onEvent: () => {} });
        spell.refresh();
        await tick();
        await tick();

        const marked = [...editor.querySelectorAll('.spell-err')].map((el) => el.textContent);
        assert.ok(marked.includes('definately'), 'misspelled prose not marked');
        assert.ok(!marked.includes('const'), 'keyword marked');
        assert.equal(editor.querySelector('pre .spell-err, code .spell-err'), null, 'code text was spell-marked');
        editor.remove();
    });

    check(`codeblocks: ${steps.length} steps`, () => {
        assert.deepEqual(stepFailures, [], stepFailures.join(', '));
    });
}
