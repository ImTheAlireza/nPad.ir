/**
 * Verifies lang/en.php and lang/fa.php expose an identical key structure.
 *
 * The old build kept copy inline in two markup blocks, which is how
 * index.html drifted 1,122 lines behind index.php. A missing translation
 * should fail the build, not silently fall back in production.
 */

import fs from 'node:fs';
import assert from 'node:assert/strict';
import engine from 'php-parser';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const parser = new engine({
    parser: { suppressErrors: false, version: 802 },
    ast: { withPositions: false },
});

function toStructure(node) {
    if (!node) return null;
    if (node.kind === 'array') {
        const isList = node.items.every((i) => !i.key);
        if (isList) return node.items.map((i) => toStructure(i.value ?? i));
        const obj = {};
        for (const item of node.items) {
            if (!item.key) continue;
            obj[item.key.value ?? String(item.key.name ?? '')] = toStructure(item.value);
        }
        return obj;
    }
    return typeof node.value === 'string' ? '<string>' : '<scalar>';
}

function loadLang(file) {
    const ast = parser.parseCode(fs.readFileSync(file, 'utf8'), file);
    const ret = ast.children.find((c) => c.kind === 'return');
    if (!ret) throw new Error(`${file}: no top-level return`);
    return toStructure(ret.expr);
}

function paths(obj, prefix = '', out = []) {
    if (Array.isArray(obj)) {
        obj.forEach((v, i) => paths(v, `${prefix}[${i}]`, out));
        return out;
    }
    if (obj && typeof obj === 'object') {
        Object.keys(obj).forEach((k) => paths(obj[k], prefix ? `${prefix}.${k}` : k, out));
        return out;
    }
    out.push(prefix);
    return out;
}

export default function run(check, group) {
    group('i18n: translation parity');

    const en = loadLang(path.join(ROOT, 'lang/en.php'));
    const fa = loadLang(path.join(ROOT, 'lang/fa.php'));
    const enPaths = new Set(paths(en));
    const faPaths = new Set(paths(fa));

    check('en and fa expose the same keys', () => {
        const missingFa = [...enPaths].filter((p) => !faPaths.has(p));
        const missingEn = [...faPaths].filter((p) => !enPaths.has(p));
        assert.deepEqual(missingFa, [], `missing from fa.php: ${missingFa.join(', ')}`);
        assert.deepEqual(missingEn, [], `missing from en.php: ${missingEn.join(', ')}`);
    });

    check('translation set is substantial', () => {
        assert.ok(enPaths.size > 150, `only ${enPaths.size} keys`);
    });

    check('no key is left as an untranslated placeholder', () => {
        const faSrc = fs.readFileSync(path.join(ROOT, 'lang/fa.php'), 'utf8');
        assert.ok(!/=>\s*''/.test(faSrc), 'empty translation value present');
        assert.ok(!/TODO|FIXME|XXX/.test(faSrc), 'placeholder marker present');
    });
}
