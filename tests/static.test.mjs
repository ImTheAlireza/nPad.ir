/**
 * Static checks across the repository: PHP/JS syntax, asset integrity, and
 * absence of the specific hazards found in the audit.
 */

import fs from 'node:fs';
import assert from 'node:assert/strict';
import engine from 'php-parser';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, filter, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['.git', 'node_modules', 'tests'].includes(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, filter, out);
        else if (filter(entry.name)) out.push(full);
    }
    return out;
}

const rel = (p) => path.relative(ROOT, p);

export default function run(check, group) {
    group('static: PHP syntax');

    const parser = new engine({ parser: { suppressErrors: false, version: 802 } });
    const phpFiles = walk(ROOT, (n) => n.endsWith('.php'));

    check(`all ${phpFiles.length} PHP files parse`, () => {
        const bad = [];
        for (const file of phpFiles) {
            try {
                const ast = parser.parseCode(fs.readFileSync(file, 'utf8'), file);
                if (ast.errors?.length) bad.push(`${rel(file)}: ${ast.errors[0].message}`);
            } catch (err) {
                bad.push(`${rel(file)}: ${err.message.split('\n')[0]}`);
            }
        }
        assert.deepEqual(bad, [], bad.join('; '));
    });

    group('static: JavaScript syntax');

    const jsFiles = walk(ROOT, (n) => n.endsWith('.js') && !n.includes('.min.'));

    check(`all ${jsFiles.length} JS files parse`, () => {
        const bad = [];
        for (const file of jsFiles) {
            const isModule = file.includes(`${path.sep}assets${path.sep}js${path.sep}`)
                && !file.includes('vendor')
                && !file.endsWith('dashboard.js');
            try {
                execFileSync(process.execPath,
                    isModule ? ['--input-type=module', '--check'] : ['--check', file],
                    isModule ? { input: fs.readFileSync(file), stdio: ['pipe', 'pipe', 'pipe'] }
                             : { stdio: ['pipe', 'pipe', 'pipe'] });
            } catch (err) {
                bad.push(`${rel(file)}: ${String(err.stderr).split('\n')[0]}`);
            }
        }
        assert.deepEqual(bad, [], bad.join('; '));
    });

    group('static: no legacy hazards');

    const allSource = walk(ROOT, (n) => /\.(php|js|css|html)$/.test(n) && !n.includes('.min.'))
        .map((f) => ({ file: rel(f), text: fs.readFileSync(f, 'utf8') }));

    check('no third-party geo-IP calls', () => {
        const hits = allSource.filter((f) => /ipwho\.is|api\.country\.is|ipapi\.co/.test(f.text));
        assert.deepEqual(hits.map((h) => h.file), [], 'geo-IP endpoint still referenced');
    });

    check('no CDN dependencies', () => {
        const hits = allSource
            .filter((f) => !f.file.startsWith('assets/js/vendor'))
            .filter((f) => /cdnjs\.cloudflare|cdn\.jsdelivr|fonts\.googleapis|fonts\.gstatic/.test(f.text));
        assert.deepEqual(hits.map((h) => h.file), [], 'CDN reference present');
    });

    check('no hardcoded absolute origin in client JS', () => {
        // Strip comments first: the modules explain *why* the old hardcoded
        // origin was wrong, and that prose should not trip the check.
        const stripComments = (src) =>
            src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

        const hits = allSource
            .filter((f) => f.file.startsWith('assets/js/') && !f.file.includes('vendor'))
            .filter((f) => /https:\/\/npad\.ir/.test(stripComments(f.text)));
        assert.deepEqual(hits.map((h) => h.file), [], 'hardcoded origin breaks staging/local');
    });

    check('no console.log left in shipped JS', () => {
        const hits = allSource
            .filter((f) => f.file.startsWith('assets/js/') && !f.file.includes('vendor'))
            .filter((f) => /console\.log\(/.test(f.text));
        assert.deepEqual(hits.map((h) => h.file), []);
    });

    check('no php_value directives in .htaccess', () => {
        const ht = fs.readFileSync(path.join(ROOT, '.htaccess'), 'utf8');
        const live = ht.split('\n').filter((l) => /^\s*php_(value|flag)\s/.test(l));
        assert.deepEqual(live, [], 'php_value fatals under PHP-FPM');
    });

    check('.htaccess sets DirectoryIndex', () => {
        const ht = fs.readFileSync(path.join(ROOT, '.htaccess'), 'utf8');
        assert.ok(/^\s*DirectoryIndex\s+index\.php/m.test(ht), 'missing DirectoryIndex');
    });

    check('CSP permits everything the pages load', () => {
        const ht = fs.readFileSync(path.join(ROOT, '.htaccess'), 'utf8');
        const csp = ht.match(/Content-Security-Policy\s+"([^"]+)"/)?.[1];
        assert.ok(csp, 'no CSP header');
        assert.ok(/connect-src[^;]*'self'/.test(csp), 'connect-src missing self');
        assert.ok(/font-src[^;]*'self'/.test(csp), 'font-src missing self');
        assert.ok(/frame-ancestors\s+'none'/.test(csp), 'no frame-ancestors');
        assert.ok(/object-src\s+'none'/.test(csp), 'no object-src none');
        // Fonts are self-hosted now, so no external font origin should be needed.
        assert.ok(!/font-src[^;]*https:/.test(csp), 'CSP still allows external fonts');
    });

    check('index.html is gone', () => {
        assert.ok(!fs.existsSync(path.join(ROOT, 'index.html')), 'duplicate homepage still present');
    });

    group('static: asset integrity');

    check('all referenced fonts exist', () => {
        const css = fs.readFileSync(path.join(ROOT, 'assets/css/app.css'), 'utf8');
        const refs = [...css.matchAll(/url\('([^']+\.woff2)'\)/g)].map((m) => m[1]);
        assert.ok(refs.length >= 4, `only ${refs.length} font refs`);
        const missing = refs.filter((r) => !fs.existsSync(path.join(ROOT, r.replace(/^\//, ''))));
        assert.deepEqual(missing, [], `missing fonts: ${missing.join(', ')}`);
    });

    check('font files are valid WOFF2', () => {
        const fonts = walk(path.join(ROOT, 'fonts'), (n) => n.endsWith('.woff2'));
        assert.ok(fonts.length >= 4, `only ${fonts.length} fonts`);
        for (const f of fonts) {
            const magic = fs.readFileSync(f).subarray(0, 4).toString('latin1');
            assert.equal(magic, 'wOF2', `${rel(f)} is not WOFF2`);
        }
    });

    check('manifest icons exist and parse', () => {
        const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.webmanifest'), 'utf8'));
        for (const icon of manifest.icons) {
            const p = path.join(ROOT, icon.src.replace(/^\//, ''));
            assert.ok(fs.existsSync(p), `missing icon: ${icon.src}`);
        }
    });

    check('service worker precache list resolves', () => {
        const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
        const list = sw.match(/const PRECACHE = \[([\s\S]*?)\]/)[1];
        const urls = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
        const missing = urls.filter((u) => {
            if (u === '/' || u === '/fa/') return false;
            return !fs.existsSync(path.join(ROOT, u.replace(/^\//, '')));
        });
        assert.deepEqual(missing, [], `precached but absent: ${missing.join(', ')}`);
    });

    check('robots.txt does not advertise missing paths', () => {
        const robots = fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8');
        assert.ok(!/\/blog\//.test(robots), 'references non-existent /blog/');
    });

    check('client and server event allow-lists agree', () => {
        const js = fs.readFileSync(path.join(ROOT, 'assets/js/analytics.js'), 'utf8');
        const php = fs.readFileSync(path.join(ROOT, 'api/track.php'), 'utf8');
        const jsEvents = [...js.match(/const ALLOWED = new Set\(\[([\s\S]*?)\]\)/)[1]
            .matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
        const phpEvents = [...php.match(/const ALLOWED_EVENTS = \[([\s\S]*?)\];/)[1]
            .matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
        assert.deepEqual(jsEvents, phpEvents, 'event allow-lists differ');
    });
}
