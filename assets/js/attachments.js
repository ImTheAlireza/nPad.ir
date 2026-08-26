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

import { sanitizeHtml, normaliseImageProps } from './sanitize.js';

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

const LAYOUT_CLASSES = new Set([
    'inline', 'wrap-left', 'wrap-right', 'top-bottom', 'behind', 'front', 'fixed',
]);

/** Parse the canonical props JSON on an <img> (validated by the sanitizer). */
export function readImageProps(img) {
    const canonical = img?.getAttribute?.('data-npad-props');
    if (!canonical) return defaultImageProps();
    try {
        return JSON.parse(canonical);
    } catch {
        return defaultImageProps();
    }
}

export function defaultImageProps() {
    return {
        layout: 'inline',
        anchor: 'paragraph',
        width: null,
        height: null,
        rotate: 0,
        flipH: false,
        flipV: false,
        crop: { l: 0, r: 0, t: 0, b: 0 },
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        recolor: 'none',
        opacity: 100,
        brightness: 100,
        contrast: 100,
        border: { width: 0, color: '#64748b', radius: 0, shadow: false },
        pos: { x: 0, y: 0 },
    };
}

/** Write canonical props AND apply them to the DOM as inline styles. */
export function writeImageProps(img, props) {
    const canonical = normaliseImageProps(props);
    if (!canonical) return img;
    img.setAttribute('data-npad-props', canonical);
    applyImagePropsCss(img, JSON.parse(canonical));
    return img;
}

/** Apply element-level CSS (not the figure mount) for a parsed props object. */
export function applyImagePropsCss(img, props) {
    const css = imageElementCss(props);
    if (css) img.setAttribute('style', css);
    else img.removeAttribute('style');
}

const RECOLOR_FILTERS = {
    none: '',
    grayscale: 'grayscale(1)',
    sepia: 'sepia(1)',
    negative: 'invert(1)',
    faded: 'saturate(0.55) brightness(0.95)',
    cool: 'hue-rotate(180deg) saturate(1.1)',
    warm: 'sepia(0.35) saturate(1.25)',
};

/** CSS for the <img> itself (transforms, filters, border, size). */
export function imageElementCss(props) {
    const bits = [];
    if (props.width) bits.push(`width:${props.width}`);
    if (props.height) bits.push(`height:${props.height}`);
    if (props.opacity < 100) bits.push(`opacity:${props.opacity / 100}`);

    const filters = [];
    if (RECOLOR_FILTERS[props.recolor]) filters.push(RECOLOR_FILTERS[props.recolor]);
    if (props.brightness !== 100) filters.push(`brightness(${props.brightness}%)`);
    if (props.contrast !== 100) filters.push(`contrast(${props.contrast}%)`);
    if (filters.length) bits.push(`filter:${filters.join(' ')}`);

    const transforms = [];
    if (props.rotate) transforms.push(`rotate(${props.rotate}deg)`);
    if (props.flipH) transforms.push('scaleX(-1)');
    if (props.flipV) transforms.push('scaleY(-1)');
    if (transforms.length) bits.push(`transform:${transforms.join(' ')}`);

    const { border } = props;
    if (border.width > 0) {
        bits.push(`border:${border.width}px solid ${border.color}`);
        if (border.radius > 0) bits.push(`border-radius:${border.radius}px`);
    }
    if (border.shadow) bits.push('box-shadow:0 2px 10px rgba(15,23,42,0.35)');
    return bits.join(';');
}

/** CSS for the figure mount: layout, margins, frame sizing, positioning. */
export function imageFigureCss(props) {
    const bits = [];
    const { margin } = props;
    const hasMargins = margin.top || margin.right || margin.bottom || margin.left;

    switch (props.layout) {
        case 'center':
            bits.push('display:block;text-align:center');
            break;
        case 'wrap-left':
            bits.push('float:left');
            break;
        case 'wrap-right':
            bits.push('float:right');
            break;
        case 'top-bottom':
            bits.push('display:block;clear:both');
            break;
        case 'behind':
        case 'front':
        case 'fixed':
            bits.push('position:absolute');
            bits.push(`left:${props.pos.x}px`);
            bits.push(`top:${props.pos.y}px`);
            bits.push(`z-index:${props.layout === 'behind' ? -1 : 1}`);
            bits.push('margin:0');
            break;
        default:
            // Inline needs no figure styling: it stays a bare, in-flow image.
            break;
    }

    if (hasMargins && !['behind', 'front', 'fixed'].includes(props.layout)) {
        bits.push(`margin:${margin.top}px ${margin.right}px ${margin.bottom}px ${margin.left}px`);
    }
    if (props.width && ['wrap-left', 'wrap-right', 'top-bottom'].includes(props.layout)) {
        bits.push(`width:${props.width}`);
    }
    return bits.join(';');
}

/** Fraction of the original image still visible after a crop. */
export function cropRegion(crop) {
    return {
        left: crop.l / 100,
        right: 1 - crop.r / 100,
        top: crop.t / 100,
        bottom: 1 - crop.b / 100,
    };
}

/** object-position percentages that show the cropped region. */
export function cropObjectPosition(crop) {
    const visibleW = Math.max(1, 100 - crop.l - crop.r);
    const visibleH = Math.max(1, 100 - crop.t - crop.b);
    const x = (crop.l / visibleW) * 100;
    const y = (crop.t / visibleH) * 100;
    return { x: Math.min(100, Math.max(0, x)), y: Math.min(100, Math.max(0, y)) };
}

/** padding-bottom % for the clip frame given the natural aspect (w/h). */
export function cropFramePadding(crop, naturalAspect) {
    if (!Number.isFinite(naturalAspect) || naturalAspect <= 0) return 75;
    const visibleW = Math.max(1, 100 - crop.l - crop.r);
    const visibleH = Math.max(1, 100 - crop.t - crop.b);
    const displayedAspect = naturalAspect * (visibleW / visibleH);
    return Math.min(400, Math.max(2, (100 / displayedAspect)));
}

function escapeAttr(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Build the stored reference markup.
 * `props` is the image-object model (layout, crop, rotation, filters…); when
 * a crop is active the image is wrapped in a clipped frame. Captions stay in
 * <figcaption>. Legacy `size`/`align` map onto props for old callers.
 */
export function imageHtml(id, { alt = '', caption = '', size = '', align = '', props = null } = {}) {
    const imageProps = props
        ? (JSON.parse(normaliseImageProps(props)) || defaultImageProps())
        : defaultImageProps();
    if (!props) {
        if (SIZE_PRESETS[size]) imageProps.width = SIZE_PRESETS[size];
        else if (size && /^\d+(\.\d+)?(px|%)$/.test(size)) imageProps.width = size;
        if (align === 'left') imageProps.layout = 'wrap-left';
        else if (align === 'center') imageProps.layout = 'center';
        else if (align === 'right') imageProps.layout = 'wrap-right';
    }
    const canonical = normaliseImageProps(imageProps);
    const propsAttr = canonical ? ` data-npad-props="${escapeAttr(canonical)}"` : '';

    const { crop } = imageProps;
    const hasCrop = crop.l || crop.r || crop.t || crop.b;
    const absolute = ['behind', 'front', 'fixed'].includes(imageProps.layout);
    const useFrame = hasCrop;

    const altAttr = `alt="${escapeAttr(alt)}"`;
    let img;
    if (useFrame) {
        const pos = cropObjectPosition(crop);
        const clipStyle = [
            'display:block',
            'position:relative',
            'overflow:hidden',
            'padding-bottom:75%',
            `object-fit:cover`,
            `object-position:${pos.x}% ${pos.y}%`,
        ].join(';');
        img = `<span data-npad-frame-clip style="${clipStyle}">`
            + `<img data-npad-img="${id}"${propsAttr} ${altAttr}`
            + ` style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;`
            + `object-position:${pos.x}% ${pos.y}%${imageElementCss(imageProps) ? ';' + imageElementCss(imageProps) : ''}">`
            + `</span>`;
    } else {
        const style = imageElementCss(imageProps);
        img = `<img data-npad-img="${id}"${propsAttr} ${altAttr}${style ? ` style="${style}"` : ''}>`;
    }

    const figureStyle = imageFigureCss(imageProps);
    const figureAttrs = [
        'data-npad-figure',
        useFrame ? 'data-npad-frame' : '',
        absolute ? `data-npad-anchor="${imageProps.anchor}"` : '',
        figureStyle ? `style="${figureStyle}"` : '',
    ].filter(Boolean).join(' ');

    const figcaption = caption
        ? `<figcaption>${escapeAttr(caption)}</figcaption>`
        : '';
    const bareInline = imageProps.layout === 'inline' && !absolute && !useFrame
        && !caption && !figureStyle
        && !(imageProps.margin.top || imageProps.margin.right || imageProps.margin.bottom || imageProps.margin.left)
        && imageProps.border.width === 0 && !imageProps.border.shadow;

    if (!bareInline) {
        return `<figure ${figureAttrs}>${img}${figcaption}</figure>`;
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
 * @param {(dataUri: string, img: HTMLImageElement) => Promise<string|null>} onImage
 *        returns the new ref html or null to drop; the source <img> is passed
 *        so callers can preserve alt/props/caption intent.
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
            const ref = await onImage(src, img);
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

/** Measure an <img> after its src is set (async, non-throwing). */
function naturalSize(img) {
    return new Promise((resolve) => {
        if (!img.src) {
            resolve(null);
            return;
        }
        const probe = new Image();
        probe.onload = () => resolve({
            width: probe.naturalWidth || 0,
            height: probe.naturalHeight || 0,
        });
        probe.onerror = () => resolve(null);
        probe.src = img.src;
    });
}

/**
 * Replace references with data URIs so exports are self-contained. The image
 * object model (layout, crop, rotation, filters…) is flattened into inline
 * CSS, crop frames get their real aspect, and every data-npad-* attribute is
 * stripped from the exported markup.
 */
export async function embedImagesAsDataUrls(html, loader) {
    const root = document.createElement('div');
    root.innerHTML = html;
    const canMeasure = typeof Image === 'function';
    const propsByImg = new Map();
    const imgs = [...root.querySelectorAll('img[data-npad-img]')];
    for (const img of imgs) {
        const id = img.getAttribute('data-npad-img');
        try {
            const blob = await loader(id);
            img.src = blob ? await blobToDataUrl(blob) : '';
        } catch {
            img.src = '';
        }
        const props = readImageProps(img);
        propsByImg.set(img, props);
        applyImagePropsCss(img, props);

        const clip = img.closest('[data-npad-frame-clip]');
        if (canMeasure && clip && (props.crop.l || props.crop.r || props.crop.t || props.crop.b)) {
            const natural = await naturalSize(img);
            if (natural?.width && natural?.height) {
                const pos = cropObjectPosition(props.crop);
                clip.style.paddingBottom = `${cropFramePadding(props.crop, natural.width / natural.height)}%`;
                img.style.objectPosition = `${pos.x}% ${pos.y}%`;
            }
        }
        for (const attribute of [...img.attributes]) {
            if (attribute.name.startsWith('data-npad-')) img.removeAttribute(attribute.name);
        }
        if (!img.getAttribute('src')) img.remove();
    }
    for (const el of [...root.querySelectorAll('[data-npad-frame]')]) {
        const figure = el;
        const innerImg = figure.querySelector('img');
        const figureProps = innerImg ? propsByImg.get(innerImg) : defaultImageProps();
        figure.style.cssText += `;${imageFigureCss(figureProps || defaultImageProps())}`;
        for (const attribute of [...figure.attributes]) {
            if (attribute.name.startsWith('data-npad-')) figure.removeAttribute(attribute.name);
        }
    }
    for (const el of [...root.querySelectorAll('[data-npad-frame-clip]')]) {
        el.removeAttribute('data-npad-frame-clip');
    }
    return root.innerHTML;
}

/** Sanitised reference markup only (never user HTML). */
export function sanitizeImageMarkup(html) {
    return sanitizeHtml(html);
}
