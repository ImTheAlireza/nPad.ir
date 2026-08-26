/**
 * NPad editor.
 *
 * Fixes carried over from the audit:
 *  - word count updates on every input (was trapped inside the 3s debounce)
 *  - pagehide/visibilitychange flush, so closing the tab cannot lose work
 *  - toolbar pressed-state tracks the real selection via selectionchange
 *  - print uses the page's own stylesheet instead of an unstyled popup
 *  - restored and pasted HTML is sanitised
 *  - open dialog enforces a size limit and handles read errors
 */

import {
    listNotes,
    createNoteRecord,
    saveNote,
    saveNoteSync,
    deleteNote,
    getActiveNoteId,
    setActiveNoteId,
    getOpenNoteIds,
    setOpenNoteIds,
    listBackups,
    saveBackup,
    deleteBackup,
    clearBackups,
    loadOrganization,
    saveOrganization,
    createFolderRecord,
    createTagRecord,
    saveImageAsset,
    loadImageAsset,
    listAllImageAssets,
    deleteImageAssets,
} from './storage.js';
import {
    MAX_IMAGE_BYTES,
    blockFromImportedImage,
    createImageBlockElement,
    collectImageAssetIds,
    createImageRenderAsset,
    dataUriToImageBlob,
    embedImageBlocksAsDataUris,
    inspectImageFile,
    newImageAssetId,
    readImageBlock,
    remapImageAssetIds,
    renderImageBlock,
    resolveImageBlockAssets,
    revokeImageObjectUrls,
    stripImageBlockRuntimeState,
} from './image-blocks.js';
import { normaliseImageBlock, rotateImageCrop } from './image-schema.js';
import { sanitizeHtml, textToHtml } from './sanitize.js';
import {
    MAX_ROWS as TABLE_MAX_ROWS,
    MAX_COLS as TABLE_MAX_COLS,
    createTableHtml,
    normaliseTables,
    closestTableCell,
    closestTable,
    cellPosition,
    cellAt,
    insertRow,
    insertColumn,
    deleteRow,
    deleteColumn,
    deleteTable,
    mergeCells,
    splitCell,
    setHeaderRow,
    setHeaderColumn,
    isHeaderRowActive,
    isHeaderColumnActive,
    setCellShading,
    alignCells,
    verticalAlignCells,
    setCellDirection,
    clearCells,
    isMergedCell,
    sortTableByColumn,
    setTableWidth,
    toggleBorders,
    tableBordersOn,
    setCaption,
    moveRow,
    tableGrid,
    stepCell,
    placeCaretInCell,
    selectionRectCells,
} from './table.js';
import {
    htmlToMarkdown,
    markdownToHtml,
    noteToJson,
    parseNoteJson,
    htmlToRtf,
    rtfToHtml,
    htmlToDocx,
    docxToHtml,
    pdfToHtml,
} from './formats.js';
import { showDialog, confirmDialog, toast, escapeHtml } from './ui.js';
import { initSpellcheck } from './spellcheck.js';

const AUTOSAVE_DELAY = 800;      // was 3000ms with no flush on unload
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const WORDS_PER_MINUTE = 200;

/** Commands whose active state we reflect in the toolbar. */
const STATE_COMMANDS = {
    bold: 'bold',
    italic: 'italic',
    underline: 'underline',
    strikeThrough: 'strikeThrough',
    subscript: 'subscript',
    superscript: 'superscript',
    insertUnorderedList: 'insertUnorderedList',
    insertOrderedList: 'insertOrderedList',
    justifyLeft: 'justifyLeft',
    justifyCenter: 'justifyCenter',
    justifyRight: 'justifyRight',
    justifyFull: 'justifyFull',
};

export function initEditor({ strings, onEvent }) {
    const editor = document.getElementById('editor');
    const toolbar = document.getElementById('toolbar');
    if (!editor) return;

    const track = typeof onEvent === 'function' ? onEvent : () => {};

    const countsEl = document.getElementById('statusCounts');
    const stateEl = document.getElementById('saveState');
    const statusbar = document.getElementById('statusbar');

    /* Multi-note workspace. */
    const workspace = document.getElementById('notesWorkspace');
    const notesSidebar = document.getElementById('notesSidebar');
    const notesList = document.getElementById('notesList');
    const notesSearch = document.getElementById('notesSearch');
    const notesEmpty = document.getElementById('notesEmpty');
    const noteTitleInput = document.getElementById('noteTitle');
    const documentTabs = document.getElementById('documentTabs');
    const documentTabTemplate = document.getElementById('documentTabTemplate');
    const noteFolderTrigger = document.getElementById('noteFolder');
    const noteFolderPicker = document.getElementById('documentFolderPicker');
    const noteFolderMenu = document.getElementById('noteFolderMenu');
    const noteFolderOptions = document.getElementById('noteFolderOptions');
    const noteFolderValue = document.getElementById('noteFolderValue');
    const currentTagsEl = document.getElementById('currentNoteTags');
    const foldersList = document.getElementById('foldersList');
    const tagsList = document.getElementById('tagsList');
    const folderItemTemplate = document.getElementById('folderItemTemplate');
    const tagFilterTemplate = document.getElementById('tagFilterTemplate');
    const notesBackdrop = document.querySelector('[data-notes-backdrop]');
    const backupDialog = document.getElementById('backupDialog');
    const backupList = document.getElementById('backupList');
    const backupEmpty = document.getElementById('backupEmpty');
    const backupCount = document.getElementById('backupCount');

    /* Find & replace bar (guarded: the markup ships with the editor page). */
    const findBar = document.getElementById('findBar');
    const findInput = findBar && findBar.querySelector('[data-find-input]');
    const replaceInput = findBar && findBar.querySelector('[data-find-replace]');
    const findCount = findBar && findBar.querySelector('#findCount');
    const findReplaceRow = document.getElementById('findReplaceRow');
    const findOptionButtons = findBar
        ? new Map([...findBar.querySelectorAll('[data-find-option]')]
            .map((button) => [button.dataset.findOption, button]))
        : new Map();

    /* View toggles. */
    const focusBtn = document.querySelector('[data-action="toggle-focus"]');
    const dirBtn = document.querySelector('[data-action="dir-rtl"]');
    const spellBtn = document.querySelector('[data-action="toggle-spellcheck"]');

    let saveTimer = null;
    let dirty = false;
    let lastSavedAt = 0;
    let notes = [];
    let organization = { folders: [], tags: [], updatedAt: 0 };
    let activeNoteId = null;
    let openNoteIds = [];
    let recoveryBackups = [];
    let sidebarOpen = false;
    let noteFilter = { type: 'all', id: null };

    /* Custom spell checker (self-contained module). */
    const spell = initSpellcheck({ editor, strings, onEvent: track });

    /* The toolbar swaps to table tools when the caret is inside a table cell. */
    const toolbarPaneBase = document.getElementById('toolbarPaneBase');
    const toolbarPaneTable = document.getElementById('toolbarPaneTable');
    const tableContextMenu = document.getElementById('tableContextMenu');
    const imageBlockToolbar = document.getElementById('imageBlockToolbar');
    const TOOLBAR_LABEL_BASE = toolbar?.getAttribute('aria-label') || '';
    let toolbarContext = 'base';

    /* Image-block state remains separate from text/table toolbar context. */
    let selectedImageBlock = null;
    let imageObjectUrls = [];
    let imageResolveSequence = 0;
    let imageResizeState = null;
    const resolvedImageAssets = new Map();

    /**
     * Editor HTML without transient spell-check marks, for storage and
     * exports. Marks are re-applied automatically after restore.
     */
    function cleanHtml() {
        const clone = editor.cloneNode(true);
        clone.querySelectorAll('.spell-err').forEach((el) => {
            el.replaceWith(document.createTextNode(el.textContent));
        });
        clone.querySelectorAll('.npad-find-match').forEach((el) => {
            el.replaceWith(...el.childNodes);
        });
        // The caret highlight is a runtime-only affordance: it never persists.
        clone.querySelectorAll('.npad-cell-active').forEach((el) => el.classList.remove('npad-cell-active'));
        stripImageBlockRuntimeState(clone);
        return sanitizeHtml(clone.innerHTML);
    }

    /* ---------------------------------------------------------------------
       Counting
       --------------------------------------------------------------------- */

    const countWords = (text) => {
        const trimmed = text.trim();
        return trimmed ? trimmed.split(/\s+/).length : 0;
    };

    /**
     * Plain-text view of the document.
     *
     * Deliberately not innerText: that property is defined in terms of
     * rendered layout, so reading it on every keystroke forces a reflow, and
     * it returns undefined in non-rendering contexts. Walking the tree is
     * cheaper, deterministic, and testable.
     */
    function editorText() {
        const BLOCKS = new Set([
            'P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
            'BLOCKQUOTE', 'PRE', 'TR', 'UL', 'OL', 'TABLE', 'TD', 'TH', 'CAPTION',
            'FIGURE', 'FIGCAPTION',
        ]);

        let out = '';

        (function walk(node) {
            for (const child of node.childNodes) {
                if (child.nodeType === Node.TEXT_NODE) {
                    out += child.nodeValue;
                } else if (child.nodeType === Node.ELEMENT_NODE) {
                    if (child.tagName === 'BR') {
                        out += '\n';
                        continue;
                    }
                    const isBlock = BLOCKS.has(child.tagName);
                    if (isBlock && out && !out.endsWith('\n')) out += '\n';
                    walk(child);
                    if (isBlock && out && !out.endsWith('\n')) out += '\n';
                }
            }
        })(editor);

        return out;
    }

    function updateCounts() {
        const text = editorText();
        const words = countWords(text);
        const chars = text.replace(/\n+$/, '').length;

        let out = `${strings.words}: ${words.toLocaleString()} · ${strings.characters}: ${chars.toLocaleString()}`;

        // The old status bar advertised a selection count that was never
        // implemented; this reports it for real.
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed && editor.contains(selection.anchorNode)) {
            const selected = selection.toString();
            if (selected.trim()) {
                out += ` · ${strings.selected}: ${countWords(selected).toLocaleString()}`;
            }
        }

        countsEl.textContent = out;
    }

    /* ---------------------------------------------------------------------
       Saving
       --------------------------------------------------------------------- */

    function setSaveState(state) {
        if (!statusbar) return;
        statusbar.dataset.saveState = state;
        stateEl.textContent = strings[state] ?? '';
    }

    function activeNote() {
        return notes.find((note) => note.id === activeNoteId) || null;
    }

    function displayTitle(note) {
        return String(note?.title || '').trim() || strings.noteUntitled || 'Untitled note';
    }

    function rememberOpenTab(id) {
        if (!id || openNoteIds.includes(id)) return;
        openNoteIds.push(id);
        setOpenNoteIds(openNoteIds);
    }

    function renderTabs() {
        if (!documentTabs || !documentTabTemplate) return;
        openNoteIds = openNoteIds.filter((id) => notes.some((note) => note.id === id));
        const fragment = document.createDocumentFragment();

        for (const id of openNoteIds) {
            const note = notes.find((item) => item.id === id);
            if (!note) continue;
            const tab = documentTabTemplate.content.firstElementChild.cloneNode(true);
            const title = displayTitle(note);
            const active = id === activeNoteId;
            const unsaved = active && dirty;
            tab.dataset.noteId = id;
            tab.classList.toggle('document-tab--active', active);
            tab.classList.toggle('document-tab--dirty', unsaved);

            const main = tab.querySelector('[data-tab-action="open"]');
            main.dataset.noteId = id;
            main.setAttribute('aria-selected', String(active));
            main.setAttribute('aria-controls', 'editor');
            main.tabIndex = active ? 0 : -1;
            main.title = unsaved ? `${title} — ${strings.noteUnsavedTab}` : title;
            main.setAttribute('aria-label', unsaved ? `${title}, ${strings.noteUnsavedTab}` : title);
            tab.querySelector('.document-tab__title').textContent = title;

            const close = tab.querySelector('[data-tab-action="close"]');
            close.dataset.noteId = id;
            close.hidden = openNoteIds.length < 2;
            const closeLabel = `${strings.noteCloseTab}: ${title}`;
            close.setAttribute('aria-label', closeLabel);
            close.title = closeLabel;
            fragment.appendChild(tab);
        }

        documentTabs.replaceChildren(fragment);
        const activeTab = documentTabs.querySelector('[role="tab"][aria-selected="true"]');
        if (activeTab && typeof activeTab.scrollIntoView === 'function') {
            activeTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
    }

    function snapshotActiveNote() {
        const current = activeNote();
        if (!current) return null;
        const now = Date.now();
        const snapshot = {
            ...current,
            title: noteTitleInput ? noteTitleInput.value.trim() : current.title,
            html: cleanHtml(),
            updatedAt: now,
        };
        notes = notes.map((note) => note.id === snapshot.id ? snapshot : note);
        return snapshot;
    }

    async function persist() {
        window.clearTimeout(saveTimer);
        const current = activeNote();
        const previous = current ? { ...current, tags: [...current.tags] } : null;
        const snapshot = snapshotActiveNote();
        if (!snapshot) return false;
        const savingId = snapshot.id;
        if (activeNoteId === savingId) setSaveState('saving');
        renderNotes();
        renderTabs();

        const previousHasContent = previous
            && (previous.html.trim()
                || (previous.title.trim() && previous.title.trim() !== strings.noteUntitled));
        const snapshotHasContent = snapshot.html.trim()
            || (snapshot.title.trim() && snapshot.title.trim() !== strings.noteUntitled);
        if (previousHasContent || snapshotHasContent) {
            await saveBackup(previousHasContent ? previous : snapshot);
        }
        const ok = await saveNote(snapshot);
        if (ok) void gcImageAssets();
        if (activeNoteId === savingId) {
            const changedWhileSaving = (noteTitleInput?.value.trim() || '') !== snapshot.title
                || cleanHtml() !== snapshot.html;
            dirty = !ok || changedWhileSaving;
            lastSavedAt = ok ? snapshot.updatedAt : lastSavedAt;
            setSaveState(ok && !changedWhileSaving ? 'saved' : 'unsaved');
            renderTabs();
        }
        return ok;
    }

    function scheduleSave() {
        if (!activeNoteId) return;
        const wasDirty = dirty;
        dirty = true;
        setSaveState('unsaved');
        if (!wasDirty) renderTabs();
        window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(persist, AUTOSAVE_DELAY);
    }

    // Flush synchronously when the page goes away. pagehide covers the
    // bfcache and mobile Safari, where beforeunload is unreliable.
    function flush() {
        if (!dirty) return;
        window.clearTimeout(saveTimer);
        const snapshot = snapshotActiveNote();
        if (!snapshot) return;
        saveNoteSync(snapshot);
        void saveNote(snapshot);
        dirty = false;
    }

    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
    });

    /* ---------------------------------------------------------------------
       Multiple notes
       --------------------------------------------------------------------- */

    const noteItemTemplate = document.getElementById('noteItemTemplate');

    function notePreview(note) {
        // A template parses markup in an inert fragment, so even a migrated
        // legacy note cannot load resources while its plain-text preview is built.
        const template = document.createElement('template');
        template.innerHTML = note.html || '';
        return (template.content.textContent || '').replace(/\s+/g, ' ').trim()
            || strings.noteEmptyPreview || 'Empty note';
    }

    function noteTime(note) {
        const date = new Date(note.updatedAt || Date.now());
        const now = new Date();
        const sameDay = date.toDateString() === now.toDateString();
        return sameDay
            ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }

    function sortedNotes() {
        return [...notes].sort((a, b) =>
            Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
    }

    function folderById(id) {
        return organization.folders.find((folder) => folder.id === id) || null;
    }

    function tagById(id) {
        return organization.tags.find((tag) => tag.id === id) || null;
    }

    function makeTagChip(tag, { removable = false } = {}) {
        const chip = document.createElement(removable ? 'button' : 'span');
        if (removable) chip.type = 'button';
        chip.className = 'tag-chip';
        chip.style.setProperty('--tag-color', tag.color);
        chip.textContent = tag.name;
        if (removable) {
            chip.dataset.removeTag = tag.id;
            chip.title = strings.removeTag;
            chip.setAttribute('aria-label', `${strings.removeTag}: ${tag.name}`);
        }
        return chip;
    }

    function matchesNoteFilter(note) {
        if (noteFilter.type === 'pinned') return note.pinned;
        if (noteFilter.type === 'unfiled') return !note.folderId;
        if (noteFilter.type === 'folder') return note.folderId === noteFilter.id;
        if (noteFilter.type === 'tag') return note.tags.includes(noteFilter.id);
        return true;
    }

    function renderNotes() {
        if (!notesList || !noteItemTemplate) return;
        const query = (notesSearch?.value || '').trim().toLocaleLowerCase();
        const visible = sortedNotes().filter((note) => {
            if (!matchesNoteFilter(note)) return false;
            if (!query) return true;
            const folderName = folderById(note.folderId)?.name || '';
            const tagNames = note.tags.map((id) => tagById(id)?.name || '').join(' ');
            return `${displayTitle(note)} ${notePreview(note)} ${folderName} ${tagNames}`
                .toLocaleLowerCase().includes(query);
        });

        const fragment = document.createDocumentFragment();
        for (const note of visible) {
            const item = noteItemTemplate.content.firstElementChild.cloneNode(true);
            item.dataset.noteId = note.id;
            item.classList.toggle('note-item--active', note.id === activeNoteId);
            item.classList.toggle('note-item--pinned', note.pinned);

            const open = item.querySelector('[data-note-action="open"]');
            open.dataset.noteId = note.id;
            open.setAttribute('aria-current', note.id === activeNoteId ? 'true' : 'false');
            item.querySelector('.note-item__title').textContent = displayTitle(note);
            item.querySelector('.note-item__preview').textContent = notePreview(note);
            item.querySelector('.note-item__time').textContent = noteTime(note);
            const metadata = item.querySelector('.note-item__metadata');
            const folder = folderById(note.folderId);
            if (folder) {
                const folderLabel = document.createElement('span');
                folderLabel.className = 'note-item__folder';
                folderLabel.textContent = folder.name;
                metadata.appendChild(folderLabel);
            }
            for (const tagId of note.tags.slice(0, 3)) {
                const tag = tagById(tagId);
                if (tag) metadata.appendChild(makeTagChip(tag));
            }

            item.querySelectorAll('[data-note-action]').forEach((button) => {
                button.dataset.noteId = note.id;
            });
            const pin = item.querySelector('[data-note-action="pin"]');
            pin.setAttribute('aria-pressed', String(note.pinned));
            pin.setAttribute('aria-label', note.pinned ? strings.noteUnpin : strings.notePin);
            pin.title = note.pinned ? strings.noteUnpin : strings.notePin;
            fragment.appendChild(item);
        }

        notesList.replaceChildren(fragment);
        if (notesEmpty) notesEmpty.hidden = visible.length !== 0;
    }

    function syncFilterButtons() {
        document.querySelectorAll('[data-filter-type]').forEach((button) => {
            const active = button.dataset.filterType === noteFilter.type
                && (button.dataset.filterId || null) === noteFilter.id;
            button.setAttribute('aria-pressed', String(active));
            button.classList.toggle('organization-filter--active', active);
        });
    }

    function renderOrganization() {
        const allCount = document.querySelector('[data-filter-count="all"]');
        const pinnedCount = document.querySelector('[data-filter-count="pinned"]');
        const unfiledCount = document.querySelector('[data-filter-count="unfiled"]');
        if (allCount) allCount.textContent = String(notes.length);
        if (pinnedCount) pinnedCount.textContent = String(notes.filter((note) => note.pinned).length);
        if (unfiledCount) unfiledCount.textContent = String(notes.filter((note) => !note.folderId).length);

        if (foldersList && folderItemTemplate) {
            const fragment = document.createDocumentFragment();
            const folders = [...organization.folders]
                .sort((a, b) => a.name.localeCompare(b.name, document.documentElement.lang));
            for (const folder of folders) {
                const item = folderItemTemplate.content.firstElementChild.cloneNode(true);
                item.dataset.organizationId = folder.id;
                const filter = item.querySelector('[data-filter-type="folder"]');
                filter.dataset.filterId = folder.id;
                filter.querySelector('.organization-filter__name').textContent = folder.name;
                filter.querySelector('.organization-filter__count').textContent = String(
                    notes.filter((note) => note.folderId === folder.id).length,
                );
                item.querySelectorAll('[data-organization-action]').forEach((button) => {
                    button.dataset.organizationId = folder.id;
                });
                fragment.appendChild(item);
            }
            foldersList.replaceChildren(fragment);
        }

        if (tagsList && tagFilterTemplate) {
            const fragment = document.createDocumentFragment();
            const tags = [...organization.tags]
                .sort((a, b) => a.name.localeCompare(b.name, document.documentElement.lang));
            for (const tag of tags) {
                const item = tagFilterTemplate.content.firstElementChild.cloneNode(true);
                item.dataset.organizationId = tag.id;
                const filter = item.querySelector('[data-filter-type="tag"]');
                filter.dataset.filterId = tag.id;
                filter.style.setProperty('--tag-color', tag.color);
                filter.querySelector('.organization-filter__name').textContent = tag.name;
                filter.querySelector('.organization-filter__count').textContent = String(
                    notes.filter((note) => note.tags.includes(tag.id)).length,
                );
                item.querySelectorAll('[data-organization-action]').forEach((button) => {
                    button.dataset.organizationId = tag.id;
                });
                fragment.appendChild(item);
            }
            tagsList.replaceChildren(fragment);
        }

        if (noteFolderTrigger && noteFolderOptions && noteFolderValue) {
            const selected = activeNote()?.folderId || '';
            const selectedFolder = folderById(selected);
            const selectedName = selectedFolder?.name || strings.noFolder;
            const folders = [...organization.folders]
                .sort((a, b) => a.name.localeCompare(b.name, document.documentElement.lang));
            const choices = [{ id: '', name: strings.noFolder }, ...folders];
            const fragment = document.createDocumentFragment();

            for (const choice of choices) {
                const option = document.createElement('button');
                option.type = 'button';
                option.className = 'document-folder__option';
                option.dataset.folderId = choice.id;
                option.setAttribute('role', 'option');
                option.setAttribute('aria-selected', String(choice.id === selected));
                option.tabIndex = -1;

                const icon = document.createElement('span');
                icon.className = 'document-folder__option-icon';
                icon.setAttribute('aria-hidden', 'true');
                icon.classList.toggle('document-folder__option-icon--empty', !choice.id);
                const label = document.createElement('span');
                label.className = 'document-folder__option-label';
                label.textContent = choice.name;
                const check = document.createElement('span');
                check.className = 'document-folder__option-check';
                check.setAttribute('aria-hidden', 'true');
                check.textContent = '✓';
                option.append(icon, label, check);
                fragment.appendChild(option);
            }

            noteFolderOptions.replaceChildren(fragment);
            noteFolderValue.textContent = selectedName;
            noteFolderTrigger.dataset.folderId = selected;
            noteFolderTrigger.classList.toggle('document-folder__trigger--empty', !selected);
            noteFolderTrigger.setAttribute('aria-label', `${strings.folderLabel}: ${selectedName}`);
        }

        if (currentTagsEl) {
            const fragment = document.createDocumentFragment();
            for (const tagId of activeNote()?.tags || []) {
                const tag = tagById(tagId);
                if (tag) fragment.appendChild(makeTagChip(tag, { removable: true }));
            }
            currentTagsEl.replaceChildren(fragment);
        }

        syncFilterButtons();
    }

    function folderOptionButtons() {
        return noteFolderOptions
            ? [...noteFolderOptions.querySelectorAll('[role="option"]')]
            : [];
    }

    function openFolderMenu({ focus = 'selected' } = {}) {
        if (!noteFolderMenu || !noteFolderTrigger) return;
        noteFolderMenu.hidden = false;
        noteFolderTrigger.setAttribute('aria-expanded', 'true');
        const options = folderOptionButtons();
        const selected = options.find((option) => option.getAttribute('aria-selected') === 'true');
        const target = focus === 'last' ? options.at(-1) : (selected || options[0]);
        target?.focus();
    }

    function closeFolderMenu({ returnFocus = false } = {}) {
        if (!noteFolderMenu || !noteFolderTrigger || noteFolderMenu.hidden) return;
        noteFolderMenu.hidden = true;
        noteFolderTrigger.setAttribute('aria-expanded', 'false');
        if (returnFocus) noteFolderTrigger.focus();
    }

    function chooseFolder(id) {
        const note = activeNote();
        if (!note) return;
        const folderId = id && folderById(id) ? id : null;
        closeFolderMenu();
        if (note.folderId === folderId) return;
        note.folderId = folderId;
        note.updatedAt = Date.now();
        renderOrganization();
        renderNotes();
        scheduleSave();
    }

    function setNoteFilter(type, id = null) {
        noteFilter = { type, id };
        syncFilterButtons();
        renderNotes();
    }

    function setSidebarOpen(open, { remember = true } = {}) {
        sidebarOpen = !!open;
        if (workspace) workspace.dataset.notesOpen = String(sidebarOpen);
        if (notesSidebar) {
            notesSidebar.toggleAttribute('inert', !sidebarOpen);
            notesSidebar.setAttribute('aria-hidden', String(!sidebarOpen));
        }
        document.querySelectorAll('[data-action="toggle-notes"]').forEach((button) => {
            button.setAttribute('aria-expanded', String(sidebarOpen));
            const label = sidebarOpen ? strings.noteHide : strings.noteShow;
            if (label) {
                button.setAttribute('aria-label', label);
                button.title = label;
            }
        });
        if (notesBackdrop) notesBackdrop.hidden = !sidebarOpen;
        if (remember) {
            try { localStorage.setItem('npad.notesSidebar', sidebarOpen ? '1' : '0'); } catch { /* ignore */ }
        }
    }

    function closeSidebarOnMobile() {
        if (window.matchMedia?.('(max-width: 840px)').matches) setSidebarOpen(false);
    }

    function showNote(note, { focusEditor = false } = {}) {
        closeFolderMenu();
        rememberOpenTab(note.id);
        activeNoteId = note.id;
        setActiveNoteId(note.id);
        editor.innerHTML = sanitizeHtml(note.html || '');
        normaliseTables(editor);
        // The new note's caret is empty: reset contextual controls.
        markActiveCell(null);
        clearImageBlockSelection();
        setToolbarContext('base');
        void resolveEditorImageBlocks();
        if (noteTitleInput) noteTitleInput.value = displayTitle(note);
        lastSavedAt = note.updatedAt || 0;
        dirty = false;
        lastEditorRange = null;
        pendingFontSize = null;
        setSaveState('saved');
        updateCounts();
        renderOrganization();
        renderNotes();
        renderTabs();
        spell.refresh();
        if (focusEditor) editor.focus();
    }

    async function switchNote(id, { focusEditor = true, closeMobile = true } = {}) {
        if (!id || id === activeNoteId) {
            if (id) rememberOpenTab(id);
            renderTabs();
            if (closeMobile) closeSidebarOnMobile();
            return;
        }
        if (dirty) await persist();
        const note = notes.find((item) => item.id === id);
        if (!note) return;
        showNote(note, { focusEditor });
        if (closeMobile) closeSidebarOnMobile();
    }

    async function activateDocumentTab(id, { focusTab = true } = {}) {
        await switchNote(id, { focusEditor: false, closeMobile: false });
        if (focusTab) {
            [...(documentTabs?.querySelectorAll('[data-tab-action="open"]') || [])]
                .find((tab) => tab.dataset.noteId === id)?.focus();
        }
    }

    async function closeDocumentTab(id) {
        if (!id || !openNoteIds.includes(id) || openNoteIds.length < 2) return;
        const closingIndex = openNoteIds.indexOf(id);
        if (id === activeNoteId && dirty) await persist();
        openNoteIds = openNoteIds.filter((noteId) => noteId !== id);
        setOpenNoteIds(openNoteIds);

        if (id === activeNoteId) {
            const nextId = openNoteIds[Math.min(closingIndex, openNoteIds.length - 1)];
            const next = notes.find((note) => note.id === nextId);
            if (next) showNote(next);
        } else {
            renderTabs();
        }
        documentTabs?.querySelector('[role="tab"][aria-selected="true"]')?.focus();
    }

    async function createNewNote({
        title = strings.noteUntitled,
        html = '',
        focusTitle = true,
        report = true,
        folderId,
        tags,
        pinned = false,
        createdAt = null,
        updatedAt = null,
    } = {}) {
        if (dirty) await persist();
        const initialFolder = folderId !== undefined
            ? folderId
            : (noteFilter.type === 'folder' ? noteFilter.id : null);
        const initialTags = tags !== undefined
            ? tags
            : (noteFilter.type === 'tag' ? [noteFilter.id] : []);
        const note = createNoteRecord({
            title: title || strings.noteUntitled,
            html: sanitizeHtml(html),
            pinned,
            folderId: initialFolder,
            tags: initialTags,
            createdAt,
            updatedAt,
        });
        notes.push(note);
        await saveNote(note);
        showNote(note);
        renderNotes();
        if (focusTitle && noteTitleInput) {
            noteTitleInput.focus();
            noteTitleInput.select();
        } else {
            editor.focus();
        }
        if (report) track('new_file');
        return note;
    }

    async function renameNote(id) {
        if (dirty && id === activeNoteId) await persist();
        const note = notes.find((item) => item.id === id);
        if (!note) return;
        const action = await showDialog({
            title: strings.noteRenameTitle,
            bodyHtml: `
                <label class="field">
                    <span class="field__label">${escapeHtml(strings.noteRenameLabel)}</span>
                    <input class="field__input" id="renameNoteInput" maxlength="120"
                           autocomplete="off" autofocus>
                </label>`,
            buttons: [
                { label: strings.cancel, action: 'cancel', variant: 'btn--ghost' },
                { label: strings.noteRename, action: 'rename', variant: 'btn--primary' },
            ],
            onOpen: (body) => {
                const input = body.querySelector('#renameNoteInput');
                input.value = displayTitle(note);
                input.select();
            },
        });
        if (action !== 'rename') return;
        const value = document.getElementById('renameNoteInput')?.value.trim();
        if (!value) return;
        const updated = { ...note, title: value, updatedAt: Date.now() };
        notes = notes.map((item) => item.id === id ? updated : item);
        if (id === activeNoteId && noteTitleInput) noteTitleInput.value = value;
        await saveBackup(note);
        await saveNote(updated);
        renderNotes();
        renderTabs();
    }

    async function duplicateNote(id) {
        if (dirty && id === activeNoteId) await persist();
        const source = notes.find((item) => item.id === id);
        if (!source) return;
        const copy = createNoteRecord({
            title: `${displayTitle(source)} ${strings.noteCopySuffix}`.trim(),
            html: source.html,
            folderId: source.folderId,
            tags: source.tags,
        });
        copy.html = await copyImageAssetsForNote(copy.html, source.id, copy.id);
        notes.push(copy);
        await saveNote(copy);
        showNote(copy, { focusEditor: true });
        closeSidebarOnMobile();
    }

    async function toggleNotePin(id) {
        if (dirty && id === activeNoteId) await persist();
        const note = notes.find((item) => item.id === id);
        if (!note) return;
        const updated = { ...note, pinned: !note.pinned };
        notes = notes.map((item) => item.id === id ? updated : item);
        await saveNote(updated);
        renderOrganization();
        renderNotes();
    }

    async function removeNote(id) {
        if (dirty && id === activeNoteId) await persist();
        const note = notes.find((item) => item.id === id);
        if (!note) return;
        const confirmed = await confirmDialog({
            title: strings.noteDeleteTitle,
            message: (strings.noteDeleteBody || '').replace('{title}', displayTitle(note)),
            confirmLabel: strings.noteDelete,
            cancelLabel: strings.cancel,
            danger: true,
        });
        if (!confirmed) return;

        const closingIndex = openNoteIds.indexOf(id);
        await saveBackup(note, { reason: 'deleted', force: true });
        await deleteNote(id);
        notes = notes.filter((item) => item.id !== id);
        openNoteIds = openNoteIds.filter((noteId) => noteId !== id);
        setOpenNoteIds(openNoteIds);
        if (id === activeNoteId) {
            const adjacentId = openNoteIds[Math.min(
                Math.max(closingIndex, 0),
                openNoteIds.length - 1,
            )];
            const next = notes.find((item) => item.id === adjacentId) || sortedNotes()[0];
            if (next) showNote(next);
            else await createNewNote({ focusTitle: false });
        } else {
            renderTabs();
        }
        renderOrganization();
        renderNotes();
    }

    const TAG_COLOURS = [
        '#2563eb', '#7c3aed', '#db2777', '#dc2626',
        '#ea580c', '#ca8a04', '#16a34a', '#0d9488',
    ];

    function organizationNameExists(collection, name, exceptId = null) {
        const normalised = name.trim().toLocaleLowerCase();
        return collection.some((item) => item.id !== exceptId
            && item.name.toLocaleLowerCase() === normalised);
    }

    async function promptFolder(folder = null) {
        const action = await showDialog({
            title: folder ? strings.renameFolderTitle : strings.addFolderTitle,
            bodyHtml: `
                <label class="field">
                    <span class="field__label">${escapeHtml(strings.folderName)}</span>
                    <input class="field__input" id="folderNameInput" maxlength="80"
                           autocomplete="off" autofocus>
                </label>`,
            buttons: [
                { label: strings.cancel, action: 'cancel', variant: 'btn--ghost' },
                {
                    label: folder ? strings.noteRename : strings.createFolder,
                    action: 'save-folder',
                    variant: 'btn--primary',
                },
            ],
            onOpen: (body) => {
                if (folder) body.querySelector('#folderNameInput').value = folder.name;
            },
        });
        if (action !== 'save-folder') return;
        const name = document.getElementById('folderNameInput')?.value.trim();
        if (!name) return;
        if (organizationNameExists(organization.folders, name, folder?.id)) {
            toast(strings.organizationDuplicate, 'error');
            return;
        }
        if (folder) {
            organization.folders = organization.folders.map((item) => item.id === folder.id
                ? { ...item, name, updatedAt: Date.now() }
                : item);
        } else {
            organization.folders.push(createFolderRecord(name));
        }
        await saveOrganization(organization);
        renderOrganization();
        renderNotes();
    }

    async function promptTag(tag = null) {
        let selectedColor = tag?.color || TAG_COLOURS[0];
        const swatches = TAG_COLOURS.map((color) => `
            <button type="button" class="tag-colour" data-tag-color="${color}"
                    style="--tag-color:${color}" aria-label="${color}"
                    aria-pressed="${color === selectedColor ? 'true' : 'false'}"></button>`).join('');
        const action = await showDialog({
            title: tag ? strings.editTagTitle : strings.addTagTitle,
            bodyHtml: `
                <label class="field">
                    <span class="field__label">${escapeHtml(strings.tagName)}</span>
                    <input class="field__input" id="tagNameInput" maxlength="40"
                           autocomplete="off" autofocus>
                </label>
                <fieldset class="tag-colours">
                    <legend class="field__label">${escapeHtml(strings.tagColor)}</legend>
                    <div class="tag-colours__list">${swatches}</div>
                </fieldset>`,
            buttons: [
                { label: strings.cancel, action: 'cancel', variant: 'btn--ghost' },
                {
                    label: tag ? strings.saveTag : strings.createTag,
                    action: 'save-tag',
                    variant: 'btn--primary',
                },
            ],
            onOpen: (body) => {
                if (tag) body.querySelector('#tagNameInput').value = tag.name;
                body.querySelector('.tag-colours__list').addEventListener('click', (event) => {
                    const swatch = event.target.closest('[data-tag-color]');
                    if (!swatch) return;
                    selectedColor = swatch.dataset.tagColor;
                    body.querySelectorAll('[data-tag-color]').forEach((item) => {
                        item.setAttribute('aria-pressed', String(item === swatch));
                    });
                });
            },
        });
        if (action !== 'save-tag') return;
        const name = document.getElementById('tagNameInput')?.value.trim();
        if (!name) return;
        if (organizationNameExists(organization.tags, name, tag?.id)) {
            toast(strings.organizationDuplicate, 'error');
            return;
        }
        if (tag) {
            organization.tags = organization.tags.map((item) => item.id === tag.id
                ? { ...item, name, color: selectedColor, updatedAt: Date.now() }
                : item);
        } else {
            organization.tags.push(createTagRecord(name, selectedColor));
        }
        await saveOrganization(organization);
        renderOrganization();
        renderNotes();
    }

    async function deleteFolderRecord(id) {
        const folder = folderById(id);
        if (!folder) return;
        const confirmed = await confirmDialog({
            title: strings.deleteFolderTitle,
            message: (strings.deleteFolderBody || '').replace('{name}', folder.name),
            confirmLabel: strings.noteDelete,
            cancelLabel: strings.cancel,
            danger: true,
        });
        if (!confirmed) return;
        if (dirty) await persist();
        organization.folders = organization.folders.filter((item) => item.id !== id);
        const changed = [];
        notes = notes.map((note) => {
            if (note.folderId !== id) return note;
            const updated = { ...note, folderId: null, updatedAt: Date.now() };
            changed.push(updated);
            return updated;
        });
        await Promise.all([saveOrganization(organization), ...changed.map(saveNote)]);
        if (noteFilter.type === 'folder' && noteFilter.id === id) noteFilter = { type: 'all', id: null };
        renderOrganization();
        renderNotes();
    }

    async function deleteTagRecord(id) {
        const tag = tagById(id);
        if (!tag) return;
        const confirmed = await confirmDialog({
            title: strings.deleteTagTitle,
            message: (strings.deleteTagBody || '').replace('{name}', tag.name),
            confirmLabel: strings.noteDelete,
            cancelLabel: strings.cancel,
            danger: true,
        });
        if (!confirmed) return;
        if (dirty) await persist();
        organization.tags = organization.tags.filter((item) => item.id !== id);
        const changed = [];
        notes = notes.map((note) => {
            if (!note.tags.includes(id)) return note;
            const updated = {
                ...note,
                tags: note.tags.filter((tagId) => tagId !== id),
                updatedAt: Date.now(),
            };
            changed.push(updated);
            return updated;
        });
        await Promise.all([saveOrganization(organization), ...changed.map(saveNote)]);
        if (noteFilter.type === 'tag' && noteFilter.id === id) noteFilter = { type: 'all', id: null };
        renderOrganization();
        renderNotes();
    }

    async function manageCurrentTags() {
        if (dirty) await persist();
        const note = activeNote();
        if (!note) return;
        const selected = new Set(note.tags);
        const hasTags = organization.tags.length > 0;
        const action = await showDialog({
            title: strings.manageTags,
            bodyHtml: `<div class="tag-checklist" id="tagChecklist"></div>`,
            buttons: hasTags
                ? [
                    { label: strings.cancel, action: 'cancel', variant: 'btn--ghost' },
                    { label: strings.apply, action: 'apply-tags', variant: 'btn--primary' },
                ]
                : [{ label: strings.ok, action: 'ok', variant: 'btn--primary' }],
            onOpen: (body) => {
                const list = body.querySelector('#tagChecklist');
                if (!organization.tags.length) {
                    const empty = document.createElement('p');
                    empty.className = 'tag-checklist__empty';
                    empty.textContent = strings.noTags;
                    list.appendChild(empty);
                    return;
                }
                for (const tag of organization.tags) {
                    const label = document.createElement('label');
                    label.className = 'tag-checklist__item';
                    const input = document.createElement('input');
                    input.type = 'checkbox';
                    input.value = tag.id;
                    input.checked = selected.has(tag.id);
                    const chip = makeTagChip(tag);
                    label.append(input, chip);
                    list.appendChild(label);
                }
            },
        });
        if (action !== 'apply-tags') return;
        const tags = [...document.querySelectorAll('#tagChecklist input:checked')]
            .map((input) => input.value);
        const updated = { ...note, tags, updatedAt: Date.now() };
        notes = notes.map((item) => item.id === note.id ? updated : item);
        await saveBackup(note);
        await saveNote(updated);
        renderOrganization();
        renderNotes();
    }

    async function removeCurrentTag(id) {
        if (dirty) await persist();
        const note = activeNote();
        if (!note || !note.tags.includes(id)) return;
        const updated = {
            ...note,
            tags: note.tags.filter((tagId) => tagId !== id),
            updatedAt: Date.now(),
        };
        notes = notes.map((item) => item.id === note.id ? updated : item);
        await saveBackup(note);
        await saveNote(updated);
        renderOrganization();
        renderNotes();
    }

    if (notesSearch) notesSearch.addEventListener('input', renderNotes);
    if (documentTabs) {
        documentTabs.addEventListener('click', (event) => {
            const button = event.target.closest('[data-tab-action]');
            if (!button) return;
            if (button.dataset.tabAction === 'open') {
                void activateDocumentTab(button.dataset.noteId);
            } else if (button.dataset.tabAction === 'close') {
                void closeDocumentTab(button.dataset.noteId);
            }
        });
        documentTabs.addEventListener('auxclick', (event) => {
            if (event.button !== 1) return;
            const tab = event.target.closest('[data-tab-action="open"]');
            if (!tab) return;
            event.preventDefault();
            void closeDocumentTab(tab.dataset.noteId);
        });
        documentTabs.addEventListener('keydown', (event) => {
            const current = event.target.closest('[data-tab-action="open"]');
            if (!current) return;
            const tabs = [...documentTabs.querySelectorAll('[data-tab-action="open"]')];
            const index = tabs.indexOf(current);
            let nextIndex = null;
            const rtl = document.documentElement.dir === 'rtl';
            if (event.key === 'ArrowRight') nextIndex = index + (rtl ? -1 : 1);
            else if (event.key === 'ArrowLeft') nextIndex = index + (rtl ? 1 : -1);
            else if (event.key === 'Home') nextIndex = 0;
            else if (event.key === 'End') nextIndex = tabs.length - 1;
            else if (event.key === 'Delete') {
                event.preventDefault();
                void closeDocumentTab(current.dataset.noteId);
                return;
            }
            if (nextIndex === null || !tabs.length) return;
            event.preventDefault();
            const next = tabs[(nextIndex + tabs.length) % tabs.length];
            void activateDocumentTab(next.dataset.noteId);
        });
    }
    if (notesList) {
        notesList.addEventListener('click', (event) => {
            const button = event.target.closest('[data-note-action]');
            if (!button) return;
            const { noteAction, noteId } = button.dataset;
            if (noteAction === 'open') void switchNote(noteId);
            else if (noteAction === 'pin') void toggleNotePin(noteId);
            else if (noteAction === 'rename') void renameNote(noteId);
            else if (noteAction === 'duplicate') void duplicateNote(noteId);
            else if (noteAction === 'delete') void removeNote(noteId);
        });
    }
    notesSidebar?.addEventListener('click', (event) => {
        const filter = event.target.closest('[data-filter-type]');
        if (filter) {
            setNoteFilter(filter.dataset.filterType, filter.dataset.filterId || null);
            return;
        }
        const action = event.target.closest('[data-organization-action]');
        if (!action) return;
        const id = action.dataset.organizationId;
        if (action.dataset.organizationAction === 'add-folder') void promptFolder();
        else if (action.dataset.organizationAction === 'rename-folder') void promptFolder(folderById(id));
        else if (action.dataset.organizationAction === 'delete-folder') void deleteFolderRecord(id);
        else if (action.dataset.organizationAction === 'add-tag') void promptTag();
        else if (action.dataset.organizationAction === 'edit-tag') void promptTag(tagById(id));
        else if (action.dataset.organizationAction === 'delete-tag') void deleteTagRecord(id);
    });
    noteFolderTrigger?.addEventListener('click', () => {
        if (noteFolderMenu?.hidden) openFolderMenu();
        else closeFolderMenu({ returnFocus: true });
    });
    noteFolderTrigger?.addEventListener('keydown', (event) => {
        if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
        event.preventDefault();
        openFolderMenu({ focus: event.key === 'ArrowUp' ? 'last' : 'selected' });
    });
    noteFolderOptions?.addEventListener('click', (event) => {
        const option = event.target.closest('[role="option"]');
        if (option) chooseFolder(option.dataset.folderId);
    });
    noteFolderOptions?.addEventListener('keydown', (event) => {
        const option = event.target.closest('[role="option"]');
        if (!option) return;
        const options = folderOptionButtons();
        const index = options.indexOf(option);
        let nextIndex = null;
        if (event.key === 'ArrowDown') nextIndex = index + 1;
        else if (event.key === 'ArrowUp') nextIndex = index - 1;
        else if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = options.length - 1;
        else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            chooseFolder(option.dataset.folderId);
            noteFolderTrigger?.focus();
            return;
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeFolderMenu({ returnFocus: true });
            return;
        } else if (event.key === 'Tab') {
            closeFolderMenu();
            return;
        }
        if (nextIndex !== null && options.length) {
            event.preventDefault();
            options[(nextIndex + options.length) % options.length]?.focus();
        }
    });
    document.addEventListener('click', (event) => {
        if (noteFolderPicker && !noteFolderPicker.contains(event.target)) closeFolderMenu();
    });
    currentTagsEl?.addEventListener('click', (event) => {
        const chip = event.target.closest('[data-remove-tag]');
        if (chip) void removeCurrentTag(chip.dataset.removeTag);
    });
    notesBackdrop?.addEventListener('click', () => setSidebarOpen(false));
    noteTitleInput?.addEventListener('input', () => {
        const note = activeNote();
        if (!note) return;
        note.title = noteTitleInput.value;
        note.updatedAt = Date.now();
        renderNotes();
        renderTabs();
        scheduleSave();
    });
    noteTitleInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            editor.focus();
        }
    });

    /* ---------------------------------------------------------------------
       Formatting
       --------------------------------------------------------------------- */

    let lastEditorRange = null;
    let pendingFontSize = null;

    function rememberEditorSelection() {
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount || !editor.contains(selection.anchorNode)) return;
        try {
            lastEditorRange = selection.getRangeAt(0).cloneRange();
        } catch {
            lastEditorRange = null;
        }
    }

    function restoreEditorSelection() {
        if (!lastEditorRange) return false;
        try {
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(lastEditorRange);
            return true;
        } catch {
            lastEditorRange = null;
            return false;
        }
    }

    function finishFormatting() {
        rememberEditorSelection();
        scheduleSave();
        updateCounts();
        syncToolbarState();
    }

    // document.execCommand is deprecated but remains the only broadly
    // supported way to drive contenteditable formatting without shipping a
    // full editing engine. Calls are centralised here for easy replacement.
    function exec(command, value = null) {
        editor.focus();
        restoreEditorSelection();
        try {
            document.execCommand(command, false, value);
        } catch {
            /* command unsupported in this browser */
        }
        finishFormatting();
    }

    function syncToolbarState() {
        if (!toolbar) return;
        toolbar.querySelectorAll('[data-command]').forEach((btn) => {
            const command = btn.dataset.command;
            if (!STATE_COMMANDS[command]) return;
            let active = false;
            try {
                active = document.queryCommandState(command);
            } catch {
                active = false;
            }
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    }

    // Keep a range whenever the caret is in the editor. Opening either custom
    // picker moves focus into its controls, but formatting still targets this
    // saved range after the popup/dialog closes.
    document.addEventListener('selectionchange', () => {
        const selection = document.getSelection();
        if (selection && editor.contains(selection.anchorNode)) {
            rememberEditorSelection();
            syncToolbarState();
            updateCounts();
            updateToolbarContext();
        }
    });

    if (toolbar) {
        toolbar.addEventListener('pointerdown', (event) => {
            if (event.target.closest('button, input')) rememberEditorSelection();
        });

        // Command buttons must not take focus from contenteditable. Picker
        // triggers and the number field do take focus for their own keyboard
        // interaction, relying on the saved range above.
        toolbar.addEventListener('mousedown', (event) => {
            if (event.target.closest('button[data-command]')) event.preventDefault();
        });

        toolbar.addEventListener('click', (event) => {
            const btn = event.target.closest('button[data-command]');
            if (!btn) return;
            event.preventDefault();
            const { command, value } = btn.dataset;
            if (command === 'createLink') promptForLink();
            else exec(command, value ?? null);
        });
    }

    /* ---------------------------------------------------------------------
       Semantic image blocks
       --------------------------------------------------------------------- */

    const imageLabels = () => ({
        descriptionNeeded: strings.imageDescriptionNeeded,
        decorative: strings.imageDecorativeLabel,
        invalid: strings.imageMissing,
    });

    function activeImageAsset(block) {
        const data = readImageBlock(block);
        return data ? resolvedImageAssets.get(data.assetId) || null : null;
    }

    function revokeActiveImageObjectUrls() {
        revokeImageObjectUrls(imageObjectUrls);
        imageObjectUrls = [];
        resolvedImageAssets.clear();
    }

    async function resolveEditorImageBlocks() {
        const sequence = (imageResolveSequence += 1);
        revokeActiveImageObjectUrls();
        const result = await resolveImageBlockAssets(editor, loadImageAsset, imageLabels());
        if (sequence !== imageResolveSequence) {
            revokeImageObjectUrls(result.urls);
            return;
        }
        imageObjectUrls = result.urls;
        result.assets.forEach((asset, id) => resolvedImageAssets.set(id, asset));
        for (const figure of editor.querySelectorAll('figure[data-npad-image-block="1"]')) {
            if (figure.classList.contains('npad-image-block--missing')) {
                figure.dataset.npadImageMissingLabel = strings.imageMissing;
            }
        }
        if (selectedImageBlock?.isConnected) positionImageBlockControls();
    }

    async function previewImageAsset(figure, sourceAsset) {
        const image = figure?.querySelector('img[data-npad-image-asset]');
        const Url = globalThis.URL || globalThis.window?.URL;
        const block = readImageBlock(figure);
        if (!image || !sourceAsset?.blob || !block || !Url?.createObjectURL) return;
        try {
            const asset = await createImageRenderAsset(sourceAsset, block);
            const url = Url.createObjectURL(asset.blob);
            imageObjectUrls.push(url);
            resolvedImageAssets.set(block.assetId, asset);
            image.src = url;
            renderImageBlock(figure, block, { asset, labels: imageLabels() });
        } catch (error) {
            toast(imageErrorMessage(error), 'error');
        }
    }

    function imageErrorMessage(error) {
        const code = String(error?.message || error || '');
        if (code === 'too-large' || code === 'too-many-bytes') return strings.imageTooLarge;
        if (code === 'too-many-pixels') return strings.imageTooManyPixels;
        if (code === 'type-mismatch') return strings.imageTypeMismatch;
        if (code === 'rotation-animated-unsupported') return strings.imageRotationAnimatedUnsupported;
        if (code === 'rotation-unavailable') return strings.imageRotationUnavailable;
        if (code === 'unsupported-file' || code === 'empty-file') return strings.imageUnsupported;
        return strings.imageInvalid;
    }

    async function storeImageFile(file, noteId) {
        let inspected;
        try {
            inspected = await inspectImageFile(file);
        } catch (error) {
            toast(imageErrorMessage(error), 'error');
            return null;
        }
        if (file.size > MAX_IMAGE_BYTES) {
            toast(strings.imageTooLarge, 'error');
            return null;
        }
        const asset = {
            id: newImageAssetId(),
            noteId,
            blob: file,
            type: inspected.type,
            size: inspected.size,
            name: String(file.name || '').slice(0, 240),
            width: inspected.width,
            height: inspected.height,
            createdAt: Date.now(),
        };
        if (!await saveImageAsset(asset)) {
            toast(strings.imageStorageFailed, 'error');
            return null;
        }
        resolvedImageAssets.set(asset.id, asset);
        return asset;
    }

    function ensureImageSpacer(figure) {
        const next = figure.nextElementSibling;
        if (!next || !['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TABLE', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'HR'].includes(next.tagName)) {
            const spacer = document.createElement('p');
            spacer.appendChild(document.createElement('br'));
            figure.after(spacer);
        }
    }

    function ensureImageResizeOverlay() {
        let overlay = document.getElementById('imageResizeOverlay');
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.id = 'imageResizeOverlay';
        overlay.className = 'npad-image-resize-overlay';
        overlay.hidden = true;
        for (const corner of ['nw', 'ne', 'sw', 'se']) {
            const handle = document.createElement('button');
            handle.type = 'button';
            handle.className = 'npad-image-resize-overlay__handle';
            handle.dataset.imageResizeHandle = corner;
            handle.tabIndex = -1;
            handle.setAttribute('aria-hidden', 'true');
            handle.addEventListener('pointerdown', startImageResize);
            overlay.appendChild(handle);
        }
        document.body.appendChild(overlay);
        return overlay;
    }

    function positionImageResizeOverlay() {
        const overlay = document.getElementById('imageResizeOverlay');
        const canvas = selectedImageBlock?.querySelector('[data-npad-image-canvas]');
        if (!overlay || !canvas || !selectedImageBlock?.isConnected) {
            if (overlay) overlay.hidden = true;
            return;
        }
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) {
            overlay.hidden = true;
            return;
        }
        overlay.style.left = `${rect.left}px`;
        overlay.style.top = `${rect.top}px`;
        overlay.style.width = `${rect.width}px`;
        overlay.style.height = `${rect.height}px`;
        overlay.hidden = false;
    }

    function syncImageBlockToolbar() {
        if (!imageBlockToolbar || !selectedImageBlock?.isConnected) return;
        const block = readImageBlock(selectedImageBlock);
        if (!block) return;
        imageBlockToolbar.querySelectorAll('[data-image-action^="layout-"]').forEach((button) => {
            const action = button.dataset.imageAction;
            const layout = action.replace('layout-', '');
            button.setAttribute('aria-pressed', String(block.display.layout === layout));
        });
        const controls = [...imageBlockToolbar.querySelectorAll('button:not([disabled])')];
        const focused = controls.indexOf(document.activeElement);
        controls.forEach((button, index) => { button.tabIndex = index === (focused >= 0 ? focused : 0) ? 0 : -1; });
    }

    function positionImageBlockToolbar() {
        if (!imageBlockToolbar || !selectedImageBlock?.isConnected) return;
        imageBlockToolbar.hidden = false;
        const rect = selectedImageBlock.getBoundingClientRect();
        const toolbarRect = imageBlockToolbar.getBoundingClientRect();
        const margin = 8;
        const preferredTop = rect.top - toolbarRect.height - margin;
        const top = preferredTop >= margin ? preferredTop : Math.min(window.innerHeight - toolbarRect.height - margin, rect.bottom + margin);
        const left = Math.min(
            Math.max(margin, rect.left),
            Math.max(margin, window.innerWidth - toolbarRect.width - margin),
        );
        imageBlockToolbar.style.left = `${left}px`;
        imageBlockToolbar.style.top = `${Math.max(margin, top)}px`;
    }

    function positionImageBlockControls() {
        positionImageBlockToolbar();
        positionImageResizeOverlay();
    }

    function clearImageBlockSelection({ returnFocus = false } = {}) {
        if (selectedImageBlock?.isConnected) {
            selectedImageBlock.removeAttribute('data-npad-image-selected');
            selectedImageBlock.classList.remove('npad-image-block--selected');
            if (returnFocus) selectedImageBlock.focus();
        }
        selectedImageBlock = null;
        imageResizeState = null;
        if (imageBlockToolbar) imageBlockToolbar.hidden = true;
        const overlay = document.getElementById('imageResizeOverlay');
        if (overlay) overlay.hidden = true;
    }

    function selectImageBlock(figure, { focus = false } = {}) {
        if (!figure?.isConnected || !figure.matches('figure[data-npad-image-block="1"]')) return;
        if (selectedImageBlock !== figure) clearImageBlockSelection();
        selectedImageBlock = figure;
        figure.classList.add('npad-image-block--selected');
        figure.setAttribute('data-npad-image-selected', '');
        // An image block has its own contextual toolbar. Do not leave a table
        // pane visible underneath it or replace the main text toolbar.
        markActiveCell(null);
        setToolbarContext('base');
        ensureImageResizeOverlay();
        syncImageBlockToolbar();
        positionImageBlockControls();
        if (focus) figure.focus({ preventScroll: true });
    }

    function updateImageBlock(figure, nextBlock, { save = true } = {}) {
        const canonical = normaliseImageBlock(nextBlock);
        if (!canonical || !figure?.isConnected) return false;
        renderImageBlock(figure, canonical, {
            asset: resolvedImageAssets.get(canonical.assetId) || null,
            labels: imageLabels(),
        });
        if (figure.classList.contains('npad-image-block--missing')) {
            figure.dataset.npadImageMissingLabel = strings.imageMissing;
        }
        syncImageBlockToolbar();
        positionImageBlockControls();
        if (save) {
            scheduleSave();
            updateCounts();
            spell.refresh();
        }
        return true;
    }

    function startImageResize(event) {
        const handle = event.target.closest('[data-image-resize-handle]');
        const figure = selectedImageBlock;
        if (!handle || !figure?.isConnected) return;
        const block = readImageBlock(figure);
        const canvas = figure.querySelector('[data-npad-image-canvas]');
        const rect = canvas?.getBoundingClientRect();
        const editorRect = editor.getBoundingClientRect();
        if (!block || !rect?.width || !editorRect.width) return;
        event.preventDefault();
        event.stopPropagation();
        imageResizeState = {
            figure,
            pointerId: event.pointerId,
            edge: handle.dataset.imageResizeHandle,
            startX: event.clientX,
            startWidth: block.display.widthPercent,
            containerWidth: editorRect.width,
            original: JSON.stringify(block),
        };
        handle.setPointerCapture?.(event.pointerId);
    }

    function moveImageResize(event) {
        const state = imageResizeState;
        if (!state || event.pointerId !== state.pointerId || !state.figure.isConnected) return;
        const current = readImageBlock(state.figure);
        if (!current) return;
        const sign = state.edge.includes('w') ? -1 : 1;
        const delta = ((event.clientX - state.startX) / state.containerWidth) * 100 * sign;
        current.display.widthPercent = Math.min(100, Math.max(10, Math.round((state.startWidth + delta) * 100) / 100));
        updateImageBlock(state.figure, current, { save: false });
    }

    function finishImageResize(event, { cancel = false } = {}) {
        const state = imageResizeState;
        if (!state || (event && event.pointerId !== state.pointerId)) return;
        imageResizeState = null;
        if (!state.figure.isConnected) return;
        if (cancel) {
            try { updateImageBlock(state.figure, JSON.parse(state.original), { save: false }); } catch { /* no-op */ }
            return;
        }
        scheduleSave();
        updateCounts();
        track('image_resized');
    }

    function cropDefaults(crop) {
        return crop || { x: 0, y: 0, width: 100, height: 100 };
    }

    function normaliseCropInput(raw) {
        const x = Math.max(0, Math.min(95, Number(raw.x) || 0));
        const y = Math.max(0, Math.min(95, Number(raw.y) || 0));
        const width = Math.max(5, Math.min(100 - x, Number(raw.width) || 100));
        const height = Math.max(5, Math.min(100 - y, Number(raw.height) || 100));
        return {
            x: Math.round(Math.min(x, 100 - width) * 100) / 100,
            y: Math.round(Math.min(y, 100 - height) * 100) / 100,
            width: Math.round(width * 100) / 100,
            height: Math.round(height * 100) / 100,
        };
    }

    function cropToRatio(crop, ratio) {
        if (!ratio) return { x: 0, y: 0, width: 100, height: 100 };
        const centerX = crop.x + crop.width / 2;
        const centerY = crop.y + crop.height / 2;
        let width = crop.width;
        let height = width / ratio;
        if (height > 100) {
            height = 100;
            width = height * ratio;
        }
        width = Math.min(width, 100);
        height = Math.min(height, 100);
        const x = Math.max(0, Math.min(100 - width, centerX - width / 2));
        const y = Math.max(0, Math.min(100 - height, centerY - height / 2));
        return normaliseCropInput({ x, y, width, height });
    }

    async function openImageCropper(figure) {
        const block = readImageBlock(figure);
        const image = figure.querySelector('img[data-npad-image-asset]');
        const asset = block ? resolvedImageAssets.get(block.assetId) : null;
        // Opening Crop must be immediate. The already-resolved render asset is
        // enough for the first frame; rotation lazily loads the preserved
        // source only when the author asks for a quarter turn.
        let sourceAsset = asset;
        if (!block || !image?.src || !sourceAsset?.blob) {
            toast(strings.imageMissing, 'error');
            return;
        }
        let crop = cropDefaults(block.crop);
        let rotation = block.rotation || 0;
        const previewUrls = [];
        let update = () => {};
        const field = (label, key, value) => `
            <label class="field">
                <span class="field__label">${escapeHtml(label)}</span>
                <input class="field__input" type="number" min="0" max="100" step="0.01"
                       inputmode="decimal" data-crop-field="${key}" value="${value}">
            </label>`;
        const bodyHtml = `
            <div class="image-cropper">
                <p class="image-cropper__hint">${escapeHtml(strings.imageCropHint)}</p>
                <div class="image-cropper__stage" data-crop-stage>
                    <img src="${escapeHtml(image.src)}" alt="">
                    <div class="image-cropper__frame" data-crop-frame>
                        <button type="button" class="image-cropper__handle" data-crop-handle="nw" tabindex="-1" aria-hidden="true"></button>
                        <button type="button" class="image-cropper__handle" data-crop-handle="ne" tabindex="-1" aria-hidden="true"></button>
                        <button type="button" class="image-cropper__handle" data-crop-handle="sw" tabindex="-1" aria-hidden="true"></button>
                        <button type="button" class="image-cropper__handle" data-crop-handle="se" tabindex="-1" aria-hidden="true"></button>
                    </div>
                </div>
                <div class="image-cropper__presets" aria-label="${escapeHtml(strings.imageCropTitle)}">
                    <button type="button" class="image-cropper__preset" data-crop-ratio="original">${escapeHtml(strings.imageCropOriginal)}</button>
                    <button type="button" class="image-cropper__preset" data-crop-ratio="1">${escapeHtml(strings.imageCropSquare)}</button>
                    <button type="button" class="image-cropper__preset" data-crop-ratio="1.333333">${escapeHtml(strings.imageCropFourThree)}</button>
                    <button type="button" class="image-cropper__preset" data-crop-ratio="1.777778">${escapeHtml(strings.imageCropSixteenNine)}</button>
                    <button type="button" class="image-cropper__preset" data-crop-reset>${escapeHtml(strings.imageCropReset)}</button>
                    <button type="button" class="image-cropper__preset" data-crop-rotate="ccw">${escapeHtml(strings.imageRotateLeft)}</button>
                    <button type="button" class="image-cropper__preset" data-crop-rotate="cw">${escapeHtml(strings.imageRotateRight)}</button>
                </div>
                <div class="image-cropper__fields">
                    ${field(strings.imageCropX, 'x', crop.x)}
                    ${field(strings.imageCropY, 'y', crop.y)}
                    ${field(strings.imageCropWidth, 'width', crop.width)}
                    ${field(strings.imageCropHeight, 'height', crop.height)}
                </div>
            </div>`;
        const action = await showDialog({
            title: strings.imageCropTitle,
            bodyHtml,
            buttons: [
                { label: strings.cancel, action: 'cancel', variant: 'btn--ghost' },
                { label: strings.imageCropApply, action: 'apply-crop', variant: 'btn--primary' },
            ],
            onOpen: (body) => {
                const stage = body.querySelector('[data-crop-stage]');
                const stageImage = stage.querySelector('img');
                const setPreview = async () => {
                    const rendered = await createImageRenderAsset(sourceAsset, { ...block, rotation });
                    if (rendered?.width && rendered?.height) stage.style.aspectRatio = `${rendered.width} / ${rendered.height}`;
                    if (rendered?.blob) {
                        const Url = globalThis.URL || globalThis.window?.URL;
                        if (Url?.createObjectURL) {
                            const url = Url.createObjectURL(rendered.blob);
                            previewUrls.push(url);
                            stageImage.src = url;
                        }
                    }
                };
                if (asset?.width && asset?.height) stage.style.aspectRatio = `${asset.width} / ${asset.height}`;
                const frame = body.querySelector('[data-crop-frame]');
                const fields = new Map([...body.querySelectorAll('[data-crop-field]')]
                    .map((input) => [input.dataset.cropField, input]));
                update = () => {
                    crop = normaliseCropInput(crop);
                    frame.style.left = `${crop.x}%`;
                    frame.style.top = `${crop.y}%`;
                    frame.style.width = `${crop.width}%`;
                    frame.style.height = `${crop.height}%`;
                    fields.forEach((input, key) => { input.value = String(crop[key]); });
                };
                body.querySelectorAll('[data-crop-field]').forEach((input) => {
                    input.addEventListener('input', () => {
                        crop = normaliseCropInput({ ...crop, [input.dataset.cropField]: input.value });
                        update();
                    });
                });
                body.querySelectorAll('[data-crop-ratio]').forEach((button) => {
                    button.addEventListener('click', () => {
                        crop = button.dataset.cropRatio === 'original'
                            ? cropDefaults(null)
                            : cropToRatio(crop, Number(button.dataset.cropRatio));
                        update();
                    });
                });
                body.querySelector('[data-crop-reset]')?.addEventListener('click', () => {
                    crop = cropDefaults(null);
                    update();
                });
                body.querySelectorAll('[data-crop-rotate]').forEach((button) => {
                    button.addEventListener('click', async () => {
                        const direction = button.dataset.cropRotate;
                        const previousRotation = rotation;
                        const previousCrop = crop;
                        rotation = (rotation + (direction === 'ccw' ? 270 : 90)) % 360;
                        crop = cropDefaults(rotateImageCrop(crop, direction));
                        try {
                            sourceAsset = await loadImageAsset(block.assetId) || sourceAsset;
                            await setPreview();
                            update();
                        } catch (error) {
                            rotation = previousRotation;
                            crop = previousCrop;
                            toast(imageErrorMessage(error), 'error');
                        }
                    });
                });

                let drag = null;
                const begin = (event) => {
                    const rect = stage.getBoundingClientRect();
                    if (!rect.width || !rect.height) return;
                    const handle = event.target.closest('[data-crop-handle]');
                    drag = {
                        pointerId: event.pointerId,
                        kind: handle ? handle.dataset.cropHandle : 'move',
                        startX: event.clientX,
                        startY: event.clientY,
                        rect,
                        crop: { ...crop },
                    };
                    stage.setPointerCapture?.(event.pointerId);
                    event.preventDefault();
                };
                const move = (event) => {
                    if (!drag || event.pointerId !== drag.pointerId) return;
                    const dx = ((event.clientX - drag.startX) / drag.rect.width) * 100;
                    const dy = ((event.clientY - drag.startY) / drag.rect.height) * 100;
                    let next = { ...drag.crop };
                    if (drag.kind === 'move') {
                        next.x = Math.max(0, Math.min(100 - next.width, next.x + dx));
                        next.y = Math.max(0, Math.min(100 - next.height, next.y + dy));
                    } else {
                        if (drag.kind.includes('w')) { next.x += dx; next.width -= dx; }
                        if (drag.kind.includes('e')) next.width += dx;
                        if (drag.kind.includes('n')) { next.y += dy; next.height -= dy; }
                        if (drag.kind.includes('s')) next.height += dy;
                    }
                    crop = normaliseCropInput(next);
                    update();
                };
                const end = (event) => {
                    if (drag && event.pointerId === drag.pointerId) drag = null;
                };
                stage.addEventListener('pointerdown', begin);
                stage.addEventListener('pointermove', move);
                stage.addEventListener('pointerup', end);
                stage.addEventListener('pointercancel', end);
                update();
            },
        });
        revokeImageObjectUrls(previewUrls);
        if (action !== 'apply-crop') return;
        const next = { ...block, rotation, crop: normaliseCropInput(crop) };
        if (next.crop.x === 0 && next.crop.y === 0 && next.crop.width === 100 && next.crop.height === 100) next.crop = null;
        updateImageBlock(figure, next);
        // Render a derived preview immediately; note storage still retains the
        // original bytes and only stores this non-destructive transform value.
        void (async () => previewImageAsset(
            figure,
            await loadImageAsset(block.assetId) || sourceAsset,
        ))();
        track('image_cropped');
        if (rotation !== (block.rotation || 0)) track('image_rotated');
    }

    async function openImageDetails(figure, { initial = false, focusField = 'alt' } = {}) {
        const block = readImageBlock(figure);
        if (!block) return;
        const selected = (layout) => block.display.layout === layout ? 'checked' : '';
        const choice = (layout, label) => `<label class="image-details__choice"><input type="radio" name="image-layout" value="${layout}" ${selected(layout)}><span>${escapeHtml(label)}</span></label>`;
        const bodyHtml = `
            <div class="image-details">
                <p class="image-details__hint">${escapeHtml(strings.imageAltHint)}</p>
                <label class="field">
                    <span class="field__label">${escapeHtml(strings.imageAlt)}</span>
                    <textarea class="field__input" rows="3" maxlength="1000" data-image-alt>${escapeHtml(block.alt.text)}</textarea>
                </label>
                <label class="image-details__decorative">
                    <input type="checkbox" data-image-decorative ${block.alt.kind === 'decorative' ? 'checked' : ''}>
                    <span>${escapeHtml(strings.imageDecorative)}</span>
                </label>
                <p class="image-details__status" data-image-description-status ${block.alt.kind === 'pending' ? '' : 'hidden'}>${escapeHtml(strings.imageDescriptionNeeded)}</p>
                <label class="field">
                    <span class="field__label">${escapeHtml(strings.imageCaption)}</span>
                    <input class="field__input" type="text" maxlength="1000" data-image-caption value="${escapeHtml(block.caption)}">
                </label>
                <fieldset class="field">
                    <legend class="field__label">${escapeHtml(strings.imageLayout)}</legend>
                    <div class="image-details__layout">
                        ${choice('block', strings.imageLayoutBlock)}
                        ${choice('start', strings.imageLayoutStart)}
                        ${choice('center', strings.imageLayoutCenter)}
                        ${choice('end', strings.imageLayoutEnd)}
                    </div>
                </fieldset>
                <label class="field">
                    <span class="field__label">${escapeHtml(strings.imageWidth)} <span class="field__hint">${escapeHtml(strings.imageWidthUnit)}</span></span>
                    <input class="field__input" type="number" min="10" max="100" step="1" inputmode="numeric" data-image-width value="${block.display.widthPercent}">
                </label>
                <div class="image-details__presets" aria-label="${escapeHtml(strings.imageSize)}">
                    <button type="button" data-image-width-preset="25">${escapeHtml(strings.imageSizeSmall)}</button>
                    <button type="button" data-image-width-preset="50">${escapeHtml(strings.imageSizeMedium)}</button>
                    <button type="button" data-image-width-preset="75">${escapeHtml(strings.imageSizeLarge)}</button>
                    <button type="button" data-image-width-preset="100">${escapeHtml(strings.imageSizeFull)}</button>
                </div>
            </div>`;
        const action = await showDialog({
            title: initial ? strings.imageDescribeTitle : strings.imageDetailsTitle,
            bodyHtml,
            buttons: [
                { label: strings.cancel, action: 'cancel', variant: 'btn--ghost' },
                { label: strings.imageSaveDetails, action: 'save-image-details', variant: 'btn--primary' },
            ],
            initialFocus: (body) => focusField === 'width'
                ? body.querySelector('[data-image-width]')
                : body.querySelector('[data-image-alt]'),
            onOpen: (body) => {
                const alt = body.querySelector('[data-image-alt]');
                const decorative = body.querySelector('[data-image-decorative]');
                const status = body.querySelector('[data-image-description-status]');
                const sync = () => {
                    alt.disabled = decorative.checked;
                    if (decorative.checked) alt.value = '';
                    status.hidden = decorative.checked || !!alt.value.trim();
                };
                decorative.addEventListener('change', sync);
                alt.addEventListener('input', sync);
                body.querySelectorAll('[data-image-width-preset]').forEach((button) => {
                    button.addEventListener('click', () => {
                        const width = body.querySelector('[data-image-width]');
                        width.value = button.dataset.imageWidthPreset;
                        width.focus();
                    });
                });
                sync();
                if (focusField === 'width') body.querySelector('[data-image-width]')?.focus();
                else if (!decorative.checked) alt.focus();
            },
        });
        if (action !== 'save-image-details') {
            if (initial && block.alt.kind === 'pending') toast(strings.imageDescriptionNeeded, 'info');
            return;
        }
        const dialog = document.getElementById('appDialog');
        const decorative = !!dialog.querySelector('[data-image-decorative]')?.checked;
        const alt = String(dialog.querySelector('[data-image-alt]')?.value || '').trim();
        const caption = String(dialog.querySelector('[data-image-caption]')?.value || '').trim();
        const layout = dialog.querySelector('input[name="image-layout"]:checked')?.value || 'block';
        const width = Number(dialog.querySelector('[data-image-width]')?.value);
        const next = {
            ...block,
            alt: decorative ? { kind: 'decorative', text: '' } : (alt ? { kind: 'informative', text: alt } : { kind: 'pending', text: '' }),
            caption,
            display: { layout, widthPercent: Number.isFinite(width) ? width : block.display.widthPercent },
        };
        updateImageBlock(figure, next);
        track('image_details_saved');
    }

    function removeImageBlock(figure) {
        if (!figure?.isConnected) return;
        const parent = figure.parentNode;
        const next = figure.nextSibling;
        clearImageBlockSelection();
        figure.remove();
        editor.focus();
        try {
            const range = document.createRange();
            if (next?.isConnected) {
                range.setStartBefore(next);
                range.collapse(true);
            } else {
                range.selectNodeContents(parent || editor);
                range.collapse(false);
            }
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            rememberEditorSelection();
        } catch { /* browser keeps the existing editor caret */ }
        scheduleSave();
        updateCounts();
        spell.refresh();
        track('image_removed');
    }

    function openImageFilePicker({ replace = false } = {}) {
        const target = replace ? selectedImageBlock : null;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp';
        input.addEventListener('change', async () => {
            const file = input.files?.[0];
            if (!file) return;
            if (target?.isConnected) await replaceImageBlockFile(target, file);
            else await insertImageFile(file, { describe: true });
        }, { once: true });
        input.click();
    }

    async function replaceImageBlockFile(figure, file) {
        const current = readImageBlock(figure);
        if (!current || !activeNoteId) return false;
        const asset = await storeImageFile(file, activeNoteId);
        if (!asset) return false;
        // Preserve author-facing metadata and placement, but do not carry a
        // crop rectangle from a different source image.
        const next = { ...current, assetId: asset.id, crop: null };
        updateImageBlock(figure, next);
        void previewImageAsset(figure, asset);
        void gcImageAssets();
        track('image_replaced');
        return true;
    }

    async function insertImageFile(file, { describe = false } = {}) {
        if (!activeNoteId) return false;
        const asset = await storeImageFile(file, activeNoteId);
        if (!asset) return false;
        const block = blockFromImportedImage({ assetId: asset.id });
        const figure = createImageBlockElement(block, { asset, labels: imageLabels() });
        if (!figure) return false;
        editor.focus();
        restoreEditorSelection();
        if (!insertBlockAtSelection(figure)) {
            editor.appendChild(figure);
        }
        ensureImageSpacer(figure);
        void previewImageAsset(figure, asset);
        selectImageBlock(figure);
        scheduleSave();
        updateCounts();
        spell.refresh();
        track('image_inserted');
        if (describe) void openImageDetails(figure, { initial: true });
        else toast(strings.imageInserted, 'info');
        return true;
    }

    function imageFilesFrom(data) {
        const files = [];
        const seen = new Set();
        const add = (file) => {
            if (file && !seen.has(file) && String(file.type || '').toLowerCase().startsWith('image/')) {
                seen.add(file);
                files.push(file);
            }
        };
        for (const file of data?.files || []) add(file);
        for (const item of data?.items || []) {
            if (String(item.type || '').toLowerCase().startsWith('image/')) add(item.getAsFile?.());
        }
        return files;
    }

    function placeDropCaret(event) {
        let range = null;
        if (typeof document.caretRangeFromPoint === 'function') {
            range = document.caretRangeFromPoint(event.clientX, event.clientY);
        } else if (typeof document.caretPositionFromPoint === 'function') {
            const position = document.caretPositionFromPoint(event.clientX, event.clientY);
            if (position) {
                range = document.createRange();
                range.setStart(position.offsetNode, position.offset);
                range.collapse(true);
            }
        }
        if (!range || !editor.contains(range.startContainer)) return;
        const target = range.startContainer.nodeType === Node.ELEMENT_NODE
            ? range.startContainer
            : range.startContainer.parentElement;
        const imageBlock = target?.closest?.('figure[data-npad-image-block="1"]');
        if (imageBlock) {
            range.setStartAfter(imageBlock);
            range.collapse(true);
        }
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        rememberEditorSelection();
    }

    /** Paste/drop keeps safe text and archives local raster files separately. */
    async function handleContentData(data) {
        const html = typeof data?.getData === 'function' ? data.getData('text/html') : '';
        const text = typeof data?.getData === 'function' ? data.getData('text/plain') : '';
        const files = imageFilesFrom(data);
        let changed = false;
        if (html) {
            const clean = activeNoteId
                ? await importEmbeddedImageData(html, activeNoteId)
                : sanitizeHtml(html);
            if (clean) {
                insertHtml(clean);
                normaliseTables(editor);
                changed = true;
            }
        } else if (text) {
            insertHtml(textToHtml(text));
            changed = true;
        }
        for (const [index, file] of files.entries()) {
            editor.focus();
            restoreEditorSelection();
            // The first file follows the same describe-image flow as Insert;
            // additional files remain visibly pending instead of stacking
            // several dialogs on top of a single paste action.
            if (await insertImageFile(file, { describe: index === 0 })) changed = true;
        }
        if (changed) {
            scheduleSave();
            updateCounts();
            spell.refresh();
        }
        return changed;
    }

    async function gcImageAssets() {
        // An asset can belong to a deleted/edited note while a recovery backup
        // still references it. Collect across both sets before deleting it.
        const keep = new Set();
        for (const note of notes) {
            collectImageAssetIds(note.html).forEach((id) => keep.add(id));
        }
        const backups = await listBackups();
        for (const backup of backups) {
            collectImageAssetIds(backup.html).forEach((id) => keep.add(id));
        }
        const stored = await listAllImageAssets();
        const orphanIds = stored.filter((asset) => !keep.has(asset.id)).map((asset) => asset.id);
        if (orphanIds.length) await deleteImageAssets(orphanIds);
    }

    async function copyImageAssetsForNote(html, sourceNoteId, targetNoteId) {
        const mapping = new Map();
        for (const id of collectImageAssetIds(html)) {
            try {
                const asset = await loadImageAsset(id);
                if (!asset?.blob || asset.noteId !== sourceNoteId) continue;
                const copied = { ...asset, id: newImageAssetId(), noteId: targetNoteId, createdAt: Date.now() };
                if (await saveImageAsset(copied)) {
                    resolvedImageAssets.set(copied.id, copied);
                    mapping.set(id, copied.id);
                }
            } catch { /* keep the old reference out of a malformed backup */ }
        }
        return mapping.size ? remapImageAssetIds(html, mapping) : html;
    }

    async function importEmbeddedImageData(html, noteId) {
        const root = document.createElement('div');
        root.innerHTML = sanitizeHtml(html, { dataImages: true });
        const sources = [...root.querySelectorAll('img[src^="data:image/"]')];
        for (const image of sources) {
            const decoded = dataUriToImageBlob(image.getAttribute('src'));
            if (!decoded) {
                image.remove();
                continue;
            }
            let inspected;
            try {
                inspected = await inspectImageFile(decoded.blob);
            } catch {
                image.remove();
                continue;
            }
            const asset = {
                id: newImageAssetId(),
                noteId,
                blob: decoded.blob,
                type: inspected.type,
                size: decoded.size,
                name: '',
                width: inspected.width,
                height: inspected.height,
                createdAt: Date.now(),
            };
            if (!await saveImageAsset(asset)) {
                image.remove();
                continue;
            }
            const parent = image.closest('figure');
            const caption = parent?.querySelector('figcaption')?.textContent || '';
            const block = blockFromImportedImage({ assetId: asset.id, alt: image.alt, caption });
            const replacement = createImageBlockElement(block, { asset, labels: imageLabels() });
            if (parent) parent.replaceWith(replacement);
            else image.replaceWith(replacement);
        }
        stripImageBlockRuntimeState(root);
        return sanitizeHtml(root.innerHTML);
    }

    imageBlockToolbar?.addEventListener('click', (event) => {
        const button = event.target.closest('[data-image-action]');
        if (!button || !selectedImageBlock?.isConnected) return;
        const figure = selectedImageBlock;
        const action = button.dataset.imageAction;
        if (action === 'replace') openImageFilePicker({ replace: true });
        else if (action === 'details') void openImageDetails(figure);
        else if (action === 'size') void openImageDetails(figure, { focusField: 'width' });
        else if (action === 'crop') void openImageCropper(figure);
        else if (action === 'remove') removeImageBlock(figure);
        else if (action.startsWith('layout-')) {
            const block = readImageBlock(figure);
            if (block) updateImageBlock(figure, {
                ...block,
                display: { ...block.display, layout: action.replace('layout-', '') },
            });
        }
    });

    imageBlockToolbar?.addEventListener('keydown', (event) => {
        const controls = [...imageBlockToolbar.querySelectorAll('button:not([disabled])')];
        const index = controls.indexOf(document.activeElement);
        if (index < 0) return;
        let next = null;
        if (event.key === 'ArrowRight') next = index + 1;
        else if (event.key === 'ArrowLeft') next = index - 1;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = controls.length - 1;
        if (next !== null) {
            event.preventDefault();
            const target = controls[(next + controls.length) % controls.length];
            controls.forEach((control) => { control.tabIndex = control === target ? 0 : -1; });
            target.focus();
        }
    });

    editor.addEventListener('click', (event) => {
        const figure = event.target.closest?.('figure[data-npad-image-block="1"]');
        if (!figure) {
            if (selectedImageBlock && !event.target.closest?.('#imageBlockToolbar')) clearImageBlockSelection();
            return;
        }
        event.preventDefault();
        selectImageBlock(figure);
    });

    editor.addEventListener('dragstart', (event) => {
        if (event.target.closest?.('figure[data-npad-image-block="1"]')) event.preventDefault();
    });

    editor.addEventListener('keydown', (event) => {
        const figure = event.target.closest?.('figure[data-npad-image-block="1"]');
        if (!figure) return;
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            selectImageBlock(figure, { focus: true });
            void openImageDetails(figure);
        } else if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            removeImageBlock(figure);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            clearImageBlockSelection({ returnFocus: true });
        }
    });

    document.addEventListener('keydown', (event) => {
        if (!selectedImageBlock?.isConnected || document.getElementById('appDialog')?.open) return;
        if (event.target.closest?.('input, textarea, select, button, [contenteditable="true"]:not(.editor)')) return;
        if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            removeImageBlock(selectedImageBlock);
        }
    });

    document.addEventListener('pointerdown', (event) => {
        if (!selectedImageBlock) return;
        if (!event.target.closest?.('figure[data-npad-image-block="1"], #imageBlockToolbar, #imageResizeOverlay, #appDialog')) {
            clearImageBlockSelection();
        }
    }, true);
    document.addEventListener('pointermove', moveImageResize);
    document.addEventListener('pointerup', finishImageResize);
    document.addEventListener('pointercancel', (event) => finishImageResize(event, { cancel: true }));
    window.addEventListener('scroll', positionImageBlockControls, true);
    window.addEventListener('resize', positionImageBlockControls);

    /* ---------------------------------------------------------------------
       Tables: contextual toolbar, insert dialog, full cell control
       --------------------------------------------------------------------- */

    function currentCellFromSelection() {
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) return null;
        return closestTableCell(selection.anchorNode)
            || closestTableCell(selection.getRangeAt(0).startContainer);
    }

    /**
     * Cell for a table action. Toolbar buttons take focus (which collapses
     * the live selection), so fall back to the range saved by pointerdown;
     * otherwise the live caret is the truth.
     */
    function currentCellForTableAction() {
        const cell = currentCellFromSelection();
        if (cell) return cell;
        if (restoreEditorSelection()) return currentCellFromSelection();
        return null;
    }

    function setToolbarContext(context) {
        toolbarContext = context;
        if (toolbarPaneBase) toolbarPaneBase.hidden = context !== 'base';
        if (toolbarPaneTable) toolbarPaneTable.hidden = context !== 'table';
        if (toolbar) {
            toolbar.dataset.toolbarContext = context;
            toolbar.setAttribute('aria-label', context === 'table'
                ? (strings.tableToolbarLabel || TOOLBAR_LABEL_BASE)
                : TOOLBAR_LABEL_BASE);
        }
        if (context === 'table') syncTableToolbarState();
    }

    function syncTableToolbarState() {
        if (!toolbarPaneTable) return;
        const cell = currentCellFromSelection();
        const table = cell?.closest('table') || null;
        const setDisabled = (action, disabled) => {
            const button = toolbarPaneTable.querySelector(`[data-table-action="${action}"]`);
            if (button) button.disabled = disabled;
        };

        const headerRowBtn = toolbarPaneTable.querySelector('[data-table-action="header-row"]');
        const headerColBtn = toolbarPaneTable.querySelector('[data-table-action="header-col"]');
        if (headerRowBtn) {
            headerRowBtn.setAttribute('aria-pressed', String(table ? isHeaderRowActive(table) : false));
        }
        if (headerColBtn) {
            headerColBtn.setAttribute('aria-pressed', String(table && cell ? isHeaderColumnActive(table, cell) : false));
        }

        // Action affordances: only show what the current selection can do.
        const selection = window.getSelection();
        const anchorCell = closestTableCell(selection?.anchorNode);
        const focusCell = closestTableCell(selection?.focusNode);
        const multiCell = !!(anchorCell && focusCell && anchorCell !== focusCell);
        const pos = table && cell ? cellPosition(table, cell) : null;

        setDisabled('merge', !multiCell);
        setDisabled('split', !table || !cell || !isMergedCell(table, cell));
        setDisabled('move-row-up', !pos || pos.row <= 0);
        setDisabled('move-row-down', !pos || !table || pos.row >= tableGrid(table).rowCount - 1);
        setDisabled('row-delete', !table);
        setDisabled('col-delete', !table);
    }

    function markActiveCell(cell) {
        editor.querySelectorAll('.npad-cell-active').forEach((el) => el.classList.remove('npad-cell-active'));
        if (cell) cell.classList.add('npad-cell-active');
    }

    /* Whole-table selection is tracked explicitly: native range selection of
       a <table> is inconsistent across engines (jsdom folds it into the
       parent), and the outline is what users see. Cleared on the next
       pointer/keyboard/typing interaction. */
    let selectedTableEl = null;

    function clearSelectedTable() {
        if (!selectedTableEl) return;
        selectedTableEl.classList.remove('npad-table-selected');
        selectedTableEl = null;
    }

    /**
     * Decide which toolbar pane the current selection asks for:
     *  - collapsed caret inside a cell         -> table tools
     *  - the whole <table> element selected     -> table tools
     *  - a range spanning more than one cell     -> table tools (merge etc.)
     *  - text selected inside ONE cell           -> default tools (format it)
     */
    function contextTableFromSelection(selection) {
        if (selectedTableEl?.isConnected) return selectedTableEl;
        if (!selection || !selection.rangeCount) return null;
        const anchorNode = selection.anchorNode;
        const focusNode = selection.focusNode;
        if (!anchorNode || !editor.contains(anchorNode)) return null;

        const anchorTable = anchorNode.nodeType === 1 && anchorNode.tagName === 'TABLE'
            ? anchorNode
            : closestTable(anchorNode);
        if (!anchorTable) return null;

        // A selection that runs out of the table selects text, not a table shape.
        const focusTable = focusNode && (focusNode.nodeType === 1 && focusNode.tagName === 'TABLE'
            ? focusNode
            : closestTable(focusNode));
        if (focusNode && !focusTable) return null;

        if (selection.isCollapsed) return anchorTable;

        // Both ends inside the same cell = a text selection: default toolbar.
        const anchorCell = closestTableCell(anchorNode);
        const focusCell = closestTableCell(focusNode);
        if (anchorCell && focusCell && anchorCell === focusCell) return null;
        return anchorTable;
    }

    function updateToolbarContext() {
        const selection = window.getSelection();
        const table = contextTableFromSelection(selection);
        const collapsedInCell = !!(table && selection?.isCollapsed);
        markActiveCell(collapsedInCell ? closestTableCell(selection.anchorNode) : null);
        setToolbarContext(table ? 'table' : 'base');
    }

    /** Insert a block element around the caret without breaking block structure. */
    function insertBlockAtSelection(element) {
        editor.focus();
        restoreEditorSelection();
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) return false;
        const range = selection.getRangeAt(0);
        range.deleteContents();

        // A block inside a table cell would nest (breaking the grid model and
        // the DOCX/Markdown exporters), so it lands right after the table the
        // cell belongs to. Inline text insertion still goes into the cell.
        const cell = closestTableCell(range.startContainer);
        if (cell) {
            const table = cell.closest('table');
            if (table) {
                table.after(element);
                return true;
            }
            range.insertNode(element);
            return true;
        }
        let block = range.startContainer.nodeType === 1
            ? range.startContainer
            : range.startContainer.parentElement;
        block = block?.closest?.('p, div, h1, h2, h3, h4, h5, h6, li, blockquote, pre');
        if (block && block !== editor) {
            const empty = !block.textContent.trim() && !block.querySelector('table, ul, ol, blockquote, pre');
            if (empty) block.replaceWith(element);
            else block.after(element);
            return true;
        }
        range.insertNode(element);
        return true;
    }

    function ensureSpacerAfter(element) {
        const next = element.nextElementSibling;
        if (!next || ['P', 'DIV', 'TABLE', 'HR', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(next.tagName)) {
            return;
        }
        const spacer = document.createElement('p');
        spacer.appendChild(document.createElement('br'));
        element.after(spacer);
    }

    function insertTableFromOptions(options) {
        editor.focus();
        restoreEditorSelection();

        // Prefer execCommand('insertHTML') so the browser's own undo stack
        // covers the insertion; fall back to a direct DOM insert (jsdom,
        // unsupported engines) where the command is a no-op.
        const html = createTableHtml(options);
        const existingTables = new Set(editor.querySelectorAll('table'));
        try {
            document.execCommand('insertHTML', false, html);
        } catch {
            /* fall through to the range-based insert */
        }
        let table = [...editor.querySelectorAll('table')].find((t) => !existingTables.has(t)) || null;

        if (!table) {
            const template = document.createElement('template');
            template.innerHTML = html;
            table = template.content.firstElementChild;
            if (!insertBlockAtSelection(table)) return;
        } else if (table.parentNode !== editor || closestTableCell(table)) {
            // Browser heuristics can leave the new table inside a block or a
            // cell; keep it a top-level sibling so the grid stays sound.
            const holder = table.parentNode;
            const nestingCell = closestTableCell(table);
            if (nestingCell) nestingCell.closest('table').after(table);
            else holder?.after(table);
        }

        ensureSpacerAfter(table);
        const firstCell = table.querySelector('td, th');
        if (firstCell) placeCaretInCell(firstCell, { atStart: true });
        rememberEditorSelection();
        updateToolbarContext();
        scheduleSave();
        updateCounts();
        spell.refresh();
        track('table_inserted');
        if (strings.tableInserted) toast(strings.tableInserted, 'success');
    }

    function insertHorizontalRule() {
        const rule = document.createElement('hr');
        if (!insertBlockAtSelection(rule)) return;
        const spacer = document.createElement('p');
        spacer.appendChild(document.createElement('br'));
        rule.after(spacer);
        const selection = window.getSelection();
        const range = document.createRange();
        range.setStart(spacer, 0);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        scheduleSave();
        updateCounts();
    }

    function insertDateTime() {
        const locale = document.documentElement.lang === 'fa' ? 'fa-IR' : 'en-GB';
        const text = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
        editor.focus();
        restoreEditorSelection();
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) return;
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const node = document.createTextNode(text);
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        scheduleSave();
        updateCounts();
    }

    function clampTableSize(value, max) {
        const number = Number.parseInt(String(value), 10);
        if (!Number.isInteger(number)) return null;
        return Math.min(max, Math.max(1, number));
    }

    async function openTableDialog() {
        rememberEditorSelection();
        const state = { rows: 3, cols: 3, headerRow: false, headerColumn: false, width: 'auto' };
        const presets = [
            ['plain', 3, 3, false, false, strings.tablePresetPlain],
            ['header', 4, 3, true, false, strings.tablePresetHeader],
            ['classic', 5, 4, true, true, strings.tablePresetClassic],
        ];
        const presetButtons = presets.map(([id, rows, cols, hr, hc, label]) => `
            <button type="button" class="table-builder__preset" data-table-preset="${id}"
                    aria-pressed="false">${escapeHtml(label)}</button>`).join('');
        const field = (label, control) => `
            <label class="table-builder__field">
                <span class="table-builder__field-label">${escapeHtml(label)}</span>
                ${control}
            </label>`;
        const check = (label, key) => `
            <label class="table-builder__check">
                <input type="checkbox" data-table-check="${key}">
                <span>${escapeHtml(label)}</span>
            </label>`;

        const bodyHtml = `
            <div class="table-builder">
                <div class="table-builder__preview" data-table-preview aria-hidden="true"></div>
                <div class="table-builder__presets" role="group" aria-label="${escapeHtml(strings.tableDialogTitle)}">
                    ${presetButtons}
                </div>
                <div class="table-builder__fields">
                    ${field(strings.tableRows, `<input type="number" data-table-rows min="1" max="${TABLE_MAX_ROWS}" value="3" inputmode="numeric" autofocus>`)}
                    ${field(strings.tableColumns, `<input type="number" data-table-cols min="1" max="${TABLE_MAX_COLS}" value="3" inputmode="numeric">`)}
                    ${field(strings.tableWidth, `
                        <select data-table-width>
                            <option value="auto">${escapeHtml(strings.tableWidthAuto)}</option>
                            <option value="full">${escapeHtml(strings.tableWidthFull)}</option>
                        </select>`)}
                    <div class="table-builder__checks">
                        ${check(strings.tableHeaderRow, 'headerRow')}
                        ${check(strings.tableHeaderColumn, 'headerColumn')}
                    </div>
                </div>
                <p class="table-builder__hint">${escapeHtml(strings.tableSizeHint)}</p>
            </div>`;

        const action = await showDialog({
            title: strings.tableDialogTitle,
            bodyHtml,
            buttons: [
                { label: strings.cancel, action: 'cancel', variant: 'btn--ghost' },
                { label: strings.tableInsert, action: 'insert', variant: 'btn--primary' },
            ],
            onOpen(body) {
                const preview = body.querySelector('[data-table-preview]');
                const rowsInput = body.querySelector('[data-table-rows]');
                const colsInput = body.querySelector('[data-table-cols]');
                const widthSelect = body.querySelector('[data-table-width]');

                const render = () => {
                    state.rows = clampTableSize(rowsInput.value, TABLE_MAX_ROWS) ?? 3;
                    state.cols = clampTableSize(colsInput.value, TABLE_MAX_COLS) ?? 3;
                    state.headerRow = body.querySelector('[data-table-check="headerRow"]').checked;
                    state.headerColumn = body.querySelector('[data-table-check="headerColumn"]').checked;
                    state.width = widthSelect.value;
                    if (preview) {
                        const previewRows = Math.min(state.rows, 8);
                        const previewCols = Math.min(state.cols, 8);
                        preview.innerHTML = createTableHtml({
                            rows: previewRows,
                            cols: previewCols,
                            headerRow: state.headerRow,
                            headerColumn: state.headerColumn,
                            width: 'auto',
                        });
                    }
                };

                const applyPreset = (id) => {
                    const preset = presets.find(([presetId]) => presetId === id);
                    if (!preset) return;
                    rowsInput.value = String(preset[1]);
                    colsInput.value = String(preset[2]);
                    body.querySelector('[data-table-check="headerRow"]').checked = preset[3];
                    body.querySelector('[data-table-check="headerColumn"]').checked = preset[4];
                    body.querySelectorAll('[data-table-preset]').forEach((btn) => {
                        btn.setAttribute('aria-pressed', String(btn.dataset.tablePreset === id));
                    });
                    render();
                };
                body.querySelectorAll('[data-table-preset]').forEach((btn) => {
                    btn.addEventListener('click', () => applyPreset(btn.dataset.tablePreset));
                });
                [rowsInput, colsInput, widthSelect].forEach((input) => {
                    input.addEventListener('input', () => {
                        body.querySelectorAll('[data-table-preset]')
                            .forEach((btn) => btn.setAttribute('aria-pressed', 'false'));
                        render();
                    });
                    input.addEventListener('change', render);
                });
                body.querySelectorAll('[data-table-check]').forEach((input) => {
                    input.addEventListener('change', render);
                });
                render();
            },
        });

        if (action !== 'insert') return;
        insertTableFromOptions(state);
    }

    function afterTableOp() {
        rememberEditorSelection();
        scheduleSave();
        updateCounts();
        spell.refresh();
        if (findBar && !findBar.hidden) refreshFind(false);
        track('table_tool_used');
        updateToolbarContext();
    }

    async function openTableProperties(table) {
        const captionEl = table.querySelector(':scope > caption');
        const bodyHtml = `
            <div class="table-properties">
                <label class="table-builder__field">
                    <span class="table-builder__field-label">${escapeHtml(strings.tableWidth)}</span>
                    <select data-prop-width>
                        <option value="auto">${escapeHtml(strings.tableWidthAuto)}</option>
                        <option value="full">${escapeHtml(strings.tableWidthFull)}</option>
                    </select>
                </label>
                <label class="table-builder__field">
                    <span class="table-builder__field-label">${escapeHtml(strings.tableCaption)}</span>
                    <input type="text" data-prop-caption maxlength="200" value="${escapeHtml(captionEl?.textContent || '')}">
                </label>
                <label class="table-builder__check">
                    <input type="checkbox" data-prop-borders>
                    <span>${escapeHtml(strings.tableBorders)}</span>
                </label>
            </div>`;
        const action = await showDialog({
            title: strings.tablePropertiesTitle,
            bodyHtml,
            buttons: [
                { label: strings.cancel, action: 'cancel', variant: 'btn--ghost' },
                { label: strings.apply, action: 'apply', variant: 'btn--primary' },
            ],
            onOpen(body) {
                const widthSelect = body.querySelector('[data-prop-width]');
                const captionInput = body.querySelector('[data-prop-caption]');
                const bordersCheck = body.querySelector('[data-prop-borders]');
                widthSelect.value = table.style.getPropertyValue('width') === '100%' ? 'full' : 'auto';
                bordersCheck.checked = tableBordersOn(table);
                captionInput.focus();
                captionInput.select();
            },
        });
        if (action !== 'apply') return;
        const width = document.querySelector('#appDialog [data-prop-width]')?.value || 'auto';
        const caption = document.querySelector('#appDialog [data-prop-caption]')?.value.trim() || '';
        const borders = document.querySelector('#appDialog [data-prop-borders]')?.checked ?? true;
        setTableWidth(table, width);
        setCaption(table, caption);
        if (borders !== tableBordersOn(table)) toggleBorders(table);
        afterTableOp();
    }

    /** Delete a table only after explicit confirmation (shared by delete-table
        and the last-row/last-column guards). */
    function confirmDeleteTable(table) {
        confirmDialog({
            title: strings.tableDeleteTitle,
            message: strings.tableDeleteBody,
            confirmLabel: strings.confirm,
            cancelLabel: strings.cancel,
            danger: true,
        }).then((confirmed) => {
            if (!confirmed) return;
            deleteTable(table);
            clearSelectedTable();
            setToolbarContext('base');
            editor.focus();
            afterTableOp();
        });
    }

    function runTableAction(action) {
        const cell = currentCellForTableAction();
        const table = cell ? closestTable(cell) : null;
        if (!table) {
            setToolbarContext('base');
            return;
        }

        // Actions that act on the whole selection (merge, alignment, shading)
        // must read the pre-click rectangle. Clicking a toolbar button moves
        // focus there and collapses the live selection, so bring back the
        // range saved by selectionchange/pointerdown first.
        const RECT_ACTIONS = [
            'merge', 'align-left', 'align-center', 'align-right',
            'cell-colour', 'clear-cells', 'v-align-top', 'v-align-middle',
            'v-align-bottom', 'cell-dir-ltr', 'cell-dir-rtl',
        ];
        if (RECT_ACTIONS.includes(action)) {
            const selection = window.getSelection();
            if (!selection || selection.isCollapsed) restoreEditorSelection();
        }

        switch (action) {
            case 'row-above':
            case 'row-below': {
                const row = insertRow(table, cell, action === 'row-above');
                if (row && row.cells[0]) { placeCaretInCell(row.cells[0]); afterTableOp(); }
                break;
            }
            case 'col-left':
            case 'col-right': {
                const pos = cellPosition(table, cell);
                insertColumn(table, cell, action === 'col-left');
                const target = action === 'col-left' ? (pos?.col ?? 0) : (pos?.col ?? 0) + 1;
                const moved = cellAt(table, pos?.row ?? 0, target);
                if (moved) placeCaretInCell(moved);
                afterTableOp();
                break;
            }
            case 'row-delete': {
                // Deleting the last row would silently destroy the table;
                // route to the explicit table-delete confirmation instead.
                if (table.rows.length <= 1) {
                    confirmDeleteTable(table);
                    break;
                }
                const removed = deleteRow(table, cell);
                if (removed) {
                    const first = table.isConnected ? table.querySelector('td, th') : null;
                    if (first) placeCaretInCell(first);
                    afterTableOp();
                }
                break;
            }
            case 'col-delete': {
                if (tableGrid(table).colCount <= 1) {
                    confirmDeleteTable(table);
                    break;
                }
                const removed = deleteColumn(table, cell);
                if (removed) {
                    const first = table.isConnected ? table.querySelector('td, th') : null;
                    if (first) placeCaretInCell(first);
                    afterTableOp();
                }
                break;
            }
            case 'merge': {
                const cells = selectionRectCells(editor);
                if (cells.length >= 2) {
                    const merged = mergeCells(table, cells[0], cells[cells.length - 1]);
                    if (merged) { placeCaretInCell(merged); afterTableOp(); }
                } else {
                    toast(strings.tableMergeHint);
                }
                break;
            }
            case 'split': {
                if (splitCell(table, cell)) { placeCaretInCell(cell, { atStart: false }); afterTableOp(); }
                else toast(strings.tableSplitHint);
                break;
            }
            case 'header-row': {
                // Header toggles rebuild the first row's cells (td <-> th),
                // which detaches the caret; put it back by grid position.
                const pos = cellPosition(table, cell);
                setHeaderRow(table, !isHeaderRowActive(table));
                if (pos && table.isConnected) {
                    const restored = cellAt(table, pos.row, pos.col);
                    if (restored) placeCaretInCell(restored);
                }
                afterTableOp();
                break;
            }
            case 'header-col': {
                const pos = cellPosition(table, cell);
                setHeaderColumn(table, !isHeaderColumnActive(table, cell));
                if (pos && table.isConnected) {
                    const restored = cellAt(table, pos.row, pos.col);
                    if (restored) placeCaretInCell(restored);
                }
                afterTableOp();
                break;
            }
            case 'align-left':
            case 'align-center':
            case 'align-right': {
                const cells = selectionRectCells(editor);
                alignCells(cells, action === 'align-center' ? 'center' : action === 'align-right' ? 'right' : 'left');
                afterTableOp();
                break;
            }
            case 'cell-colour': {
                // Capture the cells before the dialog opens: showModal moves
                // focus and collapses the live selection.
                const targetCells = selectionRectCells(editor);
                const current = targetCells[0]
                    ?.style?.getPropertyValue('background-color') || '#ffffff';
                openColourPicker({ dataset: { colorCommand: 'table', color: current }, querySelector: () => null }, (colour) => {
                    setCellShading(targetCells, colour);
                    afterTableOp();
                });
                break;
            }
            case 'clear-cells': {
                clearCells(selectionRectCells(editor));
                afterTableOp();
                break;
            }
            case 'select-table': {
                clearSelectedTable();
                selectedTableEl = table;
                table.classList.add('npad-table-selected');
                // Native selection too, where engines support it: Delete then
                // removes the whole table.
                try {
                    const range = document.createRange();
                    range.selectNode(table);
                    const nextSelection = window.getSelection();
                    nextSelection.removeAllRanges();
                    nextSelection.addRange(range);
                } catch {
                    /* selection is only a visual courtesy */
                }
                updateToolbarContext();
                break;
            }
            case 'v-align-top':
            case 'v-align-middle':
            case 'v-align-bottom': {
                verticalAlignCells(
                    selectionRectCells(editor),
                    action === 'v-align-top' ? 'top' : action === 'v-align-middle' ? 'middle' : 'bottom',
                );
                afterTableOp();
                break;
            }
            case 'cell-dir-ltr':
            case 'cell-dir-rtl': {
                setCellDirection(selectionRectCells(editor), action === 'cell-dir-ltr' ? 'ltr' : 'rtl');
                afterTableOp();
                break;
            }
            case 'sort-asc':
            case 'sort-desc': {
                // Sort around the column the user is standing in.
                const ok = sortTableByColumn(table, cell, action === 'sort-desc' ? 'desc' : 'asc');
                if (ok) afterTableOp();
                else toast(strings.tableSortUnsupported);
                break;
            }
            case 'properties':
                openTableProperties(table);
                break;
            case 'borders':
                toggleBorders(table);
                afterTableOp();
                break;
            case 'move-row-up':
            case 'move-row-down': {
                if (moveRow(table, cell, action === 'move-row-up' ? -1 : 1)) afterTableOp();
                break;
            }
            case 'delete-table':
                confirmDeleteTable(table);
                break;
            default:
                break;
        }
    }

    /** One delegated handler covers the table pane, the "more" menu and the
        right-click context menu; each dismisses itself after firing. */
    document.addEventListener('click', (event) => {
        const button = event.target.closest('[data-table-action]');
        if (!button) return;
        if (tableContextMenu && !tableContextMenu.hidden) hideTableContextMenu();
        runTableAction(button.dataset.tableAction);
    });

    function buildTableContextMenu() {
        if (!tableContextMenu || !toolbarPaneTable) return;
        tableContextMenu.innerHTML = '';
        const collect = (container) => [...container.querySelectorAll('[data-table-action]')];
        const panes = [
            ...toolbarPaneTable.querySelectorAll('.toolbar__group'),
            toolbarPaneTable.querySelector('.menu__panel--table'),
        ].filter(Boolean);

        panes.forEach((group) => {
            const buttons = collect(group);
            if (!buttons.length) return;
            const section = document.createElement('div');
            section.className = 'table-context__group';
            buttons.forEach((original) => {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'table-context__item';
                item.dataset.tableAction = original.dataset.tableAction;
                item.setAttribute('role', 'menuitem');
                // Impossibile actions stay visible but greyed, matching the
                // toolbar affordances instead of vanishing.
                item.disabled = original.disabled;
                const iconClone = original.querySelector('svg')?.cloneNode(true);
                if (iconClone) item.appendChild(iconClone);
                const label = document.createElement('span');
                label.textContent = original.getAttribute('aria-label')
                    || original.querySelector('span')?.textContent
                    || '';
                item.appendChild(label);
                section.appendChild(item);
            });
            tableContextMenu.appendChild(section);
        });
    }

    function showTableContextMenu(x, y) {
        if (!tableContextMenu) return;
        syncTableToolbarState();
        buildTableContextMenu();
        tableContextMenu.hidden = false;
        const margin = 8;
        const rect = tableContextMenu.getBoundingClientRect();
        const left = Math.min(x, Math.max(margin, window.innerWidth - rect.width - margin));
        const top = Math.min(y, Math.max(margin, window.innerHeight - rect.height - margin));
        tableContextMenu.style.left = `${left}px`;
        tableContextMenu.style.top = `${top}px`;
    }

    function hideTableContextMenu() {
        if (tableContextMenu) tableContextMenu.hidden = true;
    }

    editor.addEventListener('contextmenu', (event) => {
        if (!closestTableCell(event.target)) return;
        event.preventDefault();
        rememberEditorSelection();
        showTableContextMenu(event.clientX || 0, event.clientY || 0);
    });

    document.addEventListener('scroll', hideTableContextMenu, true);
    window.addEventListener('resize', hideTableContextMenu);

    // Any real pointer or typing interaction ends "whole table selected".
    document.addEventListener('pointerdown', clearSelectedTable, true);
    editor.addEventListener('keydown', clearSelectedTable);

    // Tab walks cells; at the last cell it appends a row (grid behaviour),
    // while Shift+Tab steps backwards.
    editor.addEventListener('keydown', (event) => {
        if (event.key !== 'Tab' || event.altKey) return;
        const cell = currentCellFromSelection();
        if (!cell) return;
        event.preventDefault();
        const table = closestTable(cell);
        const next = stepCell(table, cell, event.shiftKey);
        if (next) {
            placeCaretInCell(next, { atStart: event.shiftKey });
            rememberEditorSelection();
            updateToolbarContext();
            return;
        }
        if (event.shiftKey) {
            placeCaretInCell(cell, { atStart: true });
            return;
        }
        const lastRow = table.rows[table.rows.length - 1];
        const ref = lastRow?.cells[0];
        if (!ref) return;
        const row = insertRow(table, ref, false);
        if (row && row.cells[0]) {
            placeCaretInCell(row.cells[0]);
            afterTableOp();
        }
    });

    /* ---------------------------------------------------------------------
       Searchable font picker
       --------------------------------------------------------------------- */

    const fontTrigger = document.getElementById('fontPickerTrigger');
    const fontPopup = document.getElementById('fontPickerPopup');
    const fontSearch = document.getElementById('fontPickerSearch');
    const fontOptions = fontPopup
        ? Array.from(fontPopup.querySelectorAll('[data-font-option]'))
        : [];

    const searchable = (value) => String(value ?? '')
        .normalize('NFKD')
        .toLocaleLowerCase()
        .replace(/[يى]/g, 'ی')
        .replace(/ك/g, 'ک')
        .trim();

    function visibleFontOptions() {
        return fontOptions.filter((option) => !option.hidden);
    }

    function filterFonts(query = '') {
        const needle = searchable(query);
        let visibleCount = 0;

        fontPopup?.querySelectorAll('[data-font-group]').forEach((group) => {
            let groupCount = 0;
            group.querySelectorAll('[data-font-option]').forEach((option) => {
                const matches = !needle || searchable(option.textContent).includes(needle);
                option.hidden = !matches;
                if (matches) groupCount += 1;
            });
            group.hidden = groupCount === 0;
            visibleCount += groupCount;
        });

        const empty = fontPopup?.querySelector('[data-font-empty]');
        if (empty) empty.hidden = visibleCount !== 0;
    }

    function positionFontPopup() {
        if (!fontPopup || !fontTrigger || fontPopup.hidden) return;
        const rect = fontTrigger.getBoundingClientRect();
        const gutter = 12;
        const gap = 6;
        const width = fontPopup.offsetWidth || 340;
        const height = fontPopup.offsetHeight || 480;
        const rtl = document.documentElement.dir === 'rtl';

        let left = rtl ? rect.right - width : rect.left;
        left = Math.max(gutter, Math.min(left, window.innerWidth - width - gutter));

        let top = rect.bottom + gap;
        if (top + height > window.innerHeight - gutter && rect.top - height - gap >= gutter) {
            top = rect.top - height - gap;
            fontPopup.style.transformOrigin = 'bottom center';
        } else {
            top = Math.min(top, window.innerHeight - height - gutter);
            fontPopup.style.transformOrigin = 'top center';
        }

        fontPopup.style.left = `${Math.round(left)}px`;
        fontPopup.style.top = `${Math.max(gutter, Math.round(top))}px`;
    }

    function openFontPopup({ focusSearch = true } = {}) {
        if (!fontPopup || !fontTrigger) return;
        rememberEditorSelection();
        fontPopup.hidden = false;
        fontPopup.dataset.open = 'true';
        fontTrigger.setAttribute('aria-expanded', 'true');
        if (fontSearch) fontSearch.value = '';
        filterFonts();
        positionFontPopup();
        if (focusSearch && fontSearch) fontSearch.focus();
    }

    function closeFontPopup({ returnFocus = false } = {}) {
        if (!fontPopup || !fontTrigger || fontPopup.hidden) return;
        fontPopup.dataset.open = 'false';
        fontPopup.hidden = true;
        fontTrigger.setAttribute('aria-expanded', 'false');
        if (returnFocus) fontTrigger.focus();
    }

    function chooseFont(option) {
        if (!option || !fontTrigger) return;
        const font = option.dataset.font;
        fontOptions.forEach((item) => item.setAttribute(
            'aria-selected', item === option ? 'true' : 'false',
        ));
        fontTrigger.dataset.currentFont = font;
        const value = fontTrigger.querySelector('.font-picker__value');
        if (value) {
            value.textContent = font;
            value.style.fontFamily = option.style.fontFamily;
        }
        closeFontPopup();
        exec('fontName', option.dataset.fontStack || font);
    }

    if (fontTrigger && fontPopup && fontSearch) {
        fontTrigger.addEventListener('click', () => {
            if (fontPopup.hidden) openFontPopup();
            else closeFontPopup();
        });

        fontTrigger.addEventListener('keydown', (event) => {
            if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
                event.preventDefault();
                openFontPopup({ focusSearch: event.key !== 'ArrowUp' });
                if (event.key === 'ArrowUp') visibleFontOptions().at(-1)?.focus();
            }
        });

        fontSearch.addEventListener('input', () => filterFonts(fontSearch.value));
        fontSearch.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                visibleFontOptions()[0]?.focus();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                closeFontPopup({ returnFocus: true });
            }
        });

        fontPopup.addEventListener('click', (event) => {
            const option = event.target.closest('[data-font-option]');
            if (option) chooseFont(option);
        });

        fontPopup.addEventListener('keydown', (event) => {
            const options = visibleFontOptions();
            const current = options.indexOf(document.activeElement);
            if (current < 0) return;

            let next = null;
            if (event.key === 'ArrowDown') next = current + 1;
            else if (event.key === 'ArrowUp') next = current - 1;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = options.length - 1;
            else if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                chooseFont(options[current]);
                return;
            } else if (event.key === 'Escape') {
                event.preventDefault();
                closeFontPopup({ returnFocus: true });
                return;
            }

            if (next !== null) {
                event.preventDefault();
                options[(next + options.length) % options.length]?.focus();
            }
        });

        document.addEventListener('click', (event) => {
            if (!fontPopup.hidden
                && !fontPopup.contains(event.target)
                && !fontTrigger.contains(event.target)) {
                closeFontPopup();
            }
        });

        window.addEventListener('resize', positionFontPopup);
        window.addEventListener('scroll', positionFontPopup, true);
    }

    /* ---------------------------------------------------------------------
       Manual font size
       --------------------------------------------------------------------- */

    const sizeInput = toolbar?.querySelector('[data-font-size]');

    function convertSizeMarkers(size) {
        editor.querySelectorAll('font[size="7"]').forEach((font) => {
            font.removeAttribute('size');
            font.style.fontSize = size;
        });
    }

    function applyFontSize(rawValue) {
        const size = Number(rawValue);
        if (!Number.isFinite(size) || size < 6 || size > 200) {
            toast(strings.sizeInvalid, 'error');
            sizeInput?.focus();
            return false;
        }

        const rounded = Math.round(size * 10) / 10;
        const cssSize = `${rounded}px`;
        if (sizeInput) sizeInput.value = String(rounded);

        // Turn any legacy HTML size=7 markup into its equivalent before using
        // that value as a temporary marker for this arbitrary pixel size.
        convertSizeMarkers('48px');
        pendingFontSize = cssSize;

        editor.focus();
        restoreEditorSelection();
        try {
            // Force predictable <font size="7"> output. It is immediately
            // converted to safe inline font-size styling below.
            document.execCommand('styleWithCSS', false, false);
            document.execCommand('fontSize', false, '7');
        } catch {
            /* unsupported browser */
        }
        convertSizeMarkers(cssSize);
        finishFormatting();
        return true;
    }

    if (sizeInput) {
        sizeInput.addEventListener('focus', rememberEditorSelection);
        sizeInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                applyFontSize(sizeInput.value);
            }
        });
        sizeInput.addEventListener('change', () => applyFontSize(sizeInput.value));
    }

    /* ---------------------------------------------------------------------
       Custom colour picker modal
       --------------------------------------------------------------------- */

    const COLOUR_PRESETS = [
        '#0f172a', '#334155', '#64748b', '#94a3b8', '#ffffff',
        '#7f1d1d', '#dc2626', '#f97316', '#f59e0b', '#fde047',
        '#166534', '#16a34a', '#84cc16', '#0f766e', '#14b8a6',
        '#0e7490', '#06b6d4', '#1d4ed8', '#3b82f6', '#6366f1',
        '#6d28d9', '#8b5cf6', '#a21caf', '#d946ef', '#be185d',
        '#f43f5e', '#fecdd3', '#fed7aa', '#fef3c7', '#d1fae5',
    ];

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

    function normaliseHex(value) {
        const match = String(value ?? '').trim().match(/^#?([\da-f]{6})$/i);
        return match ? `#${match[1].toLowerCase()}` : null;
    }

    function hexToHsv(hex) {
        const value = normaliseHex(hex) ?? '#000000';
        const r = parseInt(value.slice(1, 3), 16) / 255;
        const g = parseInt(value.slice(3, 5), 16) / 255;
        const b = parseInt(value.slice(5, 7), 16) / 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const delta = max - min;
        let h = 0;
        if (delta) {
            if (max === r) h = 60 * (((g - b) / delta) % 6);
            else if (max === g) h = 60 * ((b - r) / delta + 2);
            else h = 60 * ((r - g) / delta + 4);
        }
        if (h < 0) h += 360;
        return { h, s: max ? (delta / max) * 100 : 0, v: max * 100 };
    }

    function hsvToHex(h, s, v) {
        const saturation = clamp(s, 0, 100) / 100;
        const value = clamp(v, 0, 100) / 100;
        const chroma = value * saturation;
        const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
        const m = value - chroma;
        let rgb;
        if (h < 60) rgb = [chroma, x, 0];
        else if (h < 120) rgb = [x, chroma, 0];
        else if (h < 180) rgb = [0, chroma, x];
        else if (h < 240) rgb = [0, x, chroma];
        else if (h < 300) rgb = [x, 0, chroma];
        else rgb = [chroma, 0, x];
        return `#${rgb.map((channel) => Math.round((channel + m) * 255)
            .toString(16).padStart(2, '0')).join('')}`;
    }

    async function openColourPicker(button, apply = null) {
        rememberEditorSelection();
        const command = button.dataset.colorCommand;
        const initial = normaliseHex(button.dataset.color) ?? '#000000';
        const title = command === 'hiliteColor' ? strings.highlightColour
            : command === 'table' ? strings.tableCellColour : strings.textColour;
        let selectedColour = initial;

        const presets = COLOUR_PRESETS.map((colour) => `
            <button type="button" class="colour-picker__preset" data-preset="${colour}"
                    style="--preset-colour:${colour}" aria-label="${colour}"
                    aria-pressed="${colour === initial ? 'true' : 'false'}"></button>`).join('');

        const action = await showDialog({
            title,
            bodyHtml: `
                <div class="colour-picker">
                    <div class="colour-picker__area" tabindex="0"
                         aria-label="${escapeHtml(strings.colourArea)}">
                        <span class="colour-picker__marker" aria-hidden="true"></span>
                    </div>
                    <label class="colour-picker__hue-row">
                        <span class="colour-picker__label">${escapeHtml(strings.colourHue)}</span>
                        <input class="colour-picker__hue" type="range" min="0" max="359" step="1"
                               aria-label="${escapeHtml(strings.colourHue)}">
                    </label>
                    <div class="colour-picker__custom">
                        <span class="colour-picker__preview" aria-hidden="true"></span>
                        <label class="field">
                            <span class="field__label">${escapeHtml(strings.colourHex)}</span>
                            <input class="field__input colour-picker__hex" value="${initial.toUpperCase()}"
                                   inputmode="text" maxlength="7" autocomplete="off" spellcheck="false">
                        </label>
                    </div>
                    <p class="field__error colour-picker__error" hidden>${escapeHtml(strings.colourInvalid)}</p>
                    <span class="colour-picker__label colour-picker__presets-label">${escapeHtml(strings.colourPresets)}</span>
                    <div class="colour-picker__presets">${presets}</div>
                </div>`,
            buttons: [
                { label: strings.cancel, action: 'cancel', variant: 'btn--ghost' },
                { label: strings.apply, action: 'apply', variant: 'btn--primary' },
            ],
            onOpen: (body) => {
                const picker = body.querySelector('.colour-picker');
                const area = picker.querySelector('.colour-picker__area');
                const marker = picker.querySelector('.colour-picker__marker');
                const hue = picker.querySelector('.colour-picker__hue');
                const hex = picker.querySelector('.colour-picker__hex');
                const preview = picker.querySelector('.colour-picker__preview');
                const error = picker.querySelector('.colour-picker__error');
                const applyButton = body.closest('dialog')?.querySelector('[data-action="apply"]');
                let state = hexToHsv(initial);
                let dragging = false;

                const render = ({ updateInput = true } = {}) => {
                    selectedColour = hsvToHex(state.h, state.s, state.v);
                    picker.style.setProperty('--picker-hue', `hsl(${state.h} 100% 50%)`);
                    marker.style.left = `${state.s}%`;
                    marker.style.top = `${100 - state.v}%`;
                    hue.value = String(Math.round(state.h));
                    preview.style.backgroundColor = selectedColour;
                    area.setAttribute('aria-valuetext', selectedColour.toUpperCase());
                    if (updateInput) hex.value = selectedColour.toUpperCase();
                    error.hidden = true;
                    if (applyButton) applyButton.disabled = false;
                    picker.querySelectorAll('[data-preset]').forEach((preset) => {
                        preset.setAttribute(
                            'aria-pressed',
                            preset.dataset.preset === selectedColour ? 'true' : 'false',
                        );
                    });
                };

                const updateArea = (event) => {
                    const rect = area.getBoundingClientRect();
                    if (!rect.width || !rect.height) return;
                    state.s = clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100);
                    state.v = clamp(100 - ((event.clientY - rect.top) / rect.height) * 100, 0, 100);
                    render();
                };

                area.addEventListener('pointerdown', (event) => {
                    dragging = true;
                    area.setPointerCapture?.(event.pointerId);
                    updateArea(event);
                });
                area.addEventListener('pointermove', (event) => {
                    if (dragging) updateArea(event);
                });
                area.addEventListener('pointerup', () => { dragging = false; });
                area.addEventListener('pointercancel', () => { dragging = false; });
                area.addEventListener('keydown', (event) => {
                    const amount = event.shiftKey ? 10 : 2;
                    if (event.key === 'ArrowLeft') state.s = clamp(state.s - amount, 0, 100);
                    else if (event.key === 'ArrowRight') state.s = clamp(state.s + amount, 0, 100);
                    else if (event.key === 'ArrowUp') state.v = clamp(state.v + amount, 0, 100);
                    else if (event.key === 'ArrowDown') state.v = clamp(state.v - amount, 0, 100);
                    else return;
                    event.preventDefault();
                    render();
                });

                hue.addEventListener('input', () => {
                    state.h = Number(hue.value);
                    render();
                });

                hex.addEventListener('input', () => {
                    const valid = normaliseHex(hex.value);
                    if (!valid) {
                        error.hidden = false;
                        if (applyButton) applyButton.disabled = true;
                        return;
                    }
                    state = hexToHsv(valid);
                    render({ updateInput: false });
                });
                hex.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter' && !normaliseHex(hex.value)) {
                        event.preventDefault();
                        event.stopPropagation();
                        error.hidden = false;
                    }
                });

                picker.querySelector('.colour-picker__presets').addEventListener('click', (event) => {
                    const preset = event.target.closest('[data-preset]');
                    if (!preset) return;
                    state = hexToHsv(preset.dataset.preset);
                    render();
                });

                render();
            },
        });

        if (action !== 'apply') return;
        const colour = normaliseHex(selectedColour) ?? selectedColour;
        if (apply) {
            apply(colour);
            return;
        }
        button.dataset.color = selectedColour;
        const swatch = button.querySelector('.colorfield__swatch');
        if (swatch) swatch.style.backgroundColor = selectedColour;
        exec(command, selectedColour);
    }

    toolbar?.querySelectorAll('[data-color-command]').forEach((button) => {
        button.addEventListener('click', () => openColourPicker(button));
    });

    /* ---------------------------------------------------------------------
       Links
       --------------------------------------------------------------------- */

    async function promptForLink() {
        // Preserve the selection: opening a dialog collapses it.
        const selection = window.getSelection();
        const range = selection && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;

        const action = await showDialog({
            title: strings.linkTitle,
            bodyHtml: `
                <label class="field">
                    <span class="field__label">${escapeHtml(strings.linkLabel)}</span>
                    <input class="field__input" type="url" id="linkUrl" placeholder="https://example.com"
                           autocomplete="off" spellcheck="false">
                </label>
                <p class="field__error" id="linkError" hidden>${escapeHtml(strings.linkInvalid)}</p>`,
            buttons: [
                { label: strings.cancel, action: 'cancel', variant: 'btn--ghost' },
                { label: strings.confirm, action: 'confirm', variant: 'btn--primary' },
            ],
        });

        if (action !== 'confirm') return;

        const input = document.getElementById('linkUrl');
        const raw = input ? input.value.trim() : '';
        if (!raw) return;

        // Reject anything that is not http(s) — javascript: URLs are the
        // obvious hazard here.
        let url;
        try {
            url = new URL(raw, window.location.origin);
        } catch {
            toast(strings.linkInvalid, 'error');
            return;
        }
        if (!/^https?:$/.test(url.protocol)) {
            toast(strings.linkInvalid, 'error');
            return;
        }

        editor.focus();
        if (range) {
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        }
        exec('createLink', url.href);

        // execCommand cannot set rel; harden the anchor afterwards.
        editor.querySelectorAll('a[href]:not([rel])').forEach((a) => {
            a.setAttribute('rel', 'noopener noreferrer');
            a.setAttribute('target', '_blank');
        });

        track('link_created');
    }

    /* ---------------------------------------------------------------------
       Paste — always sanitise, never trust clipboard HTML
       --------------------------------------------------------------------- */

    // Paste and drop share one local-first pipeline. Safe text is inserted and
    // supported local raster files are admitted through the same validator as
    // the Insert command.
    editor.addEventListener('paste', (event) => {
        event.preventDefault();
        if (!event.clipboardData) return;
        void handleContentData(event.clipboardData);
    });

    editor.addEventListener('drop', (event) => {
        if (!event.dataTransfer) return;
        event.preventDefault();
        placeDropCaret(event);
        void handleContentData(event.dataTransfer);
    });

    function insertHtml(html) {
        editor.focus();
        const before = editor.innerHTML;
        try {
            document.execCommand('insertHTML', false, html);
        } catch {
            /* fall through to the range insert */
        }
        // Some webviews return success without mutating anything (and jsdom's
        // execCommand stub does the same): insert the fragment directly.
        if (editor.innerHTML === before) {
            const selection = window.getSelection();
            if (!selection || !selection.rangeCount) return;
            const range = selection.getRangeAt(0);
            range.deleteContents();
            const fragment = range.createContextualFragment(html);
            range.insertNode(fragment);
        }
    }

    /* ---------------------------------------------------------------------
       File operations
       --------------------------------------------------------------------- */

    async function newFile() {
        await createNewNote();
    }

    async function importNotes(imported, fallbackTitle) {
        const prepared = [];
        let organizationChanged = false;
        for (const item of imported) {
            let folderId = null;
            const folderName = item.folder?.name?.trim().slice(0, 80);
            if (folderName) {
                let folder = organization.folders.find((candidate) =>
                    candidate.name.toLocaleLowerCase() === folderName.toLocaleLowerCase());
                if (!folder) {
                    folder = createFolderRecord(folderName);
                    organization.folders.push(folder);
                    organizationChanged = true;
                }
                folderId = folder.id;
            }

            const tagIds = [];
            for (const importedTag of item.tags || []) {
                const tagName = importedTag.name.trim().slice(0, 40);
                if (!tagName) continue;
                let tag = organization.tags.find((candidate) =>
                    candidate.name.toLocaleLowerCase() === tagName.toLocaleLowerCase());
                if (!tag) {
                    tag = createTagRecord(tagName, importedTag.color);
                    organization.tags.push(tag);
                    organizationChanged = true;
                }
                tagIds.push(tag.id);
            }
            prepared.push({
                title: item.title.trim().slice(0, 120) || fallbackTitle,
                html: sanitizeHtml(item.html, { dataImages: true }),
                pinned: !!item.pinned,
                folderId,
                tags: [...new Set(tagIds)],
                createdAt: item.createdAt,
                updatedAt: item.updatedAt,
            });
        }

        if (organizationChanged) {
            await saveOrganization(organization);
            renderOrganization();
        }
        for (const note of prepared) {
            // Create the note first so every imported asset has a real owner
            // id. The import path accepts data URIs only transiently and turns
            // them into local assets before the note is saved again.
            const created = await createNewNote({ ...note, html: '', focusTitle: false, report: false });
            created.html = await importEmbeddedImageData(note.html, created.id);
            await saveNote(created);
            showNote(created);
        }
    }

    function importErrorMessage(error, extension) {
        const reason = String(error?.message || '');
        if (extension === 'pdf') {
            if (/encrypted/i.test(reason)) return strings.openPdfEncrypted;
            if (/no extractable/i.test(reason)) return strings.openPdfNoText;
            return strings.openPdfUnsupported;
        }
        if (/notreadable|could not be read/i.test(reason)) return strings.openFailed;
        return strings.openUnsupported;
    }

    function openFile() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = [
            '.txt', '.html', '.htm', '.md', '.markdown', '.json', '.docx', '.pdf', '.rtf',
            'text/plain', 'text/html', 'text/markdown', 'application/json',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/pdf', 'application/rtf', 'text/rtf',
        ].join(',');

        input.addEventListener('change', async () => {
            const file = input.files && input.files[0];
            if (!file) return;
            if (file.size > MAX_FILE_BYTES) {
                toast(strings.openTooLarge, 'error');
                return;
            }

            const title = file.name.replace(/\.[^.]+$/, '').slice(0, 120) || strings.noteUntitled;
            let extension = file.name.split('.').pop()?.toLowerCase() || '';
            if (!file.name.includes('.')) {
                extension = ({
                    'text/plain': 'txt',
                    'text/html': 'html',
                    'text/markdown': 'md',
                    'application/json': 'json',
                    'application/pdf': 'pdf',
                    'application/rtf': 'rtf',
                    'text/rtf': 'rtf',
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
                })[file.type] || '';
            }

            try {
                let imported;
                if (extension === 'txt') {
                    imported = [{ title, html: textToHtml(await file.text()) }];
                } else if (extension === 'html' || extension === 'htm') {
                    imported = [{ title, html: sanitizeHtml(await file.text(), { dataImages: true }) }];
                } else if (extension === 'md' || extension === 'markdown') {
                    imported = [{ title, html: markdownToHtml(await file.text()) }];
                } else if (extension === 'json') {
                    imported = parseNoteJson(await file.text());
                    if (!imported.length) throw new Error('No notes in JSON');
                } else if (extension === 'rtf') {
                    imported = [{ title, html: rtfToHtml(await file.text()) }];
                } else if (extension === 'docx') {
                    imported = [{ title, html: await docxToHtml(await file.arrayBuffer()) }];
                } else if (extension === 'pdf') {
                    imported = [{ title, html: await pdfToHtml(await file.arrayBuffer()) }];
                } else {
                    toast(strings.openUnsupportedType, 'error');
                    return;
                }
                await importNotes(imported, title);
                track('open_file');
            } catch (error) {
                toast(importErrorMessage(error, extension), 'error');
            }
        });

        input.click();
    }

    function download(filename, content, mime) {
        const blob = new Blob([content], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        // Revoking immediately can cancel the download in Firefox.
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    const stamp = () => new Date().toISOString().slice(0, 10);
    const exportBaseName = () => {
        const title = (noteTitleInput?.value || '').trim()
            .replace(/[\\/:*?"<>|]/g, '-')
            .slice(0, 80);
        return title || `npad-${stamp()}`;
    };
    const currentExportNote = () => ({
        ...(activeNote() || {}),
        title: noteTitleInput?.value.trim() || strings.noteUntitled,
        html: cleanHtml(),
    });

    function saveAsText() {
        download(`${exportBaseName()}.txt`, editorText(), 'text/plain;charset=utf-8');
        track('download_txt');
    }

    async function exportHtml() {
        return embedImageBlocksAsDataUris(cleanHtml(), loadImageAsset, { direction: currentDir() });
    }

    async function saveAsHtml() {
        const doc = `<!DOCTYPE html>
<html lang="${document.documentElement.lang || 'en'}" dir="${currentDir()}">
<meta charset="utf-8">
<title>NPad note — ${stamp()}</title>
<style>body{font:16px/1.7 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:42em;margin:3em auto;padding:0 1em;color:#111}figure{margin:0 0 1em}figure img{max-width:100%;height:auto}figcaption{font-size:.85em;color:#555}</style>
${await exportHtml()}
`;
        download(`${exportBaseName()}.html`, doc, 'text/html;charset=utf-8');
        track('download_html');
    }

    async function saveAsMarkdown() {
        const html = await exportHtml();
        download(`${exportBaseName()}.md`, htmlToMarkdown(html), 'text/markdown;charset=utf-8');
        track('download_markdown');
    }

    async function saveAsJson() {
        const note = currentExportNote();
        note.html = await exportHtml();
        download(`${exportBaseName()}.json`, noteToJson(note, organization), 'application/json;charset=utf-8');
        track('download_json');
    }

    async function saveAsDocx() {
        const html = await exportHtml();
        download(
            `${exportBaseName()}.docx`,
            htmlToDocx(html, { direction: currentDir() }),
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        );
        track('download_docx');
    }

    async function saveAsRtf() {
        const html = await exportHtml();
        download(
            `${exportBaseName()}.rtf`,
            htmlToRtf(html, { direction: currentDir() }),
            'application/rtf;charset=utf-8',
        );
        track('download_rtf');
    }

    async function saveAsPdf() {
        const action = await showDialog({
            title: strings.pdfExportTitle,
            bodyHtml: `<p>${escapeHtml(strings.pdfExportBody)}</p>`,
            buttons: [
                { label: strings.cancel, action: 'cancel', variant: 'btn--ghost' },
                { label: strings.pdfExportContinue, action: 'print-pdf', variant: 'btn--primary' },
            ],
        });
        if (action !== 'print-pdf') return;
        window.print();
        track('download_pdf');
    }

    // Print the live document: @media print hides the chrome and keeps the
    // editor's own typography. The old popup lost all styling.
    function printFile() {
        window.print();
        track('print_used');
    }

    async function showDetails() {
        const text = editorText();
        const words = countWords(text);
        const chars = text.replace(/\n+$/, '').length;
        const noSpaces = text.replace(/\s/g, '').length;
        const paragraphs = text.split(/\n{1,}/).filter((p) => p.trim()).length;
        const minutes = Math.max(1, Math.round(words / WORDS_PER_MINUTE));

        const savedLabel = lastSavedAt
            ? new Date(lastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : strings.never;

        const rows = [
            [strings.detailWords, words.toLocaleString()],
            [strings.detailCharacters, chars.toLocaleString()],
            [strings.detailNoSpaces, noSpaces.toLocaleString()],
            [strings.detailParagraphs, paragraphs.toLocaleString()],
            [strings.detailReading, `${minutes} ${strings.minutes}`],
            [strings.detailSavedAt, savedLabel],
        ];

        await showDialog({
            title: strings.detailsTitle,
            bodyHtml: `<dl class="stats">${rows
                .map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`)
                .join('')}</dl>`,
            buttons: [{ label: strings.ok, action: 'ok', variant: 'btn--primary' }],
        });

        track('view_details');
    }

    function backupReasonLabel(reason) {
        if (reason === 'deleted') return strings.backupDeleted;
        if (reason === 'cleared') return strings.backupCleared;
        return strings.backupAutomatic;
    }

    async function renderBackupRecovery() {
        if (!backupList || !backupEmpty || !backupCount) return;
        recoveryBackups = await listBackups();
        const fragment = document.createDocumentFragment();

        for (const backup of recoveryBackups) {
            const item = document.createElement('article');
            item.className = 'backup-item';
            item.dataset.backupId = backup.id;

            const header = document.createElement('div');
            header.className = 'backup-item__header';
            const title = document.createElement('h3');
            title.className = 'backup-item__title';
            title.dir = 'auto';
            title.textContent = displayTitle(backup);
            const time = document.createElement('time');
            time.className = 'backup-item__time';
            const timestamp = new Date(backup.createdAt);
            time.dateTime = timestamp.toISOString();
            time.textContent = timestamp.toLocaleString([], {
                dateStyle: 'medium',
                timeStyle: 'short',
            });
            header.append(title, time);

            const metadata = document.createElement('div');
            metadata.className = 'backup-item__metadata';
            const reason = document.createElement('span');
            reason.className = `backup-item__reason backup-item__reason--${backup.reason}`;
            reason.textContent = backupReasonLabel(backup.reason);
            metadata.appendChild(reason);
            if (!notes.some((note) => note.id === backup.noteId)) {
                const missing = document.createElement('span');
                missing.className = 'backup-item__missing';
                missing.textContent = strings.backupMissing;
                metadata.appendChild(missing);
            }

            const preview = document.createElement('p');
            preview.className = 'backup-item__preview';
            preview.dir = 'auto';
            preview.textContent = notePreview(backup);

            const actions = document.createElement('div');
            actions.className = 'backup-item__actions';
            const restore = document.createElement('button');
            restore.type = 'button';
            restore.className = 'backup-item__restore';
            restore.dataset.backupAction = 'restore';
            restore.dataset.backupId = backup.id;
            restore.textContent = strings.backupRestore;
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'backup-item__delete';
            remove.dataset.backupAction = 'delete';
            remove.dataset.backupId = backup.id;
            remove.textContent = strings.backupDelete;
            actions.append(restore, remove);

            item.append(header, metadata, preview, actions);
            fragment.appendChild(item);
        }

        backupList.replaceChildren(fragment);
        backupEmpty.hidden = recoveryBackups.length !== 0;
        backupCount.textContent = (strings.backupCount || '{count}')
            .replace('{count}', recoveryBackups.length.toLocaleString());
        backupDialog?.querySelector('[data-backup-action="clear"]')
            ?.toggleAttribute('hidden', recoveryBackups.length === 0);
    }

    async function showBackupRecovery({ persistCurrent = true } = {}) {
        if (!backupDialog) return;
        if (persistCurrent && dirty) await persist();
        await renderBackupRecovery();
        if (!backupDialog.open) backupDialog.showModal();
        const firstAction = backupDialog.querySelector('[data-backup-action="restore"]');
        (firstAction || backupDialog.querySelector('[data-backup-action="close"]'))?.focus();
        track('backups_opened');
    }

    function closeBackupRecovery() {
        if (backupDialog?.open) backupDialog.close();
    }

    async function restoreLocalBackup(id) {
        const backup = recoveryBackups.find((item) => item.id === id);
        if (!backup) return;
        const folderId = folderById(backup.folderId) ? backup.folderId : null;
        const tags = backup.tags.filter((tagId) => !!tagById(tagId));
        closeBackupRecovery();
        const restored = await createNewNote({
            title: `${displayTitle(backup)} ${strings.backupRestoredSuffix}`.trim(),
            html: backup.html,
            focusTitle: false,
            report: false,
            folderId,
            tags,
            pinned: backup.pinned,
        });
        restored.html = await copyImageAssetsForNote(restored.html, backup.noteId, restored.id);
        await saveNote(restored);
        showNote(restored);
        toast(strings.backupRestored, 'success');
        track('backup_restored');
    }

    async function removeLocalBackup(id) {
        const backup = recoveryBackups.find((item) => item.id === id);
        if (!backup) return;
        closeBackupRecovery();
        const confirmed = await confirmDialog({
            title: strings.backupDeleteTitle,
            message: strings.backupDeleteBody,
            confirmLabel: strings.backupDelete,
            cancelLabel: strings.cancel,
            danger: true,
        });
        if (confirmed) {
            await deleteBackup(id);
            await gcImageAssets();
        }
        await showBackupRecovery({ persistCurrent: false });
    }

    async function removeAllLocalBackups() {
        closeBackupRecovery();
        const confirmed = await confirmDialog({
            title: strings.backupClearTitle,
            message: strings.backupClearBody,
            confirmLabel: strings.backupClear,
            cancelLabel: strings.cancel,
            danger: true,
        });
        if (confirmed) {
            await clearBackups();
            await gcImageAssets();
        }
        await showBackupRecovery({ persistCurrent: false });
    }

    backupDialog?.addEventListener('click', (event) => {
        const action = event.target.closest('[data-backup-action]');
        if (!action) return;
        if (action.dataset.backupAction === 'close') closeBackupRecovery();
        else if (action.dataset.backupAction === 'restore') {
            void restoreLocalBackup(action.dataset.backupId);
        } else if (action.dataset.backupAction === 'delete') {
            void removeLocalBackup(action.dataset.backupId);
        } else if (action.dataset.backupAction === 'clear') {
            void removeAllLocalBackups();
        }
    });

    async function clearSaved() {
        const ok = await confirmDialog({
            title: strings.clearTitle,
            message: strings.clearBody,
            confirmLabel: strings.confirm,
            cancelLabel: strings.cancel,
            danger: true,
        });
        if (!ok) return;
        if (dirty) await persist();
        for (const note of notes) {
            await saveBackup(note, { reason: 'cleared', force: true });
        }
        window.clearTimeout(saveTimer);
        await clearNotes();
        notes = [];
        openNoteIds = [];
        activeNoteId = null;
        dirty = false;
        await createNewNote({ focusTitle: false, report: false });
        track('clear_data');
    }

    /* ---------------------------------------------------------------------
       Clipboard menu items
       --------------------------------------------------------------------- */

    async function copySelection(cut = false) {
        editor.focus();
        const selection = window.getSelection();
        const text = selection ? selection.toString() : '';

        try {
            if (navigator.clipboard && text) {
                await navigator.clipboard.writeText(text);
                if (cut) document.execCommand('delete');
            } else {
                document.execCommand(cut ? 'cut' : 'copy');
            }
            track(cut ? 'cut_used' : 'copy_used');
        } catch {
            toast(strings.copyBlocked, 'error');
        }
        if (cut) {
            scheduleSave();
            updateCounts();
        }
    }

    async function pasteFromClipboard(plainOnly = false) {
        editor.focus();
        try {
            if (!plainOnly && navigator.clipboard && navigator.clipboard.read) {
                const items = await navigator.clipboard.read();
                for (const item of items) {
                    if (item.types.includes('text/html')) {
                        const source = await (await item.getType('text/html')).text();
                        const clean = activeNoteId
                            ? await importEmbeddedImageData(source, activeNoteId)
                            : sanitizeHtml(source);
                        if (clean) {
                            insertHtml(clean);
                            finishPaste(false);
                            return;
                        }
                    }
                    const imageType = item.types.find((type) => String(type).startsWith('image/'));
                    if (imageType) {
                        const blob = await item.getType(imageType);
                        if (blob && await insertImageFile(blob)) {
                            finishPaste(false);
                            return;
                        }
                    }
                }
            }
            const text = await navigator.clipboard.readText();
            if (!text) return;
            insertHtml(textToHtml(text));
            finishPaste(plainOnly);
        } catch {
            toast(strings.pasteBlocked, 'error');
        }
    }

    function finishPaste(plainOnly) {
        normaliseTables(editor);
        scheduleSave();
        updateCounts();
        track(plainOnly ? 'paste_plain_used' : 'paste_used');
    }

    /* ---------------------------------------------------------------------
       Menu wiring + keyboard shortcuts
       --------------------------------------------------------------------- */

    /* ---------------------------------------------------------------------
       Find & replace (Ctrl+F / Ctrl+H)
       --------------------------------------------------------------------- */

    let findMatches = [];
    let findIndex = -1;
    let findSelectionScope = null;

    const FIND_ALL_HIGHLIGHT = 'npad-find-all';
    const FIND_CURRENT_HIGHLIGHT = 'npad-find-current';
    const highlightRegistry = window.CSS && window.CSS.highlights;
    const HighlightCtor = window.Highlight;
    const supportsFindHighlight = !!(highlightRegistry && HighlightCtor);
    const WORD_CHARACTER = /[\p{L}\p{M}\p{N}_\u200c]/u;

    const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const findOptionOn = (name) => findOptionButtons.get(name)?.getAttribute('aria-pressed') === 'true';

    /** Preserve both an external control's focus and its text caret. */
    function captureFindFocus() {
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

    function restoreFindFocus(state) {
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

    function findTextModel() {
        // 4 === NodeFilter.SHOW_TEXT. The named constant is undefined in some
        // embedded runtimes (jsdom, older webviews), so use the literal.
        const nodes = [];
        const starts = [];
        const walker = document.createTreeWalker(editor, 4);
        let combined = '';
        let node;
        while ((node = walker.nextNode())) {
            if (!node.nodeValue?.length) continue;
            starts.push(combined.length);
            nodes.push(node);
            combined += node.nodeValue;
        }
        return { nodes, starts, combined };
    }

    function rangeFromOffsets(start, end, model = findTextModel()) {
        if (!model.nodes.length) return null;
        const safeStart = Math.max(0, Math.min(start, model.combined.length));
        const safeEnd = Math.max(safeStart, Math.min(end, model.combined.length));
        let startIndex = 0;
        while (startIndex < model.nodes.length - 1 && model.starts[startIndex + 1] <= safeStart) {
            startIndex += 1;
        }
        let endIndex = startIndex;
        while (endIndex < model.nodes.length - 1 && model.starts[endIndex + 1] < safeEnd) {
            endIndex += 1;
        }
        if (safeStart === safeEnd) endIndex = startIndex;

        const range = document.createRange();
        range.setStart(model.nodes[startIndex], safeStart - model.starts[startIndex]);
        range.setEnd(model.nodes[endIndex], safeEnd - model.starts[endIndex]);
        return range;
    }

    function selectedEditorOffsets() {
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount || selection.isCollapsed) return null;
        const source = selection.getRangeAt(0);
        const inside = (node) => node === editor || editor.contains(node);
        if (!inside(source.startContainer) || !inside(source.endContainer)) return null;

        try {
            const beforeStart = document.createRange();
            beforeStart.selectNodeContents(editor);
            beforeStart.setEnd(source.startContainer, source.startOffset);
            const beforeEnd = document.createRange();
            beforeEnd.selectNodeContents(editor);
            beforeEnd.setEnd(source.endContainer, source.endOffset);
            const start = beforeStart.toString().length;
            const end = beforeEnd.toString().length;
            return end > start ? { start, end } : null;
        } catch {
            return null;
        }
    }

    function currentEditorOffset() {
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) return null;
        const range = selection.getRangeAt(0);
        const inside = (node) => node === editor || editor.contains(node);
        if (!inside(range.startContainer)) return null;
        try {
            const before = document.createRange();
            before.selectNodeContents(editor);
            before.setEnd(range.startContainer, range.startOffset);
            return before.toString().length;
        } catch {
            return null;
        }
    }

    function unwrapFallbackFindMarks() {
        const parents = new Set();
        editor.querySelectorAll('.npad-find-match').forEach((mark) => {
            const parent = mark.parentNode;
            if (!parent) return;
            parents.add(parent);
            while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
            mark.remove();
        });
        parents.forEach((parent) => parent.normalize());
    }

    function clearFindVisuals() {
        if (supportsFindHighlight) {
            highlightRegistry.delete(FIND_ALL_HIGHLIGHT);
            highlightRegistry.delete(FIND_CURRENT_HIGHLIGHT);
        } else {
            unwrapFallbackFindMarks();
        }
    }

    function paintFallbackFindMatches() {
        const model = findTextModel();
        const segments = [];
        findMatches.forEach((match, matchIndex) => {
            if (match.start === match.end) return;
            model.nodes.forEach((node, nodeIndex) => {
                const nodeStart = model.starts[nodeIndex];
                const nodeEnd = nodeStart + node.nodeValue.length;
                const start = Math.max(match.start, nodeStart);
                const end = Math.min(match.end, nodeEnd);
                if (end > start) {
                    segments.push({
                        node,
                        start: start - nodeStart,
                        end: end - nodeStart,
                        globalStart: start,
                        matchIndex,
                    });
                }
            });
        });
        segments.sort((a, b) => b.globalStart - a.globalStart || b.end - a.end);
        for (const segment of segments) {
            if (!segment.node.isConnected || segment.end > segment.node.length) continue;
            const range = document.createRange();
            range.setStart(segment.node, segment.start);
            range.setEnd(segment.node, segment.end);
            const mark = document.createElement('mark');
            mark.className = 'npad-find-match';
            mark.dataset.findMatch = String(segment.matchIndex);
            range.surroundContents(mark);
        }
    }

    function paintFindMatches() {
        if (!findMatches.length) return;
        if (supportsFindHighlight) {
            const ranges = findMatches
                .map((match) => rangeFromOffsets(match.start, match.end))
                .filter(Boolean);
            if (ranges.length) highlightRegistry.set(FIND_ALL_HIGHLIGHT, new HighlightCtor(...ranges));
        } else {
            paintFallbackFindMatches();
        }
    }

    function setActiveFindVisual() {
        const match = findMatches[findIndex];
        if (!match) return null;
        const range = rangeFromOffsets(match.start, match.end);
        if (!range) return null;

        if (supportsFindHighlight) {
            highlightRegistry.delete(FIND_CURRENT_HIGHLIGHT);
            highlightRegistry.set(FIND_CURRENT_HIGHLIGHT, new HighlightCtor(range));
        } else {
            editor.querySelectorAll('.npad-find-match--current').forEach((mark) => {
                mark.classList.remove('npad-find-match--current');
            });
            editor.querySelectorAll(`[data-find-match="${findIndex}"]`).forEach((mark) => {
                mark.classList.add('npad-find-match--current');
            });
        }
        return range;
    }

    function compileFindPattern(query) {
        const source = findOptionOn('regex') ? query : escapeRegExp(query);
        const flags = `gu${findOptionOn('case') ? '' : 'i'}`;
        try {
            return { regex: new RegExp(source, flags), error: null };
        } catch (error) {
            return { regex: null, error };
        }
    }

    /**
     * Every occurrence in document order, represented as stable global text
     * offsets. The ranges are rebuilt on demand, so fallback <mark> wrappers
     * and rich-text replacements cannot leave stale node references behind.
     */
    function computeFindMatches(query) {
        const model = findTextModel();
        const scope = findOptionOn('selection') && findSelectionScope
            ? {
                start: Math.max(0, Math.min(findSelectionScope.start, model.combined.length)),
                end: Math.max(0, Math.min(findSelectionScope.end, model.combined.length)),
            }
            : { start: 0, end: model.combined.length };
        const input = model.combined.slice(scope.start, Math.max(scope.start, scope.end));
        const compiled = compileFindPattern(query);
        if (!compiled.regex) return { matches: [], error: compiled.error };

        const matches = [];
        let result;
        while ((result = compiled.regex.exec(input)) !== null) {
            const start = scope.start + result.index;
            const end = start + result[0].length;
            if (findOptionOn('whole')) {
                const before = start > 0 ? model.combined[start - 1] : '';
                const after = end < model.combined.length ? model.combined[end] : '';
                if ((before && WORD_CHARACTER.test(before)) || (after && WORD_CHARACTER.test(after))) {
                    if (result.index === compiled.regex.lastIndex) compiled.regex.lastIndex += 1;
                    continue;
                }
            }
            matches.push({
                start,
                end,
                text: result[0],
                captures: [...result],
                groups: result.groups || {},
                input,
                localIndex: result.index,
            });
            if (result.index === compiled.regex.lastIndex) compiled.regex.lastIndex += 1;
        }
        return { matches, error: null };
    }

    function selectFindMatch(match) {
        const range = setActiveFindVisual();
        if (!range) return;

        if (!supportsFindHighlight) {
            // Legacy fallback keeps all matches marked in the DOM and uses
            // Selection only for the current result. Restore the search
            // field's focus and caret immediately after selecting it.
            const focusedControl = captureFindFocus();
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            restoreFindFocus(focusedControl);
        }

        const rect = typeof range.getBoundingClientRect === 'function'
            ? range.getBoundingClientRect()
            : null;
        const viewport = window.innerHeight || document.documentElement.clientHeight;
        if (rect && (rect.top < 0 || rect.bottom > viewport)) {
            window.scrollBy(0, rect.top - Math.max(viewport * 0.25, 60));
        }
    }

    function renderFindCount(error = null) {
        if (!findCount || !findInput) return;
        findInput.setAttribute('aria-invalid', String(!!error));
        if (error) {
            findCount.textContent = strings.findInvalidRegex || '';
            return;
        }
        if (!findMatches.length) {
            findCount.textContent = strings.findNoResults || '';
            return;
        }
        findCount.textContent = (strings.findCount || '{current} of {total}')
            .replace('{current}', String(findIndex + 1))
            .replace('{total}', String(findMatches.length));
    }

    function refreshFind(fromCaret = false) {
        if (!findInput) return;
        const query = findInput.value;
        const caretOffset = fromCaret ? currentEditorOffset() : null;
        clearFindVisuals();

        if (!query) {
            findMatches = [];
            findIndex = -1;
            findInput.setAttribute('aria-invalid', 'false');
            if (findCount) findCount.textContent = '';
            return;
        }

        const computed = computeFindMatches(query);
        findMatches = computed.matches;
        if (computed.error || !findMatches.length) {
            findIndex = -1;
            renderFindCount(computed.error);
            return;
        }

        let next = 0;
        if (caretOffset !== null) {
            const afterCaret = findMatches.findIndex((match) => match.start >= caretOffset);
            if (afterCaret >= 0) next = afterCaret;
        }
        findIndex = Math.min(next, findMatches.length - 1);
        paintFindMatches();
        selectFindMatch(findMatches[findIndex]);
        renderFindCount();
    }

    function stepFind(direction) {
        if (!findMatches.length) return;
        findIndex = (findIndex + direction + findMatches.length) % findMatches.length;
        selectFindMatch(findMatches[findIndex]);
        renderFindCount();
    }

    function updateSelectionOption(replaceMode) {
        const button = findOptionButtons.get('selection');
        if (!button) return;
        button.hidden = !replaceMode;
        button.disabled = !findSelectionScope;
        if (!replaceMode || !findSelectionScope) button.setAttribute('aria-pressed', 'false');
    }

    function openFind(replaceMode = false) {
        if (!findBar) return;
        track('find_used');
        const wasHidden = findBar.hidden;
        if (wasHidden) findSelectionScope = selectedEditorOffsets();
        findBar.hidden = false;
        if (findReplaceRow) findReplaceRow.hidden = !replaceMode;
        updateSelectionOption(replaceMode);
        if (findInput) {
            findInput.focus();
            if (findInput.value) {
                findInput.select();
                refreshFind(false);
            }
        }
    }

    function closeFind() {
        if (!findBar) return;
        findBar.hidden = true;
        clearFindVisuals();
        findMatches = [];
        findIndex = -1;
        findSelectionScope = null;
        const selectionButton = findOptionButtons.get('selection');
        if (selectionButton) {
            selectionButton.setAttribute('aria-pressed', 'false');
            selectionButton.disabled = true;
        }
        if (findInput) findInput.setAttribute('aria-invalid', 'false');
        if (findCount) findCount.textContent = '';
        editor.focus();
    }

    function regexReplacement(match, replacement) {
        if (!findOptionOn('regex')) return replacement;
        return replacement.replace(/\$(\$|&|`|'|<[^>]+>|\d{1,2})/g, (token, part) => {
            if (part === '$') return '$';
            if (part === '&') return match.text;
            if (part === '`') return match.input.slice(0, match.localIndex);
            if (part === "'") return match.input.slice(match.localIndex + match.text.length);
            if (part.startsWith('<')) {
                const name = part.slice(1, -1);
                return Object.prototype.hasOwnProperty.call(match.groups, name)
                    ? (match.groups[name] || '')
                    : token;
            }
            const index = Number(part);
            if (index > 0 && index < match.captures.length) return match.captures[index] || '';
            if (part.length === 2) {
                const first = Number(part[0]);
                if (first > 0 && first < match.captures.length) {
                    return `${match.captures[first] || ''}${part[1]}`;
                }
            }
            return token;
        });
    }

    function replaceCurrentMatch() {
        const match = findMatches[findIndex];
        if (!match || !replaceInput) return;
        const value = regexReplacement(match, replaceInput.value);
        clearFindVisuals();

        const range = rangeFromOffsets(match.start, match.end);
        if (!range) return;
        range.deleteContents();
        if (value) range.insertNode(document.createTextNode(value));

        if (findOptionOn('selection') && findSelectionScope) {
            findSelectionScope.end += value.length - (match.end - match.start);
        }
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        refreshFind(false);
    }

    function replaceAllMatches() {
        if (!findInput || !replaceInput || !findMatches.length) return;
        const matches = [...findMatches];
        clearFindVisuals();
        let totalDelta = 0;

        // Reverse order keeps every earlier global offset stable. Rebuild each
        // Range against the current DOM so rich-text and fallback marks are safe.
        for (let i = matches.length - 1; i >= 0; i--) {
            const match = matches[i];
            const value = regexReplacement(match, replaceInput.value);
            const range = rangeFromOffsets(match.start, match.end);
            if (!range) continue;
            range.deleteContents();
            if (value) range.insertNode(document.createTextNode(value));
            totalDelta += value.length - (match.end - match.start);
        }

        if (findOptionOn('selection') && findSelectionScope) {
            findSelectionScope.end += totalDelta;
        }
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        refreshFind(false);
    }

    if (findBar) {
        findInput.addEventListener('input', () => refreshFind(true));
        findInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                stepFind(event.shiftKey ? -1 : 1);
            } else if (event.key === 'Escape') {
                event.preventDefault();
                closeFind();
            }
        });
        replaceInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                replaceCurrentMatch();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                closeFind();
            }
        });
        findBar.addEventListener('click', (event) => {
            const option = event.target.closest('[data-find-option]');
            if (option) {
                if (option.disabled) return;
                option.setAttribute('aria-pressed', String(option.getAttribute('aria-pressed') !== 'true'));
                refreshFind(false);
                return;
            }
            const btn = event.target.closest('[data-find-action]');
            if (!btn) return;
            const action = btn.dataset.findAction;
            if (action === 'prev') stepFind(-1);
            else if (action === 'next') stepFind(1);
            else if (action === 'replace') replaceCurrentMatch();
            else if (action === 'replace-all') replaceAllMatches();
            else if (action === 'close') closeFind();
        });
    }

    editor.addEventListener('npad:spell-render', () => {
        if (findBar && !findBar.hidden) refreshFind(false);
    });
    window.addEventListener('beforeprint', () => {
        clearFindVisuals();
        hideTableContextMenu();
    });
    window.addEventListener('afterprint', () => {
        if (findBar && !findBar.hidden) refreshFind(false);
    });

    /* ---------------------------------------------------------------------
       View options: focus mode, text direction, spell check
       --------------------------------------------------------------------- */

    function remember(key, value) {
        try { localStorage.setItem(key, value); } catch { /* private mode */ }
    }

    function applyFocusMode(on, suppress = false) {
        document.body.classList.toggle('focus-mode', on);
        if (focusBtn) {
            focusBtn.setAttribute('aria-pressed', String(on));
            const expand = focusBtn.querySelector('[data-icon="expand"]');
            const contract = focusBtn.querySelector('[data-icon="contract"]');
            if (expand) expand.hidden = on;
            if (contract) contract.hidden = !on;
        }
        const exitBtn = document.querySelector('.focus-exit');
        if (exitBtn) exitBtn.hidden = !on;
        if (on && !suppress) track('focus_mode_enabled');
        remember('npad.focusMode', on ? '1' : '0');
    }

    function currentDir() {
        return editor.getAttribute('dir') || document.documentElement.getAttribute('dir') || 'ltr';
    }

    function syncDirButtons(dir) {
        const ltrBtn = document.querySelector('[data-action="dir-ltr"]');
        const rtlBtn = document.querySelector('[data-action="dir-rtl"]');
        if (ltrBtn) ltrBtn.setAttribute('aria-pressed', String(dir === 'ltr'));
        if (rtlBtn) rtlBtn.setAttribute('aria-pressed', String(dir === 'rtl'));
    }

    function applyDir(dir) {
        editor.setAttribute('dir', dir);
        syncDirButtons(dir);
        remember('npad.editorDir', dir);
    }

    const actions = {
        new: newFile,
        open: openFile,
        save: saveAsText,
        'save-html': saveAsHtml,
        'save-markdown': saveAsMarkdown,
        'save-json': saveAsJson,
        'save-docx': saveAsDocx,
        'save-pdf': saveAsPdf,
        'save-rtf': saveAsRtf,
        print: printFile,
        details: showDetails,
        backups: showBackupRecovery,
        clear: clearSaved,
        copy: () => copySelection(false),
        cut: () => copySelection(true),
        paste: () => pasteFromClipboard(false),
        'paste-plain': () => pasteFromClipboard(true),
        'select-all': () => {
            editor.focus();
            document.execCommand('selectAll');
            updateCounts();
        },
        find: () => openFind(false),
        'find-replace': () => openFind(true),
        'insert-table': openTableDialog,
        'insert-image': () => openImageFilePicker(),
        'insert-hr': insertHorizontalRule,
        'insert-datetime': insertDateTime,
        'insert-link': () => promptForLink(),
        'manage-note-tags': manageCurrentTags,
        'toggle-notes': () => setSidebarOpen(!sidebarOpen),
        'toggle-focus': () => applyFocusMode(!document.body.classList.contains('focus-mode')),
        'dir-ltr': () => {
            applyDir('ltr');
            track('dir_toggled');
        },
        'dir-rtl': () => {
            applyDir('rtl');
            track('dir_toggled');
        },
        'toggle-spellcheck': () => {
            spell.setEnabled(!spell.isEnabled());
            track('spellcheck_toggled');
        },
    };

    document.addEventListener('click', (event) => {
        const el = event.target.closest('[data-action]');
        if (!el || !actions[el.dataset.action]) return;
        // Dialog buttons carry their own data-action; ignore those.
        if (el.closest('.dialog__footer')) return;
        event.preventDefault();
        actions[el.dataset.action]();
    });

    document.addEventListener('keydown', (event) => {
        const mod = event.ctrlKey || event.metaKey;
        if (!mod) return;

        const key = event.key.toLowerCase();

        if (key === 's') {
            event.preventDefault();
            saveAsText();
        } else if (key === 'k' && editor.contains(document.activeElement)) {
            event.preventDefault();
            promptForLink();
        } else if (key === 'p') {
            event.preventDefault();
            printFile();
        } else if (key === 'f') {
            event.preventDefault();
            openFind(false);
        } else if (key === 'h') {
            event.preventDefault();
            openFind(true);
        } else if (key === 'z' && event.shiftKey) {
            // Chrome does not map Ctrl+Shift+Z to redo inside contenteditable.
            if (editor.contains(document.activeElement)) {
                event.preventDefault();
                exec('redo');
            }
        }
    });

    // Escape clears a selected image block, then closes contextual UI.
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (selectedImageBlock?.isConnected && !document.getElementById('appDialog')?.open) {
            event.preventDefault();
            clearImageBlockSelection({ returnFocus: true });
            return;
        }
        if (tableContextMenu && !tableContextMenu.hidden) {
            event.preventDefault();
            hideTableContextMenu();
            return;
        }
        if (noteFolderMenu && !noteFolderMenu.hidden) {
            event.preventDefault();
            closeFolderMenu({ returnFocus: true });
            return;
        }
        if (findBar && !findBar.hidden) {
            event.preventDefault();
            closeFind();
            return;
        }
        if (sidebarOpen && window.matchMedia?.('(max-width: 840px)').matches) {
            event.preventDefault();
            setSidebarOpen(false);
            document.querySelector('.document-header [data-action="toggle-notes"]')?.focus();
            return;
        }
        if (document.body.classList.contains('focus-mode')) {
            event.preventDefault();
            applyFocusMode(false);
        }
    });

    /* ---------------------------------------------------------------------
       Boot
       --------------------------------------------------------------------- */

    editor.addEventListener('input', () => {
        clearSelectedTable();
        // When a size is chosen at a collapsed caret, the browser creates its
        // temporary size=7 wrapper only after the first character is typed.
        if (pendingFontSize) convertSizeMarkers(pendingFontSize);
        updateCounts();   // immediate, not debounced
        scheduleSave();
        if (findBar && !findBar.hidden) {
            Promise.resolve().then(() => {
                if (!findBar.hidden) refreshFind(false);
            });
        }
    });

    (async () => {
        [notes, organization] = await Promise.all([listNotes(), loadOrganization()]);

        // Repair references if organization metadata was independently
        // cleared or recovered from an older backup.
        const folderIds = new Set(organization.folders.map((folder) => folder.id));
        const tagIds = new Set(organization.tags.map((tag) => tag.id));
        const repaired = [];
        notes = notes.map((note) => {
            const folderId = note.folderId && folderIds.has(note.folderId) ? note.folderId : null;
            const tags = note.tags.filter((id) => tagIds.has(id));
            // Persist the current allow-list form so unsupported legacy markup
            // cannot remain hidden in an untouched local note.
            const html = sanitizeHtml(note.html);
            if (folderId === note.folderId && tags.length === note.tags.length && html === note.html) {
                return note;
            }
            const updated = { ...note, html, folderId, tags, updatedAt: Date.now() };
            repaired.push(updated);
            return updated;
        });
        if (repaired.length) await Promise.all(repaired.map(saveNote));

        const existingIds = new Set(notes.map((note) => note.id));
        openNoteIds = getOpenNoteIds().filter((id) => existingIds.has(id));
        setOpenNoteIds(openNoteIds);

        if (!notes.length) {
            await createNewNote({ focusTitle: false, report: false });
        } else {
            const rememberedId = getActiveNoteId();
            const initial = notes.find((note) => note.id === rememberedId) || sortedNotes()[0];
            showNote(initial);
        }
        syncToolbarState();

        // Restore view options (silent: booting into focus mode is not an event).
        try {
            if (localStorage.getItem('npad.focusMode') === '1') applyFocusMode(true, true);
            const savedDir = localStorage.getItem('npad.editorDir');
            if (savedDir === 'ltr' || savedDir === 'rtl') applyDir(savedDir);
            else syncDirButtons(currentDir());

            const sidebarPreference = localStorage.getItem('npad.notesSidebar');
            const wideLayout = window.matchMedia?.('(min-width: 841px)').matches ?? true;
            const preferredOpen = sidebarPreference === null || sidebarPreference === '1';
            setSidebarOpen(wideLayout && preferredOpen, { remember: false });
            spell.refresh();
        } catch {
            setSidebarOpen(true, { remember: false });
        }
    })();

    window.addEventListener('online', () => setSaveState(dirty ? 'unsaved' : 'saved'));
    window.addEventListener('offline', () => setSaveState('offline'));
}
