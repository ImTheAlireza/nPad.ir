/**
 * Typed, dependency-free schema for NPad image blocks.
 *
 * This module deliberately knows nothing about the DOM, storage, or styling.
 * Every other image boundary uses this canonical representation so document
 * state never depends on raw CSS or untrusted JSON.
 */

export const IMAGE_BLOCK_VERSION = 1;
export const IMAGE_LAYOUTS = new Set(['block', 'start', 'center', 'end']);
export const IMAGE_ALT_KINDS = new Set(['pending', 'informative', 'decorative']);
export const MIN_IMAGE_WIDTH_PERCENT = 10;
export const MAX_IMAGE_WIDTH_PERCENT = 100;
export const MIN_CROP_PERCENT = 5;

const ASSET_ID = /^asset-[a-z0-9][a-z0-9_-]{7,127}$/i;

function number(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function text(value, maxLength) {
    return String(value ?? '')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
        .trim()
        .slice(0, maxLength);
}

export function isImageAssetId(value) {
    return ASSET_ID.test(String(value || ''));
}

export function newImageAssetId() {
    const token = globalThis.crypto?.randomUUID?.()
        || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
    return `asset-${token}`;
}

export function defaultImageBlock(assetId = '') {
    return {
        version: IMAGE_BLOCK_VERSION,
        assetId: isImageAssetId(assetId) ? assetId : '',
        alt: { kind: 'pending', text: '' },
        caption: '',
        display: { layout: 'block', widthPercent: 100 },
        rotation: 0,
        crop: null,
    };
}

function normaliseCrop(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    let x = number(value.x, 0, 0, 100 - MIN_CROP_PERCENT);
    let y = number(value.y, 0, 0, 100 - MIN_CROP_PERCENT);
    let width = number(value.width, 100, MIN_CROP_PERCENT, 100 - x);
    let height = number(value.height, 100, MIN_CROP_PERCENT, 100 - y);

    // Fit the rectangle in the source even after a user has typed values in
    // an arbitrary order. Rounding keeps saved JSON deterministic.
    width = Math.min(width, 100 - x);
    height = Math.min(height, 100 - y);
    x = Math.min(x, 100 - width);
    y = Math.min(y, 100 - height);

    const rounded = (item) => Math.round(item * 100) / 100;
    const crop = {
        x: rounded(x),
        y: rounded(y),
        width: rounded(width),
        height: rounded(height),
    };
    return crop.x === 0 && crop.y === 0 && crop.width === 100 && crop.height === 100
        ? null
        : crop;
}

/**
 * Parse and normalise a persisted image block. Returns null for malformed or
 * unsupported records rather than guessing at an unsafe fallback.
 */
export function normaliseImageBlock(raw) {
    let value = raw;
    try {
        if (typeof value === 'string') value = JSON.parse(value);
    } catch {
        return null;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    const assetId = String(value.assetId || '');
    if (!isImageAssetId(assetId)) return null;

    const sourceAlt = value.alt && typeof value.alt === 'object' && !Array.isArray(value.alt)
        ? value.alt
        : {};
    let kind = IMAGE_ALT_KINDS.has(sourceAlt.kind) ? sourceAlt.kind : 'pending';
    let altText = text(sourceAlt.text, 1000);
    if (kind === 'decorative') altText = '';
    if (kind === 'informative' && !altText) kind = 'pending';

    const sourceDisplay = value.display && typeof value.display === 'object' && !Array.isArray(value.display)
        ? value.display
        : {};
    const layout = IMAGE_LAYOUTS.has(sourceDisplay.layout) ? sourceDisplay.layout : 'block';
    const widthPercent = Math.round(number(
        sourceDisplay.widthPercent,
        100,
        MIN_IMAGE_WIDTH_PERCENT,
        MAX_IMAGE_WIDTH_PERCENT,
    ) * 100) / 100;
    const rotation = [0, 90, 180, 270].includes(Number(value.rotation))
        ? Number(value.rotation)
        : 0;

    return {
        version: IMAGE_BLOCK_VERSION,
        assetId,
        alt: { kind, text: altText },
        caption: text(value.caption, 1000),
        display: { layout, widthPercent },
        rotation,
        crop: normaliseCrop(value.crop),
    };
}

/**
 * Rotate a crop rectangle with its source so an existing crop continues to
 * describe the same visual region after a quarter turn.
 * @param {object|null} crop
 * @param {'cw'|'ccw'} direction
 */
export function rotateImageCrop(crop, direction = 'cw') {
    const source = normaliseCrop(crop) || { x: 0, y: 0, width: 100, height: 100 };
    const rotated = direction === 'ccw'
        ? {
            x: source.y,
            y: 100 - (source.x + source.width),
            width: source.height,
            height: source.width,
        }
        : {
            x: 100 - (source.y + source.height),
            y: source.x,
            width: source.height,
            height: source.width,
        };
    return normaliseCrop(rotated);
}

export function serialiseImageBlock(block) {
    const canonical = normaliseImageBlock(block);
    return canonical ? JSON.stringify(canonical) : null;
}

export function imageBlockAccessibleName(block, labels = {}) {
    const canonical = normaliseImageBlock(block);
    if (!canonical) return labels.invalid || 'Invalid image block';
    if (canonical.alt.kind === 'informative') return canonical.alt.text;
    if (canonical.alt.kind === 'decorative') return labels.decorative || 'Decorative image';
    return labels.descriptionNeeded || 'Image description needed';
}
