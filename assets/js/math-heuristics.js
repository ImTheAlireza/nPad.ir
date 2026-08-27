/**
 * Heuristic gate shared by the formats codecs and the editor's math module.
 *
 * Lives in its own tiny module (rather than formats.js) so the eagerly
 * loaded mathblock.js does not pull the 60 KB codecs module into the
 * critical path.
 */

const CURRENCY_LIKE = /^[\d\s.,'’-]+$/;
const MATHISH = /[\\^_{}=+\-*/<>|]/;

/**
 * Heuristic gate before a `$…$` span becomes math. Mirrors the editor's
 * typing rules: the content must hug both delimiters, must not look like
 * money ("I paid $5 and $10") and must actually be present.
 * @returns {boolean}
 */
export function isPlausibleMath(content) {
    const tex = String(content ?? '');
    if (!tex.trim()) return false;
    if (/^\s|\s$/.test(tex)) return false;
    if (CURRENCY_LIKE.test(tex)) return false;
    // One math-ish character keeps prose ("10 for lunch.") out of formulas;
    // anything a user really means as math has at least one of these.
    if (!MATHISH.test(tex)) return false;
    return true;
}
