/**
 * Math typesetting.
 *
 * Self-hosted KaTeX (assets/js/vendor/katex-0.18.4.min.js — no CDN), lazy
 * loaded with its woff2-only stylesheet the first time a note contains a
 * formula or one is inserted. Follows the same transient-paint rule as the
 * syntax highlighter: the stored note keeps the LaTeX source as plain text
 * inside dedicated tags —
 *
 *     <math-inline>x^2</math-inline>  ·  <math-block>…multiline…</math-block>
 *
 * — while the live DOM carries KaTeX's rendered HTML (+ hidden MathML for
 * screen readers). The source survives in a data attribute while painted and
 * is written back as the element's text before every save and export.
 *
 * While the caret is inside a formula it drops back to raw LaTeX (monospace,
 * always LTR) so editing behaves like text entry; on leaving, the formula
 * re-renders. Typing the closing delimiter — `$x^2$` or `$$…$$` — converts
 * on the fly, gated by the same plausibility heuristics as the Markdown
 * codec so prose about money ("I paid $5 and $10") stays prose.
 */

import { confirmDialog, showDialog, toast, escapeHtml } from './ui.js';
import { caretAtEdge } from './caret.js';
import { isPlausibleMath } from './math-heuristics.js';
import { mathmlToOmml } from './math-omml.js';

/* Generated from npm katex@0.18.4 and never hand-edited: version-pinned
   paths are cache-immutable at the server. */
const KATEX_JS = '/assets/js/vendor/katex-0.18.4.min.js';
const KATEX_CSS = '/assets/css/katex-0.18.4.min.css';

const INLINE_TAG = 'MATH-INLINE';
const BLOCK_TAG = 'MATH-BLOCK';

/* Same 24×24 stroke grid as includes/icons.php. */
const DELETE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
    + '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/>'
    + '<path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/>'
    + '<path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>'
    + '</svg>';

/* Formula keyboard: [label, snippet] — "|" marks the caret stop. */
const KEYS = [
    ['a/b', '\\frac{|}{}'],
    ['√', '\\sqrt{|}'],
    ['x²', '^{|}'],
    ['x₂', '_{|}'],
    ['()', '\\left(|\\right)'],
    ['[]', '\\left[|\\right]'],
    ['∑', '\\sum_{i=1}^{|}'],
    ['∫', '\\int_{|}^{}'],
    ['lim', '\\lim_{|}'],
    ['±', '\\pm'],
    ['×', '\\times'],
    ['·', '\\cdot'],
    ['÷', '\\div'],
    ['≤', '\\leq'],
    ['≢', '\\geq'],
    ['≠', '\\neq'],
    ['≈', '\\approx'],
    ['∞', '\\infty'],
    ['→', '\\to'],
    ['∈', '\\in'],
    ['∅', '\\emptyset'],
    ['α', '\\alpha'],
    ['β', '\\beta'],
    ['γ', '\\gamma'],
    ['δ', '\\delta'],
    ['θ', '\\theta'],
    ['λ', '\\lambda'],
    ['μ', '\\mu'],
    ['π', '\\pi'],
    ['σ', '\\sigma'],
    ['φ', '\\phi'],
    ['ω', '\\omega'],
    ['Δ', '\\Delta'],
    ['Ω', '\\Omega'],
    ['aligned', '\\begin{aligned}\\n| &= \\\\\\n&= \\n\\end{aligned}'],
];

/** Fetch a formula's LaTeX source wherever the element currently keeps it. */
function sourceOf(el) {
    if (el.dataset?.tex !== undefined) return el.dataset.tex;
    return el.textContent || '';
}

/**
 * Wire the feature to one contenteditable root.
 *
 * @param {object}  options
 * @param {Element} options.editor      the contenteditable root
 * @param {object}  options.strings     localized copy (falls back to English)
 * @param {Function} options.onEvent    analytics sink
 * @param {Function} options.onEdit     called after user edits (autosave hook)
 * @param {Function} options.placeBlock inserts a block element at the
 *                                      selection (editor.js helper)
 */
export function initMath({ editor, strings = {}, onEvent, onEdit, placeBlock }) {
    const track = typeof onEvent === 'function' ? onEvent : () => {};
    const edited = typeof onEdit === 'function' ? onEdit : () => {};
    const dropBlock = typeof placeBlock === 'function' ? placeBlock : null;

    let activeEl = null;
    let switchTimer = 0;
    let katexPromise = null;

    /* ------------------------------------------------------------------
       KaTeX loading
       ------------------------------------------------------------------ */

    function loadKatex() {
        if (window.katex?.render) return Promise.resolve(window.katex);
        if (katexPromise) return katexPromise;
        katexPromise = new Promise((resolve, reject) => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = KATEX_CSS;
            document.head.appendChild(link);
            const script = document.createElement('script');
            script.src = KATEX_JS;
            script.onload = () => (window.katex?.render
                ? resolve(window.katex)
                : reject(new Error('KaTeX failed to initialise')));
            script.onerror = () => {
                script.remove();
                katexPromise = null; // a later formula may retry
                reject(new Error('KaTeX failed to load'));
            };
            document.head.appendChild(script);
        });
        return katexPromise;
    }

    function renderOptions(el) {
        return {
            throwOnError: false,
            displayMode: el.tagName === BLOCK_TAG,
            strict: false,   // legacy LaTeX stays welcome
            trust: false,    // no \href/\includegraphics from note content
        };
    }

    /* ------------------------------------------------------------------
       Paint: KaTeX output on, KaTeX output off
       ------------------------------------------------------------------ */

    function paint(el) {
        const tex = sourceOf(el);
        if (!tex.trim()) return; // empty formula stays in raw mode
        loadKatex().then((katex) => {
            // The note may have moved on while the library was loading.
            if (!el.isConnected || el === activeEl) return;
            if (sourceOf(el) !== tex) return;
            el.classList.remove('math--editing');
            const chrome = el.querySelector('[data-math-chrome]');
            el.textContent = '';
            el.dataset.tex = tex;
            if (chrome) el.appendChild(chrome);
            const target = document.createElement('span');
            el.appendChild(target);
            try {
                katex.render(tex, target, renderOptions(el));
            } catch {
                /* a parse edge case must never break editing */
            }
        }).catch(() => {
            /* offline first visit: the formula stays readable as source */
        });
    }

    /** Drop back to the editable LaTeX source. */
    function revealSource(el) {
        const tex = sourceOf(el);
        const chrome = el.querySelector('[data-math-chrome]');
        el.removeAttribute('data-tex');
        el.textContent = tex;
        if (chrome) el.appendChild(chrome);
        el.classList.add('math--editing');
    }

    /* ------------------------------------------------------------------
       Chrome: delete button (runtime-only, stripped before saving)
       ------------------------------------------------------------------ */

    function mountChrome(el) {
        let chrome = [...el.children].find((n) => n.hasAttribute?.('data-math-chrome'));
        if (!chrome) {
            chrome = document.createElement('span');
            chrome.className = 'math-chrome';
            chrome.setAttribute('data-math-chrome', '');
            chrome.setAttribute('contenteditable', 'false');
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'math-delete';
            btn.innerHTML = DELETE_ICON;
            btn.addEventListener('mousedown', (event) => event.preventDefault());
            btn.addEventListener('click', (event) => {
                event.preventDefault();
                removeFormulaWithConfirm(el);
            });
            chrome.appendChild(btn);
            el.appendChild(chrome);
        }
        const btn = chrome.querySelector('.math-delete');
        btn.setAttribute('aria-label', strings.mathDelete || 'Delete formula');
        btn.title = strings.mathDelete || 'Delete formula';
    }

    async function removeFormulaWithConfirm(el) {
        const action = await confirmDialog({
            title: strings.mathDeleteTitle || 'Delete this formula?',
            message: strings.mathDeleteBody || 'The formula will be removed from the note.',
            confirmLabel: strings.confirm || 'Delete',
            cancelLabel: strings.cancel || 'Cancel',
            danger: true,
        });
        if (!action || !editor.contains(el)) return;
        removeFormula(el);
    }

    /* ------------------------------------------------------------------
       Edit mode: raw source while the caret is inside, painted after
       ------------------------------------------------------------------ */

    function mathOf(node) {
        const element = node.nodeType === 1 ? node : node.parentElement;
        const el = element?.closest('math-inline, math-block');
        return el && editor.contains(el) ? el : null;
    }

    function applySelectionState() {
        const selection = document.getSelection();
        const el = selection && selection.rangeCount && editor.contains(selection.anchorNode)
            ? mathOf(selection.anchorNode)
            : null;

        if (el === activeEl) return;
        const previous = activeEl;
        activeEl = el;

        if (previous && previous.isConnected) {
            previous.classList.remove('math--editing');
            paint(previous);
        }
        if (el) revealSource(el);
    }

    function syncSelection() {
        window.clearTimeout(switchTimer);
        switchTimer = window.setTimeout(applySelectionState, 120);
    }

    /* ------------------------------------------------------------------
       Editing inside a formula
       ------------------------------------------------------------------ */

    function insertPlainText(text) {
        let handled = false;
        try {
            handled = document.execCommand('insertText', false, text);
        } catch {
            handled = false;
        }
        if (!handled) {
            const selection = window.getSelection();
            if (!selection?.rangeCount) return;
            const range = selection.getRangeAt(0);
            range.deleteContents();
            const node = document.createTextNode(text);
            range.insertNode(node);
            range.setStartAfter(node);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
            editor.dispatchEvent(new Event('input', { bubbles: true }));
        }
        edited();
    }

    /** Caret right after the formula — exiting to prose. */
    function exitAfter(el) {
        editor.focus();
        const selection = window.getSelection();
        const range = document.createRange();
        range.setStartAfter(el);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        syncSelection();
        edited();
    }

    /** Caret in the paragraph following a block formula. */
    function exitBlock(el) {
        let target = el.nextElementSibling;
        if (!editor.contains(target) || (target.tagName !== 'P' && target.tagName !== 'DIV')) {
            const spacer = document.createElement('p');
            spacer.appendChild(document.createElement('br'));
            if (editor.contains(target) && /^(P|DIV|H[1-6]|UL|OL|BLOCKQUOTE|PRE|TABLE|HR)$/.test(target.tagName)) {
                target.before(spacer);
            } else {
                el.after(spacer);
            }
            target = spacer;
        }
        editor.focus();
        const selection = window.getSelection();
        const range = document.createRange();
        range.setStart(target, 0);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        syncSelection();
        edited();
    }

    /** Remove the formula through the browser's undoable delete. */
    function removeFormula(el) {
        const next = el.nextElementSibling;
        editor.focus();
        const range = document.createRange();
        range.selectNode(el);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        let handled = false;
        try {
            handled = document.execCommand('delete') === true && !editor.contains(el);
        } catch {
            handled = false;
        }
        if (!handled) el.remove();

        let target = null;
        if (next && editor.contains(next) && (next.tagName === 'P' || next.tagName === 'DIV')) {
            target = next;
        } else {
            const last = editor.lastElementChild;
            if (last && (last.tagName === 'P' || last.tagName === 'DIV')) {
                target = last;
            } else {
                const spacer = document.createElement('p');
                spacer.appendChild(document.createElement('br'));
                if (next && editor.contains(next) && /^(P|DIV|H[1-6]|UL|OL|BLOCKQUOTE|PRE|TABLE|HR)$/.test(next.tagName)) {
                    next.before(spacer);
                } else {
                    editor.appendChild(spacer);
                }
                target = spacer;
            }
        }
        const caret = document.createRange();
        caret.setStart(target, 0);
        caret.collapse(true);
        selection.removeAllRanges();
        selection.addRange(caret);
        activeEl = null;
        syncSelection();
        edited();
    }

    /**
     * Keyboard model inside a formula:
     *  - Enter exits an inline formula; in a block it breaks the source line,
     *    except at the very end (and Ctrl/Cmd+Enter anywhere) where it hands
     *    the caret to the next paragraph; Shift+Enter always breaks a line
     *  - Tab leaves the formula (Shift+Tab keeps its focus-navigation role)
     *  - Backspace/Delete on an emptied formula removes it; at the edges of a
     *    non-empty one they no-op instead of merging with prose
     */
    function handleKeydown(event) {
        const key = event.key;
        if (key !== 'Tab' && key !== 'Enter' && key !== 'Backspace' && key !== 'Delete') return false;

        const selection = window.getSelection();
        if (!selection?.rangeCount) return false;
        const start = selection.getRangeAt(0).startContainer;
        const el = mathOf(start);
        if (!el || !el.contains(start)) return false;
        const active = document.activeElement;
        if (active && active !== editor && active !== document.body
            && editor.contains(active)
            && (!el.contains(active) || active.closest('[data-math-chrome]'))) return false;

        // Typing before the debounce fires must not edit the KaTeX output.
        if (el !== activeEl) {
            revealSource(el);
            activeEl = el;
        }

        const isEmpty = !(sourceOf(el) || '').trim();
        const isBlock = el.tagName === BLOCK_TAG;

        if (key === 'Tab') {
            if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
            event.preventDefault();
            event.stopPropagation();
            if (isBlock) exitBlock(el);
            else exitAfter(el);
            return true;
        }

        if (key === 'Enter') {
            if (event.altKey) return false;
            event.preventDefault();
            event.stopPropagation();
            if (event.ctrlKey || event.metaKey) {
                if (isBlock) exitBlock(el);
                else exitAfter(el);
            } else if (!isBlock) {
                exitAfter(el);
            } else if (!event.shiftKey && caretAtEdge(selection, el, true)) {
                exitBlock(el);
            } else {
                insertPlainText('\n');
            }
            return true;
        }

        if (event.ctrlKey || event.metaKey || event.altKey) return false;

        if (key === 'Backspace') {
            if (isEmpty) {
                event.preventDefault();
                event.stopPropagation();
                removeFormula(el);
                return true;
            }
            if (caretAtEdge(selection, el, false)) {
                event.preventDefault();
                event.stopPropagation();
                return true;
            }
            return false;
        }

        // Delete
        if (isEmpty) {
            event.preventDefault();
            event.stopPropagation();
            removeFormula(el);
            return true;
        }
        if (caretAtEdge(selection, el, true)) {
            event.preventDefault();
            event.stopPropagation();
            return true;
        }
        return false;
    }

    /* ------------------------------------------------------------------
       Magic typing: $x^2$ and $$…$$ convert on the closing delimiter
       ------------------------------------------------------------------ */

    function convertTypedDelimiters(node, offset) {
        const text = node.nodeValue || '';
        const before = text.slice(0, offset);

        // $$…$$ hugging the caret becomes a block formula; single $ pairs
        // stay prose (inline mode is gone, and money text is safer this way).
        const match = before.match(/\$\$([^$\n]+)\$\$/);
        if (!match || !isPlausibleMath(match[1])) return false;
        const content = match[1];

        const start = offset - content.length - 4;
        const el = document.createElement(BLOCK_TAG);
        el.textContent = content;

        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, offset);
        range.deleteContents();
        range.insertNode(el);

        const selection = window.getSelection();
        const caret = document.createRange();
        caret.setStartAfter(el);
        caret.collapse(true);
        selection.removeAllRanges();
        selection.addRange(caret);

        paint(el);
        edited();
        track('math_inserted');
        return true;
    }

    function handleInput(event) {
        if (!event.data || !event.data.includes('$')) return;
        if (event.inputType && event.inputType !== 'insertText') return;
        const selection = window.getSelection();
        const node = selection.anchorNode;
        if (!node || node.nodeType !== 3 || !editor.contains(node)) return;
        if (mathOf(node)) return; // typing a formula's source is just text
        convertTypedDelimiters(node, selection.anchorOffset);
    }

    /* ------------------------------------------------------------------
       Paste / restore normalisation
       ------------------------------------------------------------------ */

    function flattenedText(root) {
        const BREAKS = new Set(['BR', 'DIV', 'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'BLOCKQUOTE']);
        let out = '';
        (function walk(node) {
            for (const child of node.childNodes) {
                if (child.nodeType === 3) out += child.nodeValue;
                else if (child.nodeType === 1) {
                    if (child.tagName === 'BR') { out += '\n'; continue; }
                    if (BREAKS.has(child.tagName) && out && !out.endsWith('\n')) out += '\n';
                    walk(child);
                    if (BREAKS.has(child.tagName) && out && !out.endsWith('\n')) out += '\n';
                }
            }
        })(root);
        return out;
    }

    /** Formulas are text-only; pasted rich junk collapses to LaTeX text. */
    function normalise(root) {
        const scope = root && root !== editor
            && (root.matches?.('math-inline') || root.matches?.('math-block'))
            ? [root]
            : [...editor.querySelectorAll('math-inline, math-block')];
        for (const el of scope) {
            const tex = (el.dataset.tex !== undefined ? el.dataset.tex : flattenedText(el)).trim();
            el.removeAttribute('data-tex');
            el.removeAttribute('class');
            el.querySelector('[data-math-chrome]')?.remove();
            if (el.textContent !== tex) el.textContent = tex;
            if (el === activeEl) activeEl = null;
        }
        if (!root || root === editor) applySelectionState();
    }

    /* ------------------------------------------------------------------
       Save / export stripping
       ------------------------------------------------------------------ */

    /** Restore the stored source form on a cloned editor root. */
    function stripRuntime(root) {
        for (const chrome of root.querySelectorAll('[data-math-chrome]')) chrome.remove();
        for (const el of root.querySelectorAll('math-inline, math-block')) {
            const tex = sourceOf(el).replace(/^\n+|\n+$/g, '');
            el.removeAttribute('data-tex');
            el.removeAttribute('class');
            if (el.textContent !== tex) el.textContent = tex;
        }
    }

    /* ------------------------------------------------------------------
       Dialog: create / edit with a live preview
       ------------------------------------------------------------------ */

    function renderPreviewInto(preview, errorLine, tex, mode) {
        if (!tex.trim()) {
            preview.innerHTML = '';
            errorLine.hidden = true;
            return Promise.resolve();
        }
        return loadKatex().then((katex) => {
            try {
                preview.innerHTML = katex.renderToString(tex, {
                    throwOnError: true,
                    displayMode: mode === 'block',
                    strict: false,
                    trust: false,
                });
                errorLine.hidden = true;
            } catch (error) {
                preview.innerHTML = '';
                errorLine.hidden = false;
                errorLine.textContent = `${strings.mathError || 'KaTeX could not parse this:'} ${error.message || error}`;
            }
        }).catch(() => {
            preview.innerHTML = '';
            errorLine.hidden = false;
            errorLine.textContent = strings.mathOffline || 'KaTeX could not be loaded right now.';
        });
    }

    const escapeAttr = (value) => escapeHtml(value).replace(/"/g, '&quot;');

    async function openMathDialog(existing) {
        const selection = window.getSelection();
        const selected = selection && !selection.isCollapsed && editor.contains(selection.anchorNode)
            ? selection.toString()
            : '';

        const state = {
            tex: existing ? sourceOf(existing) : selected.slice(0, 500),
            mode: existing ? (existing.tagName === BLOCK_TAG ? 'block' : 'inline')
                : (selected.includes('\n') ? 'block' : 'inline'),
        };
        let texField = null;
        let preview = null;
        let errorLine = null;

        const action = await showDialog({
            title: existing ? (strings.mathEditTitle || 'Edit formula') : (strings.mathDialogTitle || 'Math formula'),
            bodyHtml: `
                <div class="math-builder">
                    <label class="math-builder__field">
                        <span>${strings.mathSource || 'LaTeX source'}</span>
                        <textarea data-math-tex rows="3" spellcheck="false" wrap="off"></textarea>
                    </label>
                    </div>
                    <div class="math-builder__pad" role="group" aria-label="${escapeAttr(strings.mathKeyboard || 'Symbol keyboard')}">
                        ${KEYS.map(([label, snippet]) => (
                            `<button type="button" class="math-builder__key" data-math-key="${escapeAttr(snippet)}"`
                            + ` title="${escapeAttr(snippet)}" aria-label="${escapeAttr(snippet)}">${escapeHtml(label)}</button>`
                        )).join('')}
                    </div>
                    <div class="math-builder__preview" data-math-preview aria-hidden="true"></div>
                    <p class="math-builder__error" data-math-error role="alert" hidden></p>
                    <p class="math-builder__hint">${strings.mathHint || ''}</p>
                </div>`,
            buttons: [
                { label: strings.cancel || 'Cancel', action: 'cancel', variant: 'btn--ghost' },
                { label: existing ? (strings.apply || 'Apply') : (strings.mathInsert || 'Insert formula'), action: 'apply', variant: 'btn--primary' },
            ],
            onOpen(body) {
                texField = body.querySelector('[data-math-tex]');
                preview = body.querySelector('[data-math-preview]');
                errorLine = body.querySelector('[data-math-error]');
                texField.value = state.tex;

                const sync = () => {
                    state.tex = texField.value;
                    renderPreviewInto(preview, errorLine, state.tex);
                };
                body.querySelectorAll('[data-math-key]').forEach((btn) => {
                    // Keep the textarea's focus and caret while "pressing keys".
                    btn.addEventListener('mousedown', (event) => event.preventDefault());
                    btn.addEventListener('click', () => {
                        const snippet = btn.dataset.mathKey;
                        const stop = snippet.indexOf('|');
                        const insert = stop === -1 ? snippet : snippet.replace('|', '');
                        const at = texField.selectionStart ?? texField.value.length;
                        texField.value = texField.value.slice(0, at) + insert
                            + texField.value.slice(texField.selectionEnd ?? at);
                        const caret = stop === -1 ? at + insert.length : at + stop;
                        texField.focus();
                        texField.setSelectionRange(caret, caret);
                        texField.dispatchEvent(new window.Event('input', { bubbles: true }));
                    });
                });
                texField.addEventListener('input', sync);
                sync();
                texField.focus();
                texField.setSelectionRange(texField.value.length, texField.value.length);
            },
        });

        if (action !== 'apply' || !state.tex.trim()) return null;
        return { ...state };
    }

    async function insertMath() {
        const built = await openMathDialog(null);
        if (!built) return;

        const el = document.createElement(BLOCK_TAG);
        el.textContent = built.tex.trim();

        if (!dropBlock || !dropBlock(el)) return;

        const selection = window.getSelection();
        const caret = document.createRange();
        caret.setStart(el, 0);
        caret.collapse(true);
        selection.removeAllRanges();
        selection.addRange(caret);
        revealSource(el);
        activeEl = el;
        mountChrome(el);

        edited();
        track('math_inserted');
        if (strings.mathInserted) toast(strings.mathInserted, 'success');
    }

    /** Double-click a formula to edit it with the live preview. */
    async function editMath(el) {
        if (!el || !editor.contains(el)) return;
        const built = await openMathDialog(el);
        if (!built) return;

        const replacement = document.createElement(BLOCK_TAG);
        replacement.textContent = built.tex.trim();
        if (activeEl === el) activeEl = replacement;
        const parent = el.parentElement;
        if (parent && parent !== editor && (parent.tagName === 'P' || parent.tagName === 'DIV')) {
            // A legacy inline formula living in a paragraph moves out of it —
            // blocks never nest inside paragraphs.
            parent.after(replacement);
            el.remove();
        } else {
            el.replaceWith(replacement);
        }
        paint(replacement);
        mountChrome(replacement);
        edited();
        track('math_edited');
    }

    /* ------------------------------------------------------------------
       Refresh (note shown, note imported)
       ------------------------------------------------------------------ */

    function refreshAll() {
        activeEl = null;
        normalise(editor);
        for (const el of editor.querySelectorAll('math-inline, math-block')) {
            mountChrome(el);
            if (!sourceOf(el).trim()) continue;
            paint(el);
        }
        applySelectionState();
    }

    document.addEventListener('selectionchange', syncSelection);
    editor.addEventListener('input', handleInput);
    editor.addEventListener('dblclick', (event) => {
        const el = mathOf(event.target);
        if (el) {
            event.preventDefault();
            editMath(el);
        }
    });

    /* ------------------------------------------------------------------
       DOCX export support: formulas become native Word math (OMML)
       ------------------------------------------------------------------ */

    /**
     * Replace every math element in an export HTML string with a marker
     * span carrying OMML, which formats.js inlines into document.xml.
     * Never throws: on any failure the original HTML (LaTeX source text)
     * is returned so DOCX export still works offline.
     */
    async function docxMath(html) {
        try {
            const template = document.createElement('template');
            template.innerHTML = String(html || '');
            const maths = template.content.querySelectorAll('math-inline, math-block');
            if (!maths.length) return html;
            const katex = await loadKatex();
            for (const el of maths) {
                const tex = el.textContent || '';
                const markup = katex.renderToString(tex, {
                    output: 'mathml',
                    throwOnError: false,
                    strict: false,
                    trust: false,
                    displayMode: el.tagName === BLOCK_TAG,
                });
                const start = markup.indexOf('<math');
                const end = markup.lastIndexOf('</math>');
                if (start < 0 || end < 0) throw new Error('no MathML in KaTeX output');
                const omml = mathmlToOmml(markup.slice(start, end + '</math>'.length));
                const span = document.createElement('span');
                span.setAttribute('data-npad-omml', el.tagName === BLOCK_TAG ? 'block' : 'inline');
                // Stored as text so template.innerHTML escapes it safely;
                // formats.js reads textContent back to the raw XML.
                span.textContent = omml;
                el.replaceWith(span);
            }
            return template.innerHTML;
        } catch {
            return html; // graceful fallback: LaTeX source, as before
        }
    }

    return {
        insertMath,
        editMath,
        refreshAll,
        normalise,
        stripRuntime,
        insertKeydown: handleKeydown,
        syncSelection,
        docxMath,
    };
}
