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

import { loadDocument, saveDocument, clearDocument, saveDocumentSync } from './storage.js';
import { sanitizeHtml, textToHtml } from './sanitize.js';
import { showDialog, confirmDialog, toast, escapeHtml } from './ui.js';

const AUTOSAVE_DELAY = 800;      // was 3000ms with no flush on unload
const MAX_FILE_BYTES = 5 * 1024 * 1024;
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

    let saveTimer = null;
    let dirty = false;
    let lastSavedAt = 0;

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
            'BLOCKQUOTE', 'PRE', 'TR', 'UL', 'OL',
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

    async function persist() {
        const html = editor.innerHTML;
        setSaveState('saving');
        const ok = await saveDocument(html);
        dirty = !ok;
        lastSavedAt = ok ? Date.now() : lastSavedAt;
        setSaveState(ok ? 'saved' : 'unsaved');
    }

    function scheduleSave() {
        dirty = true;
        setSaveState('unsaved');
        window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(persist, AUTOSAVE_DELAY);
    }

    // Flush synchronously when the page goes away. pagehide covers the
    // bfcache and mobile Safari, where beforeunload is unreliable.
    function flush() {
        if (!dirty) return;
        window.clearTimeout(saveTimer);
        saveDocumentSync(editor.innerHTML);
        void saveDocument(editor.innerHTML);
        dirty = false;
    }

    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
    });

    /* ---------------------------------------------------------------------
       Formatting
       --------------------------------------------------------------------- */

    // document.execCommand is deprecated but remains the only broadly
    // supported way to drive contenteditable formatting without shipping a
    // full editing engine. Calls are centralised here for easy replacement.
    function exec(command, value = null) {
        editor.focus();
        try {
            document.execCommand(command, false, value);
        } catch {
            /* command unsupported in this browser */
        }
        scheduleSave();
        updateCounts();
        syncToolbarState();
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

    // The old build only refreshed state after a click, so buttons were
    // wrong whenever the caret moved.
    document.addEventListener('selectionchange', () => {
        const selection = document.getSelection();
        if (selection && editor.contains(selection.anchorNode)) {
            syncToolbarState();
            updateCounts();
        }
    });

    if (toolbar) {
        toolbar.addEventListener('click', (event) => {
            // Only buttons need preventDefault (they can submit forms or lose
            // selection on focus). Applying it to the <select> elements below
            // cancels the browser's own "open the option list" action, which
            // made the font and size dropdowns appear to close instantly on
            // click without ever opening. Native <select>/<input> controls
            // are handled by their own listeners further down.
            const btn = event.target.closest('button[data-command]');
            if (!btn) return;
            event.preventDefault();
            const { command, value } = btn.dataset;
            if (command === 'createLink') promptForLink();
            else exec(command, value ?? null);
        });

        toolbar.querySelectorAll('select[data-command]').forEach((select) => {
            select.addEventListener('change', () => {
                exec(select.dataset.command, select.value);
            });
        });

        toolbar.querySelectorAll('input[type="color"][data-command]').forEach((input) => {
            const swatch = input.parentElement.querySelector('.colorfield__swatch');
            const paint = () => {
                if (swatch) swatch.style.color = input.value;
            };
            paint();
            input.addEventListener('input', () => {
                paint();
                exec(input.dataset.command, input.value);
            });
        });
    }

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

    editor.addEventListener('paste', (event) => {
        event.preventDefault();
        const clipboard = event.clipboardData;
        if (!clipboard) return;

        const html = clipboard.getData('text/html');
        const text = clipboard.getData('text/plain');

        if (html) insertHtml(sanitizeHtml(html));
        else if (text) insertHtml(textToHtml(text));

        scheduleSave();
        updateCounts();
    });

    // Drag-and-drop is the same untrusted path as paste.
    editor.addEventListener('drop', (event) => {
        const dt = event.dataTransfer;
        if (!dt) return;
        event.preventDefault();
        const html = dt.getData('text/html');
        const text = dt.getData('text/plain');
        if (html) insertHtml(sanitizeHtml(html));
        else if (text) insertHtml(textToHtml(text));
        scheduleSave();
        updateCounts();
    });

    function insertHtml(html) {
        editor.focus();
        try {
            document.execCommand('insertHTML', false, html);
        } catch {
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
        const ok = await confirmDialog({
            title: strings.newTitle,
            message: strings.newBody,
            confirmLabel: strings.confirm,
            cancelLabel: strings.cancel,
            danger: true,
        });
        if (!ok) return;
        editor.innerHTML = '';
        await clearDocument();
        dirty = false;
        setSaveState('saved');
        updateCounts();
        editor.focus();
        track('new_file');
    }

    function openFile() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.txt,.html,.htm,text/plain,text/html';

        input.addEventListener('change', () => {
            const file = input.files && input.files[0];
            if (!file) return;

            if (file.size > MAX_FILE_BYTES) {
                toast(strings.openTooLarge, 'error');
                return;
            }

            const reader = new FileReader();
            reader.onerror = () => toast(strings.openFailed, 'error');
            reader.onload = () => {
                const content = String(reader.result ?? '');
                const isHtml = /\.html?$/i.test(file.name) || /^\s*<(!doctype|html|div|p|span)/i.test(content);
                editor.innerHTML = isHtml ? sanitizeHtml(content) : textToHtml(content);
                updateCounts();
                scheduleSave();
                track('open_file');
            };
            reader.readAsText(file);
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

    function saveAsText() {
        download(`npad-${stamp()}.txt`, editorText(), 'text/plain;charset=utf-8');
        track('download_txt');
    }

    function saveAsHtml() {
        const doc = `<!DOCTYPE html>
<html lang="${document.documentElement.lang || 'en'}" dir="${document.documentElement.dir || 'ltr'}">
<meta charset="utf-8">
<title>NPad note — ${stamp()}</title>
<style>body{font:16px/1.7 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:42em;margin:3em auto;padding:0 1em;color:#111}</style>
${editor.innerHTML}
`;
        download(`npad-${stamp()}.html`, doc, 'text/html;charset=utf-8');
        track('download_html');
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

    async function clearSaved() {
        const ok = await confirmDialog({
            title: strings.clearTitle,
            message: strings.clearBody,
            confirmLabel: strings.confirm,
            cancelLabel: strings.cancel,
            danger: true,
        });
        if (!ok) return;
        editor.innerHTML = '';
        await clearDocument();
        dirty = false;
        setSaveState('saved');
        updateCounts();
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
                        const blob = await item.getType('text/html');
                        insertHtml(sanitizeHtml(await blob.text()));
                        finishPaste(plainOnly);
                        return;
                    }
                }
            }
            const text = await navigator.clipboard.readText();
            insertHtml(textToHtml(text));
            finishPaste(plainOnly);
        } catch {
            toast(strings.pasteBlocked, 'error');
        }
    }

    function finishPaste(plainOnly) {
        scheduleSave();
        updateCounts();
        track(plainOnly ? 'paste_plain_used' : 'paste_used');
    }

    /* ---------------------------------------------------------------------
       Menu wiring + keyboard shortcuts
       --------------------------------------------------------------------- */

    const actions = {
        new: newFile,
        open: openFile,
        save: saveAsText,
        'save-html': saveAsHtml,
        print: printFile,
        details: showDetails,
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
        } else if (key === 'z' && event.shiftKey) {
            // Chrome does not map Ctrl+Shift+Z to redo inside contenteditable.
            if (editor.contains(document.activeElement)) {
                event.preventDefault();
                exec('redo');
            }
        }
    });

    /* ---------------------------------------------------------------------
       Boot
       --------------------------------------------------------------------- */

    editor.addEventListener('input', () => {
        updateCounts();   // immediate, not debounced
        scheduleSave();
    });

    (async () => {
        const record = await loadDocument();
        if (record && record.html) {
            editor.innerHTML = sanitizeHtml(record.html);
            lastSavedAt = record.updatedAt || 0;
        }
        updateCounts();
        setSaveState('saved');
        syncToolbarState();
    })();

    window.addEventListener('online', () => setSaveState(dirty ? 'unsaved' : 'saved'));
    window.addEventListener('offline', () => setSaveState('offline'));
}
