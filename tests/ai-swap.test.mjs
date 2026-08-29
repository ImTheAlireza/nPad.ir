/**
 * Unit coverage for assets/js/ai-swap.js — the AI glow transition.
 *
 * The transition is decorative, but it performs surgery on the document the
 * user is editing, so what matters here is not the animation: it is that the
 * editor's DOM comes out of a swap *clean* and that the fallback path always
 * writes the text when the animation cannot run.
 *
 * Runs in jsdom (no browser needed). jsdom has no layout, so
 * getClientRects() is empty and the bloom copy is skipped — the inline path
 * and the cleanup logic are what get exercised.
 */

import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const dom = new JSDOM(
    '<!DOCTYPE html><body><div class="editor-shell"><div id="editor"></div></div></body>',
    { url: 'https://npad.ir/' },
);
global.window = dom.window;
global.document = dom.window.document;
global.Node = dom.window.Node;
global.Event = dom.window.Event;

const { glowSwap, isSwapping, __resetSwapForTests } =
    await import(`file://${path.join(ROOT, 'assets/js/ai-swap.js')}`);

const editor = document.getElementById('editor');
const shell = document.querySelector('.editor-shell');

function mount(html) {
    editor.innerHTML = html;
    editor.setAttribute('contenteditable', 'true');
    editor.className = 'editor';
    shell.className = 'editor-shell';
    __resetSwapForTests();
    return editor;
}

/** Range covering the first text node equal to `needle`. */
function rangeOf(needle) {
    const walker = document.createTreeWalker(editor, 4 /* NodeFilter.SHOW_TEXT */);
    let node = walker.nextNode();
    while (node) {
        const at = node.data.indexOf(needle);
        if (at !== -1) {
            const range = document.createRange();
            range.setStart(node, at);
            range.setEnd(node, at + needle.length);
            return range;
        }
        node = walker.nextNode();
    }
    throw new Error(`text not found: ${needle}`);
}

let committed = 0;
const commitWith = (fn) => () => { committed += 1; fn?.(); };

export default async function run(check, group) {
    group('ai-swap: in-place replacement');

    await check('replaces a word and leaves no wrapper behind', async () => {
        mount('<div>Hello <b>world</b> today</div>');
        committed = 0;
        await glowSwap(editor, {
            range: rangeOf('world'),
            payload: { type: 'text', value: 'there' },
            commit: commitWith(() => { throw new Error('fallback must not run'); }),
        });
        assert.equal(editor.textContent, 'Hello there today');
        assert.equal(editor.querySelectorAll('.ai-swap').length, 0, 'wrapper left in the document');
        assert.equal(editor.querySelectorAll('.ai-swap__ink').length, 0, 'ink left in the document');
        assert.equal(editor.querySelectorAll('b').length, 1, 'surrounding markup lost');
        assert.equal(committed, 0, 'fell back to the plain insert');
        assert.equal(isSwapping(), false, 'swap still marked active');
    });

    await check('keeps the rest of the note byte-for-byte', async () => {
        mount('<div>first line</div><div>keep <em>this</em> safe</div><div>last line</div>');
        const before = editor.innerHTML;
        await glowSwap(editor, {
            range: rangeOf('this'),
            payload: { type: 'text', value: 'that' },
            commit: commitWith(),
        });
        assert.equal(editor.innerHTML, before.replace('>this<', '>that<'));
    });

    await check('turns newlines into <br> like the browser insert does', async () => {
        mount('<div>replace me</div>');
        await glowSwap(editor, {
            range: rangeOf('replace me'),
            payload: { type: 'text', value: 'one\ntwo' },
            commit: commitWith(),
        });
        assert.equal(editor.querySelector('div').innerHTML, 'one<br>two');
    });

    await check('applies HTML payloads inside the same box', async () => {
        mount('<div>a <strong>bold</strong> word</div>');
        await glowSwap(editor, {
            range: rangeOf('bold'),
            payload: { type: 'html', value: '<em>italic</em>' },
            commit: commitWith(),
        });
        assert.equal(editor.textContent, 'a italic word');
        // The swap replaces the *text*, not the markup that styled it — the
        // surrounding <strong> survives exactly as it did before.
        assert.equal(editor.querySelector('strong')?.innerHTML, '<em>italic</em>');
        assert.equal(editor.querySelectorAll('.ai-swap').length, 0);
    });

    group('ai-swap: block results keep the document valid');

    await check('lifts block content out of a <p>', async () => {
        mount('<p>intro SWAP outro</p>');
        await glowSwap(editor, {
            range: rangeOf('SWAP'),
            payload: { type: 'html', value: '<h2>Title</h2><p>Body</p>' },
            commit: commitWith(),
        });
        assert.equal(editor.querySelectorAll('p > h2, p > p').length, 0, 'blocks nested inside <p>');
        // The paragraph splits around the lifted blocks: the leading run keeps
        // the original <p>, the trailing run gets a sibling of the same tag.
        assert.deepEqual(
            Array.from(editor.children).map((el) => el.tagName),
            ['P', 'H2', 'P', 'P'],
        );
        assert.equal(editor.textContent, 'intro TitleBody outro');
    });

    group('ai-swap: fallbacks');

    await check('writes through the plain insert on a collapsed range', async () => {
        mount('<div>text</div>');
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(true);
        const done = glowSwap(editor, {
            range,
            payload: { type: 'text', value: 'x' },
            commit: commitWith(),
        });
        assert.equal(committed, 1, 'plain insert did not run immediately');
        await done;
    });

    await check('writes through the plain insert under reduced motion', async () => {
        const previous = window.matchMedia;
        window.matchMedia = (query) => ({
            matches: query.includes('prefers-reduced-motion'),
            media: query,
            addEventListener() {}, removeEventListener() {},
            addListener() {}, removeListener() {},
        });
        try {
            mount('<div>text</div>');
            committed = 0;
            const done = glowSwap(editor, {
                range: rangeOf('text'),
                payload: { type: 'text', value: 'y' },
                commit: commitWith(),
            });
            assert.equal(committed, 1, 'reduced motion still delayed the edit');
            await done;
        } finally {
            window.matchMedia = previous;
        }
    });

    await check('never writes when the swapped text disappears mid-flight', async () => {
        mount('<div>vanishing</div>');
        committed = 0;
        const promise = glowSwap(editor, {
            range: rangeOf('vanishing'),
            payload: { type: 'text', value: 'ghost' },
            commit: commitWith(() => { editor.textContent = 'FALLBACK'; }),
        });
        // Simulate the user deleting the paragraph (or an undo restoring it).
        setTimeout(() => { editor.querySelector('.ai-swap')?.remove(); }, 80);
        await promise;
        assert.equal(committed, 0, 'wrote after its anchor text was removed');
        assert.equal(editor.textContent, '');
        assert.equal(isSwapping(), false);
    });

    await check('a second swap never overlaps the first', async () => {
        mount('<div>one two</div>');
        committed = 0;
        const first = glowSwap(editor, {
            range: rangeOf('one'),
            payload: { type: 'text', value: '1' },
            commit: commitWith(),
        });
        await glowSwap(editor, {
            range: rangeOf('two'),
            payload: { type: 'text', value: '2' },
            commit: commitWith(() => { editor.textContent = 'plain two'; }),
        });
        assert.equal(committed, 1, 'overlapping swap did not fall back');
        await first;
    });

    group('ai-swap: whole-note replacement');

    await check('flares the card and clears every trace afterwards', async () => {
        mount('<div>whole note</div>');
        committed = 0;
        const promise = glowSwap(editor, {
            range: null,
            payload: { type: 'text', value: 'rewritten' },
            commit: commitWith(() => { editor.innerHTML = '<div>rewritten</div>'; }),
        });
        assert.ok(shell.classList.contains('is-ai-burst'), 'card did not flare');
        assert.equal(editor.getAttribute('contenteditable'), 'false', 'editor not locked');
        await promise;
        assert.equal(committed, 1);
        assert.equal(editor.getAttribute('contenteditable'), 'true', 'editor stayed locked');
        assert.equal(editor.className, 'editor', 'classes left on the editor');
        assert.equal(shell.className, 'editor-shell', 'flare class left on the card');
        assert.equal(editor.textContent, 'rewritten');
    });
}
