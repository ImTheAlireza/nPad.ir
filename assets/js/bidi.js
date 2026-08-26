/**
 * Bidirectional-text helpers for the bilingual Persian/English audience.
 *
 * detectDirection() scans for the first strong directional character (the
 * same rule the Unicode bidirectional algorithm and `dir="auto"` use) so a
 * note without an explicit direction renders sensibly.
 *
 * isolate() wraps text in FSI…PDI (U+2067/U+2069): the pair makes an
 * embedded run — a Persian title inside an English document title, say —
 * keep its own direction and never scramble the surrounding text. Isolates
 * are the modern replacement for the old LRM/RLM marks.
 */

const RTL_CHARS = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const LTR_CHARS = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u1E00-\u1EFF]/;

/**
 * 'rtl' or 'ltr' for the first strong character, or null when the text has
 * no strong directionality (digits, punctuation, empty).
 */
export function detectDirection(text) {
    const source = String(text ?? '');
    for (const character of source) {
        if (RTL_CHARS.test(character)) return 'rtl';
        if (LTR_CHARS.test(character)) return 'ltr';
    }
    return null;
}

/**
 * Wrap text in first-strong isolates so it keeps its own direction inside
 * any surrounding run.
 */
export function isolate(text) {
    const source = String(text ?? '');
    if (!source) return source;
    return `\u2067${source}\u2069`;
}
