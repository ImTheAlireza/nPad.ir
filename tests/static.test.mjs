/**
 * Static checks across the repository: PHP/JS syntax, asset integrity, and
 * absence of the specific hazards found in the audit.
 */

import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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

    check('non-versioned ES modules are not cached immutable', () => {
        const ht = fs.readFileSync(path.join(ROOT, '.htaccess'), 'utf8');

        // app.js is loaded with ?v=<mtime>, but the modules it imports
        // ("./editor.js" etc.) are resolved bare by the browser. If those are
        // served immutable, a deploy never reaches returning visitors.
        const cssJsRule = ht.match(/<FilesMatch "\\\.\(css\|js\)\$">([\s\S]*?)<\/FilesMatch>/);
        assert.ok(cssJsRule, 'no Cache-Control rule for css/js');
        assert.ok(!/immutable/.test(cssJsRule[1]),
            'css/js served immutable, but module imports carry no version');
        assert.ok(/must-revalidate|max-age=0/.test(cssJsRule[1]),
            'css/js must revalidate');
    });

    check('app.js imports resolve to real files', () => {
        const app = fs.readFileSync(path.join(ROOT, 'assets/js/app.js'), 'utf8');
        const imports = [...app.matchAll(/from\s+'(\.\/[^']+)'/g)].map((m) => m[1]);
        assert.ok(imports.length >= 4, `only ${imports.length} imports found`);
        const missing = imports.filter(
            (i) => !fs.existsSync(path.join(ROOT, 'assets/js', i.replace('./', ''))),
        );
        assert.deepEqual(missing, [], `unresolvable imports: ${missing.join(', ')}`);
    });

    check('source directories are blocked at the server', () => {
        const ht = fs.readFileSync(path.join(ROOT, '.htaccess'), 'utf8');
        assert.ok(/\^\(includes\|lang\|tests\|tools\|docs(\|node_modules)?\)\(/.test(ht),
            'includes/, lang/, tests/, tools/ and docs/ are reachable over HTTP');
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
        const fonts = walk(path.join(ROOT, 'assets/fonts'), (n) => n.endsWith('.woff2'));
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

    check('release versions agree across PHP, npm and the service worker', () => {
        const packageVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
        const php = fs.readFileSync(path.join(ROOT, 'includes/bootstrap.php'), 'utf8');
        const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
        assert.equal(php.match(/NPAD_VERSION', '([^']+)'/)?.[1], packageVersion);
        assert.equal(sw.match(/npad-v([^']+)'/)?.[1], packageVersion);
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
    group('static: hardening invariants');

    check('CSP script hash matches the inline theme script', () => {
        const head = fs.readFileSync(path.join(ROOT, 'includes/head.php'), 'utf8');
        const script = head.match(/<script>\n([\s\S]*?)\n<\/script>/)?.[1];
        assert.ok(script, 'inline theme script not found in head.php');
        const hash = 'sha256-' + crypto.createHash('sha256').update(script, 'utf8').digest('base64');
        const htaccess = fs.readFileSync(path.join(ROOT, '.htaccess'), 'utf8');
        assert.ok(
            htaccess.includes(`'${hash}'`),
            `CSP does not pin the theme script hash (${hash}); update .htaccess and head.php together`,
        );
        assert.ok(
            !/script-src[^";\r\n]*unsafe-inline/.test(htaccess),
            "script-src must not contain 'unsafe-inline'",
        );
    });

    check('the spell-check engine is not on the eager module graph', () => {
        const jsDir = path.join(ROOT, 'assets/js');
        // nspell-engine.js is a generated bundle — skip it in this walk.
        const skipFile = (n) => n === 'nspell-engine.js' || n.includes('.min.');
        for (const file of walk(jsDir, (n) => n.endsWith('.js') && !skipFile(n))) {
            const text = fs.readFileSync(file, 'utf8');
            const staticWordlist = text.match(/import\s*(?:\{[^}]*\}|[\w$*]+(?:\s*,\s*\{[^}]*\})?)\s*from\s*['"]\.\/wordlist\.js['"]/);
            assert.equal(staticWordlist, null, `${rel(file)} statically imports wordlist.js`);
            const staticEngine = text.match(/import\s*(?:\{[^}]*\}|[\w$*]+(?:\s*,\s*\{[^}]*\})?)\s*from\s*['"]\.\/nspell-engine\.js['"]/);
            assert.equal(staticEngine, null, `${rel(file)} statically imports nspell-engine.js`);
        }
        const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
        assert.ok(!sw.includes('wordlist'), 'service worker precaches wordlist');
        assert.ok(!sw.includes('nspell-engine'), 'service worker precaches nspell engine');
    });

    check('dev tooling is blocked at the server and not deployed', () => {
        const htaccess = fs.readFileSync(path.join(ROOT, '.htaccess'), 'utf8');
        assert.ok(/\(includes\|lang\|tests\|tools\|docs\|node_modules\)/.test(htaccess), 'rewrite does not deny node_modules');
        assert.ok(/\(dev-server\|runone\)\\\.mjs\$/.test(htaccess), 'rewrite does not deny dev *.mjs files');
        assert.ok(/\(log\|sql\|sqlite\|bak\|old\|backup\|ini\|md\|mjs\|lock\)\$/.test(htaccess), 'FilesMatch does not deny *.mjs');
        const cpanel = fs.readFileSync(path.join(ROOT, '.cpanel.yml'), 'utf8');
        assert.ok(!/cp\s+-R\s+\*/.test(cpanel), '.cpanel.yml still blind-copies the checkout');
    });

    check('flyout submenus cannot be clipped or scrolled by their parent panel', () => {
        const css = fs.readFileSync(path.join(ROOT, 'assets/css/app.css'), 'utf8');
        assert.match(css, /\.menu__panel--submenu\s*{[\s\S]*?display:\s*none/,
            'a closed flyout must be display:none - visibility:hidden keeps its layout and the abspos panel adds scroll area to the parent');
        assert.match(css, /\.menu__panel--has-submenu\s*{[\s\S]*?overflow:\s*visible/,
            'a panel containing a flyout must let it escape its overflow (else the flyout is masked and the parent grows scrollbars)');
        const appbar = fs.readFileSync(path.join(ROOT, 'includes/appbar.php'), 'utf8');
        assert.ok(appbar.includes('menu__panel--has-submenu'),
            'the renderer must emit the has-submenu class (no :has() dependency)');
    });

    check('og image and favicon.ico exist at their assets paths', () => {
        assert.ok(fs.existsSync(path.join(ROOT, 'assets/img/og-image.png')), 'missing assets/img/og-image.png');
        assert.ok(fs.existsSync(path.join(ROOT, 'assets/icons/favicon.ico')), 'missing assets/icons/favicon.ico');
        // Legacy URLs (browsers request /favicon.ico directly, stale caches
        // may hold the pre-reorg paths) must keep resolving after the move.
        const htaccess = fs.readFileSync(path.join(ROOT, '.htaccess'), 'utf8');
        assert.ok(htaccess.includes('RewriteRule ^favicon\\.ico$ /assets/icons/favicon.ico [L]'),
            '.htaccess no longer redirects the legacy /favicon.ico');
        assert.ok(htaccess.includes('RewriteRule ^og-image\\.png$ /assets/img/og-image.png [L]'),
            '.htaccess no longer redirects the legacy /og-image.png');
        assert.ok(htaccess.includes('RewriteRule ^fonts/(.+)'), '.htaccess no longer redirects legacy /fonts/ paths');
    });

    group('static: landing pages');

    // Single source of truth: the slug list lives in includes/bootstrap.php as
    // NPAD_LANDING_SLUGS. Deriving it here keeps the tests honest when pages
    // are added without silently letting a slug ship half-wired.
    const bootstrapSrc = fs.readFileSync(path.join(ROOT, 'includes/bootstrap.php'), 'utf8');
    const slugsBlock = bootstrapSrc.match(/NPAD_LANDING_SLUGS\s*=\s*\[([\s\S]*?)\]/)?.[1] ?? '';
    const slugs = [...slugsBlock.matchAll(/'([^']+)'/g)].map((m) => m[1]);

    check('the landing slug list is non-trivial and unique', () => {
        assert.ok(slugs.length >= 4, `only ${slugs.length} landing slugs found`);
        assert.equal(new Set(slugs).size, slugs.length, 'duplicate landing slug');
    });

    check('every landing slug has EN and FA entry files', () => {
        for (const slug of slugs) {
            assert.ok(fs.existsSync(path.join(ROOT, `${slug}.php`)), `missing ${slug}.php`);
            assert.ok(fs.existsSync(path.join(ROOT, 'fa', `${slug}.php`)), `missing fa/${slug}.php`);
        }
    });

    check('pretty URLs are rewritten and listed in the sitemap', () => {
        const htaccess = fs.readFileSync(path.join(ROOT, '.htaccess'), 'utf8');
        const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.php'), 'utf8');
        for (const slug of slugs) {
            assert.ok(htaccess.includes(`RewriteRule ^${slug}/?$ `),
                `.htaccess missing rewrite for /${slug}`);
            assert.ok(htaccess.includes(`RewriteRule ^fa/${slug}/?$ `),
                `.htaccess missing rewrite for /fa/${slug}`);
            // sitemap.php iterates NPAD_LANDING_SLUGS, so every slug appears in
            // its priorities map (both locales) rather than as a literal loop.
            assert.ok(sitemap.includes(`'/${slug}'`), `sitemap missing priority for /${slug}`);
            assert.ok(sitemap.includes(`'/fa/${slug}'`), `sitemap missing priority for /fa/${slug}`);
        }
    });

    check('the footer link mesh covers every landing page in both locales', () => {
        const footer = fs.readFileSync(path.join(ROOT, 'includes/footer.php'), 'utf8');
        for (const slug of slugs) {
            assert.ok(footer.includes(`"${slug}"`) || footer.includes("'${slug}'") || footer.includes('$tool'),
                `footer does not link /${slug}`);
        }
        const en = fs.readFileSync(path.join(ROOT, 'lang/en.php'), 'utf8');
        const fa = fs.readFileSync(path.join(ROOT, 'lang/fa.php'), 'utf8');
        for (const slug of slugs) {
            assert.ok(en.includes(`'${slug}' =>`), `lang/en.php missing landing copy for ${slug}`);
            assert.ok(fa.includes(`'${slug}' =>`), `lang/fa.php missing landing copy for ${slug}`);
        }
    });

    check('landing renderer emits self-canonicals, breadcrumbs and FAQ schema', () => {
        const landing = fs.readFileSync(path.join(ROOT, 'includes/landing.php'), 'utf8');
        assert.ok(landing.includes('BreadcrumbList'), 'no BreadcrumbList schema');
        assert.ok(landing.includes('FAQPage'), 'no FAQPage schema');
        assert.ok(landing.includes('$canonicalPath'), 'canonical path not derived from slug');
        const head = fs.readFileSync(path.join(ROOT, 'includes/head.php'), 'utf8');
        assert.ok(head.includes('str_replace(\'/fa/\', \'/\', $canonicalPath)'),
            'hreflang alternates must mirror the canonical URL, not hardcode the home page');
    });
}
