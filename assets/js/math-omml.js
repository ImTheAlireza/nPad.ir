/**
 * MathML → OMML (Office Math Markup Language) conversion for DOCX export.
 *
 * Word renders OMML natively, so formulas exported as real math instead of
 * LaTeX source text. The input is KaTeX's MathML output
 * (katex.renderToString(tex, { output: 'mathml' })), which uses a stable,
 * well-known subset of Presentation MathML — this converter maps that
 * subset onto the OMML elements Word understands:
 *
 *   mfrac → m:f            msqrt/mroot → m:rad
 *   msub/msup/msubsup → m:sSub/sSup/sSubSup
 *   munder/mover/munderover → m:limLow / m:acc / m:nary (big operators)
 *   mtable → m:m matrix    mi/mn/mo/mtext → m:r runs
 *
 * Anything unexpected degrades to its children rather than failing, and a
 * parse error throws so the caller can fall back to the LaTeX-source form.
 */

const BIG_OPERATORS = new Set(
    '∑∏∫∬∭∮∯∰⨀⨁⨂⨃⨄⨅⨆⋃⋂⨿⊕⊗ominus⊙⊛⋅'.split(''),
);

/** XML text escaping for content we emit into document.xml. */
function esc(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** A single OMML run. `nor` downgrades italic for upright identifiers. */
function run(text, { nor = false } = {}) {
    if (!text) return '';
    const rPr = nor ? '<m:rPr><m:nor/></m:rPr>' : '';
    return `<m:r>${rPr}<m:t xml:space="preserve">${esc(text)}</m:t></m:r>`;
}

const childrenOf = (node) => [...node.children].map(convert).join('');

function isBigOperator(mo) {
    return mo?.tagName === 'mo' && BIG_OPERATORS.has((mo.textContent || '').trim());
}

function isAccent(mo) {
    if (!mo || mo.tagName !== 'mo') return false;
    if (mo.getAttribute('accent') === 'true') return true;
    const chr = (mo.textContent || '').trim();
    return /^[\u0300-\u036F]$/.test(chr) || ['^', '˜', '¯', '→', '⇀', '˙', '˚', '˘', 'breve'].includes(chr);
}

/** N-ary operator (sum/integral/product) with optional sub/sup limits. */
function nary(operator, { sub = '', sup = '', limLoc = 'undOvr' } = {}) {
    const hideSub = sub ? '' : '<m:subHide m:val="1"/>';
    const hideSup = sup ? '' : '<m:supHide m:val="1"/>';
    const lim = limLoc ? `<m:limLoc m:val="${limLoc}"/>` : '';
    return `<m:nary><m:naryPr><m:chr m:val="${esc(operator)}"/>${lim}${hideSub}${hideSup}</m:naryPr>`
        + `<m:sub>${sub}</m:sub><m:sup>${sup}</m:sup><m:e/></m:nary>`;
}

function convert(node) {
    if (node.nodeType === Node.TEXT_NODE) return run(node.nodeValue);
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.tagName.toLowerCase();
    const kids = [...node.children];

    switch (tag) {
        case 'math':
        case 'semantics':
        case 'mrow':
        case 'mstyle':
        case 'mpadded':
            // semantics: convert the rendered tree, skip the TeX annotation.
            return kids.filter((k) => k.tagName.toLowerCase() !== 'annotation').map(convert).join('');
        case 'mi': {
            const text = node.textContent || '';
            const upright = node.getAttribute('mathvariant') === 'normal' || text.trim().length > 1;
            return run(text, { nor: upright });
        }
        case 'mn':
        case 'mo':
        case 'mtext':
        case 'ms':
            return run(node.textContent);
        case 'mspace':
            return run(' ');
        case 'mphantom':
            return '';
        case 'merror':
            return run(node.textContent);
        case 'mfrac':
            return `<m:f><m:num>${kids[0] ? convert(kids[0]) : ''}</m:num><m:den>${kids[1] ? convert(kids[1]) : ''}</m:den></m:f>`;
        case 'msqrt':
            return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${childrenOf(node)}</m:e></m:rad>`;
        case 'mroot':
            return `<m:rad><m:deg>${kids[1] ? convert(kids[1]) : ''}</m:deg><m:e>${kids[0] ? convert(kids[0]) : ''}</m:e></m:rad>`;
        case 'msub':
            // Inline-style big operators (\sum_i) still deserve an m:nary:
            // Word renders n-aries natively; limits sit beside them.
            if (isBigOperator(kids[0])) {
                return nary(kids[0].textContent.trim(),
                    { sub: kids[1] ? convert(kids[1]) : '', limLoc: 'supSub' });
            }
            return `<m:sSub><m:e>${kids[0] ? convert(kids[0]) : ''}</m:e><m:sub>${kids[1] ? convert(kids[1]) : ''}</m:sub></m:sSub>`;
        case 'msup':
            if (isBigOperator(kids[0])) {
                return nary(kids[0].textContent.trim(),
                    { sup: kids[1] ? convert(kids[1]) : '', limLoc: 'supSub' });
            }
            return `<m:sSup><m:e>${kids[0] ? convert(kids[0]) : ''}</m:e><m:sup>${kids[1] ? convert(kids[1]) : ''}</m:sup></m:sSup>`;
        case 'msubsup':
            if (isBigOperator(kids[0])) {
                return nary(kids[0].textContent.trim(), {
                    sub: kids[1] ? convert(kids[1]) : '',
                    sup: kids[2] ? convert(kids[2]) : '',
                    limLoc: 'supSub',
                });
            }
            return `<m:sSubSup><m:e>${kids[0] ? convert(kids[0]) : ''}</m:e>`
                + `<m:sub>${kids[1] ? convert(kids[1]) : ''}</m:sub><m:sup>${kids[2] ? convert(kids[2]) : ''}</m:sup></m:sSubSup>`;
        case 'munder': {
            if (isBigOperator(kids[0])) return nary(kids[0].textContent.trim(), { sub: kids[1] ? convert(kids[1]) : '' });
            return `<m:limLow><m:e>${kids[0] ? convert(kids[0]) : ''}</m:e><m:lim>${kids[1] ? convert(kids[1]) : ''}</m:lim></m:limLow>`;
        }
        case 'mover': {
            // KaTeX marks accent constructs on the <mover> itself.
            const accent = node.getAttribute('accent') === 'true' || isAccent(kids[1]);
            if (accent) {
                const chr = (kids[1].textContent || '').trim() || '̂';
                return `<m:acc><m:accPr><m:chr m:val="${esc(chr)}"/></m:accPr><m:e>${kids[0] ? convert(kids[0]) : ''}</m:e></m:acc>`;
            }
            if (isBigOperator(kids[0])) return nary(kids[0].textContent.trim(), { sup: kids[1] ? convert(kids[1]) : '' });
            return `<m:limUpp><m:e>${kids[0] ? convert(kids[0]) : ''}</m:e><m:lim>${kids[1] ? convert(kids[1]) : ''}</m:lim></m:limUpp>`;
        }
        case 'munderover': {
            if (isBigOperator(kids[0])) {
                return nary(
                    kids[0].textContent.trim(),
                    { sub: kids[1] ? convert(kids[1]) : '', sup: kids[2] ? convert(kids[2]) : '' },
                );
            }
            // No direct OMML equivalent for a generic under-over construct:
            // degrade to sub/superscript, which reads correctly.
            return `<m:sSubSup><m:e>${kids[0] ? convert(kids[0]) : ''}</m:e>`
                + `<m:sub>${kids[1] ? convert(kids[1]) : ''}</m:sub><m:sup>${kids[2] ? convert(kids[2]) : ''}</m:sup></m:sSubSup>`;
        }
        case 'mtable': {
            const rows = kids.filter((k) => k.tagName.toLowerCase() === 'mtr');
            const cells = rows.map((row) => [...row.children]
                .filter((c) => c.tagName.toLowerCase() === 'mtd')
                .map((c) => `<m:e>${childrenOf(c)}</m:e>`));
            const width = Math.max(1, ...cells.map((r) => r.length));
            const body = cells.map((row) => `<m:mr>${row.join('')}${'<m:e/>'.repeat(width - row.length)}</m:mr>`).join('');
            return `<m:m><m:mPr><m:mcs><m:mc><m:mcPr><m:count m:val="1"/><m:mcJc m:val="center"/></m:mcPr></m:mc></m:mcs></m:mPr>${body}</m:m>`;
        }
        case 'mtr':
            return `<m:mr>${childrenOf(node)}</m:mr>`;
        case 'mtd':
            return `<m:e>${childrenOf(node)}</m:e>`;
        default:
            return childrenOf(node);
    }
}

/**
 * Convert a MathML document string into the inner OMML for <m:oMath>.
 * @param {string} mathml  markup containing a <math> element
 * @returns {string} OMML content (without the m:oMath wrapper)
 */
export function mathmlToOmml(mathml) {
    const document = new DOMParser().parseFromString(String(mathml), 'text/xml');
    if (document.documentElement?.nodeName === 'parsererror' || !document.documentElement) {
        throw new Error('MathML parse error');
    }
    const root = document.documentElement.tagName.toLowerCase() === 'math'
        ? document.documentElement
        : document.documentElement.querySelector('math');
    if (!root) throw new Error('no <math> element');
    return convert(root);
}
