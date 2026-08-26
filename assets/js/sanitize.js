/**
 * HTML sanitiser for content entering the editor.
 *
 * Applies to restored IndexedDB documents, pasted clipboard HTML and opened
 * .html files. This is a small allow-list cleaner with no dependencies:
 * anything not explicitly permitted is unwrapped or dropped.
 */

const ALLOWED_TAGS = new Set([
    'A', 'B', 'BLOCKQUOTE', 'BR', 'CAPTION', 'CODE', 'DETAILS', 'DIV', 'EM',
    'FONT', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'I', 'INPUT', 'LI',
    'MARK', 'MATH-BLOCK', 'MATH-INLINE', 'OL', 'P',
    'PRE', 'S', 'SPAN', 'STRIKE', 'STRONG', 'SUB', 'SUMMARY', 'SUP',
    'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'U', 'UL',
]);

const ALLOWED_ATTRS = {
    A: new Set(['href', 'title', 'target', 'rel']),
    CODE: new Set(['class']),
    DETAILS: new Set(['open']),
    FONT: new Set(['color', 'face', 'size']),
    INPUT: new Set(['type', 'checked', 'disabled']),
    LI: new Set(['class']),
    TD: new Set(['colspan', 'rowspan']),
    TH: new Set(['colspan', 'rowspan', 'scope']),
    UL: new Set(['class']),
    '*': new Set(['style', 'align', 'dir']),
};

/** Checklists are the only lists that may carry the marker class. */
const LIST_CLASS = /^checklist$/;
/** Task items keep only their checked marker. */
const LI_CLASS = /^task-checked$/;

/**
 * Math formulas (`<math-inline>`, `<math-block>`) keep their LaTeX source as
 * plain text content — the runtime renderer paints KaTeX output over it and
 * strips it back off before saving. The tags carry no permitted attributes,
 * so pasted copies cannot smuggle anything in.
 */

/**
 * Code blocks carry their language as `class="language-js"` for the syntax
 * highlighter. Only that one shape is kept, and the language id is bounded,
 * so a crafted class list cannot smuggle in app-level hooks like spell marks
 * or search matches.
 */
const CODE_CLASS = /^(?:language-)?plain$|^language-[a-z0-9_+.#-]{1,24}$/i;

/** Declarations we keep from inline style attributes. */
const ALLOWED_STYLES = new Set([
    'color', 'background-color', 'font-family', 'font-size', 'font-weight',
    'font-style', 'text-align', 'text-decoration', 'text-decoration-line',
    'margin-left', 'margin-right', 'padding-left', 'padding-right', 'direction',
    'width', 'min-width', 'max-width', 'border', 'border-collapse',
    'border-color', 'border-style', 'border-width', 'vertical-align',
]);

const SAFE_URL = /^(https?:|mailto:|tel:|#|\/)/i;

function sanitiseStyle(value) {
    return value
        .split(';')
        .map((decl) => decl.trim())
        .filter(Boolean)
        .filter((decl) => {
            const [prop, val = ''] = decl.split(':');
            const propName = prop.trim().toLowerCase();
            if (!propName || !val.trim() || !ALLOWED_STYLES.has(propName)) return false;
            // url() can smuggle a request; expressions are legacy IE script.
            return !/url\s*\(|expression\s*\(|javascript:/i.test(val);
        })
        .join('; ');
}

function cleanElement(el) {
    const tag = el.tagName;

    // Checkbox inputs only exist as checklist items; anything else is dropped
    // rather than unwrapped (an input has no content to preserve). Read the
    // RAW class attribute: descendants are cleaned before their ancestors,
    // so the list may not carry its cleaned class yet.
    if (tag === 'INPUT') {
        const list = el.closest('ul, ol');
        const classes = (list?.getAttribute('class') || '').split(/\s+/);
        if (!classes.includes('checklist')) {
            el.remove();
            return;
        }
    }

    // Unwrap unknown elements but keep their text, so pasting from Word or
    // Google Docs preserves the words rather than deleting them. Void nodes
    // such as retired image markup disappear naturally because they have no
    // child content to preserve.
    if (!ALLOWED_TAGS.has(tag)) {
        const parent = el.parentNode;
        if (!parent) return;
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
        return;
    }

    for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        const permitted = (ALLOWED_ATTRS[tag] && ALLOWED_ATTRS[tag].has(name))
            || ALLOWED_ATTRS['*'].has(name);

        if (!permitted) {
            el.removeAttribute(attr.name);
            continue;
        }

        if (name === 'href') {
            if (!SAFE_URL.test(attr.value.trim())) el.removeAttribute(attr.name);
            continue;
        }

        if (name === 'class' && (tag === 'UL' || tag === 'OL')) {
            const kept = attr.value.split(/\s+/).filter((token) => LIST_CLASS.test(token));
            if (kept.length) el.setAttribute('class', 'checklist');
            else el.removeAttribute('class');
            continue;
        }

        if (name === 'class' && tag === 'LI') {
            const kept = attr.value.split(/\s+/).filter((token) => LI_CLASS.test(token));
            if (kept.length) el.setAttribute('class', 'task-checked');
            else el.removeAttribute('class');
            continue;
        }

        if (tag === 'INPUT') {
            if (name === 'type') {
                if (attr.value.trim().toLowerCase() === 'checkbox') el.setAttribute('type', 'checkbox');
                else { el.remove(); return; }
            } else if (name === 'checked' || name === 'disabled') {
                el.setAttribute(name, '');
            }
            continue;
        }

        if (name === 'open' && tag === 'DETAILS') {
            el.setAttribute('open', '');
            continue;
        }

        if (name === 'class' && tag === 'CODE') {
            const kept = attr.value.split(/\s+/).filter((token) => CODE_CLASS.test(token));
            if (kept.length === 1) el.setAttribute('class', kept[0]);
            else el.removeAttribute('class');
            continue;
        }

        if (name === 'style') {
            const cleaned = sanitiseStyle(attr.value);
            if (cleaned) el.setAttribute('style', cleaned);
            else el.removeAttribute('style');
        }

        // Table spans are bounded so a malformed paste cannot ask a browser
        // to lay out a 9999-column grid that freezes the tab.
        if ((tag === 'TD' || tag === 'TH') && (name === 'colspan' || name === 'rowspan')) {
            const span = Number.parseInt(attr.value, 10);
            if (!Number.isInteger(span) || span < 1 || span > 100) {
                el.removeAttribute(attr.name);
                continue;
            }
            el.setAttribute(name, String(span));
        }

        if (tag === 'TH' && name === 'scope') {
            if (!['col', 'row', 'colgroup', 'rowgroup'].includes(attr.value.trim().toLowerCase())) {
                el.removeAttribute(attr.name);
            }
        }
    }

    // Any link that opens a new tab must not hand over window.opener.
    if (tag === 'A' && el.getAttribute('target') === '_blank') {
        el.setAttribute('rel', 'noopener noreferrer');
    }
}

/**
 * @param {string} dirty
 * @returns {string} sanitised HTML
 */
export function sanitizeHtml(dirty) {
    if (!dirty) return '';

    // <template> parses without executing scripts or loading resources.
    const template = document.createElement('template');
    template.innerHTML = String(dirty);

    // <input> is handled by cleanElement (checklist checkboxes only);
    // everything else here is active or foreign content.
    template.content
        .querySelectorAll('script, style, iframe, object, embed, link, meta, form, button, svg, math')
        .forEach((node) => node.remove());

    // Walk a static list bottom-up so unwrapping never invalidates iteration.
    const elements = Array.from(template.content.querySelectorAll('*')).reverse();
    elements.forEach(cleanElement);

    return template.innerHTML;
}

/**
 * Escape plain text for safe insertion as HTML, preserving line breaks.
 * @param {string} text
 */
export function textToHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text ?? '');
    return div.innerHTML.replace(/\r?\n/g, '<br>');
}
