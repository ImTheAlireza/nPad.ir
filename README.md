# NPad

A free, private online notepad. Keep several rich-text notes open in document
tabs, organize them with folders and color-coded tags, and filter them in the
browser; everything is saved locally, works offline, and needs no account.

Live: <https://npad.ir>

---

## Structure

```
├─ index.php              English notepad  (canonical, /)
├─ fa/index.php           Persian notepad  (/fa/)
├─ privacy.php            Privacy policy   (+ fa/privacy.php)
├─ 404.php                Error page
├─ sitemap.php            Generated sitemap (served at /sitemap.xml)
├─ sw.js                  Service worker — offline support
│
├─ includes/              PHP partials
│  ├─ bootstrap.php       Paths, config loading, helpers (e, t, asset)
│  ├─ page.php            Shared controller for both locales
│  ├─ head.php            <head> incl. pre-paint theme script
│  ├─ appbar.php          Menus, language switch, theme toggle
│  ├─ editor.php          Notes sidebar, toolbar, editing surface, dialogs
│  ├─ content.php         Marketing content + JSON-LD
│  ├─ footer.php          Footer
│  └─ icons.php           Inline SVG icon set
│
├─ lang/                  All user-facing copy
│  ├─ en.php
│  └─ fa.php
│
├─ assets/
│  ├─ css/app.css         Design tokens + all styling
│  └─ js/
│     ├─ app.js           Entry point
│     ├─ editor.js        Document tabs, note UI, editing, autosave, shortcuts
│     ├─ storage.js       Notes + folder/tag metadata, migration and recovery
│     ├─ sanitize.js      HTML allow-list sanitiser
│     ├─ ui.js            Menus, dialogs, toasts
│     ├─ theme.js         Light/dark
│     ├─ analytics.js     Anonymous event reporting
│     ├─ dashboard.js     Admin charts
│     ├─ spellcheck.js    Custom spell checker (marks + suggestion tooltip)
│     ├─ wordlist.js      Bundled en/fa dictionary (18.7k words, ~125 KB)
│     └─ vendor/          Self-hosted Chart.js 4.5.1
│
├─ fonts/                 Self-hosted Inter + Vazirmatn (WOFF2, ~96 KB)
├─ api/track.php          Event collector
├─ admin/                 Dashboard + CSV export (private)
└─ tests/                 Test suite
```

## Requirements

- PHP 8.0+ (uses `match`, `str_starts_with`, nullsafe operators)
- Apache with `mod_rewrite`, `mod_headers`, `mod_deflate`
- MySQL — **optional**, analytics only. The site runs fine without it.

## Setup

The public site needs no configuration. For analytics, create `config.php`
in the project root (git-ignored):

```php
<?php
if (!defined('CONFIG_LOADED')) { exit; }

define('DB_HOST', 'localhost');
define('DB_USER', 'user');
define('DB_PASS', 'secret');
define('DB_NAME', 'npad');

define('ADMIN_PASSWORD_HASH', password_hash('choose-a-strong-password', PASSWORD_DEFAULT));
define('SESSION_LIFETIME', 1800);
define('MAX_REQUESTS_PER_MINUTE', 60);

function getDBConnection(): mysqli {
    $conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
    if ($conn->connect_error) { throw new RuntimeException('DB connection failed'); }
    $conn->set_charset('utf8mb4');
    return $conn;
}

function verifyAdminPassword(string $password): bool {
    return password_verify($password, ADMIN_PASSWORD_HASH);
}
```

Schema:

```sql
CREATE TABLE analytics (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    event_type VARCHAR(50)  NOT NULL,
    ip_address VARCHAR(45)  NOT NULL,
    user_agent VARCHAR(255) NOT NULL,
    created_at DATETIME     NOT NULL,
    INDEX idx_created (created_at),
    INDEX idx_event (event_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

`php_value` directives belong in `.user.ini`, **not** `.htaccess` — under
PHP-FPM the latter returns HTTP 500 for the whole site.

## Local development

No system PHP needed — the site runs through PHP 8.2 compiled to WebAssembly
(the same runtime the test suite uses):

```bash
npm install
npm run dev       # serves the real site on http://0.0.0.0:8787
```

`dev-server.mjs` mirrors the repository into the php-wasm filesystem,
watches for file changes, and emulates the `.htaccess` rules (sitemap
rewrite, `ErrorDocument 404`, trailing-slash redirect). For local analytics,
create a `config.php` — see the example above (or use a SQLite-backed
variant for machines without MySQL).

## Tests

```bash
npm install     # dev-only; the site itself ships no JS dependencies
npm test
```

214 assertions covering:

| Suite | What it proves |
|---|---|
| `static` | PHP + JS parse; no CDN, geo-IP, `php_value` or `console.log` regressions; fonts, icons and service-worker precache all resolve; client/server event lists agree |
| `contrast` | Every token pair meets WCAG AA (4.5:1 text, 3:1 controls) in both themes |
| `lang` | `en.php` and `fa.php` expose identical key structures |
| `sanitize` | 22 XSS vectors neutralised; formatting preserved |
| `storage` | Legacy migration, multiple notes, open-tab state, folder/tag relationships, synchronous recovery and selective deletion |
| `render` | All 6 pages render under real PHP 8.2 (php-wasm); partials refuse direct access; markup and a11y assertions |
| `behaviour` | Document tabs and folder/tag create, assign, filter, rename and delete flows work; menus, themes, autosave and editor tools remain functional |

## Notable decisions

**One entry point.** `index.html` and `index.php` both existed and differed by
1,122 lines, with no `DirectoryIndex` set — Apache was serving the stale HTML
file. `index.html` is deleted and `DirectoryIndex index.php` is explicit.

**Languages are URLs, not CSS.** Both locales used to ship in every response
with one hidden via `display:none` (~8 KB of dead markup, plus a flash of
English for Persian visitors). Now `/` and `/fa/` render only their own copy
from `lang/*.php`.

**No third-party requests.** Fonts are self-hosted, icons are inline SVG,
Chart.js is vendored. The previous build called three geo-IP APIs to guess a
language while its own CSP set `connect-src 'self'`, so those calls could
never succeed — they only burned timeouts.

**Light theme authored first.** Cards and FAQ items used
`rgba(255,255,255,0.03)` on both themes, which computed to 1.01:1 on the light
background — invisible. Every colour is now a token with an enforced contrast
floor.

**`execCommand`.** Deprecated, but still the only broadly supported way to
drive `contenteditable` without shipping an editing engine. All calls are
funnelled through one `exec()` in `editor.js` for future replacement.

**Tabs are views, not copies.** Opening a note adds its ID to a small ordered
local session list. Switching tabs flushes the current note before restoring
the next one, while closing a tab never deletes the underlying note.

**Analytics is opt-out and truthy.** Do Not Track and Global Privacy Control
are honoured, IPs are truncated before storage, and `/privacy.php` documents
what is actually recorded. The old FAQ claimed "no tracking" while logging
every page view.

## Licences

- Inter — SIL Open Font License 1.1 (`fonts/LICENSE-Inter.txt`)
- Vazirmatn — SIL Open Font License 1.1 (`fonts/LICENSE-Vazirmatn.txt`)
- Chart.js 4.5.1 — MIT
