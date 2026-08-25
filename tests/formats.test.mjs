/**
 * Unit coverage for local document import/export codecs.
 */

import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { deflateRawSync, deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'https://npad.ir/' });
global.window = dom.window;
global.document = dom.window.document;
global.Node = dom.window.Node;
global.DOMParser = dom.window.DOMParser;

const formats = await import(`file://${path.join(ROOT, 'assets/js/formats.js')}`);

const sourceHtml = '<h2>سلام دنیا</h2><p><strong>Bold</strong> and <em>italic</em> <u>زیرخط</u> <s>strike</s>.</p><ul><li>One</li><li>Two</li></ul>';
const markdown = formats.htmlToMarkdown(sourceHtml);
const markdownHtml = formats.markdownToHtml(markdown);
const rtf = formats.htmlToRtf(sourceHtml);
const rtfHtml = formats.rtfToHtml(rtf);
const rtlRtfHtml = formats.rtfToHtml(formats.htmlToRtf('<p>فارسی</p>', { direction: 'rtl' }));
const docx = formats.htmlToDocx(sourceHtml);
const docxHtml = await formats.docxToHtml(docx);
const rtlDocxHtml = await formats.docxToHtml(formats.htmlToDocx('<p>فارسی</p>', { direction: 'rtl' }));

function testCrc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function compressedDocx(xml) {
    const name = new TextEncoder().encode('word/document.xml');
    const raw = new TextEncoder().encode(xml);
    const data = new Uint8Array(deflateRawSync(raw));
    const crc = testCrc32(raw);
    const local = new Uint8Array(30 + name.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 8, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, name.length, true);
    central.set(name, 46);

    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, 1, true);
    ev.setUint16(10, 1, true);
    ev.setUint32(12, central.length, true);
    ev.setUint32(16, local.length, true);

    const output = new Uint8Array(local.length + central.length + end.length);
    output.set(local);
    output.set(central, local.length);
    output.set(end, local.length + central.length);
    return output;
}

const compressedXml = '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Compressed DOCX</w:t></w:r></w:p></w:body></w:document>';
const compressedDocxHtml = await formats.docxToHtml(compressedDocx(compressedXml));

const pdfText = 'BT /F1 12 Tf 72 720 Td (Hello PDF) Tj ET';
const compressedPdfStream = new Uint8Array(deflateSync(Buffer.from(pdfText)));
const pdfPrefix = new TextEncoder().encode(`%PDF-1.4\n1 0 obj\n<< /Length ${compressedPdfStream.length} /Filter /FlateDecode >>\nstream\n`);
const pdfSuffix = new TextEncoder().encode('\nendstream\nendobj\n%%EOF');
const pdf = new Uint8Array(pdfPrefix.length + compressedPdfStream.length + pdfSuffix.length);
pdf.set(pdfPrefix);
pdf.set(compressedPdfStream, pdfPrefix.length);
pdf.set(pdfSuffix, pdfPrefix.length + compressedPdfStream.length);
const pdfHtml = await formats.pdfToHtml(pdf);
const cmap = `2 beginbfchar
<0001> <0633>
<0002> <0644>
<0003> <0627>
<0004> <0645>
endbfchar`;
const unicodePdfContent = 'BT /F4 12 Tf <0001000200030004> Tj ET';
const unicodePdfSource = `%PDF-1.4
2 0 obj
<< /Font << /F4 4 0 R >> >>
endobj
4 0 obj
<< /Type /Font /ToUnicode 6 0 R >>
endobj
5 0 obj
<< /Length ${unicodePdfContent.length} >>
stream
${unicodePdfContent}
endstream
endobj
6 0 obj
<< /Length ${cmap.length} >>
stream
${cmap}
endstream
endobj
%%EOF`;
const unicodePdfHtml = await formats.pdfToHtml(new TextEncoder().encode(unicodePdfSource));
let encryptedPdfError = '';
let imageOnlyPdfError = '';
try { await formats.pdfToHtml(new TextEncoder().encode('%PDF-1.4\n/Encrypt 2 0 R')); }
catch (error) { encryptedPdfError = error.message; }
try { await formats.pdfToHtml(new TextEncoder().encode('%PDF-1.4\n%%EOF')); }
catch (error) { imageOnlyPdfError = error.message; }

export default function run(check, group) {
    group('formats: Markdown and JSON');

    check('Markdown preserves headings, lists, Unicode and inline formatting', () => {
        assert.match(markdown, /^## سلام دنیا/m);
        assert.match(markdown, /\*\*Bold\*\*/);
        assert.match(markdown, /- One/);
        assert.match(markdownHtml, /<h2>سلام دنیا<\/h2>/);
        assert.match(markdownHtml, /<strong>Bold<\/strong>/);
        assert.match(markdownHtml, /<u>زیرخط<\/u>/);
        assert.match(markdownHtml, /<s>strike<\/s>/);
    });

    check('Markdown import sanitizes active content and unsafe links', () => {
        const html = formats.markdownToHtml('[safe](https://example.com) [bad](javascript:alert(1)) <script>x</script>');
        assert.match(html, /https:\/\/example\.com/);
        assert.ok(!/javascript:|<script/i.test(html), html);
    });

    check('NPad JSON round-trips metadata and sanitizes HTML', () => {
        const json = formats.noteToJson({
            title: 'Portable', html: '<p>Hi</p>', pinned: true, folderId: 'f1', tags: ['t1'],
            createdAt: 1700000000000, updatedAt: 1700000001000,
        }, {
            folders: [{ id: 'f1', name: 'Work' }],
            tags: [{ id: 't1', name: 'Urgent', color: '#dc2626' }],
        });
        const portable = JSON.parse(json);
        portable.note.html = '<p onclick="x()">Hi</p>';
        const [note] = formats.parseNoteJson(portable);
        assert.equal(note.title, 'Portable');
        assert.equal(note.folder.name, 'Work');
        assert.equal(note.tags[0].name, 'Urgent');
        assert.equal(note.pinned, true);
        assert.equal(note.createdAt, 1700000000000);
        assert.equal(note.updatedAt, 1700000001000);
        assert.ok(!note.html.includes('onclick'));
    });

    check('JSON importer accepts note arrays and plain text content', () => {
        const notes = formats.parseNoteJson([{ title: 'A', text: '<not markup>' }, { title: 'B', markdown: '**bold**' }]);
        assert.equal(notes.length, 2);
        assert.match(notes[0].html, /&lt;not markup&gt;/);
        assert.match(notes[1].html, /<strong>bold<\/strong>/);
    });

    group('formats: rich documents');

    check('RTF round-trip preserves Unicode and common rich text', () => {
        assert.match(rtf, /\\u/);
        assert.match(rtfHtml, /سلام دنیا/);
        assert.match(rtfHtml, /<strong>.*B.*o.*l.*d/s);
        assert.match(rtfHtml, /<em>/);
        assert.match(rtfHtml, /<u>/);
        assert.match(rtfHtml, /<s>/);
        assert.match(rtlRtfHtml, /<p dir="rtl">فارسی<\/p>/);
    });

    check('DOCX export is a valid ZIP package and round-trips formatting', () => {
        assert.deepEqual([...docx.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
        assert.match(docxHtml, /سلام دنیا/);
        assert.match(docxHtml, /<strong>Bold<\/strong>/);
        assert.match(docxHtml, /<em>italic<\/em>/);
        assert.match(docxHtml, /<u>زیرخط<\/u>/);
        assert.match(docxHtml, /<s>strike<\/s>/);
        assert.match(rtlDocxHtml, /<p dir="rtl">فارسی<\/p>/);
    });

    check('DOCX importer reads ordinary deflate-compressed Open XML', () => {
        assert.match(compressedDocxHtml, /<strong>Compressed DOCX<\/strong>/);
    });

    check('PDF importer inflates streams and follows Unicode font maps', () => {
        assert.match(pdfHtml, /Hello PDF/);
        assert.match(unicodePdfHtml, /سلام/);
    });

    check('PDF importer rejects encrypted and image-only documents clearly', () => {
        assert.match(encryptedPdfError, /Encrypted/);
        assert.match(imageOnlyPdfError, /No extractable/);
    });
}
