/**
 * Service worker — makes the "works offline" claim in the FAQ true.
 *
 * Strategy:
 *   - navigations: network-first, falling back to the cached shell
 *   - static assets: stale-while-revalidate
 *   - /api/: never cached
 */

const VERSION = 'npad-v2.12.0';
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;

const PRECACHE = [
    '/',
    '/fa/',
    '/offline.html',
    '/assets/css/app.css',
    '/assets/js/app.js',
    '/assets/js/editor.js',
    '/assets/js/attachments.js',
    '/assets/js/table.js',
    '/assets/js/spellcheck.js',
    '/assets/js/wordlist.js',
    '/assets/js/storage.js',
    '/assets/js/sanitize.js',
    '/assets/js/formats.js',
    '/assets/js/ui.js',
    '/assets/js/theme.js',
    '/assets/js/analytics.js',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches
            .open(SHELL)
            // addAll rejects wholesale if any single request fails; add
            // individually so one missing file cannot break installation.
            .then((cache) => Promise.allSettled(PRECACHE.map((url) => cache.add(url))))
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(
                    keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key)),
                ),
            )
            .then(() => self.clients.claim()),
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;

    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin/')) return;

    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const copy = response.clone();
                    caches.open(SHELL).then((cache) => cache.put(request, copy));
                    return response;
                })
                .catch(async () => {
                    const cached = await caches.match(request);
                    return cached || (await caches.match('/offline.html')) || Response.error();
                }),
        );
        return;
    }

    event.respondWith(
        caches.match(request).then((cached) => {
            const network = fetch(request)
                .then((response) => {
                    if (response && response.status === 200) {
                        const copy = response.clone();
                        caches.open(ASSETS).then((cache) => cache.put(request, copy));
                    }
                    return response;
                })
                .catch(() => cached);

            return cached || network;
        }),
    );
});
