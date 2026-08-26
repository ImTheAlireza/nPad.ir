/**
 * NPad image attachments.
 *
 * Notes never store image bytes: the editor HTML keeps a reference
 * (`<img data-npad-img="id">`) and the payload lives in the IndexedDB
 * `images` store (or a base64 localStorage fallback when IndexedDB is
 * unavailable). This module owns the reference format, the size/type guards
 * (the same 25 MB bound as document imports), data-URI <-> Blob conversion
 * for the import/export pipelines, and rendering helpers.
 *
 * Everything is local and dependency-free.
 */

import { sanitizeHtml } from './sanitize.js';

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

/** Raster formats only: SVG is a script vector and must never be stored. */
export const SUPPORTED_IMAGE_TYPES = new Set([
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp',
]);

const DEFAULT_ALT = '';

export function isSupportedImageType(type) {
    return SUPPORTED_IMAGE_TYPES.has(String(type || '').toLowerCase());
}

export function isSupportedImageFile(file) {
    return !!file && isSupportedImageType(file.type) && file.size <= MAX_IMAGE_BYTES;
}

export function imageTooLarge(file) {
    return !!file && file.size > MAX_IMAGE_BYTES;
}

/** Attachment id bound to a note so per-note garbage collection stays safe. */
export function newImageId(noteId) {
    const random = globalThis.crypto?.randomUUID?.()
        || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return `img-${noteId}-${random}`;
}

/* -------------------------------------------------------------------------
   Data URI <-> Blob
   ------------------------------------------------------------------------- */

/** Decode a data URI into { blob, type, bytes }. Returns null when invalid. */
export function dataUriToBlob(dataUri) {
    const match = String(dataUri || '').trim().match(
        /^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i,
    );
    if (!match || !isSupportedImageType(match[1])) return null;
    const type = match[1].toLowerCase();
    const clean = match[2].replace(/\s+/g, '');
    let bytes;
    try {
        const binary = window.atob ? window.atob(clean) : globalThis.atob(clean);
        bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
        }
    } catch {
        return null;
    }
    return { blob: new Blob([bytes], { type }), type, bytes, size: bytes.length };
}

/** Encode a Blob as a base64 data URI (export paths, localStorage fallback). */
export async function blobToDataUrl(blob) {
    if (!blob) return '';
    if (typeof blob.arrayBuffer !== 'function') {
        // Legacy/webviews without Blob.arrayBuffer: FileReader is universal.
        const Reader = globalThis.FileReader
            || (typeof window !== 'undefined' && window.FileReader)
            || null;
        if (!Reader) throw new Error('Blob reading is unsupported');
        return new Promise((resolve, reject) => {
            const reader = new Reader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
    }
    return `data:${blob.type || 'image/png'};base64,${window.btoa ? window.btoa(binary) : globalThis.btoa(binary)}`;
}

/* -------------------------------------------------------------------------
   Reference HTML
   ------------------------------------------------------------------------- */

const SIZE_PRESETS = {
    small: '25%',
    medium: '50%',
    large: '75%',
};

/**
 * Build the stored reference markup.
 * Caption/alignment wrap the image in <figure>; size maps to a width style.
 */
export function imageHtml(id, { alt = '', caption = '', size = '', align = '' } = {}) {
    const styleBits = [];
    if (SIZE_PRESETS[size]) styleBits.push(`width:${SIZE_PRESETS[size]}`);
    else if (size && /^\d+(\.\d+)?(px|%)$/.test(size)) styleBits.push(`width:${size}`);
    if (align && (align === 'left' || align === 'right')) {
        styleBits.push(`float:${align};margin:0 0 0.75em`);
        if (align === 'left') styleBits.push('margin-right:0.75em');
        else styleBits.push('margin-left:0.75em');
    }
    const style = styleBits.length ? ` style="${styleBits.join(';')}"` : '';
    const escapedAlt = alt.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const img = `<img data-npad-img="${id}" alt="${escapedAlt}"${style}>`;
    if (caption || align === 'center') {
        const figureStyle = align === 'center' ? ' style="text-align:center"' : '';
        const figcaption = caption
            ? `<figcaption>${caption.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</figcaption>`
            : '';
        return `<figure data-npad-figure${figureStyle}>${img}${figcaption}</figure>`;
    }
    return img;
}

/** Unique attachment ids referenced by an HTML string. */
export function collectImageIds(html) {
    const ids = [];
    const seen = new Set();
    const pattern = /data-npad-img="([^"]+)"/g;
    let match;
    while ((match = pattern.exec(String(html || '')))) {
        const id = match[1];
        if (!seen.has(id)) {
            seen.add(id);
            ids.push(id);
        }
    }
    return ids;
}

/** Replace id references in an HTML string (used by backup restore). */
export function remapImageIds(html, map) {
    return String(html || '').replace(/data-npad-img="([^"]+)"/g, (all, id) =>
        map.has(id) ? `data-npad-img="${map.get(id)}"` : all);
}

/* -------------------------------------------------------------------------
   Extraction from untrusted HTML (paste, drag-drop, imported files)
   ------------------------------------------------------------------------- */

/**
 * Replace supported data-URI <img> sources with references built by `onImage`
 * (which stores the payload), and turn remote <img src> into plain links —
 * NPad never fetches remote images, and the sanitizer refuses src.
 *
 * Works on a string and is idempotent for already-archived images.
 *
 * @param {string} html
 * @param {(dataUri: string) => Promise<string|null>} onImage  returns the new ref html or null to drop
 * @returns {Promise<{ html: string, archived: number }>}
 */
export async function extractImagesFromHtml(html, onImage) {
    const source = String(html || '');
    const template = document.createElement('template');
    template.innerHTML = source;

    const imgs = [...template.content.querySelectorAll('img')];
    let archived = 0;
    for (const img of imgs) {
        const src = (img.getAttribute('src') || '').trim();
        img.removeAttribute('src');

        if (img.hasAttribute('data-npad-img')) {
            // Already archived (e.g. restored note content): keep reference.
            continue;
        }

        const alt = img.getAttribute('alt') || '';
        if (/^data:image\//i.test(src)) {
            const ref = await onImage(src);
            if (ref) {
                archived += 1;
                img.outerHTML = ref;
                continue;
            }
        } else if (/^https?:/i.test(src)) {
            const label = alt || src.replace(/^https?:\/\//i, '').slice(0, 80);
            const link = document.createElement('a');
            link.href = src;
            link.setAttribute('rel', 'noopener noreferrer');
            link.textContent = label;
            img.replaceWith(link);
            continue;
        }
        img.remove();
    }

    return { html: template.innerHTML, archived };
}

/* -------------------------------------------------------------------------
   Rendering: resolve references to object URLs (browser-only)
   ------------------------------------------------------------------------- */

/**
 * Give every referenced image a src. `loader(id)` returns the Blob or null.
 * Returns the list of created object URLs so the caller can revoke them.
 */
export async function resolveImageReferences(root, loader) {
    const urls = [];
    const missing = [];
    const imgs = [...root.querySelectorAll('img[data-npad-img]')];
    for (const img of imgs) {
        const id = img.getAttribute('data-npad-img');
        try {
            const blob = await loader(id);
            if (!blob) {
                missing.push(id);
                img.classList.add('npad-img-missing');
                img.alt = img.alt || '';
                continue;
            }
            let url = '';
            if (typeof URL.createObjectURL === 'function') {
                url = URL.createObjectURL(blob);
                urls.push(url);
            }
            if (url) img.src = url;
            else img.classList.add('npad-img-missing');
        } catch {
            missing.push(id);
            img.classList.add('npad-img-missing');
        }
    }
    return { urls, missing };
}

export function revokeImageUrls(urls) {
    for (const url of urls || []) {
        try { URL.revokeObjectURL(url); } catch { /* already revoked */ }
    }
}

/** Clone-time cleanup: saved/exported HTML never carries a resolved src. */
export function stripImageSources(root) {
    for (const img of root.querySelectorAll('img[data-npad-img]')) {
        img.removeAttribute('src');
        img.classList.remove('npad-img-missing');
    }
}

/** True when the node is (or wraps) an archived image. */
export function isImageElement(node) {
    const el = node?.nodeType === 1 ? node : node?.parentElement;
    return !!el && (el.tagName === 'IMG' || el.querySelector?.('img[data-npad-img]'));
}

/* -------------------------------------------------------------------------
   Export helpers
   ------------------------------------------------------------------------- */

/** Replace references with data URIs so exports are self-contained. */
export async function embedImagesAsDataUrls(html, loader) {
    const root = document.createElement('div');
    root.innerHTML = html;
    const imgs = [...root.querySelectorAll('img[data-npad-img]')];
    for (const img of imgs) {
        const id = img.getAttribute('data-npad-img');
        try {
            const blob = await loader(id);
            img.src = blob ? await blobToDataUrl(blob) : '';
        } catch {
            img.src = '';
        }
        img.removeAttribute('data-npad-img');
        if (!img.getAttribute('src')) img.remove();
    }
    return root.innerHTML;
}

/** Sanitised reference markup only (never user HTML). */
export function sanitizeImageMarkup(html) {
    return sanitizeHtml(html);
}
