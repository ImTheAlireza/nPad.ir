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

import { confirmDialog, showDialog, toast } from './ui.js';

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

/* ---------------------------------------------------------------------
   Language autodetection
   --------------------------------------------------------------------- */

/** Count non-overlapping matches, capped so long files cannot dominate. */
function hits(pattern, sample, cap = 6) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    const matches = sample.match(new RegExp(pattern.source, flags));
    return matches ? Math.min(matches.length, cap) : 0;
}

const DETECT_MIN_SAMPLE = 12;   // too short to guess — stay plain
const DETECT_MIN_SCORE = 18;    // below this the guess is not trustworthy
const DETECT_SAMPLE_SIZE = 10000;

const DETECTORS = [
    ['json', (s) => {
        const trimmed = s.trim();
        if (!/^[{[]/.test(trimmed) || !/[}\]]$/.test(trimmed)) return 0;
        try { JSON.parse(trimmed); return 100; } catch { return 0; }
    }],
    ['diff', (s) => hits(/^diff --git /m, s, 2) * 25
        + (/^--- [^\n]+\n\+\+\+ /m.test(s) || /^@@ -\d/m.test(s) ? 30 : 0)],
    ['docker', (s) => hits(/^\s*(?:FROM|RUN|CMD|ENTRYPOINT|COPY|ADD|ENV|WORKDIR|EXPOSE)\s/m, s) * 10],
    ['php', (s) => (/<\?(?:php|=)/.test(s) ? 60 : 0)],
    ['bash', (s) => (/^#!.*\b(?:ba|z|k)?sh\b/.test(s) ? 45 : 0)
        + hits(/^\s*(?:sudo|apt-get|apt|brew|pip3?|npm|npx|yarn|git|curl|wget|mkdir|chmod|grep|cd|ls|export|source)\s/m, s) * 6],
    ['html', (s) => (/<!DOCTYPE\s+html/i.test(s) ? 50 : 0)
        + hits(/<\/(?:div|p|span|html|body|head|section|article|nav|ul|ol|li|a|table|tr|td|h[1-6])>/gi, s) * 6],
    ['xml', (s) => (/^\s*<\?xml/.test(s) ? 40 : 0)],
    ['python', (s) => hits(/^\s*def\s+\w+\s*\([^)]*\)\s*:/m, s, 5) * 20
        + hits(/^\s*class\s+\w+(?:\([^)]*\))?\s*:/m, s, 3) * 15
        + (/(?:^|\s)(?:elif|__name__)|from\s+\w+\s+import\s+\w+/.test(s) ? 15 : 0)
        + hits(/^\s*(?:import|from)\s+\w+/m, s, 4) * 6
        + hits(/^\s*print\(/m, s, 4) * 4],
    ['ruby', (s) => hits(/^\s*def\s+\w+\s*(?:$|[^()])/m, s, 5) * 15
        + (/\battr_(?:accessor|reader|writer)\b/.test(s) ? 25 : 0)
        + hits(/\bputs\b/g, s, 4) * 5
        + hits(/^\s*require(?:_relative)?\s/m, s, 3) * 8
        + (/^\s*end\s*$/m.test(s) ? 10 : 0)],
    ['go', (s) => (/\bpackage\s+\w+/.test(s) ? 30 : 0)
        + hits(/\bfunc\s+(?:\w+\s*\(|\([^)]*\)\s*\w+\s*\()/g, s, 5) * 10
        + (/\bfmt\./.test(s) ? 12 : 0)
        + (/:=/.test(s) ? 5 : 0)],
    ['rust', (s) => hits(/\bfn\s+\w+\s*\(/g, s, 5) * 12
        + (s.includes('println!') ? 30 : 0)
        + (/\blet\s+mut\b/.test(s) ? 20 : 0)
        + (/\bimpl\s+\w+/.test(s) ? 12 : 0)
        + (/\bmatch\s+\w+\s*\{/.test(s) ? 8 : 0)],
    ['java', (s) => hits(/\bpublic\s+(?:final\s+|abstract\s+|static\s+)*(?:class|void|interface|enum)\b/g, s, 4) * 20
        + (s.includes('System.out.print') ? 25 : 0)
        + (/\bthrows\s+\w+/.test(s) ? 10 : 0)],
    ['csharp', (s) => (/\busing\s+System\b/.test(s) ? 30 : 0)
        + (/\bnamespace\s+[\w.]+/.test(s) ? 18 : 0)
        + (/\bConsole\./.test(s) ? 18 : 0)],
    ['cpp', (s) => hits(/#include\s*<(?:iostream|vector|string|map|set|memory|algorithm|queue|unordered_map)>/g, s, 3) * 18
        + hits(/\bstd::/g, s) * 10
        + (/\b(?:cout|cin)\s*(?:<<|>>)/.test(s) ? 20 : 0)],
    ['c', (s) => hits(/#include\s*<\w+\.h>/g, s, 3) * 15
        + (/\bprintf\s*\(/.test(s) ? 15 : 0)
        + (/\bmalloc\s*\(|\bstruct\s+\w+\s*\{/.test(s) ? 10 : 0)],
    ['kotlin', (s) => (/\bfun\s+main\s*\(/.test(s) ? 35 : 0)
        + hits(/\bfun\s+\w+\s*\(/g, s, 4) * 8
        + (/\bdata class\b/.test(s) ? 20 : 0)
        + hits(/\b(?:val|var)\s+\w+/g, s, 4) * 4],
    ['swift', (s) => (/\bimport\s+(?:Foundation|SwiftUI|UIKit)\b/.test(s) ? 30 : 0)
        + (/\bguard\s+let\b/.test(s) ? 22 : 0)
        + hits(/\bfunc\s+\w+\s*\(/g, s, 4) * 8
        + hits(/\b(?:let|var)\s+\w+\s*[:=]/g, s, 4) * 4],
    ['typescript', (s) => hits(/:\s*(?:string|number|boolean|void|any|unknown)\b/g, s, 5) * 12
        + hits(/\binterface\s+\w+/g, s, 3) * 18
        + hits(/\btype\s+\w+\s*=/g, s, 3) * 12
        + (/\bimplements\b/.test(s) ? 10 : 0)
        + (/\benum\s+\w+\s*\{/.test(s) ? 12 : 0)],
    ['javascript', (s) => hits(/\b(?:const|let)\s+\w+\s*=/g, s, 5) * 8
        + hits(/\bfunction\s+\w+\s*\(/g, s, 4) * 8
        + hits(/\bconsole\.(?:log|error|warn)\(/g, s, 3) * 10
        + hits(/\brequire\(['"]/g, s, 3) * 8
        + hits(/\bimport\s+[^;\n]+\s+from\s+['"]/g, s, 3) * 8
        + hits(/\bdocument\.\w+/g, s, 3) * 5
        + (s.includes('=>') ? 6 : 0)],
    ['css', (s) => hits(/[@#.]?[\w-]+\s*\{[^{}]*\}/g, s, 4) * 10
        + (/@(?:media|import|keyframes|font-face)\b/.test(s) ? 15 : 0)],
    ['sql', (s) => hits(/\b(?:SELECT\s+[^;\n]+\s+FROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+(?:TABLE|INDEX|VIEW)|ALTER\s+TABLE|DROP\s+TABLE)\b/gi, s, 4) * 20
        + hits(/\b(?:JOIN|WHERE|GROUP\s+BY|ORDER\s+BY|HAVING)\b/gi, s, 4) * 6],
    ['toml', (s) => hits(/^\s*\[[\w."'-]+\]\s*$/m, s, 4) * 18
        + hits(/^\s*\w[\w-]*\s*=\s*\S/m, s, 4) * 4],
    ['ini', (s) => hits(/^\s*\[[\w.-]+\]\s*$/m, s, 4) * 12
        + hits(/^\s*[\w.-]+\s*=\s*\S/m, s, 4) * 6],
    ['yaml', (s) => hits(/^\s*[\w"'][\w\s"'.-]*:\s*(?:\S|$)/m, s) * 8
        + hits(/^\s*-\s+\S/m, s, 5) * 6],
    ['markdown', (s) => hits(/^#{1,6}\s+\S/m, s, 4) * 10
        + (/\*\*[^*\n]+\*\*/.test(s) ? 8 : 0)
        + hits(/^\s*[-*+]\s+\[[ xX]\]/m, s, 2) * 15
        + hits(/^\s*[-*+]\s+\S/m, s, 4) * 4
        + hits(/\[[^\]\n]+\]\([^)\n]+\)/g, s, 3) * 6],
];

/**
 * Guess the highlight language of a code sample.
 * @returns {string} a bundled language id, or '' when nothing is convincing
 */
export function detectLanguage(text) {
    const source = String(text ?? '');
    if (source.trim().length < DETECT_MIN_SAMPLE) return '';
    const sample = source.slice(0, DETECT_SAMPLE_SIZE);

    let best = '';
    let bestScore = 0;
    for (const [id, score] of DETECTORS) {
        let value = 0;
        try { value = score(sample); } catch { value = 0; }
        if (value > bestScore) {
            best = id;
            bestScore = value;
        }
    }
    return bestScore >= DETECT_MIN_SCORE ? best : '';
}

/* Same 24×24 stroke grid as includes/icons.php. */
const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
    + '<rect x="9" y="9" width="12" height="12" rx="2"/>'
    + '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'
    + '</svg>';

const DELETE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
    + '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/>'
    + '<path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/>'
    + '<path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>'
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
            // Prism marks the pre with tabindex=0 for keyboard scrolling; here
            // the scroll lives on the code element and a focusable pre swallows
            // clicks aimed at the padding, so take the attribute back off.
            if (pre.getAttribute('tabindex') === '0') pre.removeAttribute('tabindex');
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

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'codeblock-delete';
            deleteBtn.innerHTML = DELETE_ICON;
            deleteBtn.addEventListener('mousedown', (event) => event.preventDefault());
            deleteBtn.addEventListener('click', (event) => {
                event.preventDefault();
                removeBlockWithConfirm(pre);
            });

            chrome.append(langBtn, copyBtn, deleteBtn);
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

        const deleteBtn = chrome.querySelector('.codeblock-delete');
        if (deleteBtn) {
            deleteBtn.setAttribute('aria-label', strings.codeDelete || 'Delete code block');
            deleteBtn.title = strings.codeDelete || 'Delete code block';
        }
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
       Editing: Tab indents, Enter breaks a line, Enter/Backspace at the
       boundaries enter and remove the block
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

    const isBlockish = (el) => /^(P|DIV|H[1-6]|UL|OL|BLOCKQUOTE|PRE|TABLE|HR)$/.test(el?.tagName || '');

    /**
     * True when a collapsed caret sits exactly at one end of the code.
     *
     * Deliberately not compareBoundaryPoints(): some engines (jsdom, older
     * webviews) score the equivalent points (code, 0) and (text, 0) as
     * different, which would make the caret think it is never at an edge.
     */
    function caretAtEdge(selection, code, atEnd) {
        if (!selection.isCollapsed) return false;
        const range = selection.getRangeAt(0);
        const container = range.startContainer;
        const offset = range.startOffset;

        const childIndexOf = (parent, node) => {
            let index = 0;
            for (let child = parent.firstChild; child; child = child.nextSibling) {
                if (child === node) break;
                index += 1;
            }
            return index;
        };

        const walker = document.createTreeWalker(code, 4);
        let node;
        while ((node = walker.nextNode())) {
            if (node === container) {
                if (atEnd) {
                    if (offset < (container.nodeValue || '').length) return false;
                } else if (offset > 0) {
                    return false;
                }
                continue;
            }
            const pos = container.compareDocumentPosition(node);
            if (pos & window.Node.DOCUMENT_POSITION_CONTAINED_BY) {
                // node lives inside the caret's container: compare indexes
                const index = childIndexOf(container, node);
                if (atEnd ? index >= offset : index < offset) return false;
            } else if (atEnd) {
                if (pos & window.Node.DOCUMENT_POSITION_FOLLOWING) return false;
            } else if (pos & window.Node.DOCUMENT_POSITION_PRECEDING) {
                return false;
            }
        }
        return true;
    }

    /** Leave the block: caret into the next paragraph, one trailing newline goes. */
    function exitBlock(pre) {
        const code = pre.querySelector('code');
        if (code) {
            const text = code.textContent || '';
            // Exiting from an empty last line must not leave it behind.
            if (text.endsWith('\n')) code.textContent = text.replace(/\n$/, '');
        }
        let target = pre.nextElementSibling;
        if (!editor.contains(target) || (target.tagName !== 'P' && target.tagName !== 'DIV')) {
            const spacer = document.createElement('p');
            spacer.appendChild(document.createElement('br'));
            if (editor.contains(target) && isBlockish(target)) target.before(spacer);
            else pre.after(spacer);
            target = spacer;
        }
        editor.focus();
        const selection = window.getSelection();
        const range = document.createRange();
        range.setStart(target, 0);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        syncSelection();
        edited();
    }

    /** Remove the whole block through the browser's undoable delete. */
    function removeBlock(pre) {
        const next = pre.nextElementSibling; // captured before the removal
        editor.focus();
        const range = document.createRange();
        range.selectNode(pre);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        let handled = false;
        try {
            handled = document.execCommand('delete') === true && !editor.contains(pre);
        } catch {
            handled = false;
        }
        if (!handled) pre.remove();

        let target = null;
        if (next && editor.contains(next) && (next.tagName === 'P' || next.tagName === 'DIV')) {
            target = next;
        } else {
            const last = editor.lastElementChild;
            if (last && (last.tagName === 'P' || last.tagName === 'DIV')) {
                target = last;
            } else {
                const spacer = document.createElement('p');
                spacer.appendChild(document.createElement('br'));
                if (next && editor.contains(next) && isBlockish(next)) next.before(spacer);
                else editor.appendChild(spacer);
                target = spacer;
            }
        }
        const caret = document.createRange();
        caret.setStart(target, 0);
        caret.collapse(true);
        selection.removeAllRanges();
        selection.addRange(caret);
        syncSelection();
        edited();
    }

    async function removeBlockWithConfirm(pre) {
        const action = await confirmDialog({
            title: strings.codeDeleteTitle || 'Delete this code block?',
            message: strings.codeDeleteBody || 'The code and its language setting will be removed.',
            confirmLabel: strings.confirm || 'Delete',
            cancelLabel: strings.cancel || 'Cancel',
            danger: true,
        });
        if (!action || !editor.contains(pre)) return;
        removeBlock(pre);
    }

    /**
     * Keyboard model inside a code block:
     *  - Tab indents; Shift+Tab keeps its focus-navigation role
     *  - Enter inserts a newline — except at the very end of the block (and
     *    on Ctrl/Cmd+Enter anywhere), where it hands the caret to the next
     *    paragraph; Shift+Enter always breaks a line
     *  - Backspace/Delete on an emptied block remove the whole block; at the
     *    edges of a non-empty one they no-op instead of merging blocks
     */
    function handleKeydown(event) {
        const key = event.key;
        if (key !== 'Tab' && key !== 'Enter' && key !== 'Backspace' && key !== 'Delete') return false;

        const selection = window.getSelection();
        if (!selection?.rangeCount) return false;
        const start = selection.getRangeAt(0).startContainer;
        const pre = closestPre(start);
        const code = pre?.querySelector('code');
        if (!pre || !code || !code.contains(start)) return false;
        // Keystrokes aimed at the chrome keep their default behaviour. The
        // editor host itself counts as "inside the code": a focused
        // contenteditable host is its own activeElement.
        const active = document.activeElement;
        if (active && active !== editor && active !== document.body
            && editor.contains(active) && !code.contains(active)) return false;

        const isEmpty = !(code.textContent || '').trim();

        if (key === 'Tab') {
            if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
            event.preventDefault();
            event.stopPropagation();
            insertPlainText('\t');
            return true;
        }

        if (key === 'Enter') {
            if (event.altKey) return false;
            event.preventDefault();
            event.stopPropagation();
            if (event.ctrlKey || event.metaKey || (!event.shiftKey && caretAtEdge(selection, code, true))) {
                exitBlock(pre);
            } else {
                insertPlainText('\n');
            }
            return true;
        }

        if (event.ctrlKey || event.metaKey || event.altKey) return false;

        if (key === 'Backspace') {
            if (isEmpty) {
                event.preventDefault();
                event.stopPropagation();
                removeBlock(pre);
                return true;
            }
            if (caretAtEdge(selection, code, false)) {
                // Do not let the browser merge the pre into the previous block.
                event.preventDefault();
                event.stopPropagation();
                return true;
            }
            return false;
        }

        // Delete
        if (isEmpty) {
            event.preventDefault();
            event.stopPropagation();
            removeBlock(pre);
            return true;
        }
        if (caretAtEdge(selection, code, true)) {
            // Do not let the browser pull the next block into the code.
            event.preventDefault();
            event.stopPropagation();
            return true;
        }
        return false;
    }

    /* ------------------------------------------------------------------
       Autodetection hooks
       ------------------------------------------------------------------ */

    /** Detect and apply a language for the plain block at the caret, if any. */
    function autodetectCaretBlock() {
        const selection = window.getSelection();
        if (!selection?.rangeCount) return '';
        const pre = closestPre(selection.getRangeAt(0).startContainer);
        const code = pre?.querySelector('code');
        if (!code || langOf(code)) return '';
        const detected = detectLanguage(code.textContent || '');
        if (!detected) return '';
        setClass(code, detected);
        mountChrome(pre);
        edited();
        return detected;
    }

    /**
     * Detect languages for imported HTML (a string), leaving everything else
     * untouched. Only plain blocks are considered, so an explicit language —
     * or an explicit choice of plain — always wins.
     */
    function autodetectHtml(html) {
        const source = String(html ?? '');
        if (!source.includes('<pre')) return source;
        const template = document.createElement('template');
        template.innerHTML = source;
        let changed = false;
        for (const pre of template.content.querySelectorAll('pre')) {
            const code = pre.querySelector('code');
            if (!code || langOf(code)) continue;
            const detected = detectLanguage(code.textContent || '');
            if (detected) {
                setClass(code, detected);
                changed = true;
            }
        }
        return changed ? template.innerHTML : source;
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
        if (pre.getAttribute('tabindex') === '0') pre.removeAttribute('tabindex');
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
        autodetectCaretBlock,
        autodetectHtml,
    };
}
