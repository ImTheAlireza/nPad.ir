/**
 * AI glow swap — the neon transition played when AI rewrites text in place.
 *
 * The reference animation (a standalone prototype) has two stacked copies of
 * the same text: a crisp "ink" copy the user reads, and a blurred, blown-out
 * "bloom" copy behind it. Swapping between two texts never moves the text —
 * only light, blur and opacity change:
 *
 *   1. 0–360ms      the old text burns out: it glows pink, blurs and fades to
 *                   nothing in place, while a pink echo of it dies behind it.
 *   2. 360ms        the new text is dropped into exactly the same box.
 *   3. 360–1810ms   the new text materialises out of the light: a white-hot,
 *                   out-of-focus cyan glow that condenses into plain text.
 *   4. 0–2000ms     the editor card flares in sync, capped at a 15px spread so
 *                   the light never smears outside the frame.
 *
 * Inside the real editor the same effect has to obey two extra rules the
 * prototype did not have:
 *
 *   - The rest of the note must not move, re-wrap or change colour. The swap
 *     box therefore occupies the *same* inline space as the text it replaces
 *     (the original nodes are preserved during the burn-out phase), and the
 *     card flare animates only border + box-shadow — never `filter` — so the
 *     surrounding text keeps its exact colours.
 *   - The editor's DOM must come out clean. When the transition ends the
 *     wrapper elements are unwrapped and the new content is left as plain
 *     nodes, indistinguishable from a normal AI insert.
 *
 * Everything degrades to a plain, un-animated insert: reduced-motion users,
 * overlapping swaps, ranges inside widgets (math, code blocks, tables), and
 * any unexpected error while the animation is running.
 */

/* Timings are the prototype's, unchanged. The 2s card flare is CSS-only
   (.editor-shell.is-ai-burst) and simply runs alongside these two phases. */
const LEAVE_MS  = 360;    // burn-out
const ARRIVE_MS = 1450;   // materialise

/** Block-level tags: they may not stay nested inside <p>/<h1-6> after unwrap. */
const BLOCK_TAGS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'CAPTION', 'DD', 'DETAILS',
    'DIV', 'DL', 'DT', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4',
    'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE',
    'SECTION', 'SUMMARY', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD',
    'TR', 'UL', 'MATH-BLOCK',
]);

/** Elements whose content model is phrasing-only — blocks must be lifted out. */
const PHRASING_ONLY = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE']);

/** Regions the editor owns as widgets — never wrap a swap inside one. */
const WIDGET_SELECTOR = 'math-inline, math-block, pre, table, [contenteditable="false"]';

/** At most one transition at a time; a second AI apply falls back to a plain insert. */
let active = null;

/**
 * Thrown when the text being animated disappears mid-flight (the user deleted
 * it, or an undo restored the note). The edit is dropped rather than written
 * somewhere it no longer belongs — every other failure falls back to the
 * plain insert so an AI result is never lost.
 */
const ABORT = 'ai-swap:abort';

const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

function reducedMotion() {
    try {
        return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    } catch {
        return false;
    }
}

/** The card that lights up with the text. */
function flareTarget(editorEl) {
    try {
        return editorEl.closest('.editor-shell') || null;
    } catch {
        return null;
    }
}

/** Let the app re-count words, re-save and re-run the find bar. */
function notifyChange(editorEl) {
    try {
        const view = editorEl.ownerDocument?.defaultView;
        const Ctor = view?.Event || window.Event;
        editorEl.dispatchEvent(new Ctor('input', { bubbles: true }));
    } catch {
        /* never let bookkeeping break an edit */
    }
}

/** Park the caret at the end of what was just written (only if the editor is focused). */
function placeCaretAfter(editorEl, node) {
    const doc = editorEl.ownerDocument;
    const view = doc?.defaultView;
    if (!view || doc.activeElement !== editorEl || !node?.parentNode) return;
    try {
        const selection = view.getSelection?.();
        if (!selection) return;
        const range = doc.createRange();
        range.setStartAfter(node);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
    } catch {
        /* caret placement is a nicety, not a requirement */
    }
}

/**
 * Wrap `range` in the swap box, preserving its original nodes so nothing
 * around it shifts by a pixel.
 * @returns {HTMLElement|null} the wrapper, or null when the range is unusable
 */
function buildWrapper(editorEl, range) {
    if (!range || range.collapsed) return null;

    let scope = range.commonAncestorContainer;
    if (scope.nodeType === 3) scope = scope.parentNode;               // Node.TEXT_NODE
    if (!scope || scope.nodeType !== 1 || !editorEl.contains(scope)) return null;
    if (scope.closest?.(WIDGET_SELECTOR)) return null;

    let rectCount = 0;
    try {
        rectCount = range.getClientRects().length;
    } catch {
        rectCount = 0;
    }

    const fragment = range.cloneContents();
    if (!fragment.childNodes.length) return null;

    const doc = editorEl.ownerDocument;
    const wrapper = doc.createElement('span');
    wrapper.className = 'ai-swap';
    wrapper.dataset.aiSwap = '';
    // Read-only island: typing inside the swap would fight the unwrap step.
    wrapper.setAttribute('contenteditable', 'false');

    const ink = doc.createElement('span');
    ink.className = 'ai-swap__ink';
    ink.appendChild(fragment);
    wrapper.appendChild(ink);

    // The bloom copy is only pixel-accurate while the text sits on one line —
    // a grid-stacked copy cannot break across lines the way inline text does.
    if (rectCount === 1) {
        const bloom = doc.createElement('span');
        bloom.className = 'ai-swap__bloom';
        bloom.setAttribute('aria-hidden', 'true');
        Array.from(ink.childNodes).forEach((node) => bloom.appendChild(node.cloneNode(true)));
        // Bloom first in the DOM: it paints underneath the ink.
        wrapper.insertBefore(bloom, ink);
        wrapper.classList.add('ai-swap--stack');
    }

    range.deleteContents();
    range.insertNode(wrapper);
    return wrapper;
}

/** Build the nodes that will replace the old text. */
function nodesFromPayload(payload, doc) {
    if (payload?.type === 'html') {
        const template = doc.createElement('template');
        template.innerHTML = String(payload.value ?? '');
        return Array.from(template.content.childNodes);
    }
    const nodes = [];
    String(payload?.value ?? '').split('\n').forEach((part, index) => {
        if (index) nodes.push(doc.createElement('br'));
        if (part) nodes.push(doc.createTextNode(part));
    });
    return nodes.length ? nodes : [doc.createTextNode('')];
}

function applyPayload(ink, bloom, payload, doc) {
    const nodes = nodesFromPayload(payload, doc);
    ink.replaceChildren(...nodes);
    if (bloom) bloom.replaceChildren(...nodes.map((node) => node.cloneNode(true)));
}

/**
 * Split `parent` (a <p>/<h*> that cannot legally hold blocks) so block-level
 * content becomes its sibling instead of nesting inside it.
 */
function liftBlocks(parent, wrapper, nodes, doc) {
    const grand = parent.parentNode;
    if (!grand) return;

    // Everything that followed the swap inside the paragraph keeps its place
    // in a trailing clone.
    const tail = doc.createElement(parent.tagName.toLowerCase());
    while (wrapper.nextSibling) tail.appendChild(wrapper.nextSibling);

    const firstBlock = nodes.findIndex((node) => node.nodeType === 1 && BLOCK_TAGS.has(node.tagName));
    const keep = firstBlock === -1 ? nodes : nodes.slice(0, firstBlock);
    const lift = firstBlock === -1 ? [] : nodes.slice(firstBlock);

    const keepFragment = doc.createDocumentFragment();
    keep.forEach((node) => keepFragment.appendChild(node));
    parent.replaceChild(keepFragment, wrapper);

    if (tail.childNodes.length) grand.insertBefore(tail, parent.nextSibling);
    const reference = tail.childNodes.length ? tail : parent.nextSibling;

    // The paragraph itself may be left empty by the lift — drop it so the
    // note does not gain a blank line.
    let anchor = reference;
    if (!parent.childNodes.length && lift.length) {
        anchor = parent.nextSibling;
        grand.removeChild(parent);
    }
    lift.forEach((node) => grand.insertBefore(node, anchor));
}

/**
 * Remove the swap box, leaving only the new content behind.
 * @returns {Node|null} the last inserted node, for caret placement
 */
function unwrap(wrapper, editorEl) {
    const parent = wrapper.parentNode;
    if (!parent) return null;

    const doc = editorEl.ownerDocument;
    const ink = wrapper.querySelector('.ai-swap__ink');
    const nodes = ink ? Array.from(ink.childNodes) : Array.from(wrapper.childNodes);
    const last = nodes[nodes.length - 1] || null;

    const hasBlock = nodes.some((node) => node.nodeType === 1 && BLOCK_TAGS.has(node.tagName));
    if (hasBlock && parent.nodeType === 1 && PHRASING_ONLY.has(parent.tagName)) {
        liftBlocks(parent, wrapper, nodes, doc);
        return last;
    }

    const fragment = doc.createDocumentFragment();
    nodes.forEach((node) => fragment.appendChild(node));
    parent.replaceChild(fragment, wrapper);
    return last;
}

/** In-place replacement of a specific range (a word, a sentence, a paragraph). */
async function runRangeSwap(editorEl, wrapper, options) {
    const { payload, commit } = options;
    const doc = editorEl.ownerDocument;
    const shell = flareTarget(editorEl);
    const ink = wrapper.querySelector('.ai-swap__ink');
    const bloom = wrapper.querySelector('.ai-swap__bloom');

    let committed = false;

    active = { editorEl, wrapper };
    try {
        wrapper.classList.add('is-leaving');
        bloom?.classList.add('is-echo-old');
        shell?.classList.add('is-ai-burst');

        await wait(LEAVE_MS);
        // The user (or an undo) removed the text we were animating — drop the
        // edit rather than writing it somewhere it does not belong.
        if (!wrapper.isConnected) throw new Error(ABORT);

        applyPayload(ink, bloom, payload, doc);
        committed = true;

        wrapper.classList.remove('is-leaving');
        bloom?.classList.remove('is-echo-old');
        void wrapper.offsetWidth;                 // restart the arriving animation
        wrapper.classList.add('is-arriving');
        bloom?.classList.add('is-echo-new');
        // Counts and autosave now that the note really changed.
        notifyChange(editorEl);

        await wait(ARRIVE_MS);
    } catch (err) {
        if (!committed && err?.message !== ABORT) {
            try {
                commit();
            } catch {
                /* the fallback insert is best-effort */
            }
        }
    } finally {
        const last = wrapper.isConnected ? unwrap(wrapper, editorEl) : null;
        wrapper.classList.remove('is-leaving', 'is-arriving');
        bloom?.classList.remove('is-echo-old', 'is-echo-new');
        shell?.classList.remove('is-ai-burst');
        active = null;
        if (last) placeCaretAfter(editorEl, last);
        notifyChange(editorEl);
    }
    return true;
}

/** Whole-note replacement: the editor surface itself plays the transition. */
async function runEditorSwap(editorEl, options) {
    const { payload, commit } = options;
    const shell = flareTarget(editorEl);
    const previousEditable = editorEl.getAttribute('contenteditable');
    let committed = false;

    active = { editorEl, whole: true };
    try {
        editorEl.classList.add('ai-swap-host', 'is-leaving');
        shell?.classList.add('is-ai-burst');
        // Locked for the length of the transition, like the prototype's buttons.
        editorEl.setAttribute('contenteditable', 'false');

        await wait(LEAVE_MS);
        if (!editorEl.isConnected) throw new Error(ABORT);

        editorEl.classList.remove('is-leaving');
        editorEl.setAttribute('contenteditable', previousEditable || 'true');
        // The browser's own insert keeps block structure and the undo stack sane.
        commit();
        committed = true;

        void editorEl.offsetWidth;
        editorEl.classList.add('is-arriving');
        notifyChange(editorEl);

        await wait(ARRIVE_MS);
    } catch (err) {
        if (!committed && err?.message !== ABORT) {
            try {
                editorEl.setAttribute('contenteditable', previousEditable || 'true');
                commit();
            } catch {
                /* the fallback insert is best-effort */
            }
        }
    } finally {
        editorEl.classList.remove('ai-swap-host', 'is-leaving', 'is-arriving');
        editorEl.setAttribute('contenteditable', previousEditable || 'true');
        shell?.classList.remove('is-ai-burst');
        active = null;
        notifyChange(editorEl);
    }
    return true;
}

/**
 * Apply an AI replacement with the glow transition.
 *
 * @param {HTMLElement} editorEl
 * @param {object} options
 * @param {Range|null} options.range   text to replace; null = the whole note
 * @param {object} options.payload     { type: 'text'|'html', value: string }
 * @param {Function} options.commit    plain insert used as the fallback and as
 *                                     the whole-note writer (execCommand keeps
 *                                     block structure and native undo intact)
 * @returns {Promise<boolean>} true when the transition actually ran
 */
export async function glowSwap(editorEl, options) {
    const { range = null, payload, commit } = options || {};
    if (!editorEl || !payload || typeof commit !== 'function') return false;

    // Reduced motion, a swap already running, or a headless/test environment:
    // no animation, no delay — just write the text.
    if (reducedMotion() || active) {
        commit();
        return false;
    }

    if (range) {
        let wrapper = null;
        try {
            wrapper = buildWrapper(editorEl, range);
        } catch {
            wrapper = null;
        }
        if (!wrapper) {
            commit();
            return false;
        }
        return runRangeSwap(editorEl, wrapper, options);
    }

    return runEditorSwap(editorEl, options);
}

/** True while a transition is playing — exposed for tests and future callers. */
export function isSwapping() {
    return active !== null;
}

/** Test seam: forget any in-flight transition. */
export function __resetSwapForTests() {
    active = null;
}
