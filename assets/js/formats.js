/**
 * Local document format codecs.
 *
 * No content is sent to a server. Markdown, JSON and RTF are handled as text;
 * DOCX uses a tiny Open XML/ZIP reader-writer; PDF import extracts text from
 * common text-based content streams. PDF export is delegated to the browser's
 * print-to-PDF path so installed fonts and rich layout remain intact.
 */

import { sanitizeHtml, textToHtml } from './sanitize.js';

const utf8 = new TextEncoder();
const utf8Decoder = new TextDecoder('utf-8');
const latin1Decoder = new TextDecoder('windows-1252');

function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
}

function escapeXml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

import { tableGrid } from './table.js';

function htmlBody(html) {
    // Export paths embed images as data URIs, so this parse must allow them
    // (persisted notes never contain sources; the editor archives first).
    return new DOMParser().parseFromString(
        `<body>${sanitizeHtml(html || '', { dataImages: true })}</body>`,
        'text/html',
    ).body;
}

/* -------------------------------------------------------------------------
   Markdown
   ------------------------------------------------------------------------- */

function markdownText(value) {
    return String(value || '').replace(/([\\`*_[\]<>])/g, '\\$1');
}

function nodeToMarkdown(node, depth = 0) {
    if (node.nodeType === Node.TEXT_NODE) return markdownText(node.nodeValue);
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName.toLowerCase();
    const children = () => [...node.childNodes].map((child) => nodeToMarkdown(child, depth)).join('');
    const content = children();

    if (/^h[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag[1]))} ${content.trim()}\n\n`;
    if (tag === 'p' || tag === 'div') return `${content.trim()}\n\n`;
    if (tag === 'img') {
        const src = node.getAttribute('src') || '';
        if (!src.startsWith('data:image/')) return node.getAttribute('alt') || '';
        return `![${(node.getAttribute('alt') || '').replace(/\]/g, '\\]')}](${src})`;
    }
    if (tag === 'figure') {
        const img = node.querySelector(':scope > img');
        const caption = node.querySelector(':scope > figcaption');
        const image = img ? nodeToMarkdown(img) : '';
        const captionText = caption?.textContent.trim() ? `\n\n*${markdownText(caption.textContent.trim())}*` : '';
        return `${image}${captionText}\n\n`;
    }
    if (tag === 'figcaption') return '';
    if (tag === 'br') return '\n';
    if (tag === 'strong' || tag === 'b') return `**${content}**`;
    if (tag === 'em' || tag === 'i') return `*${content}*`;
    if (tag === 'u') return `<u>${content}</u>`;
    if (tag === 's' || tag === 'del' || tag === 'strike') return `~~${content}~~`;
    if (tag === 'code' && node.parentElement?.tagName !== 'PRE') return `\`${node.textContent.replace(/`/g, '\\`')}\``;
    if (tag === 'pre') return `\`\`\`\n${node.textContent.replace(/\n+$/, '')}\n\`\`\`\n\n`;
    if (tag === 'hr') return '---\n\n';
    if (tag === 'table') {
        const rows = [...node.rows].filter((row) => row.closest('table') === node);
        if (!rows.length) return '';

        const cellText = (cell) => [...cell.childNodes]
            .map((child) => nodeToMarkdown(child, depth + 1))
            .join('')
            .replace(/\s*\n\s*/g, ' ')
            .replace(/\|/g, '\\|')
            .trim();

        const hasHeader = [...node.querySelectorAll('th')]
            .some((th) => th.closest('table') === node);

        // GFM pipe tables always produce a header row, so a headerless table
        // is emitted as raw HTML to keep the round trip faithful.
        if (!hasHeader) return `\n${node.outerHTML}\n\n`;

        const alignOf = (cell) => {
            const style = (cell.getAttribute('style') || '')
                .match(/text-align\s*:\s*(left|center|right)/i);
            if (style) return style[1].toLowerCase();
            const align = (cell.getAttribute('align') || '').toLowerCase();
            return ['left', 'center', 'right'].includes(align) ? align : '';
        };

        const firstRow = rows[0];
        const header = `| ${[...firstRow.cells].map(cellText).join(' | ')} |`;
        const divider = `| ${[...firstRow.cells].map((cell) => {
            const align = alignOf(cell);
            if (align === 'center') return ':---:';
            if (align === 'right') return '---:';
            if (align === 'left') return ':---';
            return '---';
        }).join(' | ')} |`;
        const body = rows.slice(1).map((row) =>
            `| ${[...row.cells].map(cellText).join(' | ')} |`).join('\n');
        return `${header}\n${divider}${body ? `\n${body}` : ''}\n\n`;
    }
    if (tag === 'blockquote') {
        return `${content.trim().split('\n').map((line) => `> ${line}`).join('\n')}\n\n`;
    }
    if (tag === 'a') {
        const href = node.getAttribute('href') || '';
        return href ? `[${content || markdownText(href)}](${href.replace(/[()\s]/g, (c) => encodeURIComponent(c))})` : content;
    }
    if (tag === 'ul' || tag === 'ol') {
        const ordered = tag === 'ol';
        return `${[...node.children].filter((child) => child.tagName === 'LI').map((item, index) => {
            const nested = [...item.children].filter((child) => ['UL', 'OL'].includes(child.tagName));
            const clone = item.cloneNode(true);
            [...clone.children].filter((child) => ['UL', 'OL'].includes(child.tagName)).forEach((child) => child.remove());
            const line = [...clone.childNodes].map((child) => nodeToMarkdown(child, depth + 1)).join('').trim();
            const prefix = ordered ? `${index + 1}. ` : '- ';
            const nestedText = nested.map((list) => nodeToMarkdown(list, depth + 1)
                .trim().split('\n').map((part) => `  ${part}`).join('\n')).join('\n');
            return `${'  '.repeat(depth)}${prefix}${line}${nestedText ? `\n${nestedText}` : ''}`;
        }).join('\n')}\n\n`;
    }
    if (tag === 'li') return content;
    return content;
}

export function htmlToMarkdown(html) {
    const markdown = [...htmlBody(html).childNodes]
        .map((node) => nodeToMarkdown(node))
        .join('')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return markdown ? `${markdown}\n` : '';
}

function inlineMarkdown(value) {
    const tokens = [];
    const token = (html) => {
        const key = `\u0000${tokens.length}\u0000`;
        tokens.push(html);
        return key;
    };

    let out = String(value || '');
    // Markdown has no native underline syntax, so accept only this narrow,
    // safely escaped inline-HTML extension (also emitted by htmlToMarkdown).
    out = out.replace(/<u>([^<>]*)<\/u>/gi, (_match, text) => token(`<u>${escapeHtml(text)}</u>`));
    out = out.replace(/`([^`]+)`/g, (_match, code) => token(`<code>${escapeHtml(code)}</code>`));
    // Images: kept as data URIs (raster only) so the import pipeline can
    // archive them before persisting.
    out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, src) => {
        if (!/^data:image\/(png|jpeg|gif|webp|avif|bmp);base64,/i.test(src)) return '';
        return token(`<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">`);
    });
    out = escapeHtml(out);
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, rawHref) => {
        let href = rawHref.replace(/&amp;/g, '&').trim();
        try { href = decodeURIComponent(href); } catch { /* leave encoded */ }
        if (!/^(https?:|mailto:)/i.test(href)) return label;
        return token(`<a href="${escapeHtml(href)}">${label}</a>`);
    });
    out = out
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_]+)__/g, '<strong>$1</strong>')
        .replace(/~~([^~]+)~~/g, '<s>$1</s>')
        .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
        .replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
    tokens.forEach((html, index) => {
        out = out.replace(`\u0000${index}\u0000`, html);
    });
    return out;
}

function isMarkdownBlock(line) {
    return /^\s*(#{1,6}\s|>|[-+*]\s|\d+[.)]\s|```|~~~|(?:-{3,}|\*{3,})\s*$|<table|<\/table)/i.test(line);
}

/** Split a GFM table row on unescaped pipes. */
function splitTableRow(line) {
    const cells = [];
    let buffer = '';
    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (char === '\\' && line[index + 1] === '|') { buffer += '|'; index += 1; continue; }
        if (char === '|') { cells.push(buffer.trim()); buffer = ''; continue; }
        buffer += char;
    }
    cells.push(buffer.trim());
    return cells;
}

const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

export function markdownToHtml(markdown) {
    const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];

    for (let index = 0; index < lines.length;) {
        const line = lines[index];
        if (!line.trim()) { index += 1; continue; }

        const fence = line.match(/^\s*(```|~~~)/);
        if (fence) {
            const marker = fence[1];
            const code = [];
            index += 1;
            while (index < lines.length && !lines[index].trim().startsWith(marker)) code.push(lines[index++]);
            if (index < lines.length) index += 1;
            blocks.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
            continue;
        }

        const heading = line.match(/^\s*(#{1,6})\s+(.+)$/);
        if (heading) {
            blocks.push(`<h${heading[1].length}>${inlineMarkdown(heading[2])}</h${heading[1].length}>`);
            index += 1;
            continue;
        }

        if (/^\s*(?:-{3,}|\*{3,})\s*$/.test(line)) {
            blocks.push('<hr>');
            index += 1;
            continue;
        }

        // Raw HTML table block (emitted for headerless tables to stay faithful).
        if (/^\s*<table[\s>]/i.test(line)) {
            const raw = [line];
            index += 1;
            while (index < lines.length && !/<\/table\s*>/i.test(lines[index])) raw.push(lines[index++]);
            if (index < lines.length) raw.push(lines[index++]);
            blocks.push(raw.join('\n'));
            continue;
        }

        // GFM pipe table: a header line followed immediately by a divider row.
        if (/^\s*\|/.test(line) && lines[index + 1] && TABLE_DIVIDER.test(lines[index + 1])) {
            const headerCells = splitTableRow(line.trim().replace(/^\|\s*|\s*\|$/g, ''));
            const alignCells = splitTableRow(lines[index + 1].trim().replace(/^\|\s*|\s*\|$/g, ''));
            const aligns = alignCells.map((cell) => {
                if (cell.startsWith(':') && cell.endsWith(':')) return 'center';
                if (cell.endsWith(':')) return 'right';
                if (cell.startsWith(':')) return 'left';
                return '';
            });
            const body = [];
            index += 2;
            while (index < lines.length && /^\s*\|/.test(lines[index])) {
                body.push(splitTableRow(lines[index].trim().replace(/^\|\s*|\s*\|$/g, '')));
                index += 1;
            }

            const colCount = Math.max(headerCells.length, ...body.map((row) => row.length));
            const pad = (row) => {
                const out = [...row];
                while (out.length < colCount) out.push('');
                return out;
            };
            const cellHtml = (text, align) => {
                const style = align ? ` style="text-align: ${align}"` : '';
                return `<td${style}>${inlineMarkdown(text) || '<br>'}</td>`;
            };
            const headerHtml = pad(headerCells).map((text, i) => {
                const style = aligns[i] ? ` style="text-align: ${aligns[i]}"` : '';
                return `<th${style}>${inlineMarkdown(text) || '<br>'}</th>`;
            }).join('');
            const bodyHtml = body.map((row) => `<tr>${pad(row)
                .map((text, i) => cellHtml(text, aligns[i])).join('')}</tr>`).join('');
            blocks.push(`<table><thead><tr>${headerHtml}</tr></thead>` +
                `<tbody>${bodyHtml}</tbody></table>`);
            continue;
        }

        if (/^\s*>/.test(line)) {
            const quote = [];
            while (index < lines.length && /^\s*>/.test(lines[index])) {
                quote.push(lines[index++].replace(/^\s*>\s?/, ''));
            }
            blocks.push(`<blockquote><p>${inlineMarkdown(quote.join('<br>'))}</p></blockquote>`);
            continue;
        }

        const list = line.match(/^\s*([-+*]|\d+[.)])\s+(.+)$/);
        if (list) {
            const ordered = /^\d/.test(list[1]);
            const items = [];
            while (index < lines.length) {
                const match = lines[index].match(/^\s*([-+*]|\d+[.)])\s+(.+)$/);
                if (!match || /^\d/.test(match[1]) !== ordered) break;
                items.push(`<li>${inlineMarkdown(match[2])}</li>`);
                index += 1;
            }
            blocks.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
            continue;
        }

        const paragraph = [line.trim()];
        index += 1;
        while (index < lines.length && lines[index].trim() && !isMarkdownBlock(lines[index])) {
            paragraph.push(lines[index].trim());
            index += 1;
        }
        blocks.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`);
    }

    return sanitizeHtml(blocks.join(''), { dataImages: true });
}

/* -------------------------------------------------------------------------
   JSON
   ------------------------------------------------------------------------- */

export function noteToJson(note, organization = { folders: [], tags: [] }) {
    const folder = organization.folders?.find((item) => item.id === note.folderId);
    const tags = (note.tags || []).map((id) => organization.tags?.find((item) => item.id === id))
        .filter(Boolean)
        .map((tag) => ({ name: tag.name, color: tag.color }));
    return JSON.stringify({
        format: 'npad-note',
        version: 1,
        exportedAt: new Date().toISOString(),
        note: {
            title: String(note.title || ''),
            html: String(note.html || ''),
            pinned: !!note.pinned,
            folder: folder ? { name: folder.name } : null,
            tags,
            createdAt: Number(note.createdAt) || null,
            updatedAt: Number(note.updatedAt) || null,
        },
    }, null, 2);
}

export function parseNoteJson(json) {
    const parsed = typeof json === 'string' ? JSON.parse(json) : json;
    const rawNotes = Array.isArray(parsed) ? parsed
        : Array.isArray(parsed?.notes) ? parsed.notes
            : parsed?.note ? [parsed.note] : [parsed];
    if (rawNotes.length > 100) throw new Error('JSON contains too many notes');
    return rawNotes.filter((note) => note && typeof note === 'object').map((note) => {
        let html = note.html ?? note.content;
        if (html === undefined && note.markdown !== undefined) html = markdownToHtml(note.markdown);
        else if (html === undefined) html = textToHtml(String(note.text ?? ''));
        else html = sanitizeHtml(String(html), { dataImages: true });
        const folder = typeof note.folder === 'string'
            ? { name: note.folder }
            : (note.folder && typeof note.folder === 'object' ? { name: String(note.folder.name || '') } : null);
        const tags = (Array.isArray(note.tags) ? note.tags : []).map((tag) =>
            typeof tag === 'string'
                ? { name: tag, color: '#0e7490' }
                : { name: String(tag?.name || ''), color: String(tag?.color || '#0e7490') })
            .filter((tag) => tag.name.trim());
        const validTimestamp = (value) => {
            const number = Number(value);
            return Number.isFinite(number) && number > 0 ? number : null;
        };
        return {
            title: String(note.title || ''),
            html,
            pinned: !!note.pinned,
            folder,
            tags,
            createdAt: validTimestamp(note.createdAt),
            updatedAt: validTimestamp(note.updatedAt),
        };
    });
}

/* -------------------------------------------------------------------------
   Rich Text Format (RTF)
   ------------------------------------------------------------------------- */

function rtfEscape(value) {
    let out = '';
    for (const character of String(value || '')) {
        const point = character.codePointAt(0);
        if (character === '\\' || character === '{' || character === '}') out += `\\${character}`;
        else if (character === '\n') out += '\\line ';
        else if (point >= 32 && point <= 126) out += character;
        else {
            for (let index = 0; index < character.length; index += 1) {
                const unit = character.charCodeAt(index);
                out += `\\u${unit > 32767 ? unit - 65536 : unit}?`;
            }
        }
    }
    return out;
}

function nodeToRtf(node) {
    if (node.nodeType === Node.TEXT_NODE) return rtfEscape(node.nodeValue);
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.tagName.toLowerCase();
    const content = [...node.childNodes].map(nodeToRtf).join('');
    if (tag === 'strong' || tag === 'b') return `{\\b ${content}}`;
    if (tag === 'em' || tag === 'i') return `{\\i ${content}}`;
    if (tag === 'u' || tag === 'a') return `{\\ul ${content}}`;
    if (tag === 's' || tag === 'del' || tag === 'strike') return `{\\strike ${content}}`;
    if (tag === 'br') return '\\line ';
    if (tag === 'code') return `{\\f1 ${content}}`;
    if (tag === 'pre') return `{\\f1 ${rtfEscape(node.textContent)}}\\par\n`;
    if (/^h[1-6]$/.test(tag)) return `{\\b\\fs${Math.max(24, 42 - Number(tag[1]) * 4)} ${content}}\\par\n`;
    if (tag === 'p' || tag === 'div' || tag === 'blockquote') return `${content}\\par\n`;
    if (tag === 'li') return content;
    if (tag === 'ul') return [...node.children].map((item) => `\\bullet\\tab ${nodeToRtf(item)}\\par\n`).join('');
    if (tag === 'ol') return [...node.children].map((item, index) => `${index + 1}.\\tab ${nodeToRtf(item)}\\par\n`).join('');
    if (tag === 'hr') return '____________________\\par\n';
    if (tag === 'img') {
        // RTF pict blobs are engine-specific; keep the alt text so nothing
        // silently disappears (documented limitation).
        const alt = (node.getAttribute('alt') || '').trim();
        return alt ? `[${rtfEscape(alt)}]` : '';
    }
    if (tag === 'figure') return content;
    if (tag === 'figcaption') return `{\\i ${content}}\\par\\n`;
    if (tag === 'table') {
        // RTF tables need a separate complex structure; NPad flattens them to
        // tab-separated rows so no content is lost (documented limitation).
        const rows = [...node.rows].filter((row) => row.closest('table') === node);
        if (!rows.length) return '';
        return rows.map((row) =>
            `${[...row.cells].map((cell) => nodeToRtf(cell)).join('\\tab ')}\\par\n`).join('');
    }
    return content;
}

export function htmlToRtf(html, { direction = 'ltr' } = {}) {
    const body = htmlBody(html);
    const content = [...body.childNodes].map(nodeToRtf).join('');
    const paragraphDirection = direction === 'rtl' ? '\\rtlpar ' : '\\ltrpar ';
    return `{\\rtf1\\ansi\\uc1\\deff0{\\fonttbl{\\f0 Arial;}{\\f1 Courier New;}}\n${paragraphDirection}${content}}`;
}

function styledRtfText(text, state) {
    let out = escapeHtml(text);
    if (state.strike) out = `<s>${out}</s>`;
    if (state.underline) out = `<u>${out}</u>`;
    if (state.italic) out = `<em>${out}</em>`;
    if (state.bold) out = `<strong>${out}</strong>`;
    return out;
}

export function rtfToHtml(rtf) {
    const source = String(rtf || '');
    if (!/^\s*{\\rtf/i.test(source)) throw new Error('Invalid RTF');
    const destinations = new Set([
        'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'header', 'footer',
        'listtable', 'listoverridetable', 'generator', 'xmlnstbl', 'themedata', 'datastore',
    ]);
    const paragraphs = [[]];
    const paragraphDirections = ['ltr'];
    const stack = [];
    let state = {
        bold: false,
        italic: false,
        underline: false,
        strike: false,
        skip: false,
        uc: 1,
        direction: 'ltr',
    };
    let fallback = 0;
    const append = (text) => {
        if (!state.skip && text) paragraphs.at(-1).push(styledRtfText(text, state));
    };
    const paragraph = () => {
        if (!state.skip && paragraphs.at(-1).length) {
            paragraphs.push([]);
            paragraphDirections.push(state.direction);
        }
    };

    for (let index = 0; index < source.length;) {
        const character = source[index];
        if (character === '{') {
            stack.push({ ...state });
            index += 1;
            continue;
        }
        if (character === '}') {
            state = stack.pop() || state;
            index += 1;
            continue;
        }
        if (character !== '\\') {
            // Physical line breaks delimit RTF source; visible breaks are
            // represented by the \line or \par control words.
            if (character === '\n' || character === '\r') { index += 1; continue; }
            if (!fallback) append(character);
            else fallback -= 1;
            index += 1;
            continue;
        }

        index += 1;
        const symbol = source[index];
        if (symbol === '\\' || symbol === '{' || symbol === '}') {
            if (!fallback) append(symbol); else fallback -= 1;
            index += 1;
            continue;
        }
        if (symbol === "'") {
            const hex = source.slice(index + 1, index + 3);
            if (/^[\da-f]{2}$/i.test(hex)) {
                if (!fallback) append(latin1Decoder.decode(Uint8Array.of(parseInt(hex, 16))));
                else fallback -= 1;
                index += 3;
                continue;
            }
        }
        if (symbol === '*') {
            state.skip = true;
            index += 1;
            continue;
        }
        if (symbol === '~') { append('\u00a0'); index += 1; continue; }
        if (symbol === '_') { append('—'); index += 1; continue; }
        if (symbol === '-') { index += 1; continue; }
        if (symbol === '\n' || symbol === '\r') { index += 1; continue; }

        const match = source.slice(index).match(/^([a-zA-Z]+)(-?\d+)? ?/);
        if (!match) { index += 1; continue; }
        const word = match[1].toLowerCase();
        const value = match[2] === undefined ? null : Number(match[2]);
        index += match[0].length;

        if (destinations.has(word)) state.skip = true;
        else if (word === 'b') state.bold = value !== 0;
        else if (word === 'i') state.italic = value !== 0;
        else if (word === 'ul') state.underline = value !== 0;
        else if (word === 'ulnone') state.underline = false;
        else if (word === 'strike') state.strike = value !== 0;
        else if (word === 'plain') state = { ...state, bold: false, italic: false, underline: false, strike: false };
        else if (word === 'par') paragraph();
        else if (word === 'rtlpar') {
            state.direction = 'rtl';
            paragraphDirections[paragraphs.length - 1] = 'rtl';
        } else if (word === 'ltrpar') {
            state.direction = 'ltr';
            paragraphDirections[paragraphs.length - 1] = 'ltr';
        } else if (word === 'line') append('\n');
        else if (word === 'tab') append('\t');
        else if (word === 'uc' && value !== null) state.uc = Math.max(0, value);
        else if (word === 'u' && value !== null) {
            append(String.fromCharCode(value < 0 ? value + 65536 : value));
            fallback = state.uc;
        } else if (word === 'bin' && value) index += value;
    }

    while (paragraphs.length && !paragraphs.at(-1).length) {
        paragraphs.pop();
        paragraphDirections.pop();
    }
    let html = paragraphs.map((parts, index) => {
        const direction = paragraphDirections[index] === 'rtl' ? ' dir="rtl"' : '';
        return `<p${direction}>${parts.join('').replace(/\n/g, '<br>')}</p>`;
    }).join('');
    // The streaming parser emits safely escaped text as it goes. Coalesce
    // adjacent runs so a bold word is one semantic element, not one per code
    // unit (especially important for Unicode RTF \u escapes).
    for (const tag of ['strong', 'em', 'u', 's']) {
        html = html.replace(new RegExp(`</${tag}><${tag}>`, 'g'), '');
    }
    return sanitizeHtml(html);
}

/* -------------------------------------------------------------------------
   ZIP + DOCX
   ------------------------------------------------------------------------- */

function concatBytes(parts) {
    const size = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { output.set(part, offset); offset += part.length; }
    return output;
}

let crcTable;
function crc32(bytes) {
    if (!crcTable) {
        crcTable = new Uint32Array(256);
        for (let number = 0; number < 256; number += 1) {
            let value = number;
            for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
            crcTable[number] = value >>> 0;
        }
    }
    let crc = 0xffffffff;
    for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
    return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    return {
        time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
        date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    };
}

function makeZip(entries) {
    const locals = [];
    const centrals = [];
    let offset = 0;
    const stamp = dosDateTime();

    for (const [name, content] of entries) {
        const nameBytes = utf8.encode(name);
        const data = content instanceof Uint8Array ? content : utf8.encode(content);
        const crc = crc32(data);
        const local = new Uint8Array(30 + nameBytes.length);
        const lv = new DataView(local.buffer);
        lv.setUint32(0, 0x04034b50, true);
        lv.setUint16(4, 20, true);
        lv.setUint16(6, 0x0800, true);
        lv.setUint16(8, 0, true);
        lv.setUint16(10, stamp.time, true);
        lv.setUint16(12, stamp.date, true);
        lv.setUint32(14, crc, true);
        lv.setUint32(18, data.length, true);
        lv.setUint32(22, data.length, true);
        lv.setUint16(26, nameBytes.length, true);
        local.set(nameBytes, 30);
        locals.push(local, data);

        const central = new Uint8Array(46 + nameBytes.length);
        const cv = new DataView(central.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(8, 0x0800, true);
        cv.setUint16(10, 0, true);
        cv.setUint16(12, stamp.time, true);
        cv.setUint16(14, stamp.date, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, data.length, true);
        cv.setUint32(24, data.length, true);
        cv.setUint16(28, nameBytes.length, true);
        cv.setUint32(38, 0, true);
        cv.setUint32(42, offset, true);
        central.set(nameBytes, 46);
        centrals.push(central);
        offset += local.length + data.length;
    }

    const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    return concatBytes([...locals, ...centrals, end]);
}

async function decompress(bytes, format, limit = 30 * 1024 * 1024) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Compressed documents are unsupported');
    const reader = new Blob([bytes]).stream()
        .pipeThrough(new DecompressionStream(format))
        .getReader();
    const chunks = [];
    let size = 0;
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) {
            await reader.cancel();
            throw new Error('Decompressed document is too large');
        }
        chunks.push(value);
    }
    return concatBytes(chunks);
}

async function unzip(buffer, wantedNames = null) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;
    for (let index = Math.max(0, bytes.length - 65557); index <= bytes.length - 22; index += 1) {
        if (view.getUint32(index, true) === 0x06054b50) end = index;
    }
    if (end < 0) throw new Error('Invalid ZIP');
    const count = view.getUint16(end + 10, true);
    if (count > 10000) throw new Error('ZIP contains too many entries');
    let offset = view.getUint32(end + 16, true);
    let declaredTotal = 0;
    const entries = new Map();

    for (let item = 0; item < count; item += 1) {
        if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) {
            throw new Error('Invalid ZIP directory');
        }
        const compression = view.getUint16(offset + 10, true);
        const expectedCrc = view.getUint32(offset + 16, true);
        const compressedSize = view.getUint32(offset + 20, true);
        const uncompressedSize = view.getUint32(offset + 24, true);
        const nameLength = view.getUint16(offset + 28, true);
        const extraLength = view.getUint16(offset + 30, true);
        const commentLength = view.getUint16(offset + 32, true);
        const localOffset = view.getUint32(offset + 42, true);
        const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
        if (nextOffset > bytes.length) throw new Error('Invalid ZIP directory');
        const name = utf8Decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
        declaredTotal += uncompressedSize;
        if (declaredTotal > 100 * 1024 * 1024) throw new Error('Decompressed archive is too large');
        offset = nextOffset;
        if (wantedNames && !wantedNames.has(name)) continue;
        if (uncompressedSize > 30 * 1024 * 1024) throw new Error('ZIP entry too large');
        if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) {
            throw new Error('Invalid ZIP entry');
        }
        const localNameLength = view.getUint16(localOffset + 26, true);
        const localExtraLength = view.getUint16(localOffset + 28, true);
        const start = localOffset + 30 + localNameLength + localExtraLength;
        if (start + compressedSize > bytes.length) throw new Error('Invalid ZIP entry data');
        const compressed = bytes.slice(start, start + compressedSize);
        let data;
        if (compression === 0) data = compressed;
        else if (compression === 8) data = await decompress(compressed, 'deflate-raw');
        else throw new Error('Unsupported ZIP compression');
        if (data.length !== uncompressedSize) throw new Error('Invalid ZIP entry size');
        if (crc32(data) !== expectedCrc) throw new Error('Invalid ZIP entry checksum');
        entries.set(name, data);
    }
    return entries;
}

function wordRun(text, style = {}) {
    if (!text) return '';
    const properties = [
        style.bold ? '<w:b/>' : '',
        style.italic ? '<w:i/>' : '',
        style.underline ? '<w:u w:val="single"/>' : '',
        style.strike ? '<w:strike/>' : '',
        style.code ? '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>' : '',
    ].join('');
    const parts = String(text).split('\n');
    return parts.map((part, index) => `${index ? '<w:r><w:br/></w:r>' : ''}<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}<w:t xml:space="preserve">${escapeXml(part)}</w:t></w:r>`).join('');
}

const EMU_PER_PX = 9525;
const EMU_FULL_WIDTH = 5486400; // 6in at 100%

/** Parse the (sanitised) image object model off an exported <img>. */
function docxImageProps(img) {
    const raw = img.getAttribute('data-npad-props');
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

const RECOLOR_TO_DOCX = { grayscale: true };

/** DrawingML inline or anchored picture, mapped from the object model. */
function docxDrawing(rid, alt, props = null) {
    const descr = escapeXml(alt || '');
    const seq = Number(rid.replace(/\D+/g, '')) || 1;

    // Size: width prop -> EMU (%, px, or the 4x3 default).
    let cx = 3657600;
    let cy = 2743200;
    const width = props?.width;
    if (width && width.endsWith('%')) cx = Math.round(EMU_FULL_WIDTH * (parseFloat(width) / 100));
    else if (width && width.endsWith('px')) cx = Math.round(parseFloat(width) * EMU_PER_PX);
    const height = props?.height;
    if (height && height.endsWith('px')) cy = Math.round(parseFloat(height) * EMU_PER_PX);
    else if (width) cy = Math.round(cx * 0.75);

    // Crop -> a:srcRect (units are 1/1000 of a percent).
    const crop = props?.crop || { l: 0, r: 0, t: 0, b: 0 };
    const srcRect = crop.l || crop.r || crop.t || crop.b
        ? `<a:srcRect l="${Math.round(crop.l * 1000)}" t="${Math.round(crop.t * 1000)}" r="${Math.round(crop.r * 1000)}" b="${Math.round(crop.b * 1000)}"/>`
        : '';

    // Rotation & flip: rot is 1/60000 degree.
    let rot = Math.round(((props?.rotate || 0) % 360) * 60000);
    if (rot < 0) rot += 21600000;
    const flipH = props?.flipH ? ' flipH="1"' : '';
    const flipV = props?.flipV ? ' flipV="1"' : '';

    // Effects: grayscale + opacity survive re-import.
    const effects = [];
    if (RECOLOR_TO_DOCX[props?.recolor]) effects.push('<a:grayscale val="true"/>');
    if (props?.opacity != null && props.opacity < 100) {
        effects.push(`<a:alphaModFix amt="${Math.round(props.opacity * 1000)}"/>`);
    }
    const blip = `<a:blip r:embed="${rid}">${effects.join('')}</a:blip>`;
    const rotAttr = rot ? ` rot="${rot}"` : '';
    const xfrm = `<a:xfrm${rotAttr}${flipH}${flipV}><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`;

    const picture = `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">`
        + `<pic:pic><pic:nvPicPr><pic:cNvPr id="${seq}" name="Image ${seq}" descr="${descr}"/><pic:cNvPicPr/></pic:nvPicPr>`
        + `<pic:blipFill>${blip}${srcRect}<a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
        + `<pic:spPr>${xfrm}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>`
        + `</a:graphicData></a:graphic>`;

    const layout = props?.layout || 'inline';
    const anchor = props?.anchor || 'paragraph';
    if (layout === 'inline') {
        return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">`
            + `<wp:extent cx="${cx}" cy="${cy}"/>`
            + `<wp:docPr id="${seq}" name="Image ${seq}" descr="${descr}"/>`
            + picture + `</wp:inline></w:drawing></w:r>`;
    }

    const pxToPosOffset = (px) => Math.round((Number(px) || 0) * 6350);
    const behind = layout === 'behind' ? '1' : '0';
    let wrap = '<wp:wrapNone/>';
    let relativeH = 'column';
    let relativeV = 'paragraph';
    let posX = 0;
    let posY = 0;
    if (layout === 'wrap-left' || layout === 'wrap-right') {
        wrap = '<wp:wrapSquare wrapText="bothSides"/>';
        relativeH = 'column';
    } else if (layout === 'top-bottom') {
        wrap = '<wp:wrapTopAndBottom/>';
    } else {
        // behind / front / fixed
        relativeH = layout === 'fixed' ? 'page' : 'paragraph';
        relativeV = anchor === 'page' || layout === 'fixed' ? 'page' : 'paragraph';
        posX = pxToPosOffset(props?.pos?.x);
        posY = pxToPosOffset(props?.pos?.y);
    }
    return `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0"`
        + ` relativeHeight="${seq}" behindDoc="${behind}" locked="0" layoutInCell="1" allowOverlap="1">`
        + `<wp:simplePos x="0" y="0"/>`
        + `<wp:positionH relativeFrom="${relativeH}"><wp:posOffset>${posX}</wp:posOffset></wp:positionH>`
        + `<wp:positionV relativeFrom="${relativeV}"><wp:posOffset>${posY}</wp:posOffset></wp:positionV>`
        + `<wp:extent cx="${cx}" cy="${cy}"/>`
        + wrap
        + `<wp:docPr id="${seq}" name="Image ${seq}" descr="${descr}"/>`
        + picture + `</wp:anchor></w:drawing></w:r>`;
}

function htmlNodeToWord(node, inherited = {}) {
    if (node.nodeType === Node.TEXT_NODE) return wordRun(node.nodeValue, inherited);
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.tagName.toLowerCase();
    const style = {
        ...inherited,
        bold: inherited.bold || tag === 'b' || tag === 'strong',
        italic: inherited.italic || tag === 'i' || tag === 'em',
        underline: inherited.underline || tag === 'u' || tag === 'a',
        strike: inherited.strike || ['s', 'strike', 'del'].includes(tag),
        code: inherited.code || tag === 'code' || tag === 'pre',
    };
    if (tag === 'br') return '<w:r><w:br/></w:r>';
    if (tag === 'img') {
        const rid = node.getAttribute('data-docx-rid');
        return rid ? docxDrawing(rid, node.getAttribute('alt') || '', docxImageProps(node)) : '';
    }
    return [...node.childNodes].map((child) => htmlNodeToWord(child, style)).join('');
}

function paragraphToWord(element, prefix = '', documentDirection = 'ltr') {
    const heading = /^H([1-6])$/.exec(element.tagName || '');
    const direction = element.getAttribute?.('dir') || documentDirection;
    const properties = [
        heading ? `<w:pStyle w:val="Heading${heading[1]}"/>` : '',
        element.tagName === 'TABLE' ? '' : '',
        direction === 'rtl' ? '<w:bidi/><w:jc w:val="right"/>' : '',
    ].join('');
    const pPr = properties ? `<w:pPr>${properties}</w:pPr>` : '';
    return `<w:p>${pPr}${prefix ? wordRun(prefix) : ''}${htmlNodeToWord(element)}</w:p>`;
}

function tableToWord(table, documentDirection) {
    const gridData = tableGrid(table);
    if (!gridData.rows.length) return '';
    const colCount = Math.max(gridData.colCount, 1);

    const tblPr = '<w:tblPr><w:tblW w:w="0" w:type="auto"/>' +
        '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
            .map((edge) => `<w:${edge} w:val="single" w:sz="4" w:space="0" w:color="808080"/>`)
            .join('') + '</w:tblBorders><w:tblLayout w:type="autofit"/></w:tblPr>';
    const grid = `<w:tblGrid>${'<w:gridCol w:w="2400"/>'.repeat(colCount)}</w:tblGrid>`;

    const cellXml = (cell, { gridSpan = 1, vMerge = null } = {}) => {
        const backgroundColor = (cell.getAttribute('style') || '')
            .match(/background-color\s*:\s*#?([0-9a-f]{6})/i);
        const isHeader = cell.tagName === 'TH';
        const fill = backgroundColor?.[1]?.toUpperCase();
        const props = [
            gridSpan > 1 ? `<w:gridSpan w:val="${gridSpan}"/>` : '',
            vMerge === 'start' ? '<w:vMerge w:val="restart"/>' : '',
            vMerge === 'continue' ? '<w:vMerge/>' : '',
            isHeader ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>' : '',
            fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : '',
            documentDirection === 'rtl' ? '<w:bidi/>' : '',
        ].filter(Boolean).join('');
        const tcPr = props ? `<w:tcPr>${props}</w:tcPr>` : '';
        const content = vMerge === 'continue'
            ? ''
            : [...cell.childNodes].map((child) => htmlNodeToWord(child)).join('');
        const pPr = documentDirection === 'rtl'
            ? '<w:pPr><w:bidi/><w:jc w:val="right"/></w:pPr>' : '';
        return `<w:tc>${tcPr}<w:p>${pPr}${content}</w:p></w:tc>`;
    };

    const rowsXml = gridData.rows.map((rowEl, row) => {
        const cells = [];
        for (let col = 0; col < colCount; col += 1) {
            const cell = gridData.grid[row]?.[col];
            if (!cell) continue;
            const pos = gridData.startOf.get(cell);
            const rowspan = spanWord(cell, 'rowspan', 1);
            const colspan = spanWord(cell, 'colspan', 1);
            if (pos.row < row && pos.col === col) {
                // Continuation of a vertically merged cell from above: one
                // empty continue cell per column the merge covers.
                for (let c = 0; c < colspan; c += 1) {
                    cells.push(cellXml(cell, { vMerge: 'continue' }));
                }
                continue;
            }
            if (pos.col !== col || pos.row !== row) continue; // covered to the left/above
            cells.push(cellXml(cell, { gridSpan: colspan, vMerge: rowspan > 1 ? 'start' : null }));
        }
        // Header rows re-import as <th scope="col">.
        const header = rowEl.parentNode?.tagName === 'THEAD'
            ? '<w:trPr><w:tblHeader/></w:trPr>' : '';
        return `<w:tr>${header}${cells.join('')}</w:tr>`;
    }).join('');

    return `<w:tbl>${tblPr}${grid}${rowsXml}</w:tbl>`;
}

function spanWord(cell, name, fallback) {
    const value = Number.parseInt(cell.getAttribute(name) || '', 10);
    return Number.isInteger(value) && value > 0 ? value : fallback;
}

function htmlToWordBody(body, documentDirection) {
    const paragraphs = [];
    for (const node of body.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim()) {
            const bidi = documentDirection === 'rtl' ? '<w:pPr><w:bidi/><w:jc w:val="right"/></w:pPr>' : '';
            paragraphs.push(`<w:p>${bidi}${wordRun(node.nodeValue)}</w:p>`);
        } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'TABLE') {
            paragraphs.push(tableToWord(node, documentDirection));
        } else if (node.nodeType === Node.ELEMENT_NODE && ['UL', 'OL'].includes(node.tagName)) {
            [...node.children].forEach((item, index) => paragraphs.push(paragraphToWord(
                item,
                node.tagName === 'UL' ? '• ' : `${index + 1}. `,
                documentDirection,
            )));
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            paragraphs.push(paragraphToWord(node, '', documentDirection));
        }
    }
    return paragraphs.join('') || '<w:p/>';
}

export function htmlToDocx(html, { direction = 'ltr' } = {}) {
    const body = htmlBody(html);

    // Embedded raster images become real media parts with DrawingML inline
    // pictures (Google Docs/Word show them; the round trip is lossless).
    const media = [];
    const imageRels = [];
    const imageExtensions = new Map();
    let imageSeq = 0;
    for (const img of [...body.querySelectorAll('img')]) {
        const match = (img.getAttribute('src') || '').trim()
            .match(/^data:image\/(png|jpeg|gif|webp);base64,([a-z0-9+/=\s]+)$/i);
        if (!match) {
            img.remove();
            continue;
        }
        imageSeq += 1;
        const type = match[1].toLowerCase();
        const ext = type === 'jpeg' ? 'jpg' : type;
        const mediaName = `image${imageSeq}.${ext}`;
        const rid = `rIdImg${imageSeq}`;
        let bytes;
        try {
            const binary = atob(match[2].replace(/\s+/g, ''));
            bytes = new Uint8Array(binary.length);
            for (let index = 0; index < binary.length; index += 1) {
                bytes[index] = binary.charCodeAt(index);
            }
        } catch {
            img.remove();
            continue;
        }
        media.push([`word/media/${mediaName}`, bytes]);
        imageRels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${mediaName}"/>`);
        imageExtensions.set(ext, `image/${type}`);
        img.setAttribute('data-docx-rid', rid);
        img.removeAttribute('src');
    }

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${htmlToWordBody(body, direction)}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
    const headingStyles = [32, 28, 26, 24, 22, 20].map((size, index) => {
        const level = index + 1;
        return `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
    }).join('');
    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${headingStyles}</w:styles>`;

    const contentTypesDefaults = [...imageExtensions.entries()]
        .map(([ext, contentType]) => `<Default Extension="${ext}" ContentType="${contentType}"/>`)
        .join('');
    const documentRels = [`<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`, ...imageRels].join('');

    return makeZip([
        ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${contentTypesDefaults}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`],
        ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
        ['word/document.xml', documentXml],
        ['word/styles.xml', stylesXml],
        ['word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${documentRels}</Relationships>`],
        ...media,
    ]);
}

function firstChildByLocalName(node, name) {
    return [...(node?.children || [])].find((child) => child.localName === name) || null;
}

function wordPropertyEnabled(properties, name) {
    const property = properties && firstChildByLocalName(properties, name);
    if (!property) return false;
    const value = property.getAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'val')
        || property.getAttribute('w:val') || property.getAttribute('val') || 'true';
    return !['0', 'false', 'none', 'nil'].includes(value.toLowerCase());
}

function docxRunToHtml(run) {
    const properties = firstChildByLocalName(run, 'rPr');
    let text = '';
    for (const child of run.children) {
        if (child.localName === 't') text += escapeHtml(child.textContent);
        else if (child.localName === 'tab') text += '\t';
        else if (child.localName === 'br' || child.localName === 'cr') text += '<br>';
    }
    if (!text) return '';
    if (wordPropertyEnabled(properties, 'strike')) text = `<s>${text}</s>`;
    if (wordPropertyEnabled(properties, 'u')) text = `<u>${text}</u>`;
    if (wordPropertyEnabled(properties, 'i')) text = `<em>${text}</em>`;
    if (wordPropertyEnabled(properties, 'b')) text = `<strong>${text}</strong>`;
    return text;
}

function docxParagraphToHtml(paragraph) {
    const properties = firstChildByLocalName(paragraph, 'pPr');
    const styleNode = properties && firstChildByLocalName(properties, 'pStyle');
    const styleName = styleNode?.getAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'val')
        || styleNode?.getAttribute('w:val') || '';
    const heading = /heading\s*([1-6])/i.exec(styleName);
    const direction = properties && firstChildByLocalName(properties, 'bidi') ? ' dir="rtl"' : '';
    let content = '';
    for (const child of paragraph.children) {
        if (child.localName === 'r') content += docxRunToHtml(child);
        else if (child.localName === 'hyperlink') {
            content += [...child.children].filter((item) => item.localName === 'r').map(docxRunToHtml).join('');
        }
    }
    const tag = heading ? `h${heading[1]}` : 'p';
    return `<${tag}${direction}>${content || '<br>'}</${tag}>`;
}

function docxTableCellToHtml(tc) {
    const properties = firstChildByLocalName(tc, 'tcPr');
    const gridSpan = properties && firstChildByLocalName(properties, 'gridSpan');
    const colspanValue = gridSpan ? Number.parseInt(
        gridSpan.getAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'val')
            || gridSpan.getAttribute('w:val') || '1', 10) : 1;
    const colspan = Number.isInteger(colspanValue) && colspanValue > 1 ? colspanValue : 0;
    const vMerge = properties && firstChildByLocalName(properties, 'vMerge');
    const mergeValue = vMerge
        ? (vMerge.getAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'val')
            || vMerge.getAttribute('w:val') || 'continue') : null;
    const shadingNode = properties && firstChildByLocalName(properties, 'shd');
    const fill = shadingNode
        ? (shadingNode.getAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'fill')
            || shadingNode.getAttribute('w:fill') || '') : '';
    const style = fill && /^[0-9a-f]{6}$/i.test(fill)
        ? ` style="background-color: #${fill}"` : '';
    const paragraphs = [...tc.children]
        .filter((child) => child.localName === 'p')
        .map(docxParagraphToHtml)
        .join('');
    return { colspan, mergeValue, html: `<td${style}>${paragraphs || '<br>'}</td>` };
}

function docxTableToHtml(tbl) {
    const rows = [...tbl.children].filter((child) => child.localName === 'tr');
    if (!rows.length) return '';
    const tokens = rows.map((tr) => {
        const rowProperties = firstChildByLocalName(tr, 'trPr');
        const header = !!(rowProperties && firstChildByLocalName(rowProperties, 'tblHeader'));
        const cells = [];
        let col = 0;
        for (const tc of [...tr.children].filter((child) => child.localName === 'tc')) {
            const parsed = docxTableCellToHtml(tc);
            cells.push({ ...parsed, col, rowspan: 1, header });
            col += parsed.colspan || 1;
        }
        return cells;
    });

    // Two passes so vertical merges (vMerge restart/continue) become rowspans.
    for (let r = 0; r < tokens.length; r += 1) {
        for (const token of tokens[r]) {
            if (token.mergeValue !== 'restart') continue;
            let count = 1;
            for (let rr = r + 1; rr < tokens.length; rr += 1) {
                const continued = tokens[rr].find((other) =>
                    other.col === token.col && other.mergeValue === 'continue');
                if (!continued) break;
                count += 1;
            }
            token.rowspan = count;
        }
    }

    const rowsHtml = tokens.map((rowTokens) => {
        const anyHeader = rowTokens.some((token) => token.header);
        const tag = anyHeader ? 'th' : 'td';
        const headerAttr = anyHeader ? ' scope="col"' : '';
        const cellsHtml = rowTokens
            .filter((token) => token.mergeValue !== 'continue')
            .map((token) => {
                const attrs = [
                    token.colspan > 1 ? ` colspan="${token.colspan}"` : '',
                    token.rowspan > 1 ? ` rowspan="${token.rowspan}"` : '',
                ].join('');
                const inner = token.html.match(/<td([^>]*)>([\s\S]*)<\/td>/);
                const styleAttr = inner?.[1] || '';
                const content = inner?.[2] || '<br>';
                return `<${tag}${styleAttr}${attrs}${headerAttr}>${content}</${tag}>`;
            }).join('');
        return `<tr>${cellsHtml}</tr>`;
    }).join('');

    return `<table>${rowsHtml}</table>`;
}

export async function docxToHtml(buffer) {
    const entries = await unzip(buffer, new Set(['word/document.xml']));
    const documentData = entries.get('word/document.xml');
    if (!documentData) throw new Error('DOCX document.xml missing');
    const xml = new DOMParser().parseFromString(utf8Decoder.decode(documentData), 'application/xml');
    if (xml.querySelector('parsererror')) throw new Error('Invalid DOCX XML');
    const body = xml.getElementsByTagNameNS('*', 'body')[0];
    if (!body) throw new Error('Invalid DOCX body');
    const blocks = [];
    for (const child of body.children) {
        if (child.localName === 'p') blocks.push(docxParagraphToHtml(child));
        else if (child.localName === 'tbl') blocks.push(docxTableToHtml(child));
    }
    return sanitizeHtml(blocks.join(''));
}

/* -------------------------------------------------------------------------
   PDF text import
   ------------------------------------------------------------------------- */

function decodePdfBytes(bytes) {
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
        let output = '';
        for (let index = 2; index + 1 < bytes.length; index += 2) {
            output += String.fromCharCode((bytes[index] << 8) | bytes[index + 1]);
        }
        return output;
    }
    return latin1Decoder.decode(Uint8Array.from(bytes));
}

function pdfLiteralBytes(value) {
    const bytes = [];
    for (let index = 0; index < value.length; index += 1) {
        if (value[index] !== '\\') { bytes.push(value.charCodeAt(index) & 0xff); continue; }
        const next = value[++index];
        const escapes = { n: 10, r: 13, t: 9, b: 8, f: 12 };
        if (escapes[next] !== undefined) bytes.push(escapes[next]);
        else if (/[0-7]/.test(next || '')) {
            let octal = next;
            while (octal.length < 3 && /[0-7]/.test(value[index + 1] || '')) octal += value[++index];
            bytes.push(parseInt(octal, 8));
        } else if (next === '\n') { /* line continuation */ }
        else if (next === '\r') { if (value[index + 1] === '\n') index += 1; }
        else if (next !== undefined) bytes.push(next.charCodeAt(0) & 0xff);
    }
    return bytes;
}

function pdfHexBytes(value) {
    const hex = value.replace(/\s/g, '');
    const padded = hex.length % 2 ? `${hex}0` : hex;
    const bytes = [];
    for (let index = 0; index < padded.length; index += 2) bytes.push(parseInt(padded.slice(index, index + 2), 16));
    return bytes;
}

function cmapUnicode(hex) {
    const bytes = pdfHexBytes(hex);
    let index = bytes[0] === 0xfe && bytes[1] === 0xff ? 2 : 0;
    let output = '';
    for (; index + 1 < bytes.length; index += 2) {
        output += String.fromCharCode((bytes[index] << 8) | bytes[index + 1]);
    }
    return output;
}

function parsePdfCmap(content) {
    if (!/begin(?:bfchar|bfrange)/.test(content)) return null;
    const map = new Map();
    for (const block of content.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
        for (const pair of block[1].matchAll(/<([\da-f]+)>\s*<([\da-f]+)>/gi)) {
            map.set(pair[1].toUpperCase(), cmapUnicode(pair[2]));
        }
    }
    for (const block of content.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
        const range = /<([\da-f]+)>\s*<([\da-f]+)>\s*(?:<([\da-f]+)>|\[([^\]]*)\])/gi;
        for (const item of block[1].matchAll(range)) {
            const start = parseInt(item[1], 16);
            const end = parseInt(item[2], 16);
            const width = item[1].length;
            if (!Number.isFinite(start) || end < start || end - start > 10000) continue;
            if (item[3]) {
                const destination = BigInt(`0x${item[3]}`);
                for (let code = start; code <= end; code += 1) {
                    const unicode = (destination + BigInt(code - start)).toString(16)
                        .padStart(item[3].length, '0');
                    map.set(code.toString(16).padStart(width, '0').toUpperCase(), cmapUnicode(unicode));
                }
            } else {
                const destinations = [...item[4].matchAll(/<([\da-f]+)>/gi)];
                for (let code = start; code <= end && code - start < destinations.length; code += 1) {
                    map.set(
                        code.toString(16).padStart(width, '0').toUpperCase(),
                        cmapUnicode(destinations[code - start][1]),
                    );
                }
            }
        }
    }
    return map.size ? map : null;
}

function decodeWithCmap(bytes, map) {
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
    const widths = [...new Set([...map.keys()].map((key) => key.length))].sort((a, b) => b - a);
    let output = '';
    let mapped = 0;
    for (let index = 0; index < hex.length;) {
        const width = widths.find((candidate) => map.has(hex.slice(index, index + candidate)));
        if (!width) {
            output += '�';
            index += 2;
            continue;
        }
        output += map.get(hex.slice(index, index + width));
        mapped += width;
        index += width;
    }
    return { output, coverage: hex.length ? mapped / hex.length : 0 };
}

function decodePdfToken(value, maps) {
    const bytes = value.startsWith('(')
        ? pdfLiteralBytes(value.slice(1, -1))
        : pdfHexBytes(value.slice(1, -1));
    let best = null;
    for (const map of maps || []) {
        const decoded = decodeWithCmap(bytes, map);
        if (!best || decoded.coverage > best.coverage) best = decoded;
        if (decoded.coverage === 1) break;
    }
    return best && best.coverage >= 0.75 ? best.output : decodePdfBytes(bytes);
}

function extractPdfText(content, fontMaps = new Map(), allMaps = []) {
    const output = [];
    let currentMaps = allMaps;
    const stringPattern = String.raw`\((?:\\.|[^\\()])*\)|<[\da-fA-F\s]+>`;
    const operator = new RegExp(
        `\\/([^\\s/]+)\\s+[-+]?\\d*\\.?\\d+\\s+Tf|(${stringPattern})\\s*(?:Tj|'|")|\\[((?:\\s*${stringPattern}|[-+]?\\d*\\.?\\d+\\s*)+)\\]\\s*TJ`,
        'g',
    );
    for (const match of content.matchAll(operator)) {
        if (match[1]) {
            currentMaps = fontMaps.get(match[1]) || allMaps;
            continue;
        }
        const values = match[2] ? [match[2]] : (match[3]?.match(new RegExp(stringPattern, 'g')) || []);
        const text = values.map((value) => decodePdfToken(value, currentMaps)).join('');
        if (text.trim()) output.push(text);
    }
    return output.join('\n');
}

export async function pdfToHtml(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const source = new TextDecoder('latin1').decode(bytes);
    if (!source.slice(0, 1024).includes('%PDF-')) throw new Error('Invalid PDF');
    if (/\/Encrypt\b/.test(source)) throw new Error('Encrypted PDF');
    const objects = [...source.matchAll(/(\d+)\s+\d+\s+obj\b/g)].map((match) => ({
        id: Number(match[1]),
        start: match.index,
        end: source.indexOf('endobj', match.index + match[0].length),
    }));
    const streams = [];
    const pattern = /stream\r?\n/g;
    let objectIndex = -1;
    for (const match of source.matchAll(pattern)) {
        while (objectIndex + 1 < objects.length && objects[objectIndex + 1].start < match.index) objectIndex += 1;
        const streamObject = objects[objectIndex];
        const objectId = streamObject && (streamObject.end < 0 || match.index < streamObject.end)
            ? streamObject.id
            : null;
        const start = match.index + match[0].length;
        const dictionary = source.slice(Math.max(0, match.index - 1000), match.index);
        const directLength = [...dictionary.matchAll(/\/Length\s+(\d+)\b/g)].at(-1)?.[1];
        const end = directLength
            ? Math.min(bytes.length, start + Number(directLength))
            : source.indexOf('endstream', start);
        if (end < start) continue;
        let data = bytes.slice(start, end);
        if (!directLength) {
            while (data.length && (data.at(-1) === 10 || data.at(-1) === 13)) data = data.slice(0, -1);
        }
        try {
            const filters = [...dictionary.matchAll(/\/([A-Za-z0-9]+Decode)\b/g)].map((item) => item[1]);
            if (filters.some((filter) => filter !== 'FlateDecode')) continue;
            if (filters.includes('FlateDecode')) data = await decompress(data, 'deflate');
            streams.push({ objectId, content: new TextDecoder('latin1').decode(data) });
        } catch {
            /* A non-content stream or unsupported filter; continue. */
        }
    }

    const cmapByObject = new Map();
    for (const stream of streams) {
        const cmap = parsePdfCmap(stream.content);
        if (cmap && stream.objectId !== null) cmapByObject.set(stream.objectId, cmap);
    }
    const fontToCmap = new Map();
    for (const object of objects) {
        const body = source.slice(object.start, object.end < 0 ? undefined : object.end);
        const cmapObject = body.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/)?.[1];
        const cmap = cmapByObject.get(Number(cmapObject));
        if (cmap) fontToCmap.set(object.id, cmap);
    }
    const fontMaps = new Map();
    for (const object of objects) {
        const body = source.slice(object.start, object.end < 0 ? undefined : object.end);
        for (const reference of body.matchAll(/\/([A-Za-z0-9_.+-]+)\s+(\d+)\s+\d+\s+R/g)) {
            const cmap = fontToCmap.get(Number(reference[2]));
            if (!cmap) continue;
            const maps = fontMaps.get(reference[1]) || [];
            if (!maps.includes(cmap)) maps.push(cmap);
            fontMaps.set(reference[1], maps);
        }
    }
    const allMaps = [...cmapByObject.values()];
    const text = streams
        .filter((stream) => !cmapByObject.has(stream.objectId))
        .map((stream) => extractPdfText(stream.content, fontMaps, allMaps))
        .filter(Boolean)
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    if (!text) throw new Error('No extractable PDF text');
    return textToHtml(text);
}
