/**
 * Service worker — makes the "works offline" claim in the FAQ true.
 *
 * Strategy:
 *   - navigations: network-first, falling back to the cached page, then the
 *     locale-matched offline page
 *   - CSS / JS assets: network-first with cache fallback — these change on
 *     every deploy, so stale-while-revalidate would serve old CSS/JS on the
 *     first load after an update even when online. Network-first ensures
 *     users always get fresh styles and code when a connection is available.
 *   - other static assets (fonts, images, manifests): stale-while-revalidate
 *     — these rarely change and benefit from instant cache hits
 *   - /api/ and /admin/: never cached
 *
 * The install precache intentionally holds only the offline fallbacks: all
 * application assets are runtime-cached during the first online load, so
 * precaching them too would duplicate ~1 MB of downloads per visitor.
 */

const VERSION = 'npad-v2.25.0';
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;

const PRECACHE = [
    '/offline.html',
    '/fa/offline.html',
];

/** Paths whose assets change on every deploy — always fetch fresh when online. */
function isMutableAsset(pathname) {
    return pathname.endsWith('.css')
        || pathname.endsWith('.js')
        || pathname.endsWith('.php');
}

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

    // Navigations: network-first, cache fallback, then offline page.
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const copy = response.clone();
                    caches.open(SHELL).then((cache) => cache.put(request, copy));
                    return response;
                })
                .catch(async () => {
                    const cached = await caches.match(request, { ignoreSearch: true });
                    if (cached) return cached;
                    const offline = url.pathname.startsWith('/fa/')
                        ? '/fa/offline.html'
                        : '/offline.html';
                    return (await caches.match(offline)) || Response.error();
                }),
        );
        return;
    }

    // CSS / JS / PHP: network-first so deploys are visible immediately.
    // Falls back to cache only when offline.
    if (isMutableAsset(url.pathname)) {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response && response.status === 200) {
                        const copy = response.clone();
                        caches.open(ASSETS).then((cache) => cache.put(request, copy));
                    }
                    return response;
                })
                .catch(() => caches.match(request, { ignoreSearch: true })),
        );
        return;
    }

    // Everything else (fonts, images, manifests): stale-while-revalidate.
    event.respondWith(
        caches.match(request, { ignoreSearch: true }).then((cached) => {
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
