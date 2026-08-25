/**
 * NPad custom spell checker.
 *
 * A dictionary-based checker that works on the live contenteditable DOM:
 *  - misspelled words are wrapped in <span class="spell-err"> with a
 *    hand-drawn blue wave that animates in (see app.css)
 *  - hovering a flagged word for ~3s opens a clickable tooltip with
 *    replace suggestions, plus "add to dictionary" / "ignore"
 *  - everything is local: the bundled wordlist + a per-browser custom
 *    word list in localStorage. No network, no native spellcheck UI.
 *
 * The module is deliberately self-contained: editor.js only asks for
 * setEnabled()/refresh()/isEnabled().
 */

import { WORD_LIST, DICTIONARY } from './wordlist.js';

const MAX_SUGGESTIONS = 4;
const LS_CUSTOM = 'npad.customWords';
const LS_ENABLED = 'npad.spellcheck';

/** 4 === NodeFilter.SHOW_TEXT (named constant missing in jsdom/webviews). */
const SHOW_TEXT = 4;

/**
 * Damerau–Levenshtein (optimal string alignment). Cheap bail-out at >2 so
 * the tooltip only pays for plausible candidates.
 */
function editDistance(a, b) {
    const m = a.length;
    const n = b.length;
    if (Math.abs(m - n) > 2) return 3;

    const d = [];
    for (let i = 0; i <= m; i++) d.push(new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) d[i][0] = i;
    for (let j = 0; j <= n; j++) d[0][j] = j;

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
            }
        }
    }
    return d[m][n];
}

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
        if (DICTIONARY.has(n) || custom.has(n) || ignored.has(n)) return false;
        return true;
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

    function remark() {
        if (!enabled) return;
        const text = editor.textContent || '';
        if (text === lastText) return;
        lastText = text;

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
            if (node.nodeValue) textNodes.push(node);
        }
        for (const textNode of textNodes) wrapNode(textNode);

        restoreCaret(caret);
    }

    function scheduleRemark(delay) {
        clearTimeout(remarkTimer);
        remarkTimer = setTimeout(remark, delay);
    }

    /* ------------------------------------------------------------------
       Suggestions
       ------------------------------------------------------------------ */

    function suggest(word) {
        const n = norm(word);
        if (!n) return [];
        const first = n[0];
        const results = [];

        for (let i = 0; i < WORD_LIST.length; i++) {
            const candidate = WORD_LIST[i];
            if (candidate[0] !== first) continue;
            if (Math.abs(candidate.length - n.length) > 2) continue;
            const d = editDistance(n, candidate);
            if (d <= 2) results.push([d, i, candidate]);
        }

        results.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        return results.slice(0, MAX_SUGGESTIONS).map((r) => r[2]);
    }

    /* ------------------------------------------------------------------
       Tooltip
       ------------------------------------------------------------------ */

    function ensureTip() {
        if (tip) return tip;
        tip = document.createElement('div');
        tip.className = 'spell-tip';
        tip.setAttribute('role', 'tooltip');
        tip.hidden = true;
        // Keeping the pointer on the tooltip (or the word) keeps it open.
        tip.addEventListener('mouseenter', () => clearTimeout(hideTimer));
        tip.addEventListener('mouseleave', () => {
            hideTimer = setTimeout(hideTip, 250);
        });
        document.body.appendChild(tip);
        return tip;
    }

    function hideTip() {
        if (tip) tip.hidden = true;
        clearTimeout(hoverTimer);
        clearTimeout(hideTimer);
        hoverEl = null;
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

        let left = Math.min(Math.max(rect.left, 8), Math.max(8, vw - width - 8));
        let top = rect.bottom + 8;
        if (top + height > vh - 8 && rect.top - height - 8 > 0) {
            top = rect.top - height - 8;
        }
        tipEl.style.left = `${left}px`;
        tipEl.style.top = `${top}px`;
    }

    function replaceWord(wordEl, newText) {
        wordEl.replaceWith(document.createTextNode(newText));
        lastText = null;
        hideTip();
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        track('spell_replace_used');
    }

    function addToDictionary(wordEl) {
        custom.add(norm(wordEl.textContent));
        try { localStorage.setItem(LS_CUSTOM, JSON.stringify([...custom])); } catch { /* ignore */ }
        lastText = null;
        hideTip();
        wordEl.replaceWith(document.createTextNode(wordEl.textContent));
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        track('spell_add_word');
    }

    function ignoreWord(wordEl) {
        ignored.add(norm(wordEl.textContent));
        lastText = null;
        hideTip();
        wordEl.replaceWith(document.createTextNode(wordEl.textContent));
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function showTip(wordEl) {
        const tipEl = ensureTip();
        const suggestions = suggest(wordEl.textContent);
        tipEl.textContent = '';

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
        positionTip(wordEl);
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

    const btn = document.querySelector('[data-action="toggle-spellcheck"]');
    if (btn) btn.setAttribute('aria-pressed', String(enabled));

    editor.addEventListener('input', () => {
        if (!enabled) return;
        const delay = parseInt(editor.dataset.spellDebounce || '650', 10);
        scheduleRemark(Math.max(0, delay));
    });

    editor.addEventListener('mouseover', (event) => {
        const el = event.target.closest ? event.target.closest('.spell-err') : null;
        if (!el) return;
        if (el === hoverEl) return;
        clearTimeout(hoverTimer);
        // Moving to a different flagged word closes any open tooltip.
        if (tip && !tip.hidden) hideTip();
        hoverEl = el;
        const delay = parseInt(editor.dataset.spellDelay || '1000', 10);
        hoverTimer = setTimeout(() => showTip(el), Math.max(0, delay));
    });

    editor.addEventListener('mouseout', (event) => {
        const el = event.target.closest ? event.target.closest('.spell-err') : null;
        const to = event.relatedTarget;
        if (el && to && el.contains(to)) return;
        clearTimeout(hoverTimer);
        // If a tooltip is open, give the mouse a grace period to reach it
        // instead of hiding the instant the pointer leaves the word.
        if (tip && !tip.hidden) {
            hideTimer = setTimeout(hideTip, 200);
        } else {
            hoverEl = null;
        }
    });

    const hideOnOutside = (event) => {
        if (tip && !tip.hidden && !(tip.contains(event.target))) hideTip();
    };
    document.addEventListener('click', hideOnOutside);
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') hideTip();
    });
    window.addEventListener('scroll', hideTip, { capture: true, passive: true });
    window.addEventListener('resize', hideTip, { passive: true });

    return { setEnabled, isEnabled: () => enabled, refresh };
}
