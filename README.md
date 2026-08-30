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
├─ online-notepad.php     SEO landing pages, pretty URLs (+ fa/):
├─ markdown-editor.php      /online-notepad  /markdown-editor
├─ math-notepad.php         /math-notepad    /checklist-app
├─ checklist-app.php        rendered by includes/landing.php from lang copy
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
│  ├─ fonts/              Self-hosted Inter + Vazirmatn (+ KaTeX typefaces)
│  ├─ icons/              favicon, apple-touch-icon, PWA icons
│  ├─ img/og-image.png    Social-share card
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
│     ├─ codeblock.js     Code blocks: highlighting, language chip, copy button
│     ├─ mathblock.js     Math typesetting: KaTeX paint, dialog, magic typing
│     ├─ outline.js       Collapsible sections + outline navigator
│     ├─ checklist.js     Checklists + cross-note task overview
│     ├─ bidi.js          Direction detection + Unicode isolate helper
│     ├─ caret.js         Caret boundary helpers shared by code/math modules
│     ├─ wordlist.js      Bundled en/fa dictionary (18.7k words, ~125 KB)
│     └─ vendor/          Self-hosted Chart.js 4.5.1 + Prism 1.30.0 + KaTeX 0.18.4
│
├─ api/track.php          Event collector
├─ admin/                 Dashboard + CSV export (private)
├─ docs/                  Project docs (audits, plans, SEO notes)
├─ tools/                 Dev tooling (dev-server.mjs, runone.mjs)
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

// Only when the host does NOT restore the visitor's real IP into REMOTE_ADDR
// (ask the host; Cloudflare proxies otherwise leave the edge IP there, which
// makes the rate limit shared across all visitors). When enabled, the
// collector and dashboard prefer CF-Connecting-IP.
// define('TRUST_PROXY_HEADERS', true);

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

`tools/dev-server.mjs` mirrors the repository into the php-wasm filesystem,
watches for file changes, and emulates the `.htaccess` rules (sitemap
rewrite, pretty landing URLs, legacy `/favicon.ico`, `ErrorDocument 404`,
trailing-slash redirect). For local analytics, create a `config.php` — see
the example above (or use a SQLite-backed variant for machines without
MySQL).

## Document import and export

The File menu's **Export as** submenu exports **TXT, HTML, Markdown, NPad
JSON, DOCX, PDF, and RTF** — a click-opened flyout with full keyboard
support (arrows navigate, Escape closes the flyout before the menu) that
becomes an inline expansion on small screens. Imports stay on the top level.
Processing stays in the browser: imported active HTML passes through
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

## Code blocks

The **Insert** menu adds a code block: a monospace, always-LTR surface with a
language chip, a copy button and a delete button. Languages are highlighted by
a self-hosted Prism bundle (26 common languages, ~76 KB, lazy-loaded the first
time a note actually contains a highlighted block — no CDN, no request
otherwise). The language is stored on the block, so Markdown export writes
fenced code with the info string (```` ```js ````) and import reads it back.

The language is guessed where it helps and never where it hurts: code selected
before Insert, code pasted into a plain block, and plain fenced blocks in
imported files all go through a heuristic detector; an explicit class or an
explicit "Plain text" choice always wins. Inside a block, `Tab` indents,
`Enter` breaks a line — and at the very end of the block it hands the caret to
the next paragraph (`Shift+Enter` always breaks a line). Backspace on an
emptied block removes it, and at the block edges it refuses to merge the code
with neighbouring paragraphs.

The stored note keeps the plain form (`<pre><code class="language-js">`),
while token spans and the block chrome are runtime paint — stripped again
before every save and export, the same transient-paint rule as search
highlights. The chip's label is a CSS `attr()` value rather than a text node,
so word counts, find, spellcheck and TXT export see only the code itself.
Every syntax colour is a design token verified at WCAG AA against the code
background in both themes (and in print, where the light palette is forced).

## Math typesetting

The **Insert** menu adds a math formula: a dialog with a LaTeX field, an
inline/block toggle, a symbol keyboard (fractions, roots, sums, integrals,
Greek letters — inserts at the caret with cursor stops) and a live KaTeX
preview with parse errors shown inline. Formulas carry a delete button in
their corner (with confirmation), removed again before saving like all
runtime paint.
Formulas are self-hosted KaTeX 0.18.4 (no CDN), lazy-loaded with a
woff2-only stylesheet the first time a note actually contains one; KaTeX
renders visible HTML plus hidden MathML, so screen readers get real math.

The stored note keeps the LaTeX source as plain text inside
`<math-inline>`/`<math-block>` tags, while KaTeX output is runtime paint —
stripped before every save and export, exactly like the code-block tokens.
Markdown pairs through delimiters: `$…$` and `$$…$$` convert on import and
export, gated by the same plausibility heuristics that keep prose about
money ("I paid $5 and $10") as prose. Typing the closing `$$` delimiter in
the editor converts on the fly (formulas are blocks; inline math exists only
as a legacy rendering path). While the caret is inside a formula it shows
raw LaTeX in monospace (always LTR); on leaving it re-renders. Enter at the
end of a block formula hands the caret to the next paragraph, Backspace on
an emptied formula removes it, and double-click reopens the dialog.
DOCX export converts every formula to **native Word math (OMML)** —
KaTeX's MathML is translated to the Office math dialect (fractions,
radicals, sub/superscripts, n-ary operators with limits, accents,
matrices), so equations render and re-edit as real formulas in Word, not
as LaTeX source text. Display formulas become centred `oMathPara`
paragraphs; inline ones sit in the text flow. If KaTeX could not load
(offline first visit), the export falls back to the LaTeX source, and
re-importing a Word file flattens OMML back to readable linear text
(`a/b`, `x^(2)`, `√(x)`, `∑_{i}^{n}`) rather than dropping it. RTF keeps
the LaTeX source in monospace; PDF export prints the rendered formula
for free.

## Collapsible sections, outline and checklists

The **Insert** menu adds collapsible sections and checklists; the toolbar
gains an **Outline** panel.

Sections are native `<details>/<summary>`: the stored note keeps the source
*and* each section's open/collapsed state, clicking the summary toggles it
(the one deterministic behaviour across engines), printing expands every
section and restores it after, and Markdown passes sections through as raw
HTML blocks. **The section body is a normal editing space**: anything
inserted with the caret inside it — text, tables, checklists, code, math,
or another collapsible section — lands inside the body, and sections nest
arbitrarily. Inserting with the caret on a *title* puts the block at the
start of that section's body (another section becomes a sibling after it),
never inside the `<summary>`. Enter on a title jumps into the first body
block, whatever it is. The **Outline** panel lists the note's H1–H6 headings
and section summaries indented by level (nested sections indent deeper) —
click to jump, `Esc` to close, rebuilt live while typing.

Checklists are GFM-compatible: `- [ ]` / `- [x]` round-trip through Markdown
(empty items included), items are real checkboxes (toggle with the mouse or
Space), checked items dim with a strike-through, and the checked state
persists in the note. A new checklist starts with one **empty** item: the
"Add a task…" hint is CSS paint keyed to a transient class (stripped before
every save and export, exactly like spell marks), so placeholder text can
never become note content. The sanitizer admits checkbox inputs only inside
checklist lists.

**Edit → Tasks…** aggregates every checklist task across all notes into one
dialog — open and completed sections, live counts, toggling a row updates
the source note (the live editor for the active note, storage for the rest),
and each row carries a jump link that opens the note and scrolls to the task.

Keyboard behaviour matches plain text: Enter opens the next item (Enter on
an empty item leaves the list), Backspace on an emptied item removes it, and
inside sections Backspace on a cleared line removes it — the last one removes
the section — instead of stranding the caret.

**Direction is per note.** The toolbar LTR/RTL buttons write the direction
onto the active note (persisted with it and restored on switch); notes
without an override are auto-detected from their first strong character
(`assets/js/bidi.js`), and mixed-language titles and previews render with
`dir="auto"` plus Unicode FSI…PDI isolates where text leaves the DOM
(document title).

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

## SEO landing pages

The home page is an application, not a document: it answers no specific
query. Four landing pages give each search intent a stable, crawlable URL
in both locales — `/online-notepad`, `/markdown-editor`,
`/math-notepad`, `/checklist-app` (plus `/fa/…` mirrors). All copy lives
in `lang/{en,fa}.php` under `landing.pages`, so the lang parity test
guarantees no locale ships a half-translated page, and
`includes/landing.php` renders any slug from that copy: hero, numbered
how-it-works, features, FAQ (`<details>`), related-tools links and a
final CTA into the app.

Each page carries a self-referencing canonical (the pretty URL, served
via `.htaccess` rewrites), hreflang alternates that mirror the canonical
in the other locale, FAQPage + BreadcrumbList JSON-LD built from the
visible copy, and the same OG/Twitter card as the app. `sitemap.php`
lists all eight URLs with content-hash lastmods, and the footer links
every tool on every page so the whole set stays crawled. The render
suite executes the pages with real PHP and pins the canonicals,
hreflang pairs, breadcrumb and schema.

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
| `sanitize` | XSS vectors neutralised (including table tags/attrs); spans bounded; formatting preserved |
| `table` | Grid model: creation, row/column inserts and deletes around spans, merge/split, headers, shading, width, borders, captions, move row, Tab navigation, paste normalisation |
| `formats` | Markdown/JSON/RTF round trips; GFM pipe tables and DOCX `w:tbl` + merge spans; valid DOCX ZIPs; PDF stream and Unicode-map extraction |
| `codeblocks` | Sanitiser bounds on `language-*` classes; Markdown fence round trips; language autodetection; the runtime module against the real Prism bundle: chrome, highlight/unhighlight cycles, normalisation, the full keyboard model (Tab, Enter/Shift+Enter, Backspace/Delete edges), copy, spellcheck skip |
| `storage` | Legacy migration, notes, open-tab state, folder/tag relationships, timestamped backup retention and recovery |
| `render` | All 6 pages render under real PHP 8.2 (php-wasm); partials refuse direct access; markup and a11y assertions |
| `behaviour` | Tabs, organization and recovery flows; advanced find/replace modes; spelling corrections; autosave; Insert menu, table dialog, contextual toolbar, cell control |
| `tables-ui` | Full awaited end-to-end flow: Insert menu → settings dialog → live table → row/column/merge/split/header tools → properties → delete → context menu |
| `codeblocks-ui` | Full awaited end-to-end flow: Insert menu → block with chrome → language dialog → Prism highlight → copy → Tab → autosave stores the plain form → markdown paste |
| `math` / `math-ui` | Sanitiser bounds on the math tags; `$$…$$` round trips incl. money heuristics; the runtime module against the real KaTeX: paint/strip cycles, edit mode, keyboard model, magic typing; awaited end-to-end dialog flow, autosave, double-click edit |
| `structure` / `structure-ui` | Sanitiser bounds for sections/checklists (`open`, bounded input attrs, checklist-only inputs); Markdown round trips for task lists and raw details; outline build + jump; checklist normalisation; cross-note task scan; awaited end-to-end flows for sections, outline, checklist toggle and the Tasks dialog across notes |

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

- Inter — SIL Open Font License 1.1 (`assets/fonts/LICENSE-Inter.txt`)
- Vazirmatn — SIL Open Font License 1.1 (`assets/fonts/LICENSE-Vazirmatn.txt`)
- Chart.js 4.5.1 — MIT (`assets/js/vendor/LICENSE-chartjs.md`)
- Prism 1.30.0 — MIT (`assets/js/vendor/LICENSE-prism.md`)
- KaTeX 0.18.4 — MIT; bundled KaTeX typefaces under SIL OFL 1.1
  (`assets/js/vendor/LICENSE-katex.md`)
