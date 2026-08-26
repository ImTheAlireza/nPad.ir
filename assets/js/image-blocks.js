/**
 * Image-block primitives.
 *
 * This module owns safe file admission, semantic block rendering, runtime
 * object URLs, and import/export helpers. It intentionally does not own editor
 * selection or dialogs; those belong to editor.js.
 */

import {
    defaultImageBlock,
    imageBlockAccessibleName,
    isImageAssetId,
    newImageAssetId,
    normaliseImageBlock,
    serialiseImageBlock,
} from './image-schema.js';

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 40_000_000;
export const SUPPORTED_IMAGE_TYPES = new Set([
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp',
]);

const MIME_BY_KIND = {
    png: 'image/png',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    bmp: 'image/bmp',
};


function byteEqual(bytes, offset, values) {
    if (bytes.length < offset + values.length) return false;
    return values.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes, offset, length) {
    if (bytes.length < offset + length) return '';
    return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function uint16LE(bytes, offset) {
    if (bytes.length < offset + 2) return 0;
    return bytes[offset] | (bytes[offset + 1] << 8);
}

function uint32LE(bytes, offset) {
    if (bytes.length < offset + 4) return 0;
    return ((bytes[offset])
        | (bytes[offset + 1] << 8)
        | (bytes[offset + 2] << 16)
        | (bytes[offset + 3] << 24)) >>> 0;
}

function uint32BE(bytes, offset) {
    if (bytes.length < offset + 4) return 0;
    return (((bytes[offset] << 24) >>> 0)
        | (bytes[offset + 1] << 16)
        | (bytes[offset + 2] << 8)
        | bytes[offset + 3]) >>> 0;
}

function jpegDimensions(bytes) {
    if (!byteEqual(bytes, 0, [0xff, 0xd8])) return null;
    let offset = 2;
    while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) { offset += 1; continue; }
        while (bytes[offset] === 0xff) offset += 1;
        const marker = bytes[offset];
        offset += 1;
        if (marker === 0xd8 || marker === 0xd9) continue;
        const size = (bytes[offset] << 8) | bytes[offset + 1];
        if (size < 2 || offset + size > bytes.length) return null;
        // Baseline/progressive/lossless Start Of Frame markers.
        if ((marker >= 0xc0 && marker <= 0xc3)
            || (marker >= 0xc5 && marker <= 0xc7)
            || (marker >= 0xc9 && marker <= 0xcb)
            || (marker >= 0xcd && marker <= 0xcf)) {
            return {
                width: (bytes[offset + 5] << 8) | bytes[offset + 6],
                height: (bytes[offset + 3] << 8) | bytes[offset + 4],
            };
        }
        offset += size;
    }
    return null;
}

function webpDimensions(bytes) {
    if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return null;
    const chunk = ascii(bytes, 12, 4);
    if (chunk === 'VP8X' && bytes.length >= 30) {
        return {
            width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
            height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
        };
    }
    if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
        const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
        return { width: uint16LE(bytes, 26) & 0x3fff, height: uint16LE(bytes, 28) & 0x3fff };
    }
    return null;
}

/**
 * Inspect a small file header. AVIF dimensions are deliberately left to the
 * browser decoder because ISO BMFF box ordering is not bounded by a header.
 */
export function sniffImageHeader(bytes) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (byteEqual(data, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
        return { type: MIME_BY_KIND.png, width: uint32BE(data, 16), height: uint32BE(data, 20) };
    }
    if (byteEqual(data, 0, [0xff, 0xd8])) {
        const dimensions = jpegDimensions(data);
        return { type: MIME_BY_KIND.jpeg, ...dimensions };
    }
    if (ascii(data, 0, 3) === 'GIF') {
        return { type: MIME_BY_KIND.gif, width: uint16LE(data, 6), height: uint16LE(data, 8) };
    }
    const webp = webpDimensions(data);
    if (webp || (ascii(data, 0, 4) === 'RIFF' && ascii(data, 8, 4) === 'WEBP')) {
        return { type: MIME_BY_KIND.webp, ...(webp || {}) };
    }
    if (ascii(data, 0, 2) === 'BM') {
        return { type: MIME_BY_KIND.bmp, width: Math.abs(uint32LE(data, 18)), height: Math.abs(uint32LE(data, 22)) };
    }
    // AVIF is an ISO BMFF file. Require an avif/avis compatible brand before
    // asking the browser to decode it.
    if (ascii(data, 4, 4) === 'ftyp' && /avi[fs]/.test(ascii(data, 8, 16))) {
        return { type: MIME_BY_KIND.avif };
    }
    return null;
}

export function isSupportedImageType(type) {
    return SUPPORTED_IMAGE_TYPES.has(String(type || '').toLowerCase());
}

function imageCtor() {
    return globalThis.Image || globalThis.window?.Image || null;
}

async function decodeIntrinsicSize(blob) {
    if (typeof globalThis.createImageBitmap === 'function') {
        const bitmap = await globalThis.createImageBitmap(blob);
        const dimensions = { width: bitmap.width, height: bitmap.height };
        bitmap.close?.();
        return dimensions;
    }
    const ImageCtor = imageCtor();
    const Url = globalThis.URL || globalThis.window?.URL;
    if (!ImageCtor || !Url?.createObjectURL) throw new Error('decode-unavailable');
    const url = Url.createObjectURL(blob);
    try {
        return await new Promise((resolve, reject) => {
            const image = new ImageCtor();
            image.onload = () => resolve({
                width: image.naturalWidth || image.width || 0,
                height: image.naturalHeight || image.height || 0,
            });
            image.onerror = () => reject(new Error('decode-failed'));
            image.src = url;
        });
    } finally {
        try { Url.revokeObjectURL(url); } catch { /* no-op */ }
    }
}

function assertDimensions(dimensions) {
    const width = Number(dimensions?.width);
    const height = Number(dimensions?.height);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
        throw new Error('invalid-dimensions');
    }
    if (width * height > MAX_IMAGE_PIXELS) throw new Error('too-many-pixels');
    return { width, height };
}

/**
 * Validate an image before any browser object URL is retained or storage write
 * happens. The optional decoder makes this deterministic in tests.
 */
export async function inspectImageFile(file, { decode = decodeIntrinsicSize } = {}) {
    if (!file || typeof file.size !== 'number' || typeof file.slice !== 'function') {
        throw new Error('invalid-file');
    }
    if (file.size <= 0) throw new Error('empty-file');
    if (file.size > MAX_IMAGE_BYTES) throw new Error('too-large');

    const header = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
    const sniffed = sniffImageHeader(header);
    if (!sniffed || !isSupportedImageType(sniffed.type)) throw new Error('unsupported-file');
    const declared = String(file.type || '').toLowerCase();
    if (declared && isSupportedImageType(declared) && declared !== sniffed.type) {
        throw new Error('type-mismatch');
    }
    if (declared && !isSupportedImageType(declared)) throw new Error('unsupported-file');

    let dimensions = null;
    if (sniffed.width && sniffed.height) dimensions = assertDimensions(sniffed);
    try {
        const decoded = assertDimensions(await decode(file));
        if (dimensions && (decoded.width !== dimensions.width || decoded.height !== dimensions.height)) {
            throw new Error('dimension-mismatch');
        }
        dimensions = decoded;
    } catch (error) {
        // A browser without any decoder can still admit a format whose header
        // gave bounded dimensions. A decoder that *did* run but failed is a
        // malformed file and must be rejected.
        if (String(error?.message || error) !== 'decode-unavailable' || !dimensions) throw error;
    }
    return { type: sniffed.type, size: file.size, ...dimensions };
}

export function dataUriToImageBlob(dataUri) {
    const match = String(dataUri || '').trim().match(/^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i);
    if (!match || !isSupportedImageType(match[1])) return null;
    const clean = match[2].replace(/\s+/g, '');
    // Avoid allocating a huge decoded buffer for an imported data URI before
    // the same 25 MB admission policy can reject it.
    if (Math.floor((clean.length * 3) / 4) > MAX_IMAGE_BYTES) return null;
    try {
        const decode = globalThis.atob || globalThis.window?.atob;
        if (!decode) return null;
        const binary = decode(clean);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        return { blob: new Blob([bytes], { type: match[1].toLowerCase() }), size: bytes.length, type: match[1].toLowerCase() };
    } catch {
        return null;
    }
}

export async function blobToDataUri(blob) {
    if (!blob) return '';
    if (typeof blob.arrayBuffer !== 'function') {
        const Reader = globalThis.FileReader || globalThis.window?.FileReader;
        if (!Reader) return '';
        return new Promise((resolve) => {
            const reader = new Reader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => resolve('');
            reader.readAsDataURL(blob);
        });
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    const encode = globalThis.btoa || globalThis.window?.btoa;
    if (!encode) return '';
    return `data:${blob.type || 'image/png'};base64,${encode(binary)}`;
}

function blockImage(figure) {
    return figure?.querySelector?.(':scope > [data-npad-image-canvas] > img[data-npad-image-asset]')
        || figure?.querySelector?.('img[data-npad-image-asset]')
        || null;
}

export function isImageBlockElement(value) {
    return !!value?.matches?.('figure[data-npad-image-block="1"]');
}

export function readImageBlock(figure) {
    if (!isImageBlockElement(figure)) return null;
    return normaliseImageBlock(figure.getAttribute('data-npad-image'));
}

function removeRuntimeClasses(figure) {
    figure.classList.remove('npad-image-block--selected', 'npad-image-block--missing');
    figure.removeAttribute('data-npad-image-selected');
    figure.removeAttribute('data-npad-image-layout');
    figure.removeAttribute('data-npad-image-missing-label');
    figure.removeAttribute('data-npad-image-description-needed');
    figure.removeAttribute('aria-label');
    figure.removeAttribute('role');
    figure.removeAttribute('tabindex');
    figure.removeAttribute('contenteditable');
    figure.removeAttribute('style');
}

function cropStyle(canvas, image, block, asset) {
    canvas.removeAttribute('style');
    image.removeAttribute('style');
    if (!block.crop || !asset?.width || !asset?.height) return;
    const crop = block.crop;
    const ratioWidth = asset.width * (crop.width / 100);
    const ratioHeight = asset.height * (crop.height / 100);
    canvas.style.display = 'block';
    canvas.style.position = 'relative';
    canvas.style.overflow = 'hidden';
    canvas.style.aspectRatio = `${ratioWidth} / ${ratioHeight}`;
    image.style.position = 'absolute';
    image.style.width = `${10000 / crop.width}%`;
    image.style.maxWidth = 'none';
    image.style.left = `-${(crop.x / crop.width) * 100}%`;
    image.style.top = `-${(crop.y / crop.height) * 100}%`;
}

/** Apply canonical block data to a live figure. Runtime styles are derived. */
export function renderImageBlock(figure, block, { asset = null, labels = {} } = {}) {
    const canonical = normaliseImageBlock(block);
    if (!canonical || !isImageBlockElement(figure)) return null;
    const serialized = serialiseImageBlock(canonical);
    figure.setAttribute('data-npad-image', serialized);
    figure.setAttribute('contenteditable', 'false');
    figure.setAttribute('tabindex', '0');
    figure.setAttribute('role', 'group');
    figure.setAttribute('aria-label', imageBlockAccessibleName(canonical, labels));
    if (canonical.alt.kind === 'pending') figure.dataset.npadImageDescriptionNeeded = labels.descriptionNeeded || 'Image description needed';
    else delete figure.dataset.npadImageDescriptionNeeded;
    figure.dataset.npadImageLayout = canonical.display.layout;
    figure.style.setProperty('--npad-image-width', `${canonical.display.widthPercent}%`);

    let canvas = figure.querySelector(':scope > [data-npad-image-canvas]');
    let image = blockImage(figure);
    if (!canvas || !image) return null;
    image.setAttribute('data-npad-image-asset', canonical.assetId);
    image.alt = canonical.alt.kind === 'informative' ? canonical.alt.text : '';
    if (asset?.width) image.width = asset.width;
    if (asset?.height) image.height = asset.height;
    cropStyle(canvas, image, canonical, asset);

    let caption = figure.querySelector(':scope > figcaption');
    if (canonical.caption) {
        if (!caption) {
            caption = document.createElement('figcaption');
            figure.appendChild(caption);
        }
        caption.textContent = canonical.caption;
    } else {
        caption?.remove();
    }
    return canonical;
}

export function createImageBlockElement(block, options = {}) {
    const canonical = normaliseImageBlock(block);
    if (!canonical) return null;
    const figure = document.createElement('figure');
    figure.setAttribute('data-npad-image-block', '1');
    const canvas = document.createElement('span');
    canvas.setAttribute('data-npad-image-canvas', '');
    const image = document.createElement('img');
    image.setAttribute('data-npad-image-asset', canonical.assetId);
    canvas.appendChild(image);
    figure.appendChild(canvas);
    renderImageBlock(figure, canonical, options);
    return figure;
}

/** Remove browser-only state before a note is saved or copied. */
export function stripImageBlockRuntimeState(root) {
    for (const figure of root.querySelectorAll?.('figure[data-npad-image-block="1"]') || []) {
        removeRuntimeClasses(figure);
        const image = blockImage(figure);
        image?.removeAttribute('src');
        image?.removeAttribute('width');
        image?.removeAttribute('height');
        image?.removeAttribute('style');
        figure.querySelector(':scope > [data-npad-image-canvas]')?.removeAttribute('style');
    }
}

export function collectImageAssetIds(html) {
    const root = document.createElement('div');
    root.innerHTML = String(html || '');
    const ids = new Set();
    for (const figure of root.querySelectorAll('figure[data-npad-image-block="1"]')) {
        const block = readImageBlock(figure);
        if (block) ids.add(block.assetId);
    }
    return [...ids];
}

/** Remap copied/rehomed assets without touching author-facing block choices. */
export function remapImageAssetIds(html, mapping) {
    const root = document.createElement('div');
    root.innerHTML = String(html || '');
    for (const figure of root.querySelectorAll('figure[data-npad-image-block="1"]')) {
        const block = readImageBlock(figure);
        const nextId = block && mapping.get(block.assetId);
        if (!block || !nextId || !isImageAssetId(nextId)) continue;
        block.assetId = nextId;
        renderImageBlock(figure, block);
    }
    stripImageBlockRuntimeState(root);
    return root.innerHTML;
}

export function revokeImageObjectUrls(urls) {
    const Url = globalThis.URL || globalThis.window?.URL;
    for (const url of urls || []) {
        try { Url?.revokeObjectURL?.(url); } catch { /* already revoked */ }
    }
}

/** Resolve stored assets to ephemeral object URLs for an active editor. */
export async function resolveImageBlockAssets(root, loadAsset, labels = {}) {
    const urls = [];
    const missing = [];
    const Url = globalThis.URL || globalThis.window?.URL;
    for (const figure of root.querySelectorAll?.('figure[data-npad-image-block="1"]') || []) {
        const block = readImageBlock(figure);
        const image = blockImage(figure);
        if (!block || !image) continue;
        try {
            const asset = await loadAsset(block.assetId);
            const blob = asset?.blob || asset;
            if (!blob || !Url?.createObjectURL) throw new Error('missing');
            const url = Url.createObjectURL(blob);
            urls.push(url);
            image.src = url;
            figure.classList.remove('npad-image-block--missing');
            renderImageBlock(figure, block, { asset, labels });
        } catch {
            missing.push(block.assetId);
            image.removeAttribute('src');
            figure.classList.add('npad-image-block--missing');
            renderImageBlock(figure, block, { labels });
        }
    }
    return { urls, missing };
}

function exportStyle(block, direction = 'ltr') {
    const rtl = direction === 'rtl';
    const align = {
        block: 'display:block',
        start: rtl ? 'display:block;margin-left:auto;margin-right:0;text-align:right' : 'display:block;margin-left:0;margin-right:auto',
        center: 'display:block;margin-left:auto;margin-right:auto;text-align:center',
        end: rtl ? 'display:block;margin-left:0;margin-right:auto' : 'display:block;margin-left:auto;margin-right:0;text-align:right',
    }[block.display.layout] || 'display:block';
    return `${align};width:${block.display.widthPercent}%`;
}

/**
 * Turn local block references into portable, standard figure/img markup.
 * The resulting HTML contains data URIs only and no NPad runtime attributes.
 */
export async function embedImageBlocksAsDataUris(html, loadAsset, { direction = 'ltr' } = {}) {
    const root = document.createElement('div');
    root.innerHTML = String(html || '');
    for (const figure of [...root.querySelectorAll('figure[data-npad-image-block="1"]')]) {
        const block = readImageBlock(figure);
        const image = blockImage(figure);
        if (!block || !image) {
            figure.remove();
            continue;
        }
        let asset = null;
        try { asset = await loadAsset(block.assetId); } catch { /* handled below */ }
        const blob = asset?.blob || asset;
        const source = await blobToDataUri(blob);
        if (!source) {
            figure.remove();
            continue;
        }
        image.src = source;
        image.removeAttribute('data-npad-image-asset');
        image.alt = block.alt.kind === 'informative' ? block.alt.text : '';
        if (asset?.width) image.width = asset.width;
        if (asset?.height) image.height = asset.height;

        const canvas = figure.querySelector(':scope > [data-npad-image-canvas]');
        if (block.crop && canvas) {
            cropStyle(canvas, image, block, asset);
            canvas.removeAttribute('data-npad-image-canvas');
        } else {
            canvas?.replaceWith(image);
        }
        figure.removeAttribute('data-npad-image-block');
        figure.removeAttribute('data-npad-image');
        removeRuntimeClasses(figure);
        figure.setAttribute('style', exportStyle(block, direction));
    }
    return root.innerHTML;
}

/** Build a data-backed block record from a safe temporary import image. */
export function blockFromImportedImage({ assetId = newImageAssetId(), alt = '', caption = '' } = {}) {
    const block = defaultImageBlock(assetId);
    const description = String(alt || '').trim().slice(0, 1000);
    block.alt = description ? { kind: 'informative', text: description } : { kind: 'pending', text: '' };
    block.caption = String(caption || '').trim().slice(0, 1000);
    return block;
}

export { newImageAssetId };
