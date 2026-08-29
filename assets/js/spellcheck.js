/**
 * NPad custom spell checker.
 *
 * A dictionary-based checker that works on the live contenteditable DOM:
 *  - misspelled words are wrapped in <span class="spell-err"> with a
 *    hand-drawn blue wave that animates in (see app.css)
 *  - tapping, keyboard-activating, or hovering a flagged word opens a
 *    correction dialog with replace suggestions and dictionary actions
 *  - everything is local: the Hunspell engine + a per-browser custom
 *    word list in localStorage. No network, no native spellcheck UI.
 *
 * The module is deliberately self-contained: editor.js only asks for
 * setEnabled()/refresh()/isEnabled().
 */

/**
 * The Hunspell engine + en_US dictionary (~550 KB raw, ~196 KB gzipped)
 * is loaded off the critical path: imported dynamically on first use, and
 * until it arrives no word is flagged. The module's API stays synchronous —
 * callers never await anything.
 *
 * nspell-engine.js is a self-contained ESM bundle (nspell + dictionary-en)
 * built with esbuild. It exports a default object: { check, suggest, addWord }.
 */

/** @type {{ check: (w:string)=>boolean, suggest: (w:string)=>string[], addWord: (w:string)=>void }|null} */
let engine = null;
let engineLoad = null;

function ensureDictionary() {
    if (engine) return engineLoad;
    engineLoad ??= import('./nspell-engine.js')
        .then((module) => {
            engine = module.default;
        })
        .catch(() => {
            // Offline or load error — allow retry on next pass.
            engineLoad = null;
        });
    return engineLoad;
}

const MAX_SUGGESTIONS = 4;
const LS_CUSTOM = 'npad.customWords';
const LS_ENABLED = 'npad.spellcheck';

/** 4 === NodeFilter.SHOW_TEXT (named constant missing in jsdom/webviews). */
const SHOW_TEXT = 4;

/** Normalise for lookup: strip ZWNJ, fold Arabic yeh/kaf into Persian. */
function norm(word) {
    return word.replace(/\u200c/g, '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').toLowerCase();
}

/** Match the suggestion's casing to how the user typed the word. */
function matchCase(original, suggestion) {
    if (/^[A-Z]{2,}$/.test(original)) return suggestion.toUpperCase();
    if (/^[A-Z]/.test(original)) {
        return suggestion.charAt(0).toUpperCase() + suggestion.slice(1);
    }
    return suggestion;
}

export function initSpellcheck({ editor, strings = {}, onEvent }) {
    const track = typeof onEvent === 'function' ? onEvent : () => {};

    let enabled = true;
    let custom = new Set();
    let ignored = new Set(); // session-only
    let lastText = null;
    let remarkTimer = null;
    let hoverTimer = null;
    let hideTimer = null;
    let hoverEl = null;
    let tip = null;

    const persist = (key, value) => {
        try { localStorage.setItem(key, value); } catch { /* private mode */ }
    };

    /* ------------------------------------------------------------------
       Marking
       ------------------------------------------------------------------ */

    function isMisspelled(word) {
        if (word.length < 2) return false;
        if (/\d/.test(word)) return false;
        // All-caps Latin runs are usually acronyms (NASA, HTTP…).
        if (/^[A-Z]{2,}$/.test(word) && /^[A-Za-z]+$/.test(word)) return false;

        const n = norm(word);
        if (custom.has(n) || ignored.has(n)) return false;

        // Hunspell engine (nspell) — handles contractions, affixes, compounds.
        if (!engine) return false;
        return !engine.check(word);
    }

    function unwrapMarks() {
        editor.querySelectorAll('.spell-err').forEach((el) => {
            el.replaceWith(document.createTextNode(el.textContent));
        });
    }

    /** Wrap misspelled words inside one text node. */
    function wrapNode(textNode) {
        const text = textNode.nodeValue;
        const re = /[\p{L}\p{N}\u200c]+/gu;
        const parts = [];
        let lastIndex = 0;
        let changed = false;
        let m;

        while ((m = re.exec(text)) !== null) {
            if (!isMisspelled(m[0])) continue;
            changed = true;
            if (m.index > lastIndex) parts.push(text.slice(lastIndex, m.index));
            const span = document.createElement('span');
            span.className = 'spell-err';
            span.textContent = m[0];
            span.tabIndex = 0;
            span.setAttribute('role', 'button');
            span.setAttribute('aria-haspopup', 'dialog');
            span.setAttribute('aria-expanded', 'false');
            span.setAttribute(
                'aria-label',
                (strings.spellSuggestionsFor || 'Spelling suggestions for “{word}”')
                    .replace('{word}', m[0]),
            );
            parts.push(span);
            lastIndex = m.index + m[0].length;
        }

        if (!changed) return;
        if (lastIndex < text.length) parts.push(text.slice(lastIndex));

        const frag = document.createDocumentFragment();
        for (const part of parts) {
            frag.appendChild(typeof part === 'string' ? document.createTextNode(part) : part);
        }
        textNode.parentNode.replaceChild(frag, textNode);
    }

    /* ------------------------------------------------------------------
       Caret preservation across re-marking
       ------------------------------------------------------------------ */

    function saveCaret() {
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return null;
        const range = sel.getRangeAt(0);
        const start = range.startContainer;
        if (!editor.contains(start)) return null;

        let offset = 0;
        const walker = document.createTreeWalker(editor, SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            if (node === start) return { offset: offset + range.startOffset };
            offset += (node.nodeValue || '').length;
        }
        // Selection anchored on an element (e.g. start of a paragraph).
        return { element: start, elementOffset: range.startOffset };
    }

    function restoreCaret(where) {
        if (!where) return;
        const sel = window.getSelection();
        if (!sel) return;
        const range = document.createRange();

        if (where.element) {
            range.setStart(where.element, where.elementOffset);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
            return;
        }

        let remaining = where.offset;
        const walker = document.createTreeWalker(editor, SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            const len = (node.nodeValue || '').length;
            if (remaining <= len) {
                range.setStart(node, Math.max(0, remaining));
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);
                return;
            }
            remaining -= len;
        }
    }

    /* ------------------------------------------------------------------
       Re-mark pass
       ------------------------------------------------------------------ */

    /**
     * Capture a control that currently owns keyboard focus. Rebuilding the
     * spell-mark DOM and restoring an editor Range makes Chromium focus the
     * contenteditable, even when the user has already moved into Find, a
     * dialog field, or the font search. Keep both focus and the control's
     * caret so a delayed spell pass can never interrupt typing elsewhere.
     */
    function captureExternalFocus() {
        const element = document.activeElement;
        if (!element || element === document.body || editor.contains(element)) return null;

        const state = { element };
        if (typeof element.selectionStart === 'number') {
            state.start = element.selectionStart;
            state.end = element.selectionEnd;
            state.direction = element.selectionDirection;
        }
        return state;
    }

    function restoreExternalFocus(state) {
        if (!state || !state.element.isConnected) return;
        try {
            state.element.focus({ preventScroll: true });
        } catch {
            state.element.focus();
        }
        if (typeof state.start === 'number' && typeof state.element.setSelectionRange === 'function') {
            try {
                state.element.setSelectionRange(state.start, state.end, state.direction || 'none');
            } catch {
                /* Some input types do not expose a selectable text range. */
            }
        }
    }

    function remark() {
        if (!enabled) return;
        const text = editor.textContent || '';
        if (text === lastText) return;
        if (!engine) {
            // Engine still loading: remember nothing, so the pass that
            // runs once it arrives re-marks the current text.
            lastText = null;
            ensureDictionary().then(() => scheduleRemark(0));
            return;
        }
        lastText = text;

        const focusedControl = captureExternalFocus();
        const caret = saveCaret();
        unwrapMarks();

        // Snapshot the text nodes first. Replacing a node while the walker
        // is mid-iteration detaches its current node, so in real browsers
        // the walker stops and every later paragraph is skipped (jsdom
        // behaves differently, which is why this only showed up live).
        const textNodes = [];
        const walker = document.createTreeWalker(editor, SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            // Code is literal content: highlighting spans and the block chrome
            // are never prose, and flagging keywords as typos is noise.
            const parent = node.parentElement;
            if (parent?.closest('pre, code, math-inline, math-block, [data-codeblock-chrome]')) continue;
            if (node.nodeValue) textNodes.push(node);
        }
        for (const textNode of textNodes) wrapNode(textNode);

        restoreCaret(caret);
        restoreExternalFocus(focusedControl);
        editor.dispatchEvent(new window.CustomEvent('npad:spell-render'));
    }

    function scheduleRemark(delay) {
        clearTimeout(remarkTimer);
        remarkTimer = setTimeout(remark, delay);
    }

    /* ------------------------------------------------------------------
       Suggestions
       ------------------------------------------------------------------ */

    function suggest(word) {
        if (!engine) return [];
        // nspell returns suggestions already ranked by edit distance + frequency.
        return engine.suggest(word).slice(0, MAX_SUGGESTIONS);
    }

    /* ------------------------------------------------------------------
       Tooltip
       ------------------------------------------------------------------ */

    const HIDE_GRACE = 500;

    function cancelHide() {
        clearTimeout(hideTimer);
        hideTimer = null;
    }

    function scheduleHide() {
        cancelHide();
        hideTimer = setTimeout(hideTip, HIDE_GRACE);
    }

    function ensureTip() {
        if (tip) return tip;
        tip = document.createElement('div');
        tip.id = 'spellSuggestions';
        tip.className = 'spell-tip';
        tip.setAttribute('role', 'dialog');
        tip.setAttribute('aria-modal', 'false');
        tip.hidden = true;

        // The word and this detached, body-level popup form one hover region.
        // In particular, entering the popup must cancel the word's leave
        // timer; otherwise it disappears just as a suggestion is reached.
        tip.addEventListener('mouseenter', cancelHide);
        tip.addEventListener('mouseleave', (event) => {
            if (hoverEl && event.relatedTarget && hoverEl.contains(event.relatedTarget)) return;
            scheduleHide();
        });
        tip.addEventListener('focusin', cancelHide);
        tip.addEventListener('focusout', (event) => {
            if (event.relatedTarget && tip.contains(event.relatedTarget)) return;
            scheduleHide();
        });
        tip.addEventListener('keydown', (event) => {
            const buttons = [...tip.querySelectorAll('button:not(:disabled)')];
            const index = buttons.indexOf(document.activeElement);
            let next = null;
            if (event.key === 'ArrowDown') next = index + 1;
            else if (event.key === 'ArrowUp') next = index - 1;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = buttons.length - 1;
            else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                hideTip({ returnFocus: true });
                return;
            }
            if (next !== null && buttons.length) {
                event.preventDefault();
                buttons[(next + buttons.length) % buttons.length].focus();
            }
        });
        document.body.appendChild(tip);
        return tip;
    }

    function hideTip({ returnFocus = false } = {}) {
        const word = hoverEl;
        if (tip) tip.hidden = true;
        if (word?.isConnected) word.setAttribute('aria-expanded', 'false');
        clearTimeout(hoverTimer);
        cancelHide();
        hoverEl = null;
        if (returnFocus && word?.isConnected) word.focus();
    }

    function positionTip(wordEl) {
        const tipEl = ensureTip();
        const rect = typeof wordEl.getBoundingClientRect === 'function'
            ? wordEl.getBoundingClientRect()
            : null;
        if (!rect) return;
        const width = tipEl.offsetWidth || 240;
        const height = tipEl.offsetHeight || 0;
        const vw = window.innerWidth || document.documentElement.clientWidth;
        const vh = window.innerHeight || document.documentElement.clientHeight;

        const left = Math.min(Math.max(rect.left, 8), Math.max(8, vw - width - 8));
        let top = rect.bottom + 8;
        let placement = 'below';
        if (top + height > vh - 8 && rect.top - height - 8 > 0) {
            top = rect.top - height - 8;
            placement = 'above';
        }
        tipEl.dataset.placement = placement;
        tipEl.style.left = `${left}px`;
        tipEl.style.top = `${top}px`;
    }

    function finishWordAction(wordEl, value) {
        const textNode = document.createTextNode(value);
        hideTip();
        wordEl.replaceWith(textNode);
        lastText = null;
        editor.focus();
        try {
            const range = document.createRange();
            range.setStart(textNode, textNode.length);
            range.collapse(true);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        } catch { /* keep the replacement even when selection APIs are unavailable */ }
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function replaceWord(wordEl, newText) {
        finishWordAction(wordEl, newText);
        track('spell_replace_used');
    }

    function addToDictionary(wordEl) {
        const word = wordEl.textContent;
        const n = norm(word);
        custom.add(n);
        // Also teach the live nspell instance so re-marks treat it as correct.
        if (engine) engine.addWord(word);
        try { localStorage.setItem(LS_CUSTOM, JSON.stringify([...custom])); } catch { /* ignore */ }
        finishWordAction(wordEl, word);
        track('spell_add_word');
    }

    function ignoreWord(wordEl) {
        const word = wordEl.textContent;
        ignored.add(norm(word));
        finishWordAction(wordEl, word);
    }

    function showTip(wordEl, { focusFirst = false } = {}) {
        const tipEl = ensureTip();
        if (hoverEl && hoverEl !== wordEl && hoverEl.isConnected) {
            hoverEl.setAttribute('aria-expanded', 'false');
        }
        hoverEl = wordEl;
        const suggestions = suggest(wordEl.textContent);
        tipEl.textContent = '';
        tipEl.setAttribute(
            'aria-label',
            (strings.spellSuggestionsFor || 'Spelling suggestions for “{word}”')
                .replace('{word}', wordEl.textContent),
        );

        const list = document.createElement('div');
        list.className = 'spell-tip__list';
        if (suggestions.length) {
            for (const suggestion of suggestions) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'spell-tip__item';
                button.textContent = matchCase(wordEl.textContent, suggestion);
                button.addEventListener('click', () => replaceWord(wordEl, button.textContent));
                list.appendChild(button);
            }
        } else {
            const empty = document.createElement('p');
            empty.className = 'spell-tip__empty';
            empty.textContent = strings.spellNoSuggestions || 'No suggestions';
            list.appendChild(empty);
        }

        const actions = document.createElement('div');
        actions.className = 'spell-tip__actions';
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'spell-tip__action';
        add.textContent = strings.spellAdd || 'Add to dictionary';
        add.addEventListener('click', () => addToDictionary(wordEl));
        const ignore = document.createElement('button');
        ignore.type = 'button';
        ignore.className = 'spell-tip__action';
        ignore.textContent = strings.spellIgnore || 'Ignore';
        ignore.addEventListener('click', () => ignoreWord(wordEl));
        actions.append(add, ignore);

        tipEl.append(list, actions);
        tipEl.hidden = false;
        wordEl.setAttribute('aria-controls', tipEl.id);
        wordEl.setAttribute('aria-expanded', 'true');
        positionTip(wordEl);
        if (focusFirst) tipEl.querySelector('button')?.focus();
    }

    /* ------------------------------------------------------------------
       Public API
       ------------------------------------------------------------------ */

    function setEnabled(on) {
        enabled = !!on;
        persist(LS_ENABLED, enabled ? '1' : '0');
        const btn = document.querySelector('[data-action="toggle-spellcheck"]');
        if (btn) btn.setAttribute('aria-pressed', String(enabled));
        clearTimeout(remarkTimer);
        if (!enabled) {
            clearTimeout(hoverTimer);
            hideTip();
            unwrapMarks();
            lastText = null;
        } else {
            scheduleRemark(0);
        }
    }

    function refresh() {
        // A different note may contain identical text but no existing marks;
        // force the next pass instead of skipping on the last-text cache.
        lastText = null;
        hideTip();
        if (enabled) scheduleRemark(0);
    }

    /* ------------------------------------------------------------------
       Wiring
       ------------------------------------------------------------------ */

    try {
        const raw = localStorage.getItem(LS_CUSTOM);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) custom = new Set(parsed);
        }
    } catch { /* private mode */ }

    try {
        if (localStorage.getItem(LS_ENABLED) === '0') enabled = false;
    } catch { /* private mode */ }

    // Start the engine download immediately (it does not block the
    // editor or first paint) and mark any existing content once it lands.
    // Once loaded, seed the engine with any words the user has added.
    ensureDictionary().then(() => {
        if (engine) {
            for (const word of custom) engine.addWord(word);
        }
        scheduleRemark(0);
    });

    const btn = document.querySelector('[data-action="toggle-spellcheck"]');
    if (btn) btn.setAttribute('aria-pressed', String(enabled));

    editor.addEventListener('input', () => {
        if (!enabled) return;
        const delay = parseInt(editor.dataset.spellDebounce || '650', 10);
        scheduleRemark(Math.max(0, delay));
    });

    // A tap/click opens corrections immediately. Hover remains available for
    // mouse users, while Enter/Space/ArrowDown makes every flagged word fully
    // keyboard operable without relying on a pointer.
    editor.addEventListener('click', (event) => {
        const el = event.target.closest ? event.target.closest('.spell-err') : null;
        if (!el) return;
        cancelHide();
        clearTimeout(hoverTimer);
        showTip(el);
    });

    editor.addEventListener('keydown', (event) => {
        const el = event.target.closest ? event.target.closest('.spell-err') : null;
        if (!el || !['Enter', ' ', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        cancelHide();
        clearTimeout(hoverTimer);
        showTip(el, { focusFirst: true });
    });

    editor.addEventListener('mouseover', (event) => {
        const el = event.target.closest ? event.target.closest('.spell-err') : null;
        if (!el) return;
        cancelHide();
        if (el === hoverEl) return;
        clearTimeout(hoverTimer);
        // Moving to a different flagged word closes any open tooltip.
        if (tip && !tip.hidden) hideTip();
        hoverEl = el;
        const delay = parseInt(editor.dataset.spellDelay || '1000', 10);
        hoverTimer = setTimeout(() => {
            if (el.isConnected && hoverEl === el) showTip(el);
        }, Math.max(0, delay));
    });

    editor.addEventListener('mouseout', (event) => {
        const el = event.target.closest ? event.target.closest('.spell-err') : null;
        if (!el) return;
        const to = event.relatedTarget;
        if (to && (el.contains(to) || (tip && tip.contains(to)))) {
            cancelHide();
            return;
        }
        clearTimeout(hoverTimer);
        // Keep the open popup available while the pointer crosses the small
        // visual gap between it and the word. Its transparent CSS bridge and
        // mouseenter listener cancel this fallback timer on arrival.
        if (tip && !tip.hidden && hoverEl === el) {
            scheduleHide();
        } else if (hoverEl === el) {
            hoverEl = null;
        }
    });

    const hideOnOutside = (event) => {
        const word = event.target.closest ? event.target.closest('.spell-err') : null;
        if (word) return;
        if (tip && !tip.hidden && !tip.contains(event.target)) hideTip();
    };
    document.addEventListener('click', hideOnOutside);
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && tip && !tip.hidden) hideTip({ returnFocus: true });
    });
    window.addEventListener('scroll', hideTip, { capture: true, passive: true });
    window.addEventListener('resize', hideTip, { passive: true });

    return { setEnabled, isEnabled: () => enabled, refresh };
}
