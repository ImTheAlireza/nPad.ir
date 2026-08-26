/**
 * Tests for assets/js/sanitize.js — the module guarding every untrusted
 * path into the editor (restored documents, paste, drag-drop, opened files).
 *
 * Run: node tests/run.mjs
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

    check('strips <script>', () => {
        const out = sanitizeHtml('<p>hi</p><script>alert(1)</script>');
        assert.ok(!/script/i.test(out), out);
        assert.ok(out.includes('hi'));
    });

    check('strips <iframe>', () => {
        assert.ok(!/iframe/i.test(sanitizeHtml('<iframe src="https://evil.test"></iframe>')));
    });

    check('strips inline event handlers', () => {
        const out = sanitizeHtml('<p onclick="steal()">text</p>');
        assert.ok(!/onclick/i.test(out), out);
        assert.ok(out.includes('text'));
    });

    check('strips onerror on unwrapped img', () => {
        assert.ok(!/onerror/i.test(sanitizeHtml('<img src=x onerror="alert(1)">')));
    });

    check('removes javascript: href but keeps text', () => {
        const out = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
        assert.ok(!/javascript:/i.test(out), out);
        assert.ok(out.includes('click'));
    });

    check('removes data: href', () => {
        assert.ok(!/data:/i.test(sanitizeHtml('<a href="data:text/html,<b>x</b>">x</a>')));
    });

    check('keeps https href', () => {
        assert.ok(sanitizeHtml('<a href="https://example.com">ok</a>').includes('https://example.com'));
    });

    check('keeps mailto href', () => {
        assert.ok(sanitizeHtml('<a href="mailto:a@b.com">mail</a>').includes('mailto:a@b.com'));
    });

    check('strips <style>', () => {
        assert.ok(!/<style/i.test(sanitizeHtml('<style>body{display:none}</style><p>x</p>')));
    });

    check('strips form controls', () => {
        const out = sanitizeHtml('<form><input name="p"><button>go</button></form>');
        assert.ok(!/<form|<input|<button/i.test(out), out);
    });

    check('strips svg script vector', () => {
        assert.ok(!/svg|script/i.test(sanitizeHtml('<svg><script>alert(1)</script></svg>')));
    });

    check('adds rel to target=_blank', () => {
        const out = sanitizeHtml('<a href="https://x.test" target="_blank">x</a>');
        assert.ok(/rel="noopener noreferrer"/.test(out), out);
    });

    group('sanitize: style filtering');

    check('keeps allowed declarations', () => {
        assert.ok(/color:\s*red/i.test(sanitizeHtml('<span style="color: red">x</span>')));
    });

    check('drops url() in style', () => {
        const out = sanitizeHtml('<span style="background-color: url(https://evil.test/x)">x</span>');
        assert.ok(!/url\(/i.test(out), out);
    });

    check('drops disallowed properties', () => {
        const out = sanitizeHtml('<span style="position: fixed; color: blue">x</span>');
        assert.ok(!/position/i.test(out), out);
        assert.ok(/color/i.test(out), out);
    });

    group('sanitize: content preservation');

    check('keeps formatting tags', () => {
        const out = sanitizeHtml('<p><b>b</b><i>i</i><u>u</u><ul><li>l</li></ul></p>');
        ['<b>', '<i>', '<u>', '<ul>', '<li>'].forEach((tg) =>
            assert.ok(out.includes(tg), `${tg} missing from ${out}`));
    });

    check('unwraps unknown tags but keeps text', () => {
        const out = sanitizeHtml('<article>kept</article>');
        assert.ok(out.includes('kept') && !/article/i.test(out), out);
    });

    check('handles word-processor nesting', () => {
        assert.ok(sanitizeHtml('<div><div><span><b>deep</b></span></div></div>').includes('deep'));
    });

    check('empty input returns empty', () => {
        assert.equal(sanitizeHtml(''), '');
        assert.equal(sanitizeHtml(null), '');
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

    check('keeps allowed table styles and drops the rest', () => {
        const out = sanitizeHtml('<table><tbody><tr>'
            + '<td style="background-color: #eee; width: 120px; position: fixed">x</td>'
            + '</tr></tbody></table>');
        assert.ok(/background-color/.test(out), out);
        assert.ok(/width:\s*120px/.test(out), out);
        assert.ok(!/position/.test(out), out);
    });

    check('drops unbounded colspans and rowspans', () => {
        const out = sanitizeHtml('<table><tbody><tr>'
            + '<td colspan="999999" rowspan="-3">x</td><td rowspan="abc">y</td>'
            + '</tr></tbody></table>');
        assert.ok(!/colspan/.test(out), out);
        assert.ok(!/rowspan/.test(out), out);
    });

    check('removes event handlers and class names from table cells', () => {
        const out = sanitizeHtml('<table><tbody><tr>'
            + '<td class="evil" onclick="steal()">safe</td>'
            + '</tr></tbody></table>');
        assert.ok(!/onclick|class=/i.test(out), out);
        assert.ok(out.includes('safe'), out);
    });

    group('sanitize: textToHtml');

    check('escapes angle brackets', () => {
        const out = textToHtml('<script>alert(1)</script>');
        assert.ok(!out.includes('<script>') && out.includes('&lt;script&gt;'), out);
    });

    check('converts newlines to <br>', () => assert.equal(textToHtml('a\nb'), 'a<br>b'));
    check('handles CRLF', () => assert.equal(textToHtml('a\r\nb'), 'a<br>b'));
}
