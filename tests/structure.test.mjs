/**
 * Unit coverage for collapsible sections, the outline navigator, checklists
 * and the task overview: sanitiser bounds, Markdown round trips, the runtime
 * modules (section behaviour, outline build, checklist normalisation) and
 * the cross-note task scan.
 */

import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
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

const { sanitizeHtml } = await import(`file://${path.join(ROOT, 'assets/js/sanitize.js')}`);
const formats = await import(`file://${path.join(ROOT, 'assets/js/formats.js')}`);
const { initOutline } = await import(`file://${path.join(ROOT, 'assets/js/outline.js')}`);
const { initChecklist } = await import(`file://${path.join(ROOT, 'assets/js/checklist.js')}`);
const { detectDirection, isolate } = await import(`file://${path.join(ROOT, 'assets/js/bidi.js')}`);
const tick = () => new Promise((resolve) => window.setTimeout(resolve, 5));

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

    group('structure: sanitiser');
    await step('details/summary survive with their content and state', () => {
        const html = sanitizeHtml('<details open><summary>Title</summary><p>Body</p></details>');
        assert.match(html, /<details[^>]*open[^>]*><summary>Title<\/summary><p>Body<\/p><\/details>/);
        const closed = sanitizeHtml('<details><summary>T</summary></details>');
        assert.ok(!/<details open/.test(closed), 'closed section gained open');
    });

    await step('details carry no other attributes', () => {
        const html = sanitizeHtml('<details class="x" onclick="y()" open><summary>s</summary></details>');
        assert.match(html, /^<details[^>]*open[^>]*><summary>s<\/summary><\/details>$/);
    });

    await step('checkbox inputs survive only inside checklists', () => {
        const inside = sanitizeHtml('<ul class="checklist"><li><input type="checkbox" checked>Task</li></ul>');
        assert.match(inside, /<input type="checkbox"[^>]*checked/);
        const outside = sanitizeHtml('<p><input type="checkbox" checked>x</p>');
        assert.ok(!/<input/i.test(outside), outside);
        assert.match(outside, /x<\/p>/, 'text lost with the input');
    });

    await step('input attributes are tightly bounded', () => {
        const html = sanitizeHtml('<ul class="checklist"><li><input type="text" onclick="x()">v</li></ul>');
        assert.ok(!/<input/i.test(html), 'non-checkbox input kept');
        const evil = sanitizeHtml('<ul class="checklist"><li><input type="checkbox" onclick="x()" data-y="1" checked>v</li></ul>');
        assert.match(evil, /<input type="checkbox"[^>]*checked/);
        assert.ok(!/onclick|data-y/.test(evil), evil);
    });

    await step('checklist classes are bounded', () => {
        const list = sanitizeHtml('<ul class="checklist evil"><li class="task-checked admin">x</li></ul>');
        assert.match(list, /<ul class="checklist">/);
        assert.match(list, /<li class="task-checked">/);
        const plain = sanitizeHtml('<ul><li>x</li></ul>');
        assert.ok(!/class=/.test(plain), plain);
    });

    group('structure: markdown pairing');
    await step('task lists round trip through Markdown', () => {
        const html = formats.markdownToHtml('- [ ] milk\n- [x] tea\n');
        assert.match(html, /<ul class="checklist">/);
        assert.match(html, /<li><input type="checkbox">milk<\/li>/);
        assert.match(html, /<li class="task-checked"><input type="checkbox"[^>]*checked[^>]*>tea<\/li>/);
        const md = formats.htmlToMarkdown(html.replace(' class="checklist"', '').replace(' class="task-checked"', ''));
        // Round trip from the STORED form: the class is the truth, but the
        // checkbox state alone must also export correctly.
        const mdFromAttrs = formats.htmlToMarkdown(html.replace(' class="task-checked"', ''));
        assert.match(mdFromAttrs, /- \[ \] milk/);
        assert.match(mdFromAttrs, /- \[x\] tea/);
        const back = formats.markdownToHtml(mdFromAttrs);
        assert.match(back, /class="checklist"/);
        assert.match(back, /task-checked/);
        void md;
    });

    await step('details pass through Markdown as raw HTML', () => {
        const md = formats.htmlToMarkdown('<details open><summary>Title</summary><p>Body</p></details>');
        assert.match(md, /<details[^>]*open[^>]*><summary>Title<\/summary><p>Body<\/p><\/details>/);
        const back = formats.markdownToHtml(md);
        assert.match(back, /<details[^>]*open[^>]*>/);
        assert.match(back, /<summary>Title<\/summary>/);
    });

    group('structure: outline');
    await step('the panel lists headings and sections by level', async () => {
        document.body.innerHTML = `
            <div id="outlinePanel" hidden><p data-outline-empty hidden></p><div data-outline-list></div></div>
            <button data-action="outline"></button>
            <div id="ed"></div>`;
        const editor = document.getElementById('ed');
        editor.innerHTML = `
            <h2>Second level</h2>
            <p>intro</p>
            <h1>Top</h1>
            <details><summary>Boxed</summary><p>body</p></details>`;
        const api = initOutline({ editor, strings: {}, onEvent: () => {}, onEdit: () => {}, placeBlock: () => true });
        api.togglePanel();
        const labels = [...document.querySelectorAll('.outline-panel__entry')].map((el) => el.textContent.trim());
        assert.deepEqual(labels, ['Second level', 'Top', '▸Boxed'.replace('▸', '▸')], labels.join(','));
        const indents = [...document.querySelectorAll('.outline-panel__entry')].map((el) => el.style.paddingInlineStart);
        assert.ok(indents[1] < indents[0], 'level indent not applied');
        assert.equal(document.querySelector('[data-outline-empty]').hidden, true);
        editor.remove();
    });

    await step('clicking an entry places the caret at the heading', async () => {
        document.body.innerHTML = `
            <div id="outlinePanel" hidden><p data-outline-empty hidden></p><div data-outline-list></div></div>
            <button data-action="outline"></button>
            <div id="ed"><h2>Target</h2><p>after</p></div>`;
        const editor = document.getElementById('ed');
        const api = initOutline({ editor, strings: {}, onEvent: () => {}, onEdit: () => {}, placeBlock: () => true });
        api.togglePanel();
        document.querySelectorAll('.outline-panel__entry')[0].click();
        const selection = window.getSelection();
        assert.ok(editor.querySelector('h2').contains(selection.anchorNode), 'caret not at the heading');
        assert.equal(document.getElementById('outlinePanel').hidden, true, 'panel stayed open');
        editor.remove();
    });

    await step('clicking a summary toggles its section', () => {
        document.body.innerHTML = '<div id="ed"><details open><summary>Title</summary><p>body</p></details></div>';
        const editor = document.getElementById('ed');
        const api = initOutline({ editor, strings: {}, onEvent: () => {}, onEdit: () => {}, placeBlock: () => true });
        const details = editor.querySelector('details');
        editor.querySelector('summary').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.equal(details.open, false, 'did not collapse');
        editor.querySelector('summary').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        assert.equal(details.open, true, 'did not reopen');
        void api;
        editor.remove();
    });

    group('structure: checklists');
    await step('insertChecklist creates an empty first item with a placeholder, not literal text', () => {
        const edits = [];
        const tracked = [];
        document.body.innerHTML = '<div id="ed"><p><br></p></div>';
        const editor = document.getElementById('ed');
        const api = initChecklist({
            editor, strings: { checklistPlaceholder: 'Add a task…' }, onEvent: (e) => tracked.push(e),
            onEdit: () => edits.push(1), placeBlock: (el) => { editor.appendChild(el); return true; },
        });
        putCaretAtEnd(editor.querySelector('p'));
        api.insertChecklist();
        const list = editor.querySelector('ul.checklist');
        assert.ok(list, 'list not created');
        const input = list.querySelector('li input[type="checkbox"]');
        assert.ok(input, 'checkbox missing');
        const item = list.querySelector('li');
        assert.equal(item.textContent.trim(), '', 'first item must not contain literal text');
        assert.ok(item.classList.contains('checklist-empty'), 'empty item not marked for the placeholder');
        assert.equal(
            editor.style.getPropertyValue('--checklist-placeholder'),
            '"Add a task…"',
            'placeholder text not exposed to CSS',
        );
        const anchor = window.getSelection().anchorNode;
        assert.ok(item === anchor || item.contains(anchor), 'caret not in the item');
        assert.ok(tracked.includes('checklist_inserted'), 'not tracked');
        editor.remove();
    });

    await step('typing fills the item and drops the placeholder mark synchronously', () => {
        document.body.innerHTML = '<div id="ed"><p><br></p></div>';
        const editor = document.getElementById('ed');
        const api = initChecklist({
            editor, strings: {}, onEvent: () => {}, onEdit: () => {},
            placeBlock: (el) => { editor.appendChild(el); return true; },
        });
        api.insertChecklist();
        const item = editor.querySelector('ul.checklist li');
        assert.ok(item.classList.contains('checklist-empty'));
        item.appendChild(document.createTextNode('milk'));
        editor.dispatchEvent(new window.Event('input', { bubbles: true }));
        assert.ok(!item.classList.contains('checklist-empty'), 'filled item still marked empty');
        // The text node sits after the checkbox; delete it like Backspace would.
        assert.equal(item.lastChild.nodeType, 3, 'unexpected item structure');
        item.lastChild.remove();
        editor.dispatchEvent(new window.Event('input', { bubbles: true }));
        assert.ok(item.classList.contains('checklist-empty'), 'emptied item not re-marked');
        editor.remove();
    });

    await step('normalise marks empties and preserves a checked attribute without the class', () => {
        document.body.innerHTML = '<div id="ed"><ul class="checklist">'
            + '<li><input type="checkbox" checked></li>'
            + '<li><input type="checkbox">x</li></ul></div>';
        const editor = document.getElementById('ed');
        const api = initChecklist({ editor, strings: {}, onEvent: () => {}, onEdit: () => {}, placeBlock: () => true });
        api.normalise(editor);
        const items = editor.querySelectorAll('li');
        assert.ok(items[0].classList.contains('task-checked'), 'checked attribute lost on normalise');
        assert.ok(items[0].classList.contains('checklist-empty'), 'empty item not marked');
        assert.ok(!items[1].classList.contains('checklist-empty'), 'filled item marked empty');
        editor.remove();
    });

    await step('empty checklist items round-trip through Markdown', () => {
        const html = '<ul class="checklist">'
            + '<li><input type="checkbox"></li>'
            + '<li class="task-checked"><input type="checkbox" checked>done</li></ul>';
        const md = formats.htmlToMarkdown(html);
        assert.match(md, /- \[ \]\s*\n/, 'empty item not exported as an open task');
        const back = formats.markdownToHtml(md);
        assert.match(back, /<li><input type="checkbox"><\/li>/, 'empty item lost on import');
        assert.match(back, /class="task-checked"/, 'checked item lost on import');
    });

    await step('checkbox changes sync the item class and save', () => {
        const edits = [];
        const tracked = [];
        document.body.innerHTML = '<div id="ed"><ul class="checklist"><li><input type="checkbox">milk</li></ul></div>';
        const editor = document.getElementById('ed');
        const api = initChecklist({
            editor, strings: {}, onEvent: (e) => tracked.push(e),
            onEdit: () => edits.push(1), placeBlock: () => true,
        });
        const input = editor.querySelector('input');
        input.checked = true;
        input.dispatchEvent(new window.Event('change', { bubbles: true }));
        assert.ok(editor.querySelector('li').classList.contains('task-checked'), 'class not synced');
        assert.equal(edits.length, 1, 'onEdit not called');
        assert.ok(tracked.includes('task_toggled'), 'not tracked');
        editor.remove();
    });

    await step('normalise keeps exactly one checkbox per item', () => {
        document.body.innerHTML = '<div id="ed"><ul class="checklist">'
            + '<li>no box</li><li><input type="checkbox"><input type="checkbox">two</li></ul></div>';
        const editor = document.getElementById('ed');
        const api = initChecklist({ editor, strings: {}, onEvent: () => {}, onEdit: () => {}, placeBlock: () => true });
        api.normalise(editor);
        const items = editor.querySelectorAll('li');
        assert.equal(items[0].querySelectorAll('input').length, 1, 'missing box not added');
        assert.equal(items[0].querySelector('input').checked, false);
        assert.equal(items[1].querySelectorAll('input').length, 1, 'extra box not removed');
        editor.remove();
    });

    await step('the task scan reads every note', () => {
        document.body.innerHTML = '<div id="ed"></div>';
        const editor = document.getElementById('ed');
        const notes = [
            { id: 'a', title: 'Shopping', html: '<ul class="checklist"><li class="task-checked"><input type="checkbox" checked>tea</li><li><input type="checkbox">jam</li></ul>' },
            { id: 'b', title: 'Work', html: '<ul class="checklist"><li><input type="checkbox">report</li></ul>' },
        ];
        const api = initChecklist({
            editor, strings: {}, onEvent: () => {}, onEdit: () => {},
            placeBlock: () => true, getNotes: () => notes,
        });
        const tasks = api.scanTasks();
        assert.equal(tasks.length, 3);
        assert.deepEqual(tasks.map((t) => [t.noteTitle, t.checked, t.text]), [
            ['Shopping', true, 'tea'],
            ['Shopping', false, 'jam'],
            ['Work', false, 'report'],
        ]);
        editor.remove();
    });

    group('structure: bidi + per-note direction');
    await step('detectDirection reads the first strong character', () => {
        assert.equal(detectDirection('سلام دنیا'), 'rtl');
        assert.equal(detectDirection('Hello world'), 'ltr');
        assert.equal(detectDirection('123 + 456'), null);
        assert.equal(detectDirection(''), null);
        assert.equal(detectDirection('... سلام'), 'rtl');
    });

    await step('isolate wraps text in FSI…PDI', () => {
        const wrapped = isolate('سلام');
        assert.equal(wrapped.charCodeAt(0), 8295); // U+2067 FSI
        assert.equal(wrapped.charCodeAt(wrapped.length - 1), 8297); // U+2069 PDI
        assert.ok(wrapped.includes('سلام'));
        assert.equal(isolate(''), '');
    });

    group('structure: checklist keyboard');
    await step('Enter opens the next item with the caret after its box', () => {
        const edits = [];
        document.body.innerHTML = '<div id="ed"><ul class="checklist"><li><input type="checkbox"><span>milk</span></li></ul></div>';
        const editor = document.getElementById('ed');
        const api = initChecklist({
            editor, strings: {}, onEvent: () => {}, onEdit: () => edits.push(1), placeBlock: () => true,
        });
        const item = editor.querySelector('li');
        caretIn(item.querySelector('span').firstChild, 2);
        const enter = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        editor.dispatchEvent(enter);
        const items = editor.querySelectorAll('li');
        assert.equal(items.length, 2, 'second item not created');
        const next = items[1];
        assert.equal(next.querySelectorAll('input').length, 1, 'fresh box missing');
        assert.equal(next.querySelector('input').checked, false, 'new box should start unchecked');
        const selection = window.getSelection();
        assert.equal(selection.anchorNode, next, 'caret not in the new item');
        assert.equal(selection.anchorOffset, 1, 'caret not right after the box');
        assert.equal(edits.length, 1, 'onEdit not called');
        editor.remove();
    });

    await step('Enter on an empty item leaves the list', () => {
        document.body.innerHTML = '<div id="ed"><ul class="checklist"><li><input type="checkbox"><span>tea</span></li>'
            + '<li><input type="checkbox"></li></ul></div>';
        const editor = document.getElementById('ed');
        const api = initChecklist({
            editor, strings: {}, onEvent: () => {}, onEdit: () => {}, placeBlock: () => true,
        });
        const items = editor.querySelectorAll('li');
        caretIn(items[1], 1);
        editor.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        assert.equal(editor.querySelectorAll('li').length, 1, 'empty item kept');
        assert.ok(editor.querySelector('p'), 'no paragraph to keep typing in');
        editor.remove();
    });

    await step('Backspace on an empty item removes it', () => {
        document.body.innerHTML = '<div id="ed"><ul class="checklist"><li><input type="checkbox"><span>tea</span></li>'
            + '<li><input type="checkbox"></li></ul></div>';
        const editor = document.getElementById('ed');
        const api = initChecklist({
            editor, strings: {}, onEvent: () => {}, onEdit: () => {}, placeBlock: () => true,
        });
        const items = editor.querySelectorAll('li');
        caretIn(items[1], 1);
        editor.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
        assert.equal(editor.querySelectorAll('li').length, 1, 'empty item kept');
        const selection = window.getSelection();
        assert.ok(editor.querySelectorAll('li')[0].contains(selection.anchorNode), 'caret not in the previous item');
        editor.remove();
    });

    group('structure: sections keyboard');
    await step('Backspace on an emptied body block removes it, then the section', () => {
        document.body.innerHTML = '<div id="ed"><details open><summary>Title</summary><p>gone</p><p>keep</p></details></div>';
        const editor = document.getElementById('ed');
        const api = initOutline({
            editor, strings: {}, onEvent: () => {}, onEdit: () => {}, placeBlock: () => true,
        });
        const details = editor.querySelector('details');
        const first = details.querySelectorAll('p')[0];
        caretIn(first.firstChild, 1);
        editor.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
        editor.dispatchEvent(new window.Event('input', { bubbles: true })); // clear the text
        first.textContent = '';
        caretIn(first, 0);
        editor.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
        const paragraphs = details.querySelectorAll('p');
        assert.equal(paragraphs.length, 1, 'emptied block not removed');
        const selection = window.getSelection();
        assert.ok(paragraphs[0].contains(selection.anchorNode), 'caret not in the remaining block');

        paragraphs[0].textContent = '';
        caretIn(paragraphs[0], 0);
        editor.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
        assert.equal(editor.querySelector('details'), null, 'empty section not removed');
        editor.remove();
    });

    await step('Backspace at the start of the first body block is a no-op', () => {
        document.body.innerHTML = '<div id="ed"><details open><summary>Title</summary><p>content</p></details></div>';
        const editor = document.getElementById('ed');
        const api = initOutline({
            editor, strings: {}, onEvent: () => {}, onEdit: () => {}, placeBlock: () => true,
        });
        const block = editor.querySelector('p');
        caretIn(block.firstChild, 0);
        const back = new window.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
        editor.dispatchEvent(back);
        assert.equal(back.defaultPrevented, true, 'merge into summary not prevented');
        assert.ok(editor.querySelector('details'), 'section must stay');
        assert.match(block.textContent, /content/);
        editor.remove();
    });

    check(`structure: ${steps.length} steps`, () => {
        assert.deepEqual(stepFailures, [], stepFailures.join(', '));
    });
}

function caretIn(node, offset = 0) {
    const range = node.ownerDocument.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    const selection = node.ownerDocument.defaultView.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
}
function putCaretAtEnd(node) {
    const range = node.ownerDocument.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    const selection = node.ownerDocument.defaultView.getSelection();
    selection.removeAllRanges();

    selection.addRange(range);
}
