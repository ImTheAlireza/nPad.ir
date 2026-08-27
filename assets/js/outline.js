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
import { caretAtEdge } from './caret.js';

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
            // Nested sections indent: a summary inside another section sits
            // one level deeper per ancestor <details>.
            let level = Number(el.tagName[1]);
            if (isSummary) {
                level = 2;
                let parent = el.parentElement?.parentElement;
                while (parent && parent !== editor) {
                    if (parent.tagName === 'DETAILS') level += 1;
                    parent = parent.parentElement;
                }
            }
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
            button.dir = 'auto';
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

    function caretToEnd(node) {
        editor.focus();
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(node);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    function caretInto(node, offset) {
        editor.focus();
        const selection = window.getSelection();
        const range = document.createRange();
        range.setStart(node, offset);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    // Enter leaves the title for the body; Backspace on an empty title
    // removes the whole section. In the body, Backspace on an emptied block
    // removes the block (the last one removes the section) so clearing a line
    // behaves like ordinary text instead of stranding the caret; at the start
    // of the first body block it stops before merging into the summary.
    editor.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== 'Backspace') return;
        const selection = window.getSelection();
        if (!selection?.rangeCount || !selection.isCollapsed) return;
        const start = selection.getRangeAt(0).startContainer;
        const summary = summaryFrom(start);

        if (!summary) {
            if (event.key !== 'Backspace') return;
            // The caret container may BE the block (an emptied paragraph).
            const startEl = start.nodeType === 1 ? start : start.parentElement;
            const details = startEl?.closest('details');
            if (!details || !editor.contains(details)) return;
            const block = startEl?.closest('p, div, ul, ol, blockquote, pre, h1, h2, h3, h4, h5, h6');
            if (!block || !details.contains(block)) return;
            const firstBody = details.querySelector(':scope > *:not(summary)');
            const previous = block.previousElementSibling === details.querySelector(':scope > summary')
                ? null
                : block.previousElementSibling;

            if (!(block.textContent || '').trim()) {
                event.preventDefault();
                event.stopPropagation();
                block.remove();
                if (previous && details.contains(previous)) caretToEnd(previous);
                else {
                    const next = details.querySelector(':scope > *:not(summary)');
                    if (next) caretInto(next, 0);
                    else {
                        details.remove();
                        const anchor = editor.querySelector('details') || null;
                        if (anchor) caretToEnd(anchor.previousElementSibling || editor);
                        else editor.focus();
                    }
                }
                edited();
                refresh();
            } else if (caretAtEdge(selection, block, false) && block === firstBody) {
                // Don't let the browser merge the first body block into the
                // summary; the title keeps its own line.
                event.preventDefault();
                event.stopPropagation();
            }
            return;
        }

        if (!summary.contains(start)) return;
        const details = summary.parentElement;

        if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            // Moving the caret consumes the keystroke completely. Later
            // listeners on this same event must not act on the NEW caret
            // position (the checklist's Enter model would otherwise see the
            // freshly-entered empty item and dismantle the list).
            event.stopImmediatePropagation();
            details.open = true;

            // Enter the first body block, whatever it is — a fresh section
            // body may legitimately start with a checklist, table, code
            // block or nested section rather than a paragraph.
            let body = details.querySelector(':scope > *:not(summary)');
            if (!body) {
                body = document.createElement('p');
                body.appendChild(document.createElement('br'));
                details.appendChild(body);
                caretInto(body, 0);
                edited();
                return;
            }
            editor.focus();
            const range = document.createRange();
            if (body.tagName === 'UL' || body.tagName === 'OL') {
                const item = body.querySelector(':scope > li');
                if (!item) {
                    range.setStart(body, 0);
                } else if (item.firstChild?.tagName === 'INPUT') {
                    // Right after a checklist's checkbox.
                    range.setStart(item, 1);
                } else {
                    range.setStart(item, 0);
                }
            } else if (body.tagName === 'TABLE') {
                range.setStart(body.querySelector('td, th') || body, 0);
            } else if (body.tagName === 'DETAILS') {
                range.setStart(body.querySelector('summary') || body, 0);
            } else {
                range.setStart(body, 0);
            }
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
