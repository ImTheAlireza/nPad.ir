# NPad

A free, private online notepad. Keep several rich-text notes open in document
tabs, organize them with folders and color-coded tags, build and edit tables,
recover content from automatic local backups, and move documents through TXT,
HTML, Markdown, JSON, DOCX, PDF, or RTF. Everything works offline and needs no
account.

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
│     ├─ storage.js       Notes, organization, timestamped backups + migration
│     ├─ formats.js       Local Markdown, JSON, DOCX, PDF and RTF codecs
│     ├─ sanitize.js      HTML allow-list sanitiser
│     ├─ table.js         Table grid model: insert/merge/split, rows, cols
│     ├─ ui.js            Menus, dialogs, toasts
│     ├─ theme.js         Light/dark
│     ├─ analytics.js     Anonymous event reporting
│     ├─ dashboard.js     Admin charts
│     ├─ spellcheck.js    Local spell checker with tap/keyboard corrections
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

## Document import and export

The File menu imports and exports **TXT, HTML, Markdown, NPad JSON, DOCX, PDF,
and RTF**. Processing stays in the browser: imported active HTML passes through
the same allow-list sanitizer as pasted content, and no document is uploaded.
NPad JSON carries the current note's title, rich content, pinned state, folder,
color-coded tags, and timestamps. Imported JSON note arrays create separate
notes.

DOCX support uses a self-contained Open XML ZIP reader/writer, including common
paragraph and inline styles. RTF preserves Unicode plus bold, italic, underline,
and strikeout. Archive decompression and imported files are bounded (25 MB per
file) to prevent unexpectedly large documents from exhausting browser memory.

PDF export intentionally opens the browser print dialog: choosing **Save as
PDF** there preserves the browser's installed fonts, formatting, Unicode, and
right-to-left layout. PDF import extracts text from ordinary unencrypted text
PDFs, including Flate-compressed streams and embedded Unicode font maps. It is
not OCR; scanned/image-only, encrypted, damaged, and unsupported PDFs report a
localized error instead of silently creating an empty note.

## Advanced search and spelling

Find and Replace supports case-sensitive search, Unicode-aware whole-word
matching, regular expressions with capture-group replacements, and replacement
limited to the editor selection. Every result is highlighted at once while the
active result uses a stronger color; the CSS Custom Highlight API keeps modern
browsers' document DOM untouched, with a transient `<mark>` fallback for older
webviews. Search highlights are always removed from saved and exported notes.

Misspelled words can be tapped to open local correction suggestions immediately.
On desktop, each flagged word is keyboard-focusable: Enter, Space, or Arrow Down
opens its accessible correction dialog; arrow keys move through suggestions and
Escape returns focus to the word. Coarse-pointer layouts provide 44 px correction
targets. The dictionary and custom words remain entirely on the device.

## Tables

The **Insert** menu (next to Edit) adds a table through a settings dialog:
rows and columns, header row and header column, width, presets and a live
preview. The toolbar is **selection-friendly**: it swaps to table tools for a
collapsed caret in a cell, a whole-table selection or a multi-cell selection,
and back to the default tools while you select text inside a single cell so
bold, italics and the rest keep working:

- add/delete rows and columns (grid-accurate around merged cells)
- merge a rectangular selection of cells and split merged cells back
- toggle the header row (`<thead><th scope="col">`) and header column
- horizontal alignment plus vertical alignment (top/middle/bottom)
- cell text direction (LTR/RTL), background colour, width, borders, caption
- clear cell content and select the whole table (marked with an outline)
- sort a column ascending/descending (skips tables with merged cells)
- move rows and delete the whole table (with confirmation — also used when
  deleting the last row or column)
- right-click context menu with the same actions, greyed out when impossible
- buttons for impossible actions are disabled (merge without a multi-cell
  selection, split an unmerged cell, move at the ends of the table)
- `Tab` / `Shift+Tab` walk cells; `Tab` from the last cell appends a row
- inserted tables go through `execCommand('insertHTML')`, so `Ctrl+Z` undoes
  the insertion; a new table never nests inside a cell (it lands beside the
  current table)

Everything stays in the browser. Tables survive local backups, HTML and NPad
JSON exports, and are serialised to GFM pipe tables in Markdown, real
`w:tbl` tables in DOCX, and tab-separated rows in RTF; pasted tables from
Excel, Word or the web are normalised (nested tables lifted, spans bounded)
before they enter the grid model.

## Image blocks

Images are semantic document blocks, not floating page objects. Use
**Insert → Image…**, paste a local image, or drop one into a note. Every route
uses the same local-first pipeline:

- **Allowed input:** PNG, JPEG, GIF, WebP, AVIF, and BMP only. Files are checked
  against their signature, decoded dimensions, a 25 MB byte cap, and a 40 MP
  pixel cap. SVG and remote image URLs are not accepted.
- **Private storage:** source bytes are stored as local assets in IndexedDB
  (`imageAssets`); localStorage is only a bounded fallback. Note HTML contains
  a validated asset reference, never image bytes, object URLs, or arbitrary CSS.
- **Accessible insertion:** NPad immediately asks for alternative text or an
  explicit decorative-image choice. A pending-description badge remains visible
  until the author makes that choice. Captions are separate visible prose.
- **Predictable editing:** click a block for a compact contextual toolbar:
  Replace, alignment, Size, details, Crop, and Delete. The primary text toolbar
  stays stable. Corner resizing is available on fine pointers; the Size dialog
  provides the same keyboard and touch path.
- **Safe layouts:** block/start/center/end alignment only. There is no free
  dragging, fixed-page placement, behind-text layering, or arbitrary filters.
- **Crop:** the dedicated Crop dialog has a visible crop frame, Original/1:1/
  4:3/16:9 presets, exact keyboard-editable values, and explicit Cancel/Apply.
  Cropping is non-destructive.
- **Portable export:** HTML, Markdown, NPad JSON, DOCX, and RTF export image
  fallbacks locally. HTML/Markdown/JSON embed safe raster data for portability;
  DOCX writes compatible media parts (or an accessible text fallback); RTF retains descriptive text and captions.

Assets follow note copies and recovery snapshots. Garbage collection only removes
an asset when neither a live note nor a recovery snapshot references it.

## Tests

```bash
npm install     # dev-only; the site itself ships no JS dependencies
npm test
```

Automated coverage includes:

| Suite | What it proves |
|---|---|
| `static` | PHP + JS parse; no CDN, geo-IP, `php_value` or `console.log` regressions; fonts, icons and service-worker precache all resolve; client/server event lists agree |
| `contrast` | Every token pair meets WCAG AA (4.5:1 text, 3:1 controls) in both themes |
| `lang` | `en.php` and `fa.php` expose identical key structures |
| `sanitize` | XSS vectors neutralised; typed image-block markup and transient data-image boundaries validated; table spans bounded |
| `image-blocks` | Image schema, file signature/dimension guards, semantic markup, temporary URLs, portable export, and asset remapping |
| `table` | Grid model: creation, row/column inserts and deletes around spans, merge/split, headers, shading, width, borders, captions, move row, Tab navigation, paste normalisation |
| `formats` | Markdown/JSON/RTF image fallbacks; GFM pipe tables and DOCX `w:tbl`/media parts; valid DOCX ZIPs; PDF stream and Unicode-map extraction |
| `storage` | Legacy migration, local image assets, notes, open-tab state, folder/tag relationships, timestamped backup retention and recovery |
| `render` | All 6 pages render under real PHP 8.2 (php-wasm); partials refuse direct access; markup and a11y assertions |
| `behaviour` | Tabs, organization and recovery flows; advanced find/replace modes; spelling corrections; autosave; Insert menu, table dialog, contextual toolbar, cell control |
| `tables-ui` | Awaited editor flows: table controls plus image picker, semantic insertion, description, roving toolbar, keyboard size, crop cancel/apply, resize, Escape, persistence, and delete |

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

**Formats stay local.** The Markdown, JSON, DOCX, PDF, and RTF codecs ship as
first-party JavaScript with no CDN or conversion service. PDF export uses the
browser's print engine rather than a Latin-only PDF generator, preserving
Persian fonts and RTL layout.

**Search paint is transient.** Modern browsers receive non-destructive CSS
highlights for all matches and a distinct active result. The legacy DOM fallback
is stripped before every save, backup, print, and export, so searching can never
change a note's stored content.

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

**Backups are local and bounded.** Autosave keeps timestamped prior versions at
most once every five minutes and always snapshots a note immediately before it
is deleted. IndexedDB retains up to 30 versions per note and 120 overall; the
fallback drops the oldest snapshots first under localStorage quota pressure.
Restoring always creates a separate note instead of overwriting current work.

**Analytics is opt-out and truthy.** Do Not Track and Global Privacy Control
are honoured, IPs are truncated before storage, and `/privacy.php` documents
what is actually recorded. The old FAQ claimed "no tracking" while logging
every page view.

## Licences

- Inter — SIL Open Font License 1.1 (`fonts/LICENSE-Inter.txt`)
- Vazirmatn — SIL Open Font License 1.1 (`fonts/LICENSE-Vazirmatn.txt`)
- Chart.js 4.5.1 — MIT
