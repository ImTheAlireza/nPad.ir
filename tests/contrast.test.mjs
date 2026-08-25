/**
 * WCAG contrast audit of the design tokens in assets/css/app.css.
 *
 * The previous build shipped body text at 3.60:1, accent links at 1.84:1 and
 * card surfaces at 1.01:1 (invisible). These assertions keep that from
 * recurring.
 */

import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(ROOT, 'assets/css/app.css'), 'utf8');

function block(selector) {
    const m = css.match(new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm'));
    if (!m) throw new Error(`block not found: ${selector}`);
    const vars = {};
    for (const line of m[1].split('\n')) {
        const v = line.match(/^\s*(--[\w-]+)\s*:\s*([^;]+);/);
        if (v) vars[v[1]] = v[2].trim();
    }
    return vars;
}

const hexToRgb = (hex) => {
    const h = hex.replace('#', '').trim();
    const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
};

const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

const L = (r) => 0.2126 * lin(r[0]) + 0.7152 * lin(r[1]) + 0.0722 * lin(r[2]);

const ratio = (a, b) => {
    const [la, lb] = [L(a), L(b)];
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/**
 * [label, fg token, bg token, minimum]
 *
 * 4.5 = WCAG AA body text (1.4.3)
 * 3.0 = WCAG AA non-text contrast for controls (1.4.11). Applies to
 *       --border-strong, used on inputs, ghost buttons, toolbar groups and
 *       the segmented control.
 * 1.25 = sanity floor for purely decorative separators, which are exempt
 *        from 1.4.11 but must not vanish as they did before.
 */
const PAIRS = [
    ['body text on page',       '--text-body',     '--surface-page',   4.5],
    ['body text on raised',     '--text-body',     '--surface-raised', 4.5],
    ['muted text on page',      '--text-muted',    '--surface-page',   4.5],
    ['muted text on raised',    '--text-muted',    '--surface-raised', 4.5],
    ['muted text on sunken',    '--text-muted',    '--surface-sunken', 4.5],
    ['strong text on page',     '--text-strong',   '--surface-page',   4.5],
    ['strong text on raised',   '--text-strong',   '--surface-raised', 4.5],
    ['accent text on page',     '--accent-text',   '--surface-page',   4.5],
    ['accent text on raised',   '--accent-text',   '--surface-raised', 4.5],
    ['on-accent on accent',     '--text-onaccent', '--accent',         4.5],
    ['danger on raised',        '--danger',        '--surface-raised', 4.5],
    ['success on raised',       '--success',        '--surface-raised', 4.5],
    ['active search result',    '--find-current-text', '--find-current-bg', 4.5],
    ['strong border on raised', '--border-strong', '--surface-raised', 3.0],
    ['strong border on page',   '--border-strong', '--surface-page',   3.0],
    ['strong border on sunken', '--border-strong', '--surface-sunken', 3.0],
    ['subtle border on page',   '--border-subtle', '--surface-page',   1.25],
    ['subtle border on raised', '--border-subtle', '--surface-raised', 1.25],
];

export default function run(check, group) {
    const light = block(':root');
    const dark = block("\\[data-theme='dark'\\]");

    for (const [themeName, vars] of [['light', light], ['dark', dark]]) {
        group(`contrast: ${themeName} theme`);
        for (const [label, fgVar, bgVar, required] of PAIRS) {
            const fg = vars[fgVar] ?? light[fgVar];
            const bg = vars[bgVar] ?? light[bgVar];
            check(`${label} >= ${required}:1`, () => {
                assert.ok(fg?.startsWith('#'), `${fgVar} not a hex colour`);
                assert.ok(bg?.startsWith('#'), `${bgVar} not a hex colour`);
                const r = ratio(hexToRgb(fg), hexToRgb(bg));
                assert.ok(r >= required, `${r.toFixed(2)}:1 (need ${required}:1)`);
            });
        }
    }
}
