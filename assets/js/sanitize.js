/**
 * HTML sanitiser for content entering the editor.
 *
 * Applies to restored IndexedDB documents, pasted clipboard HTML and opened
 * .html files. The previous build loaded DOMPurify from a CDN and then never
 * called it — restored content went straight into innerHTML unfiltered.
 *
 * This is a small allow-list cleaner with no dependencies: anything not
 * explicitly permitted is unwrapped or dropped.
 */

const ALLOWED_TAGS = new Set([
    'A', 'B', 'BLOCKQUOTE', 'BR', 'CAPTION', 'CODE', 'DIV', 'EM', 'FIGCAPTION',
    'FIGURE', 'FONT', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'I', 'IMG', 'LI',
    'MARK', 'OL', 'P', 'PRE', 'S', 'SPAN', 'STRIKE', 'STRONG', 'SUB', 'SUP',
    'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'U', 'UL',
]);

const ALLOWED_ATTRS = {
    A: new Set(['href', 'title', 'target', 'rel']),
    FONT: new Set(['color', 'face', 'size']),
    TD: new Set(['colspan', 'rowspan']),
    TH: new Set(['colspan', 'rowspan', 'scope']),
    IMG: new Set(['data-npad-img', 'data-npad-props', 'alt', 'title']),
    FIGURE: new Set(['data-npad-figure', 'data-npad-frame', 'data-npad-anchor']),
    SPAN: new Set(['data-npad-frame-clip']),
    '*': new Set(['style', 'align', 'dir']),
};

/** Declarations we keep from inline style attributes. */
const ALLOWED_STYLES = new Set([
    'color', 'background-color', 'font-family', 'font-size', 'font-weight',
    'font-style', 'text-align', 'text-decoration', 'text-decoration-line',
    'margin-left', 'margin-right', 'padding-left', 'padding-right', 'direction',
    'width', 'min-width', 'max-width', 'border', 'border-collapse',
    'border-color', 'border-style', 'border-width', 'vertical-align',
    'height', 'max-height', 'float', 'clear', 'display',
    'position', 'top', 'right', 'bottom', 'left', 'z-index',
    'transform', 'filter', 'opacity', 'overflow',
    'margin', 'margin-top', 'margin-bottom',
    'border-radius', 'box-shadow',
    'object-fit', 'object-position', 'padding-bottom', 'aspect-ratio',
]);

const SAFE_URL = /^(https?:|mailto:|tel:|#|\/)/i;

/** Raster data-URI images only: no SVG (script vector), no remote fetch. */
const SAFE_IMAGE_DATA = /^data:image\/(png|jpeg|gif|webp|avif|bmp);base64,[a-z0-9+/=\s]+$/i;

/* -------------------------------------------------------------------------
   Image object properties (stored as <img data-npad-props="{...}">).
   This is the security boundary: every value is parsed, validated, clamped
   and re-serialised so a malicious paste cannot smuggle unknown keys, CSS
   or huge numbers into a note.
   ------------------------------------------------------------------------- */

const IMAGE_LAYOUTS = new Set(['inline', 'center', 'wrap-left', 'wrap-right', 'top-bottom', 'behind', 'front', 'fixed']);
const IMAGE_ANCHORS = new Set(['paragraph', 'page']);
const IMAGE_RECOLORS = new Set(['none', 'grayscale', 'sepia', 'negative', 'faded', 'cool', 'warm']);

const num = (value, min, max, fallback) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
};

const sizeValue = (value) => {
    const text = String(value ?? '');
    return /^\d+(\.\d+)?(px|%)$/.test(text) ? text : null;
};

const hexColour = (value) => (/^#[\da-f]{6}$/i.test(String(value || '')) ? String(value).toLowerCase() : null);

/**
 * Validate and canonicalise image props JSON. Returns a canonical JSON
 * string, or null when the value is not an object.
 */
export function normaliseImageProps(raw) {
    let parsed;
    try {
        parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    const crop = parsed.crop && typeof parsed.crop === 'object' && !Array.isArray(parsed.crop)
        ? {
            l: num(parsed.crop.l, 0, 40, 0),
            r: num(parsed.crop.r, 0, 40, 0),
            t: num(parsed.crop.t, 0, 40, 0),
            b: num(parsed.crop.b, 0, 40, 0),
        }
        : { l: 0, r: 0, t: 0, b: 0 };
    const margin = parsed.margin && typeof parsed.margin === 'object' && !Array.isArray(parsed.margin)
        ? {
            top: num(parsed.margin.top, 0, 200, 0),
            right: num(parsed.margin.right, 0, 200, 0),
            bottom: num(parsed.margin.bottom, 0, 200, 0),
            left: num(parsed.margin.left, 0, 200, 0),
        }
        : { top: 0, right: 0, bottom: 0, left: 0 };
    const border = parsed.border && typeof parsed.border === 'object' && !Array.isArray(parsed.border)
        ? {
            width: num(parsed.border.width, 0, 20, 0),
            color: hexColour(parsed.border.color) || '#64748b',
            radius: num(parsed.border.radius, 0, 300, 0),
            shadow: !!parsed.border.shadow,
        }
        : { width: 0, color: '#64748b', radius: 0, shadow: false };

    const out = {
        layout: IMAGE_LAYOUTS.has(parsed.layout) ? parsed.layout : 'inline',
        anchor: IMAGE_ANCHORS.has(parsed.anchor) ? parsed.anchor : 'paragraph',
        width: sizeValue(parsed.width),
        height: sizeValue(parsed.height),
        rotate: num(parsed.rotate, -360, 360, 0),
        flipH: !!parsed.flipH,
        flipV: !!parsed.flipV,
        crop,
        margin,
        recolor: IMAGE_RECOLORS.has(parsed.recolor) ? parsed.recolor : 'none',
        opacity: num(parsed.opacity, 0, 100, 100),
        brightness: num(parsed.brightness, 25, 300, 100),
        contrast: num(parsed.contrast, 25, 300, 100),
        border,
        pos: {
            x: num(parsed.pos?.x, -4000, 4000, 0),
            y: num(parsed.pos?.y, -4000, 4000, 0),
        },
    };
    return JSON.stringify(out);
}

const LAYOUT_STYLE_TAGS = new Set(['IMG', 'FIGURE', 'SPAN']);
const LAYOUT_ONLY_STYLES = new Set(['position', 'top', 'right', 'bottom', 'left', 'z-index']);

function sanitiseStyle(value, tag = '') {
    return value
        .split(';')
        .map((decl) => decl.trim())
        .filter(Boolean)
        .filter((decl) => {
            const [prop, val = ''] = decl.split(':');
            const propName = prop.trim().toLowerCase();
            if (!propName || !val.trim()) return false;
            if (!ALLOWED_STYLES.has(propName)) return false;
            // Absolute-positioning styles are only valid on our image mounts;
            // on paragraphs/divs a pasted style could overlay the UI.
            if (LAYOUT_ONLY_STYLES.has(propName) && !LAYOUT_STYLE_TAGS.has(tag)) return false;
            // url() can smuggle a request; expressions are legacy IE script.
            return !/url\s*\(|expression\s*\(|javascript:/i.test(val);
        })
        .join('; ');
}

function cleanElement(el, options = {}) {
    const tag = el.tagName;

    // Unwrap unknown elements but keep their text, so pasting from Word or
    // Google Docs preserves the words rather than deleting them.
    if (!ALLOWED_TAGS.has(tag)) {
        const parent = el.parentNode;
        if (!parent) return;
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
        return;
    }

    for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        const srcAllowed = name === 'src' && tag === 'IMG' && !!options.dataImages;
        const permitted =
            srcAllowed ||
            (ALLOWED_ATTRS[tag] && ALLOWED_ATTRS[tag].has(name)) ||
            ALLOWED_ATTRS['*'].has(name);

        if (!permitted) {
            el.removeAttribute(attr.name);
            continue;
        }

        if (name === 'href') {
            if (!SAFE_URL.test(attr.value.trim())) el.removeAttribute(attr.name);
            continue;
        }

        // Transient data-URI sources survive only the import path (JSON/HTML
        // files); the editor extracts them into the attachment store before
        // the content is persisted, where only data-npad-img may live.
        if (name === 'src' && tag === 'IMG') {
            if (!SAFE_IMAGE_DATA.test(attr.value.trim())) el.removeAttribute(attr.name);
            continue;
        }

        if (name === 'style') {
            const cleaned = sanitiseStyle(attr.value, tag);
            if (cleaned) el.setAttribute('style', cleaned);
            else el.removeAttribute('style');
        }

        // Image object properties: schema-validated JSON or the attribute is
        // dropped entirely (nothing user-bytes may skip validation).
        if (name === 'data-npad-props' && tag === 'IMG') {
            const canonical = normaliseImageProps(attr.value);
            if (canonical) el.setAttribute('data-npad-props', canonical);
            else el.removeAttribute('data-npad-props');
            continue;
        }

        if (tag === 'FIGURE' && name === 'data-npad-anchor') {
            if (!['paragraph', 'page'].includes(attr.value.trim().toLowerCase())) {
                el.removeAttribute(attr.name);
            }
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

    // Notes store image references, never their bytes: an IMG without an
    // attachment id (and not in transient data-URI import mode) is broken
    // and would render an empty icon forever.
    if (tag === 'IMG' && !el.getAttribute('data-npad-img')
        && !(options.dataImages && el.getAttribute('src'))) {
        el.remove();
        return;
    }

    // Any link that opens a new tab must not hand over window.opener.
    if (tag === 'A' && el.getAttribute('target') === '_blank') {
        el.setAttribute('rel', 'noopener noreferrer');
    }
}

/**
 * @param {string} dirty
 * @param {object} [options]
 * @param {boolean} [options.dataImages] Allow transient data-URI image src
 *   (import path only — the editor archives them into the attachment store
 *   before content is persisted).
 * @returns {string} sanitised HTML
 */
export function sanitizeHtml(dirty, options = {}) {
    if (!dirty) return '';

    // <template> parses without executing scripts or loading resources.
    const template = document.createElement('template');
    template.innerHTML = String(dirty);

    template.content
        .querySelectorAll('script, style, iframe, object, embed, link, meta, form, input, button, svg, math')
        .forEach((node) => node.remove());

    // Walk a static list bottom-up so unwrapping never invalidates iteration.
    const elements = Array.from(template.content.querySelectorAll('*')).reverse();
    elements.forEach((element) => cleanElement(element, options));

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
