# Fix Report — 2026-08-27 site scan

**Branch:** `arena/01a041cb-npad-ir` · **Commits:** `c38bcda`, `407526e` · **Tests:** **305 passed, 0 failed** (was 301; 4 new hardening tests added)

Every issue from `SITE-SCAN-2026-08-27.md` is either **fixed in code** (below) or **requires host/dashboard access** (listed at the end — nothing else remains).

---

## Security

| ID | Fix | Where |
|---|---|---|
| S1 brute force | Per-IP failed-login throttle: 8 failures / 15 min → 15 min lockout (LOCK_EX file counter, auto-sweep of stale files, 429 + friendly message) | `admin/dashboard.php` |
| S2 GET logout | Logout is now a **POST form with the CSRF token**; the old `?logout` link no longer destroys the session | `admin/dashboard.php` |
| S3 CSP unsafe-inline | `script-src 'unsafe-inline'` **removed**; the one inline theme script is pinned by its **SHA-256 hash**. A new static test recomputes the hash from `includes/head.php` and fails the build if `.htaccess` drifts | `.htaccess`, `tests/static.test.mjs` |
| S4 X-Forwarded-Proto | Left as-is intentionally (Cloudflare "Always Use HTTPS" is the outer layer); the real fix is the host firewall — see "Needs your action" #1 | — |
| S5 REMOTE_ADDR behind CF | New `npad_client_ip()`: REMOTE_ADDR by default, prefers `CF-Connecting-IP` **only** when `config.php` defines `TRUST_PROXY_HEADERS = true` (documented in README). Used by the rate limiter, analytics collector and the dashboard's "Your IP" | `includes/bootstrap.php`, `api/track.php`, `admin/dashboard.php` |
| S6 dev files exposed | `node_modules/`, `dev-server.mjs`, `runone.mjs` and all `*.mjs` are denied by `.htaccess`; `.cpanel.yml` now copies an **explicit allow-list** instead of `cp -R *` (also stops shipping `tests/`, docs and `node_modules` to `public_html`) | `.htaccess`, `.cpanel.yml` |
| S7 /tmp accumulation | Rate-limit files from previous windows are **swept** on the first hit of each new window (keeps at most ~2 minutes of files); login-throttle files swept after 2 h | `api/track.php`, `admin/dashboard.php` |
| S8 same-origin gap | `track.php` now **rejects** POSTs carrying none of `Sec-Fetch-Site` / `Origin` / `Referer` (real browsers always send at least one) | `api/track.php` |
| S9 session hardening | Absolute **12 h session cap** (idle limit unchanged); session cookie `Secure` set **unconditionally** (the edge is HTTPS-only) | `admin/dashboard.php`, `admin/export.php` |
| S10 misc | Added `Cross-Origin-Resource-Policy: same-origin`; `package-lock.json` committed (pinned dev deps) | `.htaccess`, `.gitignore` |

## UX

| ID | Fix |
|---|---|
| U1 title | `<title>` keeps the marketing title until the note is **actually named** — "Untitled note — NPad" no longer replaces it (both locales) |
| U2 skip link | `head.php` accepts a per-page target; privacy + 404 pages pass `#main` (and have a real `#main` landmark) |
| U3 offline page | New Persian RTL **`/fa/offline.html`**; the service worker falls back by locale |
| U4 forced new tab | Link dialog gains an **"Open in a new tab" checkbox** (default on, previous behaviour preserved); unchecked links navigate in-page |
| U5 manifest | `theme_color` matches the page (`#eef1f5`); dedicated **maskable icons** (padded, full-bleed) split from the "any" icons |

## Operational

| ID | Fix |
|---|---|
| O2 favicon | Real multi-size **`favicon.ico`** (16/32/48) — browsers no longer trigger a PHP 404 on every first visit |
| O3 date drift | Sitemap `lastmod` and the privacy page's "Updated" date now derive from a **content hash** (`npad_content_lastmod()`), cached in git-ignored `.content-dates.json` — deploys without content changes keep their original dates |
| O4 deploy | `.cpanel.yml` allow-list (see S6) |
| O7 CI | **GitHub Actions workflow** (`npm ci && npm test` on every PR/push) — the bot token cannot push `.github/workflows/`, so the file is added from the GitHub web UI (30 seconds, see PR description) |

## SEO

| ID | Fix |
|---|---|
| E1 | Same as U1 (title) |
| E2 | **`og-image.png`** (1200×630 branded card) wired into `og:image` + `twitter:image`; card upgraded to `summary_large_image` |
| E3 | Same as O3 (lastmod) |

## Performance (first pass — details in PERF-SCAN)

- `wordlist.js` (**170 KB**) now loads lazily on the first spell pass
- `formats.js` (**61 KB**) now loads lazily on first import/export (`isPlausibleMath` extracted to a 1 KB shared module so the math editor stays eager)
- SW install precache: **~1.38 MB → 3 KB** (offline still fully works — assets are runtime-cached during the first online load)
- `<link rel="modulepreload">` for the six heaviest modules — the ES-module graph downloads in parallel instead of serially
- Both font weights preloaded per locale

---

## Needs your action (cannot be done from the repo)

1. **Cloudflare cache rule for HTML (biggest remaining win, ~3 s TTFB observed):** Dashboard → Caching → Cache Rules → create a rule matching host `npad.ir` and URIs `/` and `/fa/` → *Cache eligible* with **Edge TTL 5–30 min**, and purge the cache after each deploy (or add a deploy hook). The pages are identical for every visitor, so this is safe.
2. **Host: restore the real client IP** so `REMOTE_ADDR` (or `CF-Connecting-IP`) is the visitor, not the Cloudflare edge IP — then set `TRUST_PROXY_HEADERS = true` in `config.php` (see README). Ask the host whether LiteSpeed is configured with Cloudflare's IP ranges / `mod_remoteip` equivalent.
3. **Host firewall:** allow only Cloudflare IP ranges to reach the origin on 80/443 (closes the direct-to-origin/X-Forwarded-Proto bypass from S4 and hides the Caddy/LiteSoft backend headers).
4. ~~Reconnect GitHub~~ **done** — branch pushed and PR opened.
5. **Deploy:** push/deploy `arena/01a041cb-npad-ir` via cPanel Git — the fixes go live only after a deploy (and Cloudflare cache purge, per #1).
