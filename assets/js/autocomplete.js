/**
 * Inline autocomplete for the editor.
 *
 * As the user types a word, the most frequent continuation from a large
 * Persian/English word-frequency list is shown as faded ghost text after
 * the caret (placeholder-grey). Tab (and → at end of word) accepts it;
 * any other key dismisses. Suggestions come from a bundled offline
 * frequency list — no network, no provider call, works with the strict
 * CSP and offline mode.
 *
 * Rendering never touches the contenteditable DOM: the ghost is an
 * absolutely-positioned span in <body>, anchored to the caret's own client
 * rect (exact on every line, both directions), so the editor's undo stack,
 * sanitiser, spellchecker and exporters never see it. The suggestion is
 * committed through insertText at the caret, exactly like typing.
 */

import { WORD_SUGGEST_SUFFIX } from './autocomplete-data.js';

const MIN_PREFIX = 2;          // start suggesting from the 2nd character
const MAX_WORD_LEN = 40;       // tokens longer than this are not words
const DEBOUNCE_MS = 60;        // coalesce fast typing
const REPEAT_LIMIT = 3;        // don't ghost the same suffix 3+ times in a row

export function initAutocomplete({ editor, strings = {}, onEvent }) {
    const track = typeof onEvent === 'function' ? onEvent : () => {};

    let ghost = null;          // absolutely-positioned span
    let current = null;        // { word, ghostText, rangeOffset }
    let debounceTimer = 0;
    let lastAccepted = null;   // { suffix, at } for repeat suppression
    let enabled = true;

    try {
        enabled = localStorage.getItem('npad:autocomplete-off') !== '1';
    } catch { /* default on */ }

    function isEnabled() { return enabled; }

    function setEnabled(value) {
        enabled = !!value;
        hide();
        try { localStorage.setItem('npad:autocomplete-off', enabled ? '0' : '1'); } catch { /* ignore */ }
    }

    /** Ensure the ghost element exists; it lives in <body>, not the editor. */
    function ensureGhost() {
        if (ghost) return ghost;
        ghost = document.createElement('span');
        ghost.className = 'ai-autocomplete-ghost';
        ghost.setAttribute('aria-hidden', 'true');
        document.body.appendChild(ghost);
        return ghost;
    }

    function hide() {
        if (ghost) ghost.textContent = '';
        current = null;
    }

    /**
     * The plain-text word being typed immediately before the caret, or ''.
     * Returns null when the caret isn't in a plain-text position the ghost
     * can mirror (multi-node selections, non-text carets).
     */
    /** True when the caret sits inside a code block or formula — Tab means
     *  indent/leave there, so autocomplete never ghosts in those. */
    function inCodeOrMath(node) {
        const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        return !!(el?.closest?.('pre, code, math-block, math-inline'));
    }

    function wordAtCaret() {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
        const node = sel.anchorNode;
        if (!node || node.nodeType !== Node.TEXT_NODE || !editor.contains(node)) return null;
        if (inCodeOrMath(node)) return null;
        const offset = sel.anchorOffset;
        const text = node.textContent || '';
        let start = offset;
        while (start > 0 && text.slice(start - 1, start).search(/[\p{L}\p{Nd}'’_-]/u) === 0) start -= 1;
        const word = text.slice(start, offset);
        if (!word || word.length > MAX_WORD_LEN) return null;
        // Caret must sit at the word's end (i.e. the user is typing it).
        if (start + word.length !== offset) return null;
        return { word, start, node };
    }

    /** Suggest one continuation for `word`, or ''. */
    function suggest(word) {
        const lower = word.toLocaleLowerCase();
        const entry = WORD_SUGGEST_SUFFIX[lower];
        if (!entry) return '';
        const suffix = typeof entry === 'string' ? entry : entry[0];
        if (!suffix) return '';
        // Match the user's casing pattern: ALL-CAPS word → upper suffix.
        if (word.length > 1 && word === word.toLocaleUpperCase() && /\p{L}/u.test(word)) {
            return suffix.toLocaleUpperCase();
        }
        return suffix;
    }

    /** Viewport rect of the caret itself (collapsed range), when the
     *  browser can produce real layout. Null in environments without
     *  layout (jsdom) or for detached nodes. */
    function caretRectAt(node, offset) {
        try {
            const range = document.createRange();
            range.setStart(node, offset);
            range.collapse(true);
            const rect = range.getBoundingClientRect();
            if (rect && (rect.height > 0 || rect.width > 0)) return rect;
        } catch { /* no layout available */ }
        return null;
    }

    /** Position the ghost exactly at the caret. Primary anchor is the
     *  caret's own client rect — exact on wrapped lines, in nested
     *  elements and in RTL. A mirror-span estimate is only the fallback
     *  for environments without real layout. */
    function positionGhost(node, offset, ghostText) {
        const el = ensureGhost();
        const style = window.getComputedStyle(editor);
        const rtl = (editor.getAttribute('dir') || '').toLowerCase() === 'rtl'
            || style.direction === 'rtl';

        el.style.font = style.font;
        el.style.letterSpacing = style.letterSpacing;

        const caretRect = caretRectAt(node, offset);
        if (caretRect) {
            const scrollX = window.scrollX || window.pageXOffset || 0;
            const scrollY = window.scrollY || window.pageYOffset || 0;
            // Match the caret's line box so the faded text sits on the
            // same baseline as the typed word.
            el.style.lineHeight = `${Math.round(caretRect.height)}px`;
            el.textContent = ghostText;
            const w = el.getBoundingClientRect().width;
            el.style.top = `${Math.round(caretRect.top + scrollY)}px`;
            el.style.left = `${Math.round((rtl ? caretRect.left - w : caretRect.left) + scrollX)}px`;
            return;
        }

        // ── Fallback: mirror-span estimate (no real layout) ──
        const mirror = document.createElement('span');
        mirror.style.cssText = 'white-space:pre;position:absolute;visibility:hidden;top:0;left:-9999px;';
        // Copy the editor's font so the measurement matches to the pixel.
        for (const prop of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'wordSpacing', 'textTransform', 'paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth']) {
            mirror.style[prop] = style[prop];
        }
        mirror.textContent = node.textContent.slice(0, offset) + '\u200b' + ghostText;
        document.body.appendChild(mirror);

        const base = document.createElement('span');
        base.style.cssText = mirror.style.cssText;
        base.textContent = node.textContent.slice(0, offset);
        document.body.appendChild(base);

        const range = document.createRange();
        range.setStart(node, Math.max(0, offset - 1));
        range.setEnd(node, offset);
        let charRect = null;
        try { charRect = range.getBoundingClientRect(); } catch { charRect = null; }

        const editorRect = editor.getBoundingClientRect();
        const caretCharWidth = mirror.getBoundingClientRect().width - base.getBoundingClientRect().width;
        document.body.removeChild(mirror);
        document.body.removeChild(base);

        const scrollX = window.scrollX || window.pageXOffset || 0;
        const scrollY = window.scrollY || window.pageYOffset || 0;

        // Vertical: caret line when measurable, else the editor's line box math.
        let top;
        if (charRect && charRect.height) {
            top = charRect.top;
        } else {
            const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
            const beforeText = (node.textContent || '').slice(0, offset);
            const lines = beforeText.split('\n').length - 1;
            top = editorRect.top + parseFloat(style.paddingTop) + lines * line;
        }
        // Horizontal: mirror width of the full node text before the caret
        // (single-line paragraphs are the dominant case).
        const fullMirror = document.createElement('span');
        fullMirror.style.cssText = mirror.style.cssText;
        fullMirror.textContent = node.textContent.slice(0, offset);
        document.body.appendChild(fullMirror);
        let left = editorRect.left + fullMirror.getBoundingClientRect().width;
        document.body.removeChild(fullMirror);

        // RTL: ghost sits to the LEFT of the caret.
        if (rtl) left -= caretCharWidth + measureText(ghostText, style);

        el.style.top = `${Math.round(top + scrollY)}px`;
        el.style.left = `${Math.round(left + scrollX)}px`;
        el.textContent = ghostText;
    }

    function measureText(text, style) {
        const m = document.createElement('span');
        m.style.cssText = 'white-space:pre;position:absolute;visibility:hidden;top:0;left:-9999px;';
        m.style.font = style.font;
        m.textContent = text;
        document.body.appendChild(m);
        const w = m.getBoundingClientRect().width;
        document.body.removeChild(m);
        return w;
    }

    function evaluate() {
        const at = wordAtCaret();
        if (!at) { hide(); return; }
        if (at.word.length < MIN_PREFIX) { hide(); return; }

        // Suppress immediate repeats: after accepting «است», don't ghost it
        // again for the same word unless the user kept typing.
        const suffix = suggest(at.word);
        if (!suffix) { hide(); return; }
        if (lastAccepted && lastAccepted.suffix === suffix
            && Date.now() - lastAccepted.at < 4000 && lastAccepted.word === at.word) {
            hide();
            return;
        }

        current = { word: at.word, ghostText: suffix, node: at.node, offset: at.start + at.word.length };
        positionGhost(at.node, at.start + at.word.length, suffix);
    }

    function schedule() {
        window.clearTimeout(debounceTimer);
        debounceTimer = window.setTimeout(evaluate, DEBOUNCE_MS);
    }

    /** Commit the ghost text at the caret (like the user typed it). */
    function accept() {
        if (!current) return false;
        const { ghostText, word } = current;
        const suffix = ghostText;
        hide();
        editor.focus();
        document.execCommand('insertText', false, suffix);
        lastAccepted = { suffix, word, at: Date.now() };
        track('autocomplete_accept');
        return true;
    }

    /** True when the event was consumed (Tab / arrow-right accept). */
    function handleKeydown(event) {
        if (!current) return false;
        if (event.key === 'Tab') {
            event.preventDefault();
            return accept();
        }
        // ArrowRight at the caret's word end also accepts (nice for RTL too
        // via the explicit Tab). Escape and everything else dismisses.
        if (event.key === 'ArrowRight' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
            const sel = window.getSelection();
            if (sel && sel.isCollapsed) return accept();
        }
        hide();
        return false;
    }

    editor.addEventListener('input', () => { schedule(); });
    editor.addEventListener('keydown', (event) => {
        if (handleKeydown(event)) event.stopPropagation();
    }, true);
    // Click, blur: any caret move elsewhere dismisses the ghost.
    editor.addEventListener('click', hide);
    editor.addEventListener('blur', hide);

    // While a ghost is visible, keep it glued to the caret if the page or
    // an inner container scrolls/resizes under it.
    const reposition = () => {
        if (current) positionGhost(current.node, current.offset, current.ghostText);
    };
    document.addEventListener('scroll', reposition, { capture: true, passive: true });
    window.addEventListener('resize', reposition);

    return { isEnabled, setEnabled, accept, hide };
}
