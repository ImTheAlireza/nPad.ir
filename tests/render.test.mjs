/**
 * Renders every page with a real PHP 8.2 runtime (php-wasm) and asserts the
 * output. Each assertion encodes a specific defect found in the audit of the
 * previous build, so regressions fail loudly.
 */

import { PHP } from '@php-wasm/universal';
import { loadNodeRuntime } from '@php-wasm/node';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function renderAll() {
    const rt = await loadNodeRuntime('8.2', { emscriptenOptions: { processId: 1 } });
    const php = new PHP(rt);

    (function mirror(host, vfs) {
        php.mkdir(vfs);
        for (const entry of fs.readdirSync(host, { withFileTypes: true })) {
            if (['.git', 'node_modules', 'tests'].includes(entry.name)) continue;
            const h = path.join(host, entry.name);
            const v = `${vfs}/${entry.name}`;
            if (entry.isDirectory()) mirror(h, v);
            else php.writeFile(v, fs.readFileSync(h));
        }
    })(ROOT, '/site');

    const run = async (scriptPath, uri) => {
        try {
            const r = await php.run({
                scriptPath,
                $_SERVER: {
                    REQUEST_METHOD: 'GET',
                    REQUEST_URI: uri,
                    HTTP_HOST: 'npad.ir',
                    HTTPS: 'on',
                    REMOTE_ADDR: '203.0.113.42',
                    SCRIPT_FILENAME: scriptPath,
                },
            });
            return { body: r.text ?? '', errors: (r.errors ?? '').trim(), exit: r.exitCode };
        } catch (err) {
            const r = err.response ?? {};
            return { body: r.text ?? '', errors: String(r.errors ?? err.message), exit: 255 };
        }
    };

    return {
        en: await run('/site/index.php', '/'),
        fa: await run('/site/fa/index.php', '/fa/'),
        privacy: await run('/site/privacy.php', '/privacy.php'),
        privacyFa: await run('/site/fa/privacy.php', '/fa/privacy.php'),
        notFound: await run('/site/404.php', '/nope'),
        sitemap: await run('/site/sitemap.php', '/sitemap.xml'),
        partials: Object.fromEntries(
            await Promise.all(
                ['appbar', 'editor', 'content', 'head', 'footer', 'page'].map(async (n) => [
                    n,
                    await run(`/site/includes/${n}.php`, `/includes/${n}.php`),
                ]),
            ),
        ),
    };
}

export default async function run(check, group) {
    const pages = await renderAll();

    group('render: PHP execution');

    for (const [name, page] of Object.entries(pages)) {
        if (name === 'partials') continue;
        check(`${name} renders without error`, () => {
            assert.equal(page.exit, 0, `exit ${page.exit}: ${page.errors.split('\n')[0]}`);
            assert.ok(
                !/Fatal error|Parse error|Warning:|Uncaught|Deprecated/i.test(page.errors + page.body),
                page.errors.split('\n')[0] || 'error text in body',
            );
            assert.ok(page.body.length > 500, `only ${page.body.length} bytes`);
        });
    }

    group('render: partials refuse direct access');

    for (const [name, page] of Object.entries(pages.partials)) {
        check(`includes/${name}.php is inert`, () => {
            assert.equal(page.body.length, 0, `leaked ${page.body.length} bytes`);
            assert.ok(!/Fatal|Warning/i.test(page.errors), page.errors.split('\n')[0]);
        });
    }

    for (const [key, lang, dir] of [['en', 'en', 'ltr'], ['fa', 'fa', 'rtl']]) {
        const html = pages[key].body;
        const { document } = new JSDOM(html).window;
        group(`markup: index (${lang})`);

        check('exactly one <h1>', () => {
            const n = document.querySelectorAll('h1').length;
            assert.equal(n, 1, `found ${n} (old build shipped 2)`);
        });

        check(`lang="${lang}" dir="${dir}"`, () => {
            assert.equal(document.documentElement.lang, lang);
            assert.equal(document.documentElement.dir, dir);
        });

        check('no inline event handlers', () => {
            for (const a of ['onclick', 'onload', 'onerror', 'onchange', 'onsubmit']) {
                const n = document.querySelectorAll(`[${a}]`).length;
                assert.equal(n, 0, `${n} element(s) with ${a} (old build had 25 onclick)`);
            }
        });

        check('no external resources', () => {
            const ext = [...document.querySelectorAll('[src],[href]')]
                .map((el) => el.getAttribute('src') || el.getAttribute('href'))
                .filter((u) => /^https?:\/\//.test(u) && !u.startsWith('https://npad.ir'));
            assert.deepEqual(ext, [], `external: ${ext.join(', ')}`);
        });

        check('no CDN or Font Awesome remnants', () => {
            assert.ok(!/cdnjs|jsdelivr|fonts\.googleapis|font-awesome|fa-solid/i.test(html));
        });

        check('opposite language is not inlined', () => {
            const marker = lang === 'en' ? 'دفترچه' : 'Frequently asked';
            assert.ok(!html.includes(marker), 'both locales shipped in one document');
        });

        check('every toolbar button is named', () => {
            const btns = [...document.querySelectorAll('.toolbar__btn')];
            assert.ok(btns.length >= 18, `only ${btns.length} toolbar buttons`);
            const unnamed = btns.filter((b) => !b.getAttribute('aria-label')?.trim());
            assert.equal(unnamed.length, 0, `${unnamed.length} unnamed`);
        });

        check('menus are keyboard/touch operable buttons', () => {
            const triggers = [...document.querySelectorAll('.menu__trigger')];
            assert.equal(triggers.length, 2, `expected 2 menus, got ${triggers.length}`);
            triggers.forEach((t) => {
                assert.equal(t.tagName, 'BUTTON', 'trigger is not a button');
                assert.equal(t.getAttribute('aria-expanded'), 'false');
                assert.equal(t.getAttribute('aria-haspopup'), 'true');
                const id = t.getAttribute('aria-controls');
                assert.ok(id && document.getElementById(id), `aria-controls target missing: ${id}`);
            });
        });

        check('skip link resolves', () => {
            const skip = document.querySelector('.skip-link');
            assert.ok(skip, 'no skip link');
            assert.ok(document.getElementById(skip.getAttribute('href').slice(1)));
        });

        check('editor exposes textbox semantics', () => {
            const ed = document.getElementById('editor');
            assert.ok(ed, 'no #editor');
            assert.equal(ed.getAttribute('role'), 'textbox');
            assert.equal(ed.getAttribute('aria-multiline'), 'true');
            assert.ok(ed.getAttribute('aria-label'));
            assert.ok(ed.hasAttribute('contenteditable'));
        });

        check('status region is live', () => {
            assert.equal(document.getElementById('statusCounts')?.getAttribute('aria-live'), 'polite');
        });

        check('FAQ works without JavaScript', () => {
            const items = document.querySelectorAll('details.faq__item');
            assert.ok(items.length >= 6, `only ${items.length} FAQ items`);
            items.forEach((d) => assert.ok(d.querySelector('summary')));
        });

        check('theme toggle is a labelled button', () => {
            const t = document.querySelector('[data-theme-toggle]');
            assert.ok(t && t.tagName === 'BUTTON');
            assert.ok(t.getAttribute('aria-label'));
            assert.notEqual(t.getAttribute('aria-pressed'), null);
        });

        check('theme is set before first paint', () => {
            assert.ok(document.head.innerHTML.includes('npad:theme'), 'no pre-paint theme script');
        });

        check('no fabricated aggregateRating', () => {
            assert.ok(!/aggregateRating|ratingValue/i.test(html), 'fabricated review data');
        });

        check('structured data is valid JSON', () => {
            const nodes = [...document.querySelectorAll('script[type="application/ld+json"]')];
            assert.ok(nodes.length > 0, 'no JSON-LD');
            nodes.forEach((n) => JSON.parse(n.textContent));
        });

        check('i18n island is populated', () => {
            const data = JSON.parse(document.getElementById('i18n').textContent);
            assert.ok(Object.keys(data).length > 20);
            assert.ok(data.saved && data.words);
        });

        check('canonical and hreflang present', () => {
            assert.ok(document.querySelector('link[rel=canonical]'));
            ['en', 'fa', 'x-default'].forEach((h) =>
                assert.ok(document.querySelector(`link[hreflang="${h}"]`), `no hreflang=${h}`));
        });

        check('zoom is not disabled', () => {
            const v = document.querySelector('meta[name=viewport]').content;
            assert.ok(!/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/.test(v));
        });

        check('app script is a deferred module', () => {
            const s = [...document.querySelectorAll('script[src]')].find((x) => x.src.includes('app.js'));
            assert.ok(s, 'app.js not linked');
            assert.equal(s.type, 'module');
        });

        check('decorative icons are hidden from AT', () => {
            const exposed = [...document.querySelectorAll('svg')]
                .filter((s) => s.getAttribute('aria-hidden') !== 'true');
            assert.equal(exposed.length, 0, `${exposed.length} svg exposed`);
        });
    }

    group('markup: privacy');

    check('privacy documents the real analytics behaviour', () => {
        const { document } = new JSDOM(pages.privacy.body).window;
        const text = document.body.textContent;
        assert.ok(/truncated|final octet/i.test(text), 'no mention of IP truncation');
        assert.ok(/usage/i.test(text), 'no mention of usage statistics');
        assert.ok(document.querySelector('h1'), 'no heading');
        assert.ok(text.length > 800, 'too short to be a real policy');
    });

    group('markup: 404');

    check('404 has a heading and a way back', () => {
        const { document } = new JSDOM(pages.notFound.body).window;
        assert.ok(document.querySelector('h1'));
        assert.ok(document.querySelector('a[href="/"]'));
    });

    group('sitemap');

    check('lists only URLs that exist', () => {
        const locs = [...pages.sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
        assert.equal(locs.length, 4, `expected 4 URLs, got ${locs.length}`);
        assert.equal(locs.filter((u) => /\/blog\//.test(u)).length, 0, 'phantom blog URLs');
    });

    check('lastmod is current, not hardcoded', () => {
        assert.ok(!pages.sitemap.body.includes('2025-01-01'), 'stale hardcoded lastmod');
        assert.ok(pages.sitemap.body.includes(`<lastmod>${new Date().getFullYear()}`));
    });
}
