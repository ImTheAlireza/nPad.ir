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
import { initSpellcheck } from './spellcheck.js';

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

    /* Find & replace bar (guarded: the markup ships with the editor page). */
    const findBar = document.getElementById('findBar');
    const findInput = findBar && findBar.querySelector('[data-find-input]');
    const replaceInput = findBar && findBar.querySelector('[data-find-replace]');
    const findCount = findBar && findBar.querySelector('#findCount');
    const findReplaceRow = document.getElementById('findReplaceRow');

    /* View toggles. */
    const focusBtn = document.querySelector('[data-action="toggle-focus"]');
    const dirBtn = document.querySelector('[data-action="dir-rtl"]');
    const spellBtn = document.querySelector('[data-action="toggle-spellcheck"]');

    let saveTimer = null;
    let dirty = false;
    let lastSavedAt = 0;

    /* Custom spell checker (self-contained module). */
    const spell = initSpellcheck({ editor, strings, onEvent: track });

    /**
     * Editor HTML without transient spell-check marks, for storage and
     * exports. Marks are re-applied automatically after restore.
     */
    function cleanHtml() {
        const clone = editor.cloneNode(true);
        clone.querySelectorAll('.spell-err').forEach((el) => {
            el.replaceWith(document.createTextNode(el.textContent));
        });
        return clone.innerHTML;
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
        const html = cleanHtml();
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
        const html = cleanHtml();
        saveDocumentSync(html);
        void saveDocument(html);
        dirty = false;
    }

    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
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

    async function openColourPicker(button) {
        rememberEditorSelection();
        const command = button.dataset.colorCommand;
        const initial = normaliseHex(button.dataset.color) ?? '#000000';
        const title = command === 'hiliteColor' ? strings.highlightColour : strings.textColour;
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
${cleanHtml()}
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

    /* ---------------------------------------------------------------------
       Find & replace (Ctrl+F / Ctrl+H)
       --------------------------------------------------------------------- */

    let findMatches = [];
    let findIndex = -1;

    const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    function findTextNodes(root) {
        // 4 === NodeFilter.SHOW_TEXT. The named constant is undefined in some
        // embedded runtimes (jsdom, older webviews), so use the literal.
        const nodes = [];
        const walker = document.createTreeWalker(root, 4);
        let node;
        while ((node = walker.nextNode())) {
            if (node.nodeValue && node.nodeValue.length) nodes.push(node);
        }
        return nodes;
    }

    /**
     * Every occurrence of the query, in document order, as ranges.
     * Matches may span text nodes (e.g. a phrase split by bold markup);
     * each range records its exact start and end node/offset.
     */
    function computeFindMatches(query) {
        const nodes = findTextNodes(editor);
        const starts = new Array(nodes.length);
        let combined = '';
        for (let i = 0; i < nodes.length; i++) {
            starts[i] = combined.length;
            combined += nodes[i].nodeValue;
        }

        const matches = [];
        if (!query) return matches;

        const re = new RegExp(escapeRegExp(query), 'gi');
        let m;
        while ((m = re.exec(combined)) !== null) {
            const start = m.index;
            const end = m.index + m[0].length;

            let si = 0;
            while (si < nodes.length - 1 && starts[si + 1] <= start) si++;
            let ei = si;
            while (ei < nodes.length - 1 && starts[ei + 1] < end) ei++;

            matches.push({
                startNode: nodes[si],
                startOffset: start - starts[si],
                endNode: nodes[ei],
                endOffset: end - starts[ei],
            });

            if (m.index === re.lastIndex) re.lastIndex++; // no zero-length spin
        }
        return matches;
    }

    function selectFindMatch(match) {
        const range = document.createRange();
        range.setStart(match.startNode, match.startOffset);
        range.setEnd(match.endNode, match.endOffset);

        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);

        // Bring an out-of-viewport match into view.
        const rect = typeof range.getBoundingClientRect === 'function'
            ? range.getBoundingClientRect()
            : null;
        const viewport = window.innerHeight || document.documentElement.clientHeight;
        if (rect && (rect.top < 0 || rect.bottom > viewport)) {
            window.scrollBy(0, rect.top - Math.max(viewport * 0.25, 60));
        }
    }

    function renderFindCount() {
        if (!findCount) return;
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
        const query = findInput.value.trim();

        if (!query) {
            findMatches = [];
            findIndex = -1;
            if (findCount) findCount.textContent = '';
            window.getSelection().removeAllRanges();
            return;
        }

        findMatches = computeFindMatches(query);
        if (!findMatches.length) {
            findIndex = -1;
            window.getSelection().removeAllRanges();
            renderFindCount();
            return;
        }

        // On a fresh query, prefer the first match at or after the caret so
        // "find next" starts where the user is looking.
        // Range.END_TO_START === -1. Resolve from whichever global exposes
        // the constructor — jsdom validates the constant by identity, and in
        // some embedded runtimes only window.Range exists.
        const RangeCtor = (typeof Range !== 'undefined' ? Range : window.Range) || null;
        const END_TO_START = RangeCtor ? RangeCtor.END_TO_START : -1;
        let next = 0;
        if (fromCaret) {
            const selection = window.getSelection();
            if (selection && selection.rangeCount && editor.contains(selection.anchorNode)) {
                const caret = selection.getRangeAt(0);
                for (let i = 0; i < findMatches.length; i++) {
                    const probe = document.createRange();
                    probe.setStart(findMatches[i].startNode, findMatches[i].startOffset);
                    probe.setEnd(findMatches[i].endNode, findMatches[i].endOffset);
                    if (caret.compareBoundaryPoints(END_TO_START, probe) <= 0) {
                        next = i;
                        break;
                    }
                }
            }
        }
        findIndex = Math.min(next, findMatches.length - 1);
        selectFindMatch(findMatches[findIndex]);
        renderFindCount();
    }

    function stepFind(direction) {
        if (!findMatches.length) return;
        findIndex = (findIndex + direction + findMatches.length) % findMatches.length;
        selectFindMatch(findMatches[findIndex]);
        renderFindCount();
    }

    function openFind(replaceMode = false) {
        if (!findBar) return;
        track('find_used');
        findBar.hidden = false;
        if (findReplaceRow) findReplaceRow.hidden = !replaceMode;
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
        findMatches = [];
        findIndex = -1;
        if (findCount) findCount.textContent = '';
        editor.focus();
    }

    function replaceCurrentMatch() {
        const match = findMatches[findIndex];
        if (!match || !replaceInput) return;
        const value = replaceInput.value;

        const range = document.createRange();
        range.setStart(match.startNode, match.startOffset);
        range.setEnd(match.endNode, match.endOffset);
        range.deleteContents();

        const selection = window.getSelection();
        if (value) {
            const textNode = document.createTextNode(value);
            range.insertNode(textNode);
            const after = document.createRange();
            after.setStart(textNode, textNode.length);
            after.collapse(true);
            selection.removeAllRanges();
            selection.addRange(after);
        } else {
            selection.removeAllRanges();
        }

        editor.dispatchEvent(new Event('input', { bubbles: true }));
        refreshFind(false);
    }

    function replaceAllMatches() {
        if (!findInput || !replaceInput) return;
        const query = findInput.value.trim();
        if (!query) return;
        const value = replaceInput.value;

        // Reverse order keeps earlier node references valid as we edit.
        const matches = computeFindMatches(query);
        for (let i = matches.length - 1; i >= 0; i--) {
            const range = document.createRange();
            range.setStart(matches[i].startNode, matches[i].startOffset);
            range.setEnd(matches[i].endNode, matches[i].endOffset);
            range.deleteContents();
            if (value) range.insertNode(document.createTextNode(value));
        }

        if (matches.length) {
            editor.dispatchEvent(new Event('input', { bubbles: true }));
        }
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
        find: () => openFind(false),
        'find-replace': () => openFind(true),
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

    // Escape: close the find bar first, then leave focus mode.
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (findBar && !findBar.hidden) {
            event.preventDefault();
            closeFind();
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
        // When a size is chosen at a collapsed caret, the browser creates its
        // temporary size=7 wrapper only after the first character is typed.
        if (pendingFontSize) convertSizeMarkers(pendingFontSize);
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

        // Restore view options (silent: booting into focus mode is not an event).
        try {
            if (localStorage.getItem('npad.focusMode') === '1') applyFocusMode(true, true);
            const savedDir = localStorage.getItem('npad.editorDir');
            if (savedDir === 'ltr' || savedDir === 'rtl') applyDir(savedDir);
            else syncDirButtons(currentDir());
            spell.refresh();
        } catch { /* private mode */ }
    })();

    window.addEventListener('online', () => setSaveState(dirty ? 'unsaved' : 'saved'));
    window.addEventListener('offline', () => setSaveState('offline'));
}
