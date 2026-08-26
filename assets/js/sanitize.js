/**
 * HTML sanitiser for content entering the editor.
 *
 * Applies to restored IndexedDB documents, pasted clipboard HTML and opened
 * files. Image blocks are a deliberately narrow exception to the normal
 * allow-list: their typed JSON is canonicalised and their pixels never live in
 * persisted note HTML.
 */

import { isImageAssetId, normaliseImageBlock, serialiseImageBlock } from './image-schema.js';

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
    FIGURE: new Set(['data-npad-image-block', 'data-npad-image']),
    FIGCAPTION: new Set(),
    IMG: new Set(['data-npad-image-asset', 'alt', 'title', 'width', 'height']),
    SPAN: new Set(['data-npad-image-canvas']),
    '*': new Set(['style', 'align', 'dir']),
};

/** Declarations we keep from inline style attributes. */
const ALLOWED_STYLES = new Set([
    'color', 'background-color', 'font-family', 'font-size', 'font-weight',
    'font-style', 'text-align', 'text-decoration', 'text-decoration-line',
    'margin-left', 'margin-right', 'padding-left', 'padding-right', 'direction',
    'width', 'min-width', 'max-width', 'border', 'border-collapse',
    'border-color', 'border-style', 'border-width', 'vertical-align',
]);

const SAFE_URL = /^(https?:|mailto:|tel:|#|\/)/i;
const SAFE_IMAGE_DATA = /^data:image\/(png|jpeg|gif|webp|avif|bmp);base64,[a-z0-9+/=\s]+$/i;
const TEMP_IMAGE_STYLES = new Set([
    'display', 'position', 'top', 'left', 'height', 'max-height', 'overflow',
    'aspect-ratio', 'object-fit', 'object-position',
]);

function sanitiseStyle(value, { allowImageLayout = false } = {}) {
    return String(value || '')
        .split(';')
        .map((decl) => decl.trim())
        .filter(Boolean)
        .filter((decl) => {
            const [prop, val = ''] = decl.split(':');
            const propName = prop.trim().toLowerCase();
            if (!propName || !val.trim()
                || (!ALLOWED_STYLES.has(propName) && !(allowImageLayout && TEMP_IMAGE_STYLES.has(propName)))) return false;
            // url() can request third-party content; expressions are legacy IE script.
            return !/url\s*\(|expression\s*\(|javascript:/i.test(val);
        })
        .join('; ');
}

function unwrap(el) {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
}

function boundedDimension(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 && parsed <= 100000 ? String(parsed) : null;
}

function cleanElement(el, options = {}) {
    const tag = el.tagName;
    if (!ALLOWED_TAGS.has(tag)) {
        unwrap(el);
        return;
    }

    for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        const srcAllowed = tag === 'IMG' && name === 'src' && !!options.dataImages;
        const permitted = srcAllowed
            || (ALLOWED_ATTRS[tag] && ALLOWED_ATTRS[tag].has(name))
            || ALLOWED_ATTRS['*'].has(name);
        if (!permitted) {
            el.removeAttribute(attr.name);
            continue;
        }

        if (name === 'href') {
            if (!SAFE_URL.test(attr.value.trim())) el.removeAttribute(attr.name);
            continue;
        }
        if (name === 'src') {
            if (!SAFE_IMAGE_DATA.test(attr.value.trim())) el.removeAttribute(attr.name);
            continue;
        }
        if (name === 'style') {
            // Stored image blocks are schema-driven. Temporary export/import
            // HTML can keep the normal safe text/table declarations only.
            if ((tag === 'FIGURE' || tag === 'IMG' || (tag === 'SPAN' && el.hasAttribute('data-npad-image-canvas')))
                && !options.dataImages) {
                el.removeAttribute('style');
                continue;
            }
            const cleaned = sanitiseStyle(attr.value, {
                allowImageLayout: !!options.dataImages && ['FIGURE', 'IMG', 'SPAN'].includes(tag),
            });
            if (cleaned) el.setAttribute('style', cleaned);
            else el.removeAttribute('style');
            continue;
        }
        if ((name === 'width' || name === 'height') && tag === 'IMG') {
            const dimension = boundedDimension(attr.value);
            if (dimension) el.setAttribute(name, dimension);
            else el.removeAttribute(name);
            continue;
        }
        if ((tag === 'TD' || tag === 'TH') && (name === 'colspan' || name === 'rowspan')) {
            const span = Number.parseInt(attr.value, 10);
            if (!Number.isInteger(span) || span < 1 || span > 100) {
                el.removeAttribute(attr.name);
                continue;
            }
            el.setAttribute(name, String(span));
            continue;
        }
        if (tag === 'TH' && name === 'scope') {
            if (!['col', 'row', 'colgroup', 'rowgroup'].includes(attr.value.trim().toLowerCase())) {
                el.removeAttribute(attr.name);
            }
        }
    }

    if (tag === 'A' && el.getAttribute('target') === '_blank') {
        el.setAttribute('rel', 'noopener noreferrer');
    }
}

function directCanvas(figure) {
    return [...figure.children].find((child) => child.matches?.('span[data-npad-image-canvas]')) || null;
}

function directCaption(figure) {
    return [...figure.children].find((child) => child.tagName === 'FIGCAPTION') || null;
}

function unwrapRetiredFigure(figure) {
    // Pixel nodes are intentionally discarded. A visible caption remains text
    // so an old note does not silently lose the author’s prose.
    figure.querySelectorAll('img').forEach((image) => image.remove());
    unwrap(figure);
}

function canonicaliseStoredImageBlock(figure) {
    if (figure.getAttribute('data-npad-image-block') !== '1') return false;
    const block = normaliseImageBlock(figure.getAttribute('data-npad-image'));
    const canvas = directCanvas(figure);
    const image = canvas?.querySelector(':scope > img[data-npad-image-asset]') || null;
    if (!block || !canvas || !image || image.getAttribute('data-npad-image-asset') !== block.assetId) {
        return false;
    }
    if (!isImageAssetId(block.assetId)) return false;

    const canonical = serialiseImageBlock(block);
    figure.replaceChildren(canvas);
    figure.setAttribute('data-npad-image-block', '1');
    figure.setAttribute('data-npad-image', canonical);
    for (const attr of [...figure.attributes]) {
        if (!['data-npad-image-block', 'data-npad-image', 'dir'].includes(attr.name)) figure.removeAttribute(attr.name);
    }
    canvas.replaceChildren(image);
    canvas.setAttribute('data-npad-image-canvas', '');
    for (const attr of [...canvas.attributes]) {
        if (attr.name !== 'data-npad-image-canvas') canvas.removeAttribute(attr.name);
    }
    image.setAttribute('data-npad-image-asset', block.assetId);
    image.alt = block.alt.kind === 'informative' ? block.alt.text : '';
    image.removeAttribute('src');
    image.removeAttribute('style');
    image.removeAttribute('width');
    image.removeAttribute('height');
    for (const attr of [...image.attributes]) {
        if (!['data-npad-image-asset', 'alt', 'title'].includes(attr.name)) image.removeAttribute(attr.name);
    }
    if (block.caption) {
        const caption = document.createElement('figcaption');
        caption.textContent = block.caption;
        figure.appendChild(caption);
    }
    return true;
}

function cleanTemporaryDataImage(image) {
    const src = image.getAttribute('src') || '';
    if (!SAFE_IMAGE_DATA.test(src)) {
        image.remove();
        return;
    }
    for (const attr of [...image.attributes]) {
        if (!['src', 'alt', 'title', 'width', 'height', 'style', 'dir', 'align'].includes(attr.name)) {
            image.removeAttribute(attr.name);
        }
    }
    image.alt = String(image.getAttribute('alt') || '').slice(0, 1000);
}

/** Validate image markup after the generic bottom-up pass. */
function postProcessImageBlocks(fragment, options) {
    const valid = new Set();
    for (const figure of [...fragment.querySelectorAll('figure')]) {
        if (canonicaliseStoredImageBlock(figure)) {
            valid.add(figure);
            continue;
        }
        if (options.dataImages && figure.querySelector('img[src]')) {
            // Temporary import/export figure. It is never accepted by the
            // default persisted-note path.
            const image = figure.querySelector('img[src]');
            cleanTemporaryDataImage(image);
            if (!image.parentNode) {
                unwrapRetiredFigure(figure);
                continue;
            }
            for (const attr of [...figure.attributes]) {
                if (!['style', 'align', 'dir'].includes(attr.name)) figure.removeAttribute(attr.name);
            }
            continue;
        }
        unwrapRetiredFigure(figure);
    }

    for (const image of [...fragment.querySelectorAll('img')]) {
        const owner = image.closest('figure[data-npad-image-block="1"]');
        if (owner && valid.has(owner)) continue;
        if (options.dataImages && image.getAttribute('src')) {
            cleanTemporaryDataImage(image);
            continue;
        }
        image.remove();
    }

    for (const caption of [...fragment.querySelectorAll('figcaption')]) {
        if (caption.closest('figure')) continue;
        unwrap(caption);
    }
    for (const canvas of [...fragment.querySelectorAll('span[data-npad-image-canvas]')]) {
        if (canvas.closest('figure[data-npad-image-block="1"]')) continue;
        unwrap(canvas);
    }
}

/**
 * @param {string} dirty
 * @param {object} [options]
 * @param {boolean} [options.dataImages] Allow transient, raster data URIs for
 * export/import conversion only. Persisted note paths must omit this option.
 * @returns {string} sanitised HTML
 */
export function sanitizeHtml(dirty, options = {}) {
    if (!dirty) return '';
    const template = document.createElement('template');
    template.innerHTML = String(dirty);
    template.content
        .querySelectorAll('script, style, iframe, object, embed, link, meta, form, input, button, svg, math')
        .forEach((node) => node.remove());

    const elements = Array.from(template.content.querySelectorAll('*')).reverse();
    elements.forEach((element) => cleanElement(element, options));
    postProcessImageBlocks(template.content, options);
    return template.innerHTML;
}

/** Escape plain text for safe insertion as HTML, preserving line breaks. */
export function textToHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text ?? '');
    return div.innerHTML.replace(/\r?\n/g, '<br>');
}
