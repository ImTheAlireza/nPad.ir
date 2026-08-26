/** Image block schema, validation, markup, and portable-export coverage. */

import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://npad.ir/' });
global.window = dom.window;
global.document = dom.window.document;
global.Node = dom.window.Node;

const schema = await import(`file://${path.join(ROOT, 'assets/js/image-schema.js')}`);
const blocks = await import(`file://${path.join(ROOT, 'assets/js/image-blocks.js')}`);
const { sanitizeHtml } = await import(`file://${path.join(ROOT, 'assets/js/sanitize.js')}`);

const pngBytes = Uint8Array.from(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
));

function pngFile(type = 'image/png') {
    const blob = new Blob([pngBytes], { type });
    Object.defineProperty(blob, 'name', { value: 'one-pixel.png' });
    return blob;
}

export default async function run(check, group) {
    group('image blocks: typed schema');

    check('canonicalises block data and removes unknown fields', () => {
        const block = schema.normaliseImageBlock({
            version: 99,
            assetId: 'asset-12345678',
            alt: { kind: 'informative', text: '  Diagram\u0000  ' },
            caption: ' Caption ',
            display: { layout: 'center', widthPercent: 55.555 },
            crop: { x: 10, y: 10, width: 40, height: 30 },
            evil: 'nope',
        });
        assert.deepEqual(block, {
            version: 1,
            assetId: 'asset-12345678',
            alt: { kind: 'informative', text: 'Diagram' },
            caption: 'Caption',
            display: { layout: 'center', widthPercent: 55.56 },
            rotation: 0,
            crop: { x: 10, y: 10, width: 40, height: 30 },
        });
        assert.equal(Object.hasOwn(block, 'evil'), false);
    });

    check('requires a valid asset id and a real informative description', () => {
        assert.equal(schema.normaliseImageBlock({ assetId: 'bad' }), null);
        const pending = schema.normaliseImageBlock({
            assetId: 'asset-12345678', alt: { kind: 'informative', text: '' },
        });
        assert.equal(pending.alt.kind, 'pending');
        const decorative = schema.normaliseImageBlock({
            assetId: 'asset-12345678', alt: { kind: 'decorative', text: 'ignored' },
        });
        assert.deepEqual(decorative.alt, { kind: 'decorative', text: '' });
    });

    check('normalises quarter turns and rotates crop coordinates with the source', () => {
        const block = schema.normaliseImageBlock({ assetId: 'asset-12345678', rotation: 90 });
        assert.equal(block.rotation, 90);
        assert.equal(schema.normaliseImageBlock({ assetId: 'asset-12345678', rotation: 45 }).rotation, 0);
        assert.deepEqual(
            schema.rotateImageCrop({ x: 10, y: 20, width: 30, height: 40 }, 'cw'),
            { x: 40, y: 10, width: 40, height: 30 },
        );
        assert.deepEqual(
            schema.rotateImageCrop({ x: 10, y: 20, width: 30, height: 40 }, 'ccw'),
            { x: 20, y: 60, width: 40, height: 30 },
        );
    });

    group('image blocks: file admission');

    const decodeOnePixel = async () => ({ width: 1, height: 1 });

    await (async () => {
        const inspected = await blocks.inspectImageFile(pngFile(), { decode: decodeOnePixel });
        check('accepts a supported file only after signature and decode checks', () => {
            assert.equal(inspected.type, 'image/png');
            assert.equal(inspected.width, 1);
            assert.equal(inspected.height, 1);
        });
    })();

    await (async () => {
        let mismatch = '';
        try { await blocks.inspectImageFile(pngFile('image/jpeg'), { decode: decodeOnePixel }); }
        catch (error) { mismatch = error.message; }
        check('rejects MIME data that disagrees with the file signature', () => {
            assert.equal(mismatch, 'type-mismatch');
        });
    })();

    await (async () => {
        let pixels = '';
        try { await blocks.inspectImageFile(pngFile(), { decode: async () => ({ width: 8000, height: 8000 }) }); }
        catch (error) { pixels = error.message; }
        check('rejects decoded dimensions above the pixel safety limit', () => {
            assert.equal(pixels, 'too-many-pixels');
        });
    })();

    await (async () => {
        const previousBitmap = global.createImageBitmap;
        const previousCanvas = global.OffscreenCanvas;
        let rotated = 0;
        global.createImageBitmap = async () => ({ width: 2, height: 3, close() {} });
        global.OffscreenCanvas = class {
            constructor(width, height) { this.width = width; this.height = height; }
            getContext() { return { translate() {}, rotate(value) { rotated = value; }, drawImage() {} }; }
            async convertToBlob() { return new Blob([Uint8Array.of(1)], { type: 'image/png' }); }
        };
        let rendered;
        try {
            rendered = await blocks.createImageRenderAsset(
                { blob: pngFile(), type: 'image/png', width: 2, height: 3 },
                { assetId: 'asset-12345678', rotation: 90 },
            );
        } finally {
            global.createImageBitmap = previousBitmap;
            global.OffscreenCanvas = previousCanvas;
        }
        check('derives a quarter-turn render without replacing the source asset', () => {
            assert.equal(rendered.width, 3);
            assert.equal(rendered.height, 2);
            assert.equal(rendered.type, 'image/png');
            assert.equal(rotated, Math.PI / 2);
        });
    })();

    await (async () => {
        let reason = '';
        try {
            await blocks.createImageRenderAsset(
                { blob: pngFile(), type: 'image/gif', width: 1, height: 1 },
                { assetId: 'asset-12345678', rotation: 90 },
            );
        } catch (error) { reason = error.message; }
        check('refuses animated GIF rotation instead of flattening animation', () => {
            assert.equal(reason, 'rotation-animated-unsupported');
        });
    })();

    group('image blocks: stored and portable markup');

    const block = {
        version: 1,
        assetId: 'asset-12345678',
        alt: { kind: 'informative', text: 'Blue square' },
        caption: 'Example caption',
        display: { layout: 'center', widthPercent: 50 },
        crop: { x: 10, y: 10, width: 80, height: 80 },
    };
    const asset = { id: block.assetId, blob: pngFile(), type: 'image/png', size: pngBytes.length, width: 1, height: 1 };
    const figure = blocks.createImageBlockElement(block, { asset, labels: { descriptionNeeded: 'Description needed' } });

    check('creates semantic figure markup without a persisted source URL', () => {
        assert.equal(figure.tagName, 'FIGURE');
        assert.equal(figure.getAttribute('data-npad-image-block'), '1');
        assert.equal(figure.querySelector('img').getAttribute('data-npad-image-asset'), block.assetId);
        assert.equal(figure.querySelector('img').getAttribute('src'), null);
        assert.equal(figure.querySelector('figcaption').textContent, 'Example caption');
    });

    check('stored sanitizer keeps only canonical schema markup', () => {
        const dirty = figure.outerHTML.replace('data-npad-image-block="1"', 'data-npad-image-block="1" onclick="boom()" style="position:fixed"');
        const clean = sanitizeHtml(dirty);
        assert.ok(clean.includes('data-npad-image-block="1"'), clean);
        assert.ok(clean.includes('data-npad-image-asset="asset-12345678"'), clean);
        assert.ok(!/onclick|position:fixed|src=/.test(clean), clean);
        assert.ok(clean.includes('Example caption'), clean);
    });

    check('default sanitizer rejects raw image sources while temporary export mode allows raster data', () => {
        const data = 'data:image/png;base64,iVBORw0KGgo=';
        assert.equal(sanitizeHtml(`<img src="${data}" alt="x">`), '');
        assert.match(sanitizeHtml(`<img src="${data}" alt="x">`, { dataImages: true }), /src="data:image\/png;base64/);
    });

    await (async () => {
        const portable = await blocks.embedImageBlocksAsDataUris(figure.outerHTML, async () => asset);
        check('portable export embeds bytes, keeps crop presentation, and removes runtime attributes', () => {
            const safe = sanitizeHtml(portable, { dataImages: true });
            assert.match(portable, /src="data:image\/png;base64,/);
            assert.ok(!/data-npad-image/.test(portable), portable);
            assert.match(portable, /Example caption/);
            assert.match(safe, /overflow:\s*hidden/);
            assert.match(safe, /position:\s*absolute/);
        });
    })();

    check('copy remapping changes only asset ownership references', () => {
        const remapped = blocks.remapImageAssetIds(figure.outerHTML, new Map([['asset-12345678', 'asset-abcdefgh']]));
        assert.match(remapped, /asset-abcdefgh/);
        assert.match(remapped, /Blue square/);
        assert.match(remapped, /Example caption/);
    });

    await (async () => {
        const start = { ...block, display: { layout: 'start', widthPercent: 50 } };
        const rtlFigure = blocks.createImageBlockElement(start, { asset });
        const portable = await blocks.embedImageBlocksAsDataUris(rtlFigure.outerHTML, async () => asset, { direction: 'rtl' });
        check('portable start/end alignment follows RTL document direction', () => {
            assert.match(portable, /margin-left:auto;\s*margin-right:0/);
        });
    })();

    dom.window.close();
}
