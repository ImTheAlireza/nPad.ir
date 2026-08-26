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

const { normaliseImageProps } = await import(`file://${path.join(ROOT, 'assets/js/sanitize.js')}`);
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

    group('attachments: object model (crop, layout, rotation, adjustments)');

    const cropProps = attachments.defaultImageProps();
    cropProps.crop = { l: 10, r: 10, t: 5, b: 5 };
    cropProps.layout = 'wrap-right';
    cropProps.rotate = 30;
    cropProps.flipH = true;
    cropProps.opacity = 60;
    cropProps.brightness = 120;
    cropProps.contrast = 80;
    cropProps.recolor = 'grayscale';
    cropProps.margin = { top: 4, right: 8, bottom: 12, left: 16 };
    cropProps.border = { width: 2, color: '#dc2626', radius: 12, shadow: true };
    cropProps.width = '50%';
    const propsCanonical = normaliseImageProps(cropProps);

    const cropHtml = attachments.imageHtml('img-crop', {
        alt: 'cropped', caption: 'C', props: JSON.parse(propsCanonical),
    });
    const wrapCss = attachments.imageFigureCss(cropProps);
    const elementCss = attachments.imageElementCss(cropProps);
    const cropPos = attachments.cropObjectPosition(cropProps.crop);

    check('crop region and frame math are exact', () => {
        assert.equal(cropPos.x, 12.5);
        assert.equal(cropPos.y, 5.555555555555555);
        assert.ok(attachments.cropFramePadding({ l: 10, r: 10, t: 5, b: 5 }, 1) > 0);
        assert.equal(attachments.cropFramePadding({ l: 0, r: 0, t: 0, b: 0 }, 1), 100);
    });

    check('crop markup wraps the image in a clipped frame', () => {
        assert.match(cropHtml, /data-npad-frame/);
        assert.match(cropHtml, /data-npad-frame-clip/);
        assert.match(cropHtml, /object-fit:cover/);
        assert.match(cropHtml, /object-position:12\.5% 5\.555555555555555%/);
    });

    check('figure CSS maps layout and margins; element CSS maps effects', () => {
        assert.match(wrapCss, /float:right/);
        assert.match(wrapCss, /margin:4px 8px 12px 16px/);
        assert.match(elementCss, /width:50%/);
        assert.match(elementCss, /opacity:0\.6/);
        assert.match(elementCss, /filter:grayscale\(1\) brightness\(120%\) contrast\(80%\)/);
        assert.match(elementCss, /transform:rotate\(30deg\) scaleX\(-1\)/);
        assert.match(elementCss, /border:2px solid #dc2626/);
        assert.match(elementCss, /border-radius:12px/);
        assert.match(elementCss, /box-shadow/);
    });

    check('behind/front/fixed map to absolute placement', () => {
        const behind = attachments.defaultImageProps();
        behind.layout = 'behind';
        behind.pos = { x: 40, y: -12 };
        const css = attachments.imageFigureCss(behind);
        assert.match(css, /position:absolute/);
        assert.match(css, /left:40px/);
        assert.match(css, /top:-12px/);
        assert.match(css, /z-index:-1/);
        const fixed = attachments.defaultImageProps();
        fixed.layout = 'front';
        assert.match(attachments.imageFigureCss(fixed), /z-index:1/);
    });

    check('writeImageProps round-trips through data-npad-props', () => {
        const host = editorWith(`<img data-npad-img="a" alt="x">`);
        const img = host.querySelector('img');
        attachments.writeImageProps(img, cropProps);
        const parsed = attachments.readImageProps(img);
        assert.equal(parsed.layout, 'wrap-right');
        assert.equal(parsed.rotate, 30);
        assert.deepEqual(parsed.crop, { l: 10, r: 10, t: 5, b: 5 });
        assert.match(img.getAttribute('style'), /opacity:0\.6/);
    });

    check('embedImagesAsDataUrls flattens props into inline styles', async () => {
        const html = '<figure data-npad-frame data-npad-anchor="paragraph" style="float:right">'
            + `<img data-npad-img="a" data-npad-props="${propsCanonical.replace(/"/g, '&quot;')}" alt="x">`
            + '<figcaption>C</figcaption></figure>';
        const out = await attachments.embedImagesAsDataUrls(html, async () =>
            new window.Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }));
        assert.ok(!/data-npad-/.test(out), out);
        assert.match(out, /float:\s*right/);
        assert.match(out, /opacity:0\.6/);
        assert.match(out, /filter:/);
        assert.match(out, /transform:rotate\(30deg\)/);
        assert.match(out, /src="data:image\/png;base64,/);
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
