/**
 * Checklists and the task overview.
 *
 * A checklist is a GFM-compatible list —
 *
 *     <ul class="checklist">
 *       <li class="task-checked"><input type="checkbox" checked>Milk</li>
 *       <li><input type="checkbox">Tea</li>
 *     </ul>
 *
 * — real checkboxes (keyboard-toggleable, screen-reader correct) inside
 * contenteditable. The `task-checked` class mirrors the input's state so the
 * stored form stays simple and the Markdown round trip (which reads the
 * class) never depends on form-field quirks. A normaliser keeps exactly one
 * checkbox per item, whatever Enter/undo/paste does to the DOM.
 *
 * The task overview scans every note's checklists into a single dialog:
 * toggling a row updates the source note (the live editor for the active
 * note, storage for the rest), and each row carries a jump link that opens
 * the note and scrolls to the task.
 */

import { showDialog, toast, escapeHtml } from './ui.js';

export function initChecklist({ editor, strings = {}, onEvent, onEdit, placeBlock, getNotes, updateNoteTask, jumpToTask }) {
    const track = typeof onEvent === 'function' ? onEvent : () => {};
    const edited = typeof onEdit === 'function' ? onEdit : () => {};
    const dropBlock = typeof placeBlock === 'function' ? placeBlock : null;
    let normaliseTimer = 0;

    /* ------------------------------------------------------------------
       Normalisation: exactly one checkbox, first child of each item
       ------------------------------------------------------------------ */

    function normaliseList(list) {
        for (const item of list.children) {
            if (item.tagName !== 'LI') continue;
            const inputs = [...item.children].filter((el) => el.tagName === 'INPUT');
            for (const extra of inputs.slice(1)) extra.remove();
            let input = inputs[0];
            if (!input) {
                input = document.createElement('input');
                input.type = 'checkbox';
                item.prepend(input);
            }
            input.checked = item.classList.contains('task-checked');
            if (input.checked) input.setAttribute('checked', '');
            else input.removeAttribute('checked');
        }
    }

    function normalise(root) {
        const scope = root && root !== editor && root.matches?.('ul.checklist')
            ? [root]
            : [...editor.querySelectorAll('ul.checklist')];
        for (const list of scope) normaliseList(list);
    }

    /* ------------------------------------------------------------------
       Editing behaviour
       ------------------------------------------------------------------ */

    function insertChecklist() {
        if (!dropBlock) return;
        const list = document.createElement('ul');
        list.className = 'checklist';
        const item = document.createElement('li');
        const input = document.createElement('input');
        input.type = 'checkbox';
        const text = document.createElement('span');
        text.textContent = strings.checklistTask || 'Task';
        item.append(input, text);
        list.appendChild(item);

        if (!dropBlock(list)) return;
        const next = list.nextElementSibling;
        if (!next || !/^(P|DIV|TABLE|HR|UL|OL|BLOCKQUOTE|PRE|DETAILS|H[1-6])$/.test(next.tagName)) {
            const spacer = document.createElement('p');
            spacer.appendChild(document.createElement('br'));
            list.after(spacer);
        }

        const selection = window.getSelection();
        const caret = document.createRange();
        caret.setStart(text, 0);
        caret.collapse(true);
        selection.removeAllRanges();
        selection.addRange(caret);

        edited();
        track('checklist_inserted');
        if (strings.checklistInserted) toast(strings.checklistInserted, 'success');
    }

    // Checkbox changes sync the item class (the storage truth) and autosave.
    editor.addEventListener('change', (event) => {
        const input = event.target;
        if (input?.tagName !== 'INPUT' || input.type !== 'checkbox') return;
        const item = input.closest('ul.checklist > li, ol.checklist > li');
        if (!item || !editor.contains(item)) return;
        item.classList.toggle('task-checked', input.checked);
        if (input.checked) input.setAttribute('checked', '');
        else input.removeAttribute('checked');
        edited();
        track('task_toggled');
    }, true);

    // Enter/undo/paste can clone or drop checkboxes; tidy up shortly after.
    editor.addEventListener('input', () => {
        window.clearTimeout(normaliseTimer);
        normaliseTimer = window.setTimeout(() => normalise(editor), 300);
    });

    function itemFrom(node) {
        const element = node.nodeType === 1 ? node : node.parentElement;
        const item = element?.closest('ul.checklist > li, ol.checklist > li');
        return item && editor.contains(item) ? item : null;
    }

    function itemText(item) {
        const clone = item.cloneNode(true);
        for (const input of clone.querySelectorAll('input')) input.remove();
        return clone.textContent || '';
    }

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

    // Enter opens the next item (fresh unchecked box, caret right after it);
    // Enter on an empty item leaves the list. Backspace on an empty item
    // removes it (the last one removes the list); at an item start it merges
    // into the previous item instead of mangling the list structure.
    editor.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== 'Backspace') return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const selection = window.getSelection();
        if (!selection?.rangeCount || !selection.isCollapsed) return;
        const start = selection.getRangeAt(0).startContainer;
        const item = itemFrom(start);
        if (!item || !item.contains(start)) return;
        const list = item.parentElement;

        if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            if (!itemText(item).trim()) {
                // Empty item: leave the list with a paragraph.
                const paragraph = document.createElement('p');
                paragraph.appendChild(document.createElement('br'));
                if (list.children.length === 1) list.replaceWith(paragraph);
                else {
                    item.remove();
                    list.after(paragraph);
                }
                caretInto(paragraph, 0);
                edited();
                return;
            }
            const next = document.createElement('li');
            const input = document.createElement('input');
            input.type = 'checkbox';
            next.appendChild(input);
            item.after(next);
            caretInto(next, 1); // right after the fresh box
            edited();
            return;
        }

        // Backspace
        if (!itemText(item).trim()) {
            event.preventDefault();
            event.stopPropagation();
            const previous = item.previousElementSibling;
            item.remove();
            if (previous) caretToEnd(previous);
            else if (!list.children.length) {
                const paragraph = document.createElement('p');
                paragraph.appendChild(document.createElement('br'));
                list.replaceWith(paragraph);
                caretInto(paragraph, 0);
            } else {
                caretToEnd(list.lastElementChild);
            }
            edited();
            return;
        }

        if (caretAtEdge(selection, item, false)) {
            const previous = item.previousElementSibling;
            if (!previous) {
                // First item: keep the list intact instead of merging out.
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            for (const child of [...item.childNodes]) {
                if (child.tagName === 'INPUT') continue;
                previous.appendChild(child);
            }
            item.remove();
            caretToEnd(previous);
            edited();
        }
    }, true);

    /* ------------------------------------------------------------------
       Task overview across notes
       ------------------------------------------------------------------ */

    function scanTasks() {
        const tasks = [];
        for (const note of (typeof getNotes === 'function' ? getNotes() : [])) {
            const holder = document.createElement('template');
            holder.innerHTML = note.html || '';
            const items = holder.content.querySelectorAll('ul.checklist > li, ol.checklist > li');
            items.forEach((item, index) => {
                const checked = item.classList.contains('task-checked')
                    || !!item.querySelector('input:checked');
                const text = (item.textContent || '').trim();
                if (!text) return;
                tasks.push({ noteId: note.id, noteTitle: note.title, index, checked, text });
            });
        }
        return tasks;
    }

    function taskRowHtml(task) {
        const escapeAttr = (value) => escapeHtml(value).replace(/"/g, '&quot;');
        return `
            <div class="task-overview__row">
                <label class="task-overview__task">
                    <input type="checkbox" data-task-toggle
                           data-note-id="${escapeAttr(task.noteId)}" data-task-index="${task.index}"
                           ${task.checked ? 'checked' : ''}>
                    <span dir="auto">${escapeHtml(task.text)}</span>
                </label>
                <button type="button" class="task-overview__note" data-task-jump
                        data-note-id="${escapeAttr(task.noteId)}" data-task-index="${task.index}"
                        dir="auto"
                        title="${escapeAttr(strings.tasksJump || 'Show in note')}">
                    ${escapeHtml(task.noteTitle || strings.noteUntitled || 'Untitled')}
                </button>
            </div>`;
    }

    function renderSections(view, tasks) {
        const sections = view.querySelector('[data-task-sections]');
        const empty = view.querySelector('[data-task-empty]');
        const open = tasks.filter((task) => !task.checked);
        const done = tasks.filter((task) => task.checked);
        const build = (title, count, rows) => `
            <section class="task-overview__section">
                <h3 class="task-overview__heading">${escapeHtml(title)}
                    <span class="task-overview__count">${count}</span></h3>
                ${rows}
            </section>`;
        sections.innerHTML = `
            ${build(strings.tasksOpen || 'Open tasks', open.length, open.map(taskRowHtml).join(''))}
            ${build(strings.tasksDone || 'Completed', done.length, done.map(taskRowHtml).join(''))}`;
        if (empty) empty.hidden = tasks.length > 0;
    }

    async function openTasks() {
        track('tasks_opened');
        await showDialog({
            title: strings.tasksTitle || 'Tasks',
            bodyHtml: `<div class="task-overview" data-task-overview>
                    <div data-task-sections></div>
                    <p class="task-overview__empty" data-task-empty hidden>${escapeHtml(strings.tasksEmpty || 'No tasks yet.')}</p>
                </div>`,
            buttons: [
                { label: strings.close || 'Close', action: 'close', variant: 'btn--primary' },
            ],
            onOpen(view) {
                renderSections(view, scanTasks());
                view.addEventListener('change', async (event) => {
                    const input = event.target.closest('[data-task-toggle]');
                    if (!input) return;
                    if (typeof updateNoteTask === 'function') {
                        await updateNoteTask(input.dataset.noteId, Number(input.dataset.taskIndex), input.checked);
                    }
                    track('task_toggled');
                    renderSections(view, scanTasks());
                });
                view.addEventListener('click', (event) => {
                    const jump = event.target.closest('[data-task-jump]');
                    if (jump && typeof jumpToTask === 'function') {
                        jumpToTask(jump.dataset.noteId, Number(jump.dataset.taskIndex));
                    }
                });
            },
        });
    }

    return { insertChecklist, normalise, openTasks, scanTasks };
}
