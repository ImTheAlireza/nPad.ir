/**
 * Unit coverage for assets/js/attachments.js — reference format, size/type
 * guards, data-URI conversion, extraction from untrusted HTML, rendering and
 * export embedding. Async results are precomputed at module scope (the
 * harness check() is synchronous), each on its own detached element so no
 * check can interfere with another.
 */

import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'https://npad.ir/' });
global.window = dom.window;
global.document = dom.window.document;
global.Node = dom.window.Node;
// Deliberately NOT replacing global.Blob: the formats suite loads afterwards
// and relies on Node's Blob (stream/arrayBuffer); jsdom's Blob lacks them.

const attachments = await import(`file://${path.join(ROOT, 'assets/js/attachments.js')}`);

const PNG_1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function tinyPngFile(type = 'image/png', name = 'a.png') {
    return new dom.window.File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], name, { type });
}

function editorWith(html) {
    const host = document.createElement('div');
    host.innerHTML = html;
    return host;
}

/* --- module-scope async precomputation --- */

const parsedPng = attachments.dataUriToBlob(PNG_1x1);
const roundTripDataUrl = await attachments.blobToDataUrl(
    new dom.window.Blob([Uint8Array.from([1, 2, 3])], { type: 'image/png' }),
);
const roundTripBytes = parsedPng
    ? [...new Uint8Array(await parsedPng.blob.arrayBuffer())]
    : [];
void roundTripBytes;

const plainImageHtml = attachments.imageHtml('img-1', { alt: 'cat' });
const captionedImageHtml = attachments.imageHtml('img-2', {
    alt: 'a', caption: 'My <b>cat</b>', size: 'medium', align: 'center',
});

const htmlWithRefs = '<img data-npad-img="a"><img data-npad-img="b"><img data-npad-img="a">';
const remappedHtml = attachments.remapImageIds(htmlWithRefs, new Map([['a', 'x'], ['b', 'y']]));

const extracted = await attachments.extractImagesFromHtml(
    `<p>before</p><img src="${PNG_1x1}" alt="x"><img data-npad-img="existing" alt="y"><p>after</p>`,
    async (uri) => {
        // eslint-disable-next-line no-unused-vars
        void uri;
        return '<img data-npad-img="new" alt="">';
    },
);
const remoteExtracted = await attachments.extractImagesFromHtml(
    '<img src="https://example.com/pic.png" alt="Diagram">',
    async () => null,
);

const missingEditor = editorWith('<img data-npad-img="gone" alt="x"><img data-npad-img="also-gone">');
const resolvedMissing = await attachments.resolveImageReferences(missingEditor, async () => null);

const okEditor = editorWith('<img data-npad-img="ok" alt="x">');
const hadUrlFactory = typeof URL.createObjectURL === 'function';
const originalUrlFactory = URL.createObjectURL;
let objectUrlsCreated = 0;
URL.createObjectURL = () => { objectUrlsCreated += 1; return 'blob:https://npad.ir/uuid'; };
const resolvedOk = await attachments.resolveImageReferences(
    okEditor,
    async () => new dom.window.Blob(['x'], { type: 'image/png' }),
);
if (hadUrlFactory) URL.createObjectURL = originalUrlFactory;
else delete URL.createObjectURL;

const strippedEditor = editorWith('<img data-npad-img="a" src="blob:x" class="npad-img-missing">');
attachments.stripImageSources(strippedEditor);

const embeddedHtml = await attachments.embedImagesAsDataUrls(
    '<figure><img data-npad-img="a" alt="x" style="width:50%"><figcaption>cap</figcaption></figure>',
    async () => new dom.window.Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }),
);

export default function run(check, group) {
    group('attachments: guards');

    check('rejects unsupported and oversized files', () => {
        assert.equal(attachments.isSupportedImageFile(tinyPngFile()), true);
        assert.equal(attachments.isSupportedImageFile(tinyPngFile('image/svg+xml', 'a.svg')), false);
        const big = tinyPngFile();
        Object.defineProperty(big, 'size', { value: attachments.MAX_IMAGE_BYTES + 1 });
        assert.equal(attachments.imageTooLarge(big), true);
        assert.equal(attachments.isSupportedImageFile(big), false);
    });

    check('size bound matches document imports (25 MB)', () => {
        assert.equal(attachments.MAX_IMAGE_BYTES, 25 * 1024 * 1024);
    });

    group('attachments: data URIs');

    check('decodes raster data URIs and rejects others', () => {
        assert.ok(parsedPng, 'png not decoded');
        assert.equal(parsedPng.type, 'image/png');
        assert.equal(parsedPng.size > 0, true);
        assert.equal(attachments.dataUriToBlob('data:image/svg+xml;base64,PHN2Zy8+'), null);
        assert.equal(attachments.dataUriToBlob('not a uri'), null);
    });

    check('blob -> data URI round-trips', async () => {
        assert.ok(roundTripDataUrl.startsWith('data:image/png;base64,'), roundTripDataUrl);
        const parsed = attachments.dataUriToBlob(roundTripDataUrl);
        assert.deepEqual([...new Uint8Array(await parsed.blob.arrayBuffer())], [1, 2, 3]);
    });

    group('attachments: reference markup');

    check('imageHtml builds plain references without sources', () => {
        assert.ok(/data-npad-img="img-1"/.test(plainImageHtml), plainImageHtml);
        assert.ok(/alt="cat"/.test(plainImageHtml), plainImageHtml);
        assert.ok(!/src=/.test(plainImageHtml), 'reference markup must not contain a source');
        assert.ok(!/figure/.test(plainImageHtml), plainImageHtml);
    });

    check('imageHtml wraps captioned images and escapes content', () => {
        assert.ok(/<figure/.test(captionedImageHtml), captionedImageHtml);
        assert.ok(/<figcaption>My &lt;b&gt;cat&lt;\/b&gt;<\/figcaption>/.test(captionedImageHtml), captionedImageHtml);
        assert.ok(/width:50%/.test(captionedImageHtml), captionedImageHtml);
        assert.ok(/text-align:center/.test(captionedImageHtml), captionedImageHtml);
    });

    check('collectImageIds and remapImageIds are exact', () => {
        assert.deepEqual(attachments.collectImageIds(htmlWithRefs), ['a', 'b']);
        assert.ok(/data-npad-img="x"/.test(remappedHtml) && /data-npad-img="y"/.test(remappedHtml), remappedHtml);
        assert.ok(!/data-npad-img="a"/.test(remappedHtml), remappedHtml);
    });

    group('attachments: extraction from untrusted HTML');

    check('archives data URIs through the callback and keeps existing refs', () => {
        assert.equal(extracted.archived, 1);
        assert.match(extracted.html, /data-npad-img="new"/);
        assert.match(extracted.html, /data-npad-img="existing"/);
        assert.match(extracted.html, /before/);
        assert.ok(!/src=/.test(extracted.html), extracted.html);
    });

    check('remote images become plain links, never downloads', () => {
        assert.match(remoteExtracted.html, /<a href="https:\/\/example\.com\/pic\.png"/);
        assert.match(remoteExtracted.html, /Diagram/);
        assert.ok(!/<img/.test(remoteExtracted.html), remoteExtracted.html);
    });

    group('attachments: rendering');

    check('resolveImageReferences marks missing payloads, never throws', () => {
        assert.deepEqual(resolvedMissing.missing, ['gone', 'also-gone']);
        assert.equal(missingEditor.querySelectorAll('.npad-img-missing').length, 2);
        assert.ok(!missingEditor.querySelector('img').hasAttribute('src'));
    });

    check('resolveImageReferences sets src when object URLs exist', () => {
        assert.equal(objectUrlsCreated, 1);
        assert.equal(resolvedOk.urls.length, 1);
        assert.equal(okEditor.querySelector('img').getAttribute('src'), 'blob:https://npad.ir/uuid');
    });

    check('stripImageSources removes resolved srcs', () => {
        assert.ok(!strippedEditor.querySelector('img').hasAttribute('src'));
        assert.ok(!strippedEditor.querySelector('img').classList.contains('npad-img-missing'));
    });

    check('embedImagesAsDataUrls produces a self-contained export', () => {
        assert.match(embeddedHtml, /src="data:image\/png;base64,/);
        assert.ok(!/data-npad-img/.test(embeddedHtml), embeddedHtml);
        assert.match(embeddedHtml, /<figcaption>cap<\/figcaption>/);
    });
}
