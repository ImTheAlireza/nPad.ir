/**
 * Unit coverage for math typesetting: sanitiser bounds on the math tags, the
 * Markdown delimiter round trip, and the runtime module against the real
 * vendored KaTeX in jsdom — render/strip cycle, edit mode, the keyboard
 * model, magic typing with its money heuristics, and the export treatments.
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
Object.defineProperty(global, 'navigator', { value: window.navigator, configurable: true, writable: true });

// The vendored KaTeX, before the modules load: mathblock.js then picks it up
// instead of injecting a script tag (jsdom cannot fetch file:// URLs).
window.eval(fs.readFileSync(path.join(ROOT, 'assets/js/vendor/katex-0.18.4.min.js'), 'utf8'));
assert.ok(window.katex.renderToString, 'KaTeX did not initialise');

const { sanitizeHtml } = await import(`file://${path.join(ROOT, 'assets/js/sanitize.js')}`);
const formats = await import(`file://${path.join(ROOT, 'assets/js/formats.js')}`);
const { initMath } = await import(`file://${path.join(ROOT, 'assets/js/mathblock.js')}`);
const tick = () => new Promise((resolve) => window.setTimeout(resolve, 5));
const BS = String.fromCharCode(92); // one literal backslash
const NEWLINE = String.fromCharCode(10);

const STRINGS = {
    mathDialogTitle: 'Math formula', mathSource: 'LaTeX source', mathMode: 'Placement',
    mathModeInline: 'Inline', mathModeBlock: 'Block', mathInsert: 'Insert formula',
    mathError: 'KaTeX could not parse this:', cancel: 'Cancel', apply: 'Apply',
};

function makeEditor(html, { tracked = [], edits = [] } = {}) {
    const editor = document.createElement('div');
    editor.innerHTML = html;
    document.body.appendChild(editor);
    const api = initMath({
        editor,
        strings: { ...STRINGS },
        onEvent: (e) => tracked.push(e),
        onEdit: () => edits.push(1),
        placeBlock: (el) => { editor.appendChild(el); return true; },
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

    group('math: sanitiser');
    await step('math tags are kept with their text source', () => {
        const html = sanitizeHtml('<p>a<math-inline>x^2</math-inline>b</p><math-block>\\frac{1}{2}</math-block>');
        assert.match(html, /<math-inline>x\^2<\/math-inline>/);
        assert.match(html, /<math-block>\\frac\{1\}\{2\}<\/math-block>/);
    });

    await step('math tags carry no permitted attributes', () => {
        const html = sanitizeHtml('<math-inline onclick="x()" data-tex="y" class="z">v</math-inline>');
        assert.equal(html, '<math-inline>v</math-inline>');
    });

    await step('math source text survives the sanitiser untouched', () => {
        const html = sanitizeHtml('<math-block>x < y > z &amp; \\begin{aligned}\\end{aligned}</math-block>');
        assert.match(html, /x &lt; y &gt; z &amp; /);
    });

    group('math: markdown pairing');
    await step('inline delimiters become math-inline elements', () => {
        const html = formats.markdownToHtml('Euler wrote $e^{i\\pi}+1=0$ in 1748.');
        assert.match(html, /<math-inline>e\^\{i\\pi\}\+1=0<\/math-inline>/);
    });

    await step('block delimiters become math-block elements', () => {
        const single = formats.markdownToHtml('$$x = \\frac{1}{2}$$');
        assert.match(single, /<math-block>x = \\frac\{1\}\{2\}<\/math-block>/);
        const multiline = formats.markdownToHtml('$$\na &= b \\\\\nc &= d\n$$');
        assert.ok(multiline.includes('<math-block>a &amp;= b ' + BS + BS + NEWLINE + 'c &amp;= d</math-block>'), multiline);
    });

    await step('money prose never becomes math', () => {
        const html = formats.markdownToHtml('I paid $5 and $10 total.');
        assert.ok(!/<math-/.test(html), html);
        assert.match(html, /\$5 and \$10/);
        const tight = formats.markdownToHtml('It costs $9.99 now.');
        assert.ok(!/<math-/.test(tight), tight);
    });

    await step('math exports its delimiters to Markdown and back', () => {
        const md = formats.htmlToMarkdown('<p>a</p><math-inline>e^{i\\pi}</math-inline><math-block>x = \\frac{1}{2}</math-block>');
        assert.match(md, /\$e\^\{i\\pi\}\$/);
        assert.match(md, /\$\$\nx = \\frac\{1\}\{2\}\n\$\$/);
        const back = formats.markdownToHtml(md);
        assert.match(back, /<math-inline>e\^\{i\\pi\}<\/math-inline>/);
        assert.match(back, /<math-block>x = \\frac\{1\}\{2\}<\/math-block>/);
    });

    await step('DOCX and RTF treat math as monospace source', () => {
        const rtf = formats.htmlToRtf('<math-inline>e^{i\\pi}</math-inline>');
        assert.ok(rtf.includes('\\f1 $e^'), rtf);
        assert.ok(rtf.includes('pi'), 'source missing from RTF');
        const docx = new TextDecoder().decode(formats.htmlToDocx('<math-inline>e^{i\\pi}</math-inline>'));
        assert.match(docx, /w:rFonts w:ascii="Courier New"/);
        assert.match(docx, /e\^\{i\\pi\}/);
    });

    group('math: runtime module');
    await step('refreshAll paints KaTeX and keeps the source', async () => {
        const { editor, api } = makeEditor('<p>x</p><math-block>x = \\frac{1}{2}</math-block>');
        api.refreshAll();
        await tick();
        const el = editor.querySelector('math-block');
        assert.equal(el.dataset.tex, 'x = \\frac{1}{2}', 'source not carried');
        assert.ok(el.querySelector('.katex'), 'KaTeX output missing');
        assert.ok(el.querySelector('math'), 'MathML for screen readers missing');
        editor.remove();
    });

    await step('stripRuntime restores the exact stored form', async () => {
        const stored = '<math-block>x = \\frac{1}{2}</math-block>';
        const { editor, api } = makeEditor(`<p>x</p>${stored}`);
        api.refreshAll();
        await tick();
        assert.ok(editor.querySelector('.katex'), 'not painted');
        const clone = editor.cloneNode(true);
        api.stripRuntime(clone);
        assert.equal(clone.querySelector('math-block').outerHTML, stored);
        editor.remove();
    });

    await step('entering a formula reveals raw LaTeX, leaving re-paints', async () => {
        const { editor, api } = makeEditor('<math-inline>e^{i\\pi}</math-inline><p>after</p>');
        api.refreshAll();
        await tick();
        const el = editor.querySelector('math-inline');
        assert.ok(el.querySelector('.katex'), 'not painted');

        caretIn(el.querySelector('.katex *'), 0);
        api.syncSelection();
        await new Promise((resolve) => window.setTimeout(resolve, 140));
        assert.equal(el.textContent, 'e^{i\\pi}', 'raw source not revealed');
        assert.ok(el.classList.contains('math--editing'));

        caretIn(editor.querySelector('p').firstChild, 0);
        api.syncSelection();
        await new Promise((resolve) => window.setTimeout(resolve, 140));
        assert.ok(el.querySelector('.katex'), 'not re-painted after leaving');
        editor.remove();
    });

    await step('Backspace on an emptied formula removes it', () => {
        const edits = [];
        const { editor, api } = makeEditor('<p>keep</p><math-inline>  </math-inline>', { edits });
        const el = editor.querySelector('math-inline');
        caretIn(el, 0);
        const back = new window.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
        assert.equal(api.insertKeydown(back), true, 'Backspace not handled');
        assert.equal(editor.querySelector('math-inline'), null, 'not removed');
        assert.equal(window.getSelection().anchorNode.tagName, 'P', 'caret not parked in a paragraph');
        assert.equal(edits.length, 1, 'onEdit not called');
        editor.remove();
    });

    await step('Enter leaves an inline formula; block multiline source works', () => {
        const edits = [];
        const { editor, api } = makeEditor('<p>before <math-inline>x^2</math-inline> after</p>', { edits });
        const el = editor.querySelector('math-inline');
        caretIn(el, 0);
        const enter = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        assert.equal(api.insertKeydown(enter), true);
        const caret = window.getSelection();
        assert.ok(!el.contains(caret.anchorNode), 'still inside inline formula');
        assert.equal(caret.anchorNode.parentElement.textContent.includes('after'), true, 'caret not after the formula');

        const { editor: bEditor, api: bApi } = makeEditor('<math-block>a = b</math-block><p><br></p>');
        const block = bEditor.querySelector('math-block');
        caretIn(block.firstChild, 3); // mid-source: Enter breaks the line
        const line = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        assert.equal(bApi.insertKeydown(line), true, 'block Enter not handled');
        assert.ok(block.textContent.includes('\n'), 'block source line not broken');
        assert.ok(block.contains(window.getSelection().anchorNode), 'caret left after a mid-line Enter');

        caretIn(block, block.childNodes.length);
        const exit = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        assert.equal(bApi.insertKeydown(exit), true);
        assert.ok(!block.contains(window.getSelection().anchorNode), 'still inside block formula');
        bEditor.remove();
        editor.remove();
    });

    group('math: magic typing');
    await step('typing the closing $$ creates a block formula', async () => {
        const tracked = [];
        const { editor, api } = makeEditor('<p>x</p>', { tracked });
        const p = editor.querySelector('p');
        p.textContent = '$$x = \\frac{1}{2}$$';
        caretIn(p.firstChild, p.firstChild.length);

        p.firstChild.dispatchEvent(new window.Event('input', { bubbles: true }));
        const input = new window.InputEvent('input', { data: '$', inputType: 'insertText', bubbles: true });
        editor.dispatchEvent(input);

        const el = editor.querySelector('math-block');
        assert.ok(el, 'block formula not created');
        assert.equal(el.textContent, 'x = \\frac{1}{2}', 'wrong source');
        assert.ok(tracked.includes('math_inserted'), 'not tracked');
        editor.remove();
    });

    await step('typing a single $ pair stays plain text', () => {
        const { editor, api } = makeEditor('<p>Euler: </p>');
        const p = editor.querySelector('p');
        p.firstChild.nodeValue = 'Euler: $e^{' + String.fromCharCode(92) + 'pi}+1=0$';
        caretIn(p.firstChild, p.firstChild.length);
        editor.dispatchEvent(new window.InputEvent('input', { data: '$', inputType: 'insertText', bubbles: true }));
        assert.equal(editor.querySelector('math-inline'), null, 'single-$ converted');
        assert.equal(editor.querySelector('math-block'), null, 'single-$ converted');
        assert.equal(p.textContent.includes('$e^{' + String.fromCharCode(92) + 'pi}'), true, 'prose was mutated');
        editor.remove();
    });

    await step('money text stays prose', () => {
        const { editor, api } = makeEditor('<p>I paid </p>');
        const p = editor.querySelector('p');
        p.firstChild.nodeValue = 'I paid $5 and $';
        caretIn(p.firstChild, p.firstChild.length);
        editor.dispatchEvent(new window.InputEvent('input', { data: '$', inputType: 'insertText', bubbles: true }));
        assert.equal(editor.querySelector('math-inline'), null, 'money converted to math');
        assert.equal(editor.querySelector('math-block'), null, 'money converted to math');
        editor.remove();
    });

    await step('typing inside a formula source never converts', () => {
        const { editor, api } = makeEditor('<p><math-inline>a_b</math-inline></p>');
        const el = editor.querySelector('math-inline');
        el.textContent = '$a_b$'; // user typed dollars into the source
        caretIn(el.firstChild, el.firstChild.length);
        editor.dispatchEvent(new window.InputEvent('input', { data: '$', inputType: 'insertText', bubbles: true }));
        assert.equal(editor.querySelectorAll('math-inline').length, 1, 'nested conversion happened');
        editor.remove();
    });

    check(`math: ${steps.length} steps`, () => {
        assert.deepEqual(stepFailures, [], stepFailures.join(', '));
    });
}
