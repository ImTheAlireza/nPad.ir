# NPad — SEO status & growth playbook

**Date:** 2026-08-28 · **Scope:** honest assessment + the work actually done + what only *you* can do next.

---

## The blunt truth

Your **on-page and technical SEO are not the problem.** They were rebuilt properly
(see `AUDIT.md`) and are now better than most of your competitors': server-rendered
content, clean canonicals, correct `hreflang`, honest structured data, fast
self-hosted assets, a generated sitemap. A crawler gets ~4,000 words of real HTML on
the homepage with no JavaScript required.

You are not stuck in the rankings because of a missing meta tag. You are stuck for two
reasons no code change can fix:

1. **"online notepad" is a bloodbath.** notepadonline.app, notepad-online.com,
   notezpad.com, screenapp.io and dozens more have years of history and backlinks.
   Google ranks a technically-perfect *unknown* site below a mediocre *known* one.
2. **npad.ir has almost no authority signal** — few/no quality backlinks, little brand
   search volume, a young domain. This is the entire game now.

So: the code work below is worth doing (and is done), but **80% of your remaining
ranking upside is off-page.** Budget your time accordingly. Don't keep polishing
`<head>`; go get links and brand mentions.

---

## What was changed in this pass (code — all shipped, 322 tests green)

| Change | Why it matters |
|---|---|
| **Per-page OG/Twitter cards** | Every landing page shared the *generic homepage* social card before. Now `/markdown-editor`, `/word-counter` etc. share their own title + description → correct signals, higher social CTR. Added `twitter:title`/`twitter:description`. |
| **`WebSite` + `Organization` schema** on the homepage | Entity/brand signal for Google's Knowledge Graph; enables sitelinks and ties the whole graph together via `@id` references. |
| **`SoftwareApplication` schema** on every landing page | The pages targeting real query intent previously had only FAQ + breadcrumb. Now each declares itself as a free web app with a feature list. |
| **3 new landing pages** (en + fa) | `/text-editor`, `/word-counter`, `/rich-text-editor` — ~850 words each, targeting query intents you already have features for. Wired into sitemap, footer link-mesh, and internal links automatically. |
| **Single source of truth for slugs** (`NPAD_LANDING_SLUGS`) | Slugs were hardcoded in 3 files. Now one constant drives sitemap, footer, and related-links; tests derive from it. Adding page #8 is a 5-file mechanical change with the parity test as a guardrail. |

### To add another landing page later
1. Add the slug to `NPAD_LANDING_SLUGS` in `includes/bootstrap.php`.
2. Create `<slug>.php` and `fa/<slug>.php` (copy an existing entry file).
3. Add two `.htaccess` rewrites (`^<slug>/?$` and `^fa/<slug>/?$`).
4. Add a priority pair in `sitemap.php`.
5. Add copy under `landing.pages.<slug>` in **both** `lang/en.php` and `lang/fa.php`
   (the parity test fails the build if one is missing).
6. `npm test`.

---

## Do these NOW (free, high-impact, ~1 hour total — only you can)

1. **Google Search Console** — verify npad.ir, submit `https://npad.ir/sitemap.xml`,
   and set up the fa/ pages. Watch the *Performance* report: it tells you which
   queries you already rank for on page 2-3 (those are your fastest wins — improve
   the matching page's copy for exactly those terms).
2. **Bing Webmaster Tools** — same. Bing also feeds DuckDuckGo/ChatGPT search.
3. **Request indexing** for the 3 new pages in GSC's URL Inspection tool so they
   don't wait weeks for discovery.
4. **Confirm the live sitemap** returns 18 URLs and the new pretty URLs
   (`/text-editor`, `/word-counter`, `/rich-text-editor` and their `/fa/` twins) all
   return 200. (Verified locally already.)

---

## Off-page: the part that actually moves rankings

Ranked by effort-to-reward. **This is where your time should go.**

### Tier 1 — brand + easy links (do first)
- **Product directories:** Product Hunt, AlternativeTo (list NPad as an alternative to
  Notepad++/Google Keep/Notion), SaaSHub, Slant, Toolfinder. These are dofollow-ish,
  send real users, and build brand queries.
- **GitHub:** if the repo is public, a good README with the live link earns links as
  the project gets starred. Add topics: `notepad`, `text-editor`, `markdown`, `pwa`.
- **Persian tech directories & listicles:** Digikala Mag, Digiato, Zoomit comment/tip
  submissions. A single mention in a "بهترین دفترچه یادداشت آنلاین" listicle
  (they exist and rank — e.g. digiato has one) is worth more than 50 tweaks.
- **Reddit / forums:** r/productivity, r/selfhosted, r/webdev "I built…" posts;
  Hacker News "Show HN". Be genuine, not spammy — the offline/private angle is a real
  story.

### Tier 2 — content that earns links
Your privacy/offline/no-account angle is a genuine differentiator. Write comparison
and how-to content (as new landing/blog pages) that people link to:
- "Online notepad that works offline — how NPad does it without an account"
- "NPad vs Google Keep vs Notion for private note-taking"
- Persian equivalents — **far less competition in fa.** The .ir domain is an asset
  here, not a liability. This is likely your single fastest ranking win.

### Tier 3 — the long game
- **Brand search volume** is a ranking signal. Get people searching "npad" by name
  (social, word of mouth, the directories above). Consistency of the name "NPad"
  everywhere helps entity recognition.
- Earn a few **editorial links** from productivity/writing blogs. Guest posts,
  "tools I use" roundups, teacher/student resource lists (your math-notepad page is
  perfect bait for education sites).

---

## Keyword map (what each page should own)

| URL | Primary intent | Notes |
|---|---|---|
| `/` | brand + "online notepad" (generic) | hardest term; rank via authority, not copy |
| `/online-notepad` | "online notepad", "notepad online no login" | |
| `/text-editor` | "online text editor", "text editor online free" | new |
| `/rich-text-editor` | "rich text editor online", "wysiwyg editor" | new |
| `/word-counter` | "word counter", "character count online" | new; huge search volume, utility intent |
| `/markdown-editor` | "online markdown editor", "markdown to word" | strong niche fit |
| `/math-notepad` | "write math equations online", "latex to word" | education backlink bait |
| `/checklist-app` | "online checklist", "to-do list no signup" | |
| `/fa/*` | Persian equivalents | **lowest competition — prioritise** |

---

## What NOT to waste time on
- ❌ More meta-tag micro-tweaks. Diminishing returns; you're already clean.
- ❌ Keyword-stuffing the copy. Google is past that; it hurts.
- ❌ Buying backlinks / link farms — manual-action risk, can tank you.
- ❌ Fabricated review stars in schema — the previous build did this and it violates
  Google policy. It's correctly gone. Do not add `aggregateRating` unless you have
  a real review system.
- ❌ Chasing generic English "online notepad" as your #1 goal short-term. Win fa/ and
  the utility long-tails (`word counter`, `markdown editor`) first — they convert to
  the authority you need to eventually compete on the head term.
