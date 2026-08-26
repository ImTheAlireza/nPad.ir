/**
 * Code blocks with syntax highlighting.
 *
 * Self-hosted Prism (assets/js/vendor/prism-1.30.0.min.js — no CDN), a
 * monospace surface and a copy button. Follows the same transient-paint rule
 * as the search highlights: the stored note keeps plain
 * `<pre><code class="language-js">…text…</code></pre>`, while token spans and
 * the block chrome (language chip, copy button) exist only in the live DOM and
 * are stripped again before every save and export.
 *
 * While the caret is inside a block it drops back to plain monospace text so
 * typing behaves like any text entry; on leaving, the block re-highlights.
 * Prism itself is loaded lazily — the first note that actually contains a
 * highlighted block pays for the ~75 KB bundle, everyone else never does.
 *
 * The chrome label is painted with CSS `content: attr()`, so it is not a DOM
 * text node: word counts, find, spellcheck, TXT export and selection all see
 * only the code itself, without every walker needing a special case.
 */

import { showDialog, toast } from './ui.js';

/* This file is generated from npm prismjs@1.30.0 and never hand-edited, so it
   is cache-immutable at the server; the version in the name is the bust. */
const PRISM_SRC = '/assets/js/vendor/prism-1.30.0.min.js';

const LANG_PATTERN = /^[a-z0-9_+.#-]{1,24}$/;

/**
 * The languages bundled in prism-1.30.0.min.js, shown in the language picker.
 * Group keys map to localized labels (strings.codeGroup*).
 */
const LANGUAGES = [
    { id: 'markup',     name: 'HTML / XML',  aliases: ['html', 'xml', 'svg'], group: 'web' },
    { id: 'css',        name: 'CSS',         aliases: [],                     group: 'web' },
    { id: 'javascript', name: 'JavaScript',  aliases: ['js'],                 group: 'web' },
    { id: 'typescript', name: 'TypeScript',  aliases: ['ts'],                 group: 'web' },
    { id: 'jsx',        name: 'JSX',         aliases: [],                     group: 'web' },
    { id: 'tsx',        name: 'TSX',         aliases: [],                     group: 'web' },
    { id: 'php',        name: 'PHP',         aliases: [],                     group: 'web' },
    { id: 'markdown',   name: 'Markdown',    aliases: ['md'],                 group: 'web' },
    { id: 'json',       name: 'JSON',        aliases: [],                     group: 'data' },
    { id: 'yaml',       name: 'YAML',        aliases: ['yml'],                group: 'data' },
    { id: 'toml',       name: 'TOML',        aliases: [],                     group: 'data' },
    { id: 'ini',        name: 'INI',         aliases: [],                     group: 'data' },
    { id: 'sql',        name: 'SQL',         aliases: [],                     group: 'data' },
    { id: 'bash',       name: 'Bash / Shell', aliases: ['sh', 'shell'],       group: 'data' },
    { id: 'docker',     name: 'Dockerfile',  aliases: ['dockerfile'],         group: 'data' },
    { id: 'diff',       name: 'Diff / patch', aliases: [],                    group: 'data' },
    { id: 'python',     name: 'Python',      aliases: ['py'],                 group: 'apps' },
    { id: 'ruby',       name: 'Ruby',        aliases: ['rb'],                 group: 'apps' },
    { id: 'go',         name: 'Go',          aliases: [],                     group: 'apps' },
    { id: 'rust',       name: 'Rust',        aliases: [],                     group: 'apps' },
    { id: 'java',       name: 'Java',        aliases: [],                     group: 'apps' },
    { id: 'kotlin',     name: 'Kotlin',      aliases: ['kt', 'kts'],          group: 'apps' },
    { id: 'swift',      name: 'Swift',       aliases: [],                     group: 'apps' },
    { id: 'c',          name: 'C',           aliases: [],                     group: 'apps' },
    { id: 'cpp',        name: 'C++',         aliases: [],                     group: 'apps' },
    { id: 'csharp',     name: 'C#',          aliases: ['cs'],                 group: 'apps' },
];

const CANONICAL = new Map(LANGUAGES.map((lang) => [lang.id, lang]));
const ALIASES = new Map(LANGUAGES.flatMap((lang) => lang.aliases.map((alias) => [alias, lang.id])));

/* Same 24×24 stroke grid as includes/icons.php. */
const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
    + '<rect x="9" y="9" width="12" height="12" rx="2"/>'
    + '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'
    + '</svg>';

/**
 * Wire the feature to one contenteditable root.
 *
 * @param {object}  options
 * @param {Element} options.editor   the contenteditable root
 * @param {object}  options.strings  localized copy (falls back to English)
 * @param {Function} options.onEvent analytics sink
 * @param {Function} options.onEdit  called after user edits (autosave hook)
 */
export function initCodeblocks({ editor, strings = {}, onEvent, onEdit }) {
    const track = typeof onEvent === 'function' ? onEvent : () => {};
    const edited = typeof onEdit === 'function' ? onEdit : () => {};

    /** The block whose code is currently plain because the caret is inside. */
    let activePre = null;
    let switchTimer = 0;
    let prismPromise = null;

    /* ------------------------------------------------------------------
       Prism loading
       ------------------------------------------------------------------ */

    function loadPrism() {
        if (window.Prism?.highlightElement) return Promise.resolve(window.Prism);
        if (prismPromise) return prismPromise;
        prismPromise = new Promise((resolve, reject) => {
            // Manual mode: highlightAll() must never run — this module decides
            // which blocks are painted, and the editor may hold caret state.
            window.Prism = window.Prism || { manual: true };
            window.Prism.manual = true;
            const script = document.createElement('script');
            script.src = PRISM_SRC;
            script.onload = () => (window.Prism?.highlightElement
                ? resolve(window.Prism)
                : reject(new Error('Prism failed to initialise')));
            script.onerror = () => {
                script.remove();
                prismPromise = null; // a later block may retry (e.g. back online)
                reject(new Error('Prism failed to load'));
            };
            document.head.appendChild(script);
        });
        return prismPromise;
    }

    /* ------------------------------------------------------------------
       Language helpers
       ------------------------------------------------------------------ */

    function langOf(code) {
        const match = (code.getAttribute('class') || '').match(/language-([a-z0-9_+.#-]{1,24})/i);
        if (!match) return '';
        const token = match[1].toLowerCase();
        if (token === 'plain') return '';
        return ALIASES.get(token) || token;
    }

    function setClass(code, lang) {
        if (lang && LANG_PATTERN.test(lang) && lang !== 'plain') {
            code.setAttribute('class', `language-${lang}`);
        } else {
            code.removeAttribute('class');
        }
    }

    function displayName(code) {
        const lang = langOf(code);
        return lang ? (CANONICAL.get(lang)?.name || lang) : (strings.codePlainText || 'Text');
    }

    /* ------------------------------------------------------------------
       Paint: token spans on, token spans off
       ------------------------------------------------------------------ */

    /** Replace highlight markup with plain text, preserving the caret's node. */
    function unwrapTokens(code) {
        const tokens = code.querySelectorAll('span.token');
        for (const token of [...tokens].reverse()) {
            token.replaceWith(...token.childNodes);
        }
    }

    function highlightPre(pre) {
        if (pre === activePre || !pre.isConnected) return;
        const code = pre.querySelector('code');
        if (!code) return;
        const lang = langOf(code);
        if (!lang) return;

        loadPrism().then((Prism) => {
            // The document may have moved on while the bundle was loading.
            if (!code.isConnected || pre === activePre) return;
            if (pre.querySelector('code') !== code || langOf(code) !== lang) return;
            try {
                Prism.highlightElement(code);
            } catch {
                /* a grammar edge case must never break editing */
            }
        }).catch(() => {
            /* offline first visit: the block stays plain but editable */
        });
    }

    /* ------------------------------------------------------------------
       Chrome: language chip + copy button (runtime-only, zero text nodes)
       ------------------------------------------------------------------ */

    const chromeOf = (pre) => [...pre.children].find((el) => el.hasAttribute('data-codeblock-chrome'));

    function mountChrome(pre) {
        let chrome = chromeOf(pre);
        if (!chrome) {
            chrome = document.createElement('div');
            chrome.className = 'codeblock-chrome';
            chrome.setAttribute('data-codeblock-chrome', '');
            chrome.setAttribute('contenteditable', 'false');
            chrome.setAttribute('aria-hidden', 'true');

            const langBtn = document.createElement('button');
            langBtn.type = 'button';
            langBtn.className = 'codeblock-lang';
            langBtn.setAttribute('aria-haspopup', 'dialog');
            langBtn.addEventListener('mousedown', (event) => event.preventDefault());
            langBtn.addEventListener('click', (event) => {
                event.preventDefault();
                openLanguageDialog(pre);
            });

            const copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.className = 'codeblock-copy';
            copyBtn.innerHTML = COPY_ICON;
            copyBtn.addEventListener('mousedown', (event) => event.preventDefault());
            copyBtn.addEventListener('click', (event) => {
                event.preventDefault();
                copyCode(pre);
            });

            chrome.append(langBtn, copyBtn);
            pre.appendChild(chrome);
        }

        const code = pre.querySelector('code');
        const name = code ? displayName(code) : '';
        const langBtn = chrome.querySelector('.codeblock-lang');
        // Visible label comes from CSS attr(); the accessible name from here.
        langBtn.dataset.langLabel = name;
        const chipLabel = (strings.codeLangChip || 'Language: {lang}').replace('{lang}', name);
        langBtn.setAttribute('aria-label', chipLabel);
        langBtn.title = strings.codeLangChange || 'Change language';

        const copyBtn = chrome.querySelector('.codeblock-copy');
        copyBtn.setAttribute('aria-label', strings.codeCopy || 'Copy code');
        copyBtn.title = strings.codeCopy || 'Copy code';
        return chrome;
    }

    function unmountChrome(pre) {
        chromeOf(pre)?.remove();
    }

    async function copyCode(pre) {
        const code = pre.querySelector('code');
        const text = ((code || pre).textContent || '').replace(/\n+$/, '');
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
            } else {
                legacyCopy(text);
            }
            track('code_copied');
            toast(strings.codeCopied || 'Code copied', 'success');
            const chrome = chromeOf(pre);
            const copyBtn = chrome?.querySelector('.codeblock-copy');
            if (copyBtn) {
                copyBtn.classList.add('codeblock-copy--done');
                window.setTimeout(() => copyBtn.classList.remove('codeblock-copy--done'), 1500);
            }
        } catch {
            toast(strings.codeCopyFailed || 'Copying is blocked here', 'error');
        }
    }

    function legacyCopy(text) {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        try {
            if (!document.execCommand('copy')) throw new Error('copy rejected');
        } finally {
            area.remove();
        }
    }

    /* ------------------------------------------------------------------
       Language picker
       ------------------------------------------------------------------ */

    async function openLanguageDialog(pre) {
        const code = pre.querySelector('code');
        if (!code) return;
        const current = langOf(code);

        const option = (lang) => `<option value="${lang.id}"${lang.id === current ? ' selected' : ''}>`
            + `${escape(lang.name)}</option>`;
        const group = (key, label) => {
            const langs = LANGUAGES.filter((lang) => lang.group === key);
            return `<optgroup label="${escape(label || key)}">${langs.map(option).join('')}</optgroup>`;
        };

        let select = null;
        const action = await showDialog({
            title: strings.codeLangDialogTitle || 'Code language',
            bodyHtml: `
                <div class="codeblock-langpicker">
                    <label class="codeblock-langpicker__field">
                        <span>${escape(strings.codeLangLabel || 'Language')}</span>
                        <select data-code-lang-select>
                            <option value=""${current ? '' : ' selected'}>${escape(strings.codePlainText || 'Text')}</option>
                            ${group('web', strings.codeGroupWeb)}
                            ${group('data', strings.codeGroupData)}
                            ${group('apps', strings.codeGroupApps)}
                        </select>
                    </label>
                    <p class="codeblock-langpicker__hint">${escape(strings.codeLangHint || '')}</p>
                </div>`,
            buttons: [
                { label: strings.cancel || 'Cancel', action: 'cancel', variant: 'btn--ghost' },
                { label: strings.apply || 'Apply', action: 'apply', variant: 'btn--primary' },
            ],
            onOpen(body) {
                select = body.querySelector('[data-code-lang-select]');
                select?.focus();
            },
        });

        if (action !== 'apply' || !select) return;
        setBlockLanguage(pre, select.value);
    }

    function setBlockLanguage(pre, value) {
        const code = pre.querySelector('code');
        if (!code) return;
        const lang = value ? (ALIASES.get(value) || value).toLowerCase() : '';
        if (lang && !LANG_PATTERN.test(lang)) return;
        setClass(code, lang);
        mountChrome(pre);
        edited(); // persist the class change even while the caret stays inside

        if (pre === activePre) return; // re-highlighted when the caret leaves
        if (lang) highlightPre(pre);
        else unwrapTokens(code);
    }

    const escape = (value) => {
        const div = document.createElement('div');
        div.textContent = String(value ?? '');
        return div.innerHTML;
    };

    /* ------------------------------------------------------------------
       Edit mode: plain while the caret is inside, painted when it leaves
       ------------------------------------------------------------------ */

    function closestPre(node) {
        const element = node.nodeType === 1 ? node : node.parentElement;
        const pre = element?.closest('pre');
        return pre && editor.contains(pre) ? pre : null;
    }

    function applySelectionState() {
        const selection = document.getSelection();
        const pre = selection && selection.rangeCount && editor.contains(selection.anchorNode)
            ? closestPre(selection.anchorNode)
            : null;

        if (pre === activePre) return;
        const previous = activePre;
        activePre = pre;

        if (previous && previous.isConnected) {
            previous.classList.remove('codeblock--editing');
            const code = previous.querySelector('code');
            if (code) {
                unwrapTokens(code);
                highlightPre(previous);
            }
        }
        if (pre) {
            const code = pre.querySelector('code');
            if (code) {
                unwrapTokens(code);
                pre.classList.add('codeblock--editing');
            }
        }
    }

    function syncSelection() {
        window.clearTimeout(switchTimer);
        switchTimer = window.setTimeout(applySelectionState, 120);
    }

    /* ------------------------------------------------------------------
       Editing: Tab indents, Enter breaks a line — inside code only
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

    function handleKeydown(event) {
        if (event.key !== 'Tab' && event.key !== 'Enter') return false;
        if (event.ctrlKey || event.metaKey || event.altKey) return false;
        if (event.key === 'Tab' && event.shiftKey) return false; // keep focus navigation

        const selection = window.getSelection();
        if (!selection?.rangeCount) return false;
        const pre = closestPre(selection.getRangeAt(0).startContainer);
        const code = pre?.querySelector('code');
        if (!pre || !code) return false;
        // Only keystrokes aimed at the code itself; the chip and copy button
        // are outside the code element and keep their default behaviour.
        if (!code.contains(selection.getRangeAt(0).startContainer)) return false;

        event.preventDefault();
        event.stopPropagation();
        insertPlainText(event.key === 'Tab' ? '\t' : '\n');
        return true;
    }

    /* ------------------------------------------------------------------
       Paste / restore normalisation
       ------------------------------------------------------------------ */

    /** Code text with block-ish children flattened to newlines. */
    function flattenedText(root) {
        const BREAKS = new Set(['BR', 'DIV', 'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'BLOCKQUOTE']);
        let out = '';
        (function walk(node) {
            for (const child of node.childNodes) {
                if (child.hasAttribute?.('data-codeblock-chrome')) continue;
                if (child.nodeType === 3) out += child.nodeValue;
                else if (child.nodeType === 1) {
                    if (child.tagName === 'BR') { out += '\n'; continue; }
                    const block = BREAKS.has(child.tagName);
                    if (block && out && !out.endsWith('\n')) out += '\n';
                    walk(child);
                    if (block && out && !out.endsWith('\n')) out += '\n';
                }
            }
        })(root);
        return out;
    }

    function normalisePre(pre) {
        let code = pre.querySelector('code');
        const foreign = [...pre.children].filter((el) => el !== code && !el.hasAttribute('data-codeblock-chrome'));
        const messy = code && [...code.querySelectorAll('*')].some((el) => el.tagName !== 'SPAN');

        if (!code || foreign.length || messy) {
            const lang = code ? langOf(code) : '';
            code = document.createElement('code');
            if (lang) setClass(code, lang);
            code.textContent = flattenedText(pre);
            for (const child of [...pre.childNodes]) {
                if (!child.hasAttribute?.('data-codeblock-chrome')) child.remove();
            }
            pre.appendChild(code);
        } else if (code) {
            unwrapTokens(code);
        }

        if (code) {
            // Canonicalise aliases (`language-js` → `language-javascript`) so
            // the stored form is stable across import/export cycles.
            setClass(code, langOf(code));
        }
    }

    function normalise(root) {
        // With the editor (or nothing) the whole document is the scope; with a
        // single <pre>, only that block.
        const scope = root && root !== editor && root.matches?.('pre')
            ? [root]
            : [...editor.querySelectorAll('pre')];
        for (const pre of scope) normalisePre(pre);
    }

    /* ------------------------------------------------------------------
       Save / export stripping
       ------------------------------------------------------------------ */

    /** Remove all runtime paint from a cloned editor root. */
    function stripRuntime(root) {
        for (const chrome of [...root.querySelectorAll('[data-codeblock-chrome]')]) chrome.remove();
        for (const pre of root.querySelectorAll('pre')) {
            pre.classList.remove('codeblock--editing');
            // Prism marks the container with the language and a scroll
            // tabindex; the stored form keeps both off the pre (the sanitiser
            // drops them from restored notes as well).
            pre.removeAttribute('class');
            pre.removeAttribute('tabindex');
            const code = pre.querySelector('code');
            if (!code) continue;
            // Undo, IME input or an odd engine can leave <br>/<div> inside the
            // code; store those as plain newlines so exports stay faithful.
            const foreign = [...code.querySelectorAll('*')].some((el) => el.tagName !== 'SPAN');
            if (foreign) {
                code.textContent = flattenedText(code);
            } else {
                unwrapTokens(code);
                code.normalize();
            }
            setClass(code, langOf(code));
        }
    }

    /* ------------------------------------------------------------------
       Refresh (note shown, note imported, block inserted)
       ------------------------------------------------------------------ */

    function refreshAll() {
        activePre = null;
        for (const pre of editor.querySelectorAll('pre')) {
            normalisePre(pre);
            mountChrome(pre);
            highlightPre(pre);
        }
        applySelectionState();
    }

    // Edit-mode switching is driven by selection movement, wherever it comes
    // from (typing, clicking, tab-restores, find jumps).
    document.addEventListener('selectionchange', syncSelection);

    return {
        insertKeydown: handleKeydown,
        refreshAll,
        normalise,
        stripRuntime,
        setBlockLanguage,
        syncSelection,
    };
}
