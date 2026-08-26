/**
 * Collapsible sections and the outline navigator.
 *
 * Sections are native <details>/<summary> blocks — semantic, printable and
 * exportable. The stored note keeps the source (including each section's
 * open/collapsed state via the `open` attribute); clicking a summary toggles
 * it manually, because native toggling inside contenteditable differs across
 * engines. Before printing every section is expanded and restored after, so
 * a collapsed section can never print as a bare title.
 *
 * The outline navigator is a toolbar panel listing the note's H1–H6
 * headings and section summaries, indented by level. Clicking an entry
 * scrolls to it and places the caret; the list rebuilds live while typing.
 */

import { toast } from './ui.js';

export function initOutline({ editor, strings = {}, onEvent, onEdit, placeBlock }) {
    const track = typeof onEvent === 'function' ? onEvent : () => {};
    const edited = typeof onEdit === 'function' ? onEdit : () => {};
    const dropBlock = typeof placeBlock === 'function' ? placeBlock : null;

    const panel = document.getElementById('outlinePanel');
    const listEl = panel?.querySelector('[data-outline-list]');
    const emptyEl = panel?.querySelector('[data-outline-empty]');
    let refreshTimer = 0;

    /* ------------------------------------------------------------------
       Panel
       ------------------------------------------------------------------ */

    function isOpen() {
        return !!panel && !panel.hidden;
    }

    function togglePanel(force) {
        if (!panel) return;
        const open = typeof force === 'boolean' ? force : panel.hidden;
        panel.hidden = !open;
        const button = document.querySelector('[data-action="outline"]');
        if (button) button.setAttribute('aria-pressed', String(open));
        if (open) {
            refresh();
            if (listEl) listEl.querySelector('button')?.focus();
            track('outline_used');
        }
    }

    function closePanel() {
        togglePanel(false);
        document.querySelector('[data-action="outline"]')?.focus();
    }

    /** Headings and section summaries, in document order. */
    function collectEntries() {
        const entries = [];
        editor.querySelectorAll('h1, h2, h3, h4, h5, h6, details > summary').forEach((el) => {
            const isSummary = el.tagName === 'SUMMARY';
            const level = isSummary ? 2 : Number(el.tagName[1]);
            const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 90);
            entries.push({
                el,
                level,
                text: text || (isSummary ? (strings.sectionSummary || 'Summary') : (strings.outlineUntitled || 'Untitled')),
                isSummary,
            });
        });
        return entries;
    }

    function refresh() {
        if (!panel || panel.hidden || !listEl) return;
        const entries = collectEntries();
        listEl.textContent = '';
        emptyEl.hidden = entries.length > 0;

        for (const entry of entries) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'outline-panel__entry';
            button.style.paddingInlineStart = `calc(var(--space-3) + ${(entry.level - 1) * 14}px)`;
            button.textContent = entry.text;
            if (entry.isSummary) {
                const mark = document.createElement('span');
                mark.className = 'outline-panel__mark';
                mark.textContent = '▸';
                mark.setAttribute('aria-hidden', 'true');
                button.prepend(mark);
            }
            button.addEventListener('click', () => {
                // Close (and move focus off the panel) first: focusing the
                // toolbar button must not clobber the caret placed below.
                closePanel();
                editor.focus();
                const selection = window.getSelection();
                const range = document.createRange();
                range.setStart(entry.el, 0);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
                if (typeof entry.el.scrollIntoView === 'function') {
                    entry.el.scrollIntoView({ block: 'start' });
                }
                track('outline_used');
            });
            listEl.appendChild(button);
        }
    }

    /* ------------------------------------------------------------------
       Collapsible sections
       ------------------------------------------------------------------ */

    function ensureSpacerAfter(element) {
        const next = element.nextElementSibling;
        if (!next || /^(P|DIV|TABLE|HR|UL|OL|BLOCKQUOTE|PRE|DETAILS|H[1-6])$/.test(next.tagName)) return;
        const spacer = document.createElement('p');
        spacer.appendChild(document.createElement('br'));
        element.after(spacer);
    }

    function insertSection() {
        if (!dropBlock) return;
        const details = document.createElement('details');
        details.open = true;
        const summary = document.createElement('summary');
        summary.textContent = strings.sectionSummary || 'Summary';
        const body = document.createElement('p');
        body.appendChild(document.createElement('br'));
        details.append(summary, body);

        if (!dropBlock(details)) return;
        ensureSpacerAfter(details);

        const selection = window.getSelection();
        const caret = document.createRange();
        caret.setStart(summary, 0);
        caret.collapse(true);
        selection.removeAllRanges();
        selection.addRange(caret);

        edited();
        refresh();
        track('section_inserted');
        if (strings.sectionInserted) toast(strings.sectionInserted, 'success');
    }

    /* ------------------------------------------------------------------
       Behaviour inside the editor
       ------------------------------------------------------------------ */

    function summaryFrom(node) {
        const element = node.nodeType === 1 ? node : node.parentElement;
        const summary = element?.closest('summary');
        return summary && editor.contains(summary) ? summary : null;
    }

    // Click a summary toggles its section. Engines disagree: Chrome's toggle
    // is a cancelable default action, jsdom/Firefox toggle natively no matter
    // what. preventDefault plus a settle check gives every engine exactly one
    // toggle: if the native one fired, nothing more to do.
    editor.addEventListener('click', (event) => {
        const summary = summaryFrom(event.target);
        if (!summary) return;
        event.preventDefault();
        const details = summary.parentElement;
        const wasOpen = details.open;
        window.setTimeout(() => {
            if (!details.isConnected) return;
            if (details.open !== wasOpen) {
                edited();
                refresh();
                return;
            }
            details.open = !wasOpen;
            edited();
        }, 0);
    }, true);

    // Enter leaves the title for the body; Backspace on an empty title
    // removes the whole section.
    editor.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== 'Backspace') return;
        const selection = window.getSelection();
        if (!selection?.rangeCount) return;
        const summary = summaryFrom(selection.getRangeAt(0).startContainer);
        if (!summary || !summary.contains(selection.getRangeAt(0).startContainer)) return;
        const details = summary.parentElement;

        if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            let body = details.querySelector(':scope > p, :scope > div');
            if (!body) {
                body = document.createElement('p');
                body.appendChild(document.createElement('br'));
                details.appendChild(body);
            }
            details.open = true;
            editor.focus();
            const range = document.createRange();
            range.setStart(body, 0);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
            edited();
            return;
        }

        // Backspace
        if ((summary.textContent || '').trim()) return;
        event.preventDefault();
        event.stopPropagation();
        details.remove();
        edited();
        refresh();
    }, true);

    // Rebuild the outline while typing (debounced) and before printing.
    editor.addEventListener('input', () => {
        window.clearTimeout(refreshTimer);
        refreshTimer = window.setTimeout(refresh, 300);
    });

    let printStates = null;
    window.addEventListener('beforeprint', () => {
        printStates = [];
        for (const details of editor.querySelectorAll('details:not([open])')) {
            printStates.push(details);
            details.open = true;
        }
    });
    window.addEventListener('afterprint', () => {
        if (!printStates) return;
        for (const details of printStates) details.open = false;
        printStates = null;
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && isOpen()) closePanel();
    });

    return { insertSection, refresh, togglePanel, isOpen };
}
