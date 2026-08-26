/**
 * Tests for assets/js/sanitize.js — the module guarding every untrusted path
 * into the editor (restored documents, paste, drag-drop, opened files).
 */

import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'https://npad.ir/' });
global.window = dom.window;
global.document = dom.window.document;

const { sanitizeHtml, textToHtml } = await import(
    `file://${path.join(ROOT, 'assets/js/sanitize.js')}`
);

export default function run(check, group) {
    group('sanitize: XSS vectors');

    check('strips executable and embedded nodes', () => {
        const out = sanitizeHtml('<p>hi</p><script>alert(1)</script><iframe src="https://evil.test"></iframe>');
        assert.ok(!/script|iframe/i.test(out), out);
        assert.ok(out.includes('hi'));
    });

    check('strips inline event handlers', () => {
        const out = sanitizeHtml('<p onclick="steal()">text</p>');
        assert.ok(!/onclick/i.test(out), out);
        assert.ok(out.includes('text'));
    });

    check('removes unsafe href values but keeps link text', () => {
        const javascript = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
        const data = sanitizeHtml('<a href="data:text/html,<b>x</b>">x</a>');
        assert.ok(!/javascript:/i.test(javascript), javascript);
        assert.ok(!/data:/i.test(data), data);
        assert.ok(javascript.includes('click'));
    });

    check('keeps safe links and hardens target=_blank', () => {
        const out = sanitizeHtml('<a href="https://example.com" target="_blank">ok</a>');
        assert.match(out, /https:\/\/example\.com/);
        assert.match(out, /rel="noopener noreferrer"/);
        assert.ok(sanitizeHtml('<a href="mailto:a@b.com">mail</a>').includes('mailto:a@b.com'));
    });

    check('strips styles, form controls and SVG payloads', () => {
        const out = sanitizeHtml('<style>body{display:none}</style><form><input><button>go</button></form><svg><script>x</script></svg><p>safe</p>');
        assert.ok(!/<style|<form|<input|<button|svg|script/i.test(out), out);
        assert.ok(out.includes('safe'));
    });

    group('sanitize: style filtering');

    check('keeps safe formatting and table declarations', () => {
        const out = sanitizeHtml('<span style="color: red; font-weight: bold">x</span><table style="width: 100%"><tbody><tr><td style="background-color:#eee">y</td></tr></tbody></table>');
        assert.match(out, /color:\s*red/i);
        assert.match(out, /font-weight:\s*bold/i);
        assert.match(out, /width:\s*100%/i);
        assert.match(out, /background-color/i);
    });

    check('drops requests and retired layout/effect declarations', () => {
        const out = sanitizeHtml('<p style="position:fixed;top:0;transform:rotate(1deg);filter:blur(1px);background-color:url(https://evil.test/x);color:blue">x</p>');
        assert.ok(!/position|top|transform|filter|url\(/i.test(out), out);
        assert.match(out, /color:\s*blue/i);
    });

    group('sanitize: content preservation');

    check('keeps supported rich-text tags', () => {
        const out = sanitizeHtml('<p><b>b</b><i>i</i><u>u</u><ul><li>l</li></ul></p>');
        ['<b>', '<i>', '<u>', '<ul>', '<li>'].forEach((tag) =>
            assert.ok(out.includes(tag), `${tag} missing from ${out}`));
    });

    check('unwraps unknown containers but keeps their text', () => {
        const out = sanitizeHtml('<article><div><span><b>kept</b></span></div></article>');
        assert.ok(out.includes('kept') && !/article/i.test(out), out);
    });

    check('empty input returns empty and plain text escapes safely', () => {
        assert.equal(sanitizeHtml(''), '');
        assert.equal(sanitizeHtml(null), '');
        assert.equal(textToHtml('<b>x</b>\nnext'), '&lt;b&gt;x&lt;/b&gt;<br>next');
    });

    group('sanitize: tables');

    const tableHtml = '<table style="width: 100%"><caption>Data</caption>'
        + '<thead><tr><th scope="col">Name</th><th scope="col">Count</th></tr></thead>'
        + '<tbody><tr><td colspan="2" rowspan="3">All</td></tr></tbody></table>';

    check('keeps table structure, spans and scoped headers', () => {
        const out = sanitizeHtml(tableHtml);
        ['<table', '<caption>', '<thead>', '<tbody>', '<th scope="col"', '<td colspan="2" rowspan="3"']
            .forEach((piece) => assert.ok(out.includes(piece), `${piece} missing from ${out}`));
    });

    check('bounds table spans and removes unsafe attributes', () => {
        const out = sanitizeHtml('<table><tbody><tr>'
            + '<td class="evil" onclick="steal()" colspan="999999" rowspan="-3">x</td>'
            + '<td rowspan="abc">y</td></tr></tbody></table>');
        assert.ok(!/colspan|rowspan|onclick|class=/i.test(out), out);
        assert.ok(out.includes('x') && out.includes('y'), out);
    });

    group('sanitize: retired media markup');

    check('removes retired image nodes and metadata', () => {
        const out = sanitizeHtml('<p>before</p><figure data-npad-figure style="position:absolute">'
            + '<img data-npad-img="old-id" data-npad-props="{}" src="blob:https://npad.ir/x" alt="Lost">'
            + '<figcaption>Useful caption</figcaption></figure><p>after</p>');
        assert.ok(!/<img|<figure|<figcaption|data-npad|blob:/i.test(out), out);
        assert.ok(out.includes('before') && out.includes('Useful caption') && out.includes('after'), out);
    });

    check('rejects remote and data-URI media markup through every import path', () => {
        const out = sanitizeHtml('<img src="https://evil.test/a.png"><img src="data:image/png;base64,iVBORw0KGgo=">');
        assert.equal(out, '', out);
    });

    dom.window.close();
}
