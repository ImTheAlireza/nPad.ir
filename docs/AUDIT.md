# nPad.ir — Performance & UI Audit

**Date:** 2026-07-26 · **Commit:** `e7d500b` · **Scope:** `index.html`, `index.php`, `style.css`, `scripts.js`, `dashboard.php`, `track.php`, `export.php`, `.htaccess`, `robots.txt`, `sitemap.xml`

---

## Verdict

The app *works*, and the visual direction (glass, gradients, animated blobs, bilingual EN/FA) is genuinely nice. But it's a flat pile of 8 files at the repo root with **two competing homepages**, a **language system that runs twice**, and a **light theme — the default — whose marketing section is functionally invisible.**

The most important finding: **`index.html` and `index.php` are both present, differ by 1,122 lines, and no `DirectoryIndex` is set.** Apache's stock order is `index.html` first — so the file most likely being served is the *stale* one, without the bilingual system you built.

| Area | Grade | One-line summary |
|---|---|---|
| Architecture / organization | **D** | 8 files at root, duplicate homepage, dead code, no build |
| Performance | **D+** | Up to 5 blocked geo requests/load, theme flash, 52% dead markup |
| UI / visual correctness | **D** | Light mode cards invisible (1.01:1), close button off-screen |
| Accessibility | **E** | Hover-only menus, 30px targets, 5 contrast failures |
| Mobile / responsive | **E** | One media query, three rules |
| SEO | **C−** | Good instincts, fabricated ratings, sitemap 404s |
| Security / privacy | **C** | Solid PHP, but CSP self-defeats and privacy claims contradict |

---

# CRITICAL

### C1 · Two homepages; the stale one probably wins
`.htaccess` has **no `DirectoryIndex`**. Apache defaults to `index.html` before `index.php`.

`index.html` is missing everything recent:

| Feature | `index.html` | `index.php` |
|---|---|---|
| `lang-toggle` | 0 | 2 |
| `content-fa` (Persian section) | 0 | 1 |
| `data-lang` | 0 | 4 |
| Font preloads | 0 | 2 |
| Self-hosted fonts | no — CDN | yes |

It also render-blocks on Google Fonts, and loads **DOMPurify that is never called** (0 usages of `DOMPurify.sanitize` anywhere in the repo).

**Fix:** delete `index.html`, add `DirectoryIndex index.php`.

### C2 · The language system runs twice, ~9s worst case
`scripts.js:260` and the inline script at `index.php:510` **both** define `detectCountry`/`setLanguage`/`initLanguage`, and **both call `initLanguage()`** (`scripts.js:374`, `index.php:632`).

On a cold visit with no saved language:

```
scripts.js : ipwho.is → api.country.is → ipapi.co   (sequential, 3s timeout each)
index.php  : ipwho.is → api.country.is              (sequential, 3s timeout each)
```

**Up to 5 third-party requests**, two racing writers to `setLanguage()` and `localStorage`. `toggleFaq` is likewise defined twice (`scripts.js:253`, `index.php:493`).

### C3 · …and your own CSP blocks all of them
`.htaccess` sets `connect-src 'self'`. Every geo `fetch()` is **blocked by the browser**. Country detection can *never* succeed in production — it only ever burns the timeouts and falls through.

Two more CSP mismatches in `index.html`: `style-src` omits `fonts.googleapis.com`, and `font-src` allows only cdnjs — so `fonts.gstatic.com` is blocked. **The stylesheet and fonts that page depends on are blocked by your own policy.**

### C4 · `filemtime()` on a file that doesn't exist
```php
index.php:42  <link ... href="/css/fontawesome-custom.css?v=<?php echo filemtime('css/fontawesome-custom.css'); ?>">
```
`css/fontawesome-custom.css` is **not in the repo**. On PHP 8 this raises `E_WARNING` and returns `false` — emitting a warning **inside `<head>`** if `display_errors` is on.

### C5 · Missing assets referenced in production
`css/fontawesome-custom.css` · `fonts/inter/Inter-Regular.woff2` · `fonts/fontawesome/fa-solid-900.woff2` · `favicon-16x16.png` · `favicon-32x32.png` · `apple-touch-icon.png` · `og-image.png` · `screenshot.png` · `/fa/` · `/blog/`

The last two are advertised in `robots.txt` **and** `sitemap.xml` (which lists 5 blog posts + `/fa/`). Those are **soft-404s being actively submitted to Google.**

---

# PERFORMANCE

### P1 · Word count is frozen for 3 seconds while you type
`updateWordCount()` sits *inside* the 3s autosave debounce (`scripts.js:406`). The counter doesn't move as you type — it looks broken. Update the counter on every input (it's cheap); debounce only the IndexedDB write.

### P2 · Close the tab within 3s and your work is gone
Zero occurrences of `beforeunload`, `pagehide`, or `visibilitychange`. Anything typed in the last 3 seconds is **lost** — directly contradicting the "Auto-Save Technology… never lose your work" card.

### P3 · Dark-mode users get a white flash every load
`dark-mode` is applied inside `DOMContentLoaded` (`scripts.js:387`) — after first paint. No pre-paint inline theme script exists in `<head>` (0 occurrences). Needs a blocking one-liner before the stylesheet.

### P4 · 52% of the document is marketing copy, half permanently hidden
| Segment | Bytes | Share |
|---|---|---|
| `index.php` total | 35,592 | 100% |
| English section | 8,019 | 22.5% |
| Persian section | 10,583 | 29.7% |
| **Both** | **18,602** | **52.3%** |

~8KB is `display:none` for every user, always. The EN section is also visible by default before JS resolves → Persian visitors see an **English flash**.

### P5 · Blob animation is a compositor stress test
Three `position:fixed` elements at 600×600 / 500×500 / 300×300 with `filter: blur(100px)`, animating `transform` on a 20s infinite loop. Blur at that radius is expensive to rasterize, and animating a blurred layer forces re-raster on many GPUs. Runs forever in dark mode, including offscreen and in background tabs. **No `prefers-reduced-motion` guard anywhere** (0 occurrences) — a WCAG 2.3.3 issue as well as a battery one.

### P6 · Misc
- `transition: all` ×8 and `backdrop-filter` ×7 — `transition: all` on `.feature-card`/`#navbar` transitions layout properties too.
- `console.log` left in production (tracking, language, country detection).
- `dashboard.php:329` loads **unpinned** `cdn.jsdelivr.net/npm/chart.js` — always latest, no SRI, breaking-change risk.
- No service worker or manifest, yet the FAQ claims **"works completely offline"** (`index.php:302`). Untrue on a hard reload.

---

# UI & VISUAL

### U1 · Light mode — the default — has invisible cards
The marketing surfaces use white-on-white alphas designed for the dark background, and **no light-mode overrides exist** (`grep 'dark-mode .feature-card'` → 0 results):

| Element | Declared | Renders as | Contrast vs `#e0e0e0` |
|---|---|---|---|
| `.feature-card` bg | `rgba(255,255,255,0.03)` | `#e1e1e1` | **1.01:1 — invisible** |
| `.feature-card` border | `rgba(255,255,255,0.08)` | `#e2e2e2` | **1.02:1 — invisible** |
| `.faq-item` bg | `rgba(255,255,255,0.02)` | `#e1e1e1` | **1.01:1 — invisible** |
| `.faq-item` border | `rgba(255,255,255,0.08)` | `#e2e2e2` | **1.02:1 — invisible** |
| `.seo-footer` border-top | `rgba(255,255,255,0.05)` | `#e2e2e2` | **1.02:1 — invisible** |

WCAG 1.4.11 wants ≥3:1 for meaningful boundaries. **Default-theme visitors see floating text with no cards at all.**

### U2 · Modal close button is white-on-white *and* in the wrong corner
```css
.close { position: absolute; right: 20px; top: 10px; color: #fff; }
.modal-content { background-color: #fff; /* no position: relative */ }
```
Two bugs stacked: `#fff` on `#fff` = **1.00:1, invisible in light mode**; and with no positioned ancestor it anchors to `.modal` (`position:fixed`, full viewport) — so the × renders in the **top-right corner of the screen**, detached from the dialog.

### U3 · Contrast failures (WCAG AA, 4.5:1)
| Pair | Ratio | |
|---|---|---|
| Body text `#64748b` on `#e0e0e0` | 3.60:1 | ✗ |
| Footer / FAQ accent `#06b6d4` on `#e0e0e0` | **1.84:1** | ✗✗ |
| CTA button white on `#06b6d4` | 2.43:1 | ✗ |
| Editor placeholder `#999` | 2.54:1 | ✗ |
| Dark-mode word count `#64748b` | 3.93:1 | ✗ |

### U4 · Menus are unusable on touch and by keyboard
`.dropdown:hover .dropdown-content { display: block; }` is the **only** open mechanism — no click, no `:focus-within`, no JS. **File and Edit menus cannot be opened on any touch device.** `aria-expanded="false"` is hardcoded and never updated; `aria-haspopup` is on Edit but missing from File.

### U5 · Touch targets are 30px
24 toolbar controls at `height: 30px`. WCAG 2.5.8 and the iOS HIG want ≥44px.

### U6 · Responsive design is three rules
The entire stylesheet has **one** media query (`max-width: 768px`) changing only hero size, section title size, and grid columns. Nothing for the navbar, the **24-control toolbar** (which will wrap into a tall pile on phones), `body { padding: 50px 30px }`, or the editor. No small-phone breakpoint.

### U7 · Language toggle collides with the footer
`position: fixed; bottom: 30px; right: 30px` overlaps footer links, with no `env(safe-area-inset-*)` handling on notched phones.

### U8 · Smaller UI bugs
- **Half the word-count label vanishes on first keystroke.** Initial HTML reads `Words: 0 - Characters: 0 | Selected words: 0 - Selected characters: 0`, but `updateWordCount()` writes only `Words: X - Characters: Y`. Selection counting was never implemented.
- `showDetails()` sends `\n` to `#modal-message`, which has no `white-space: pre-line` → renders on one line.
- `.faq-item.active .faq-answer { max-height: 200px }` — fixed cap; the longest Persian answer (167 chars, Vazirmatn RTL) can clip on narrow screens.
- `printFile()` never calls `printWindow.close()` (orphaned popups), uses deprecated `document.write`, and copies `innerHTML` **without the editor's stylesheet** — printed output loses all formatting.
- `window.onclick = …` inside `showModal` **clobbers** any other global click handler, reassigned on every open.
- `openFile()` has no size guard and no `reader.onerror`; it accepts `.html` but assigns to `innerText`, so HTML files import as visible escaped markup.
- Theme is written to IndexedDB but **never read back** — `loadFromIndexedDB()` ignores `data.theme`. Dead data.
- `updateButtonStates()` tracks only bold/italic/underline of 20 buttons, and never runs on `selectionchange` — **active states are wrong most of the time.**
- Two `<h1>` elements in the DOM (EN + FA).
- 25 inline `onclick=` handlers force `'unsafe-inline'` in `script-src`, defeating much of the CSP.
- `document.execCommand` ×8 — deprecated.

---

# SEO, PRIVACY & HOUSEKEEPING

- **Fabricated review data.** `index.html:72` ships `aggregateRating: 4.8 / 1250 ratings`. This is invented and violates Google's structured-data policy — **manual-action risk**. Remove it.
- **Privacy claims contradict the code.** The FAQ says "no tracking, complete privacy," while `track.php` logs IP + user agent to MySQL on every page view. IP *is* anonymized (good) — but the copy is still false as written, and the Privacy "policy" is a native `alert()`.
- **Sitemap advertises 6 non-existent URLs**; all `lastmod` values are `2025-01-01`.
- **Footer says "© 2025"** — hardcoded, and it's 2026.
- **`editor.innerHTML = data.content`** restores unsanitized HTML from IndexedDB. Self-inflicted only, but it's why DOMPurify was presumably added — and never wired up.
- `.htaccess`: `php_value` directives **fatal the server** under PHP-FPM/CGI (they're mod_php-only); `X-XSS-Protection` is deprecated and best removed.
- CRLF line endings throughout, no `.editorconfig` or `.gitattributes`. Last commit was `Delete error_log` — a log file had been committed.

---

# Proposed structure

```
/
├─ index.php                 # single entry point
├─ assets/
│  ├─ css/  style.css, critical.css
│  ├─ js/   editor.js, i18n.js, tracking.js, theme.js
│  └─ fonts/
├─ includes/                 # PHP partials: head, navbar, toolbar, footer
├─ lang/    en.php, fa.php   # copy out of markup
├─ admin/   dashboard.php, export.php
├─ api/     track.php
└─ .editorconfig, .gitattributes, DirectoryIndex in .htaccess
```

Rendering one language server-side from `lang/*.php` removes the ~8KB of always-hidden markup, kills the EN flash, and lets `/` and `/fa/` become real URLs — which fixes the sitemap at the same time.

---

# Suggested order

**Phase 1 — stop the bleeding (~1h).** Delete `index.html`; set `DirectoryIndex`; remove the duplicate language IIFE + `toggleFaq` from `index.php`; drop geo detection entirely (CSP blocks it — use `Accept-Language`/saved preference); guard `filemtime()`.

**Phase 2 — visible quality (~2–3h).** Light-mode overrides for cards/FAQ/footer; fix the modal close button; contrast palette pass; pre-paint theme script; immediate word count; unload flush.

**Phase 3 — interaction & mobile (~3–4h).** Click/keyboard dropdowns; 44px targets; real responsive breakpoints; `prefers-reduced-motion`; `:focus-visible`.

**Phase 4 — structure (~4–6h).** Directory reorganization, partials, `lang/` extraction, real `/fa/` route.

**Phase 5 — polish.** Remove fabricated ratings; real privacy page; regenerate sitemap; optional service worker to make the offline claim true.
