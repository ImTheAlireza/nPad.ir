# NPad — Feature Roadmap Ideas

Tailored to nPad.ir's existing architecture: PHP front-end, local-only storage
(IndexedDB/localStorage), offline PWA, bilingual FA/EN, self-hosted fonts, no
third-party requests, and a strict CSP. Effort: **S** = small (days), **M** =
medium (1–2 weeks), **L** = large (a month+).

> **Implemented 2026-08:** items 2 (Tables), 4 (Code blocks with syntax
> highlighting), 5 (Math typesetting), 6 (Collapsible sections & outline
> navigator), 7 (Checklists & task aggregation) and 8 (Per-note RTL/LTR
> control) are shipped.
>
> **Reset 2026-08:** the previous image/attachment implementation was removed
> deliberately. It had accumulated a large object model and competing editing
> interactions before a clear, accessible content-block design was agreed.
> Research findings and the replacement proposal live in
> [IMAGE_EDITOR_REDESIGN_PLAN.md](IMAGE_EDITOR_REDESIGN_PLAN.md).

---

## Part 1 — 20 New Features & Tools (non-AI)

### Editor & content
1. **Markdown / WYSIWYG dual mode** — toggle the same note between rich text
   and live-rendered Markdown, with conversions both ways. Draws on the
   existing Markdown codec. *(M)*
2. **Tables** — insert/edit/resize tables with toolbar controls (native
   `contenteditable` support is thin; a small table editor panel is enough;
   must survive DOCX/HTML export). *(M)*
3. **Image blocks (planned)** — intentionally not shipped while the
   researched, accessibility-first redesign in
   [IMAGE_EDITOR_REDESIGN_PLAN.md](IMAGE_EDITOR_REDESIGN_PLAN.md) is reviewed. *(L)*
4. **Code blocks with syntax highlighting** — self-hosted Prism (no CDN),
   monospace font, copy button; essential for the developer audience and it
   pairs with Markdown mode. *(M)*
5. **Math typesetting** — inline/block LaTeX rendered by self-hosted KaTeX;
   stores the LaTeX source in the note so export/import round-trips. *(M)*
6. **Collapsible sections & outline navigator** — `<details>`-style blocks plus
   a heading tree panel to jump within long notes. *(S)*
7. **Checklists & task aggregation** — real checkbox items with checked state
   that persist, plus a "Today" view collecting checked/unchecked tasks across
   notes. *(M)*
8. **Per-note RTL/LTR control** — a per-note `dir` override and a bidi-text
   helper (unicode isolates) for mixed Persian/English content. The app's core
   audience is bilingual — this is a differentiator. *(S)*

### Organization & productivity
9. **Wiki-style note links** — `[[note title]]` autocompletes to a link,
   generates internal cross-references and a backlinks panel; the PWA's "no
   account" model means this is purely local metadata. *(M)*
10. **Trash / recycle bin** — soft-delete with 30-day retention before the
    backup snapshot is freed; complements the existing "snapshot before
    delete" behaviour. *(S)*
11. **Version-history UI with diff** — a side-by-side diff viewer for the
    timestamped backups (instead of always restoring as a new note), with
    "restore this version" and "compare" actions. *(M)*
12. **Note templates** — journal, meeting notes, study notes, idea capture;
    `{{date}}` and `{{time}}` placeholders expanded on creation. *(S)*
13. **Command palette (Ctrl/Cmd+K)** — fuzzy action search: jump to note,
    create, pin, tag, export, toggle theme. Built on the existing tab/session
    model. *(M)*
14. **Cross-window live sync** — `BroadcastChannel` so two browser windows (or
    a desktop PWA window and a tab) update each other's open notes in real
    time without a server. *(S)*
15. **Optional self-hosted sync / WebDAV** — encrypted-at-rest sync to a URL
    the user provides (WebDAV-friendly), with a key never leaving the device;
    keeps the "no account" promise while enabling multi-device use. *(L)*
16. **Trash-free "session timeline"** — a day/week calendar strip showing when
    each note was edited, with click-to-jump; a lightweight local activity
    view. *(S)*

### Input, export & tools
17. **Web Share Target & File System Access** — register the PWA as a share
    target (send text and supported documents from other apps straight into a note) and expose
    "Save as… / Open from disk" via the File System Access API where
    supported. *(M)*
18. **Import from other notepads** — Google Keep JSON, Apple Notes, Evernote
    `.enex`, and plain `.txt`-folders, each mapped to notes/folders/tags via a
    friendly wizard. *(M)*
19. **Live status bar** — word/character count, reading time, selection stats,
    and "saved" indicator updated on every keystroke (fixes the historical
    frozen-count issue) instead of on the 3-second debounce. *(S)*
20. **Print/PDF builder** — print header/footer with note title/date/page
    numbers, optional "print only selection", and a print stylesheet that
    removes UI chrome (extends the browser-print PDF path). *(S)*

**Bonus tools (if you want more):** custom export templates (CSS themes for
HTML/DOCX), note-linking QR codes for quick phone-to-desktop handoff,
built-in Pomodoro timer, per-note font size/line-height, and a "local-only"
readability/word-difficulty checker.

---

## Part 2 — 20 New AI Features

> **Status 2026-08:** the AI pipeline shipped behind the user's own
> OpenAI-compatible provider (same-origin PHP proxy, per-user keys in
> localStorage, explicit consent). Shipped from this list: #3 (tone rewrite),
> #4 (smart titles), #5 (summarize — note & selection), #6 (translate),
> #7 (extract to-dos), #8 (smart formatting). All non-option actions now
> apply directly and are reversible via the AI undo/redo history. The next
> wave of ideas, built on that pipeline, lives in **Part 2b** below.

The remaining original ideas follow one rule: **local-first**. NPad's brand
is privacy, so the ideal default is on-device models (Transformers.js, WebLLM,
Web Speech API) downloaded on demand and cached; note content only leaves the
device if the user explicitly enables an opt-in cloud provider. Effort
assumes a local-model path unless marked "cloud" (which is much simpler to
ship — and how the shipped items above were built).

### Writing help
1. **AI proofreader** — in-place grammar/style suggestions (red squiggle →
   fixed text) for Persian and English; small local model, accept/reject per
   suggestion. *(L)*
2. **Continue writing (autocomplete)** — a ghost-text completion behind the
   caret, dismissed with Esc; local causal model. *(L)*
3. **Tone & style rewrite** — "make it formal / casual / friendly / concise /
   more persuasive" for the selection, in FA or EN. *(M)*
4. **Smart titles** — auto-generate a title from the first lines when the note
   is untitled, with 3 suggestions. *(S)*
5. **Summarize note** — produce a bullet summary + key points + "action
   items", saved as a separate note. *(M)*
6. **Translate selection ↔ Persian/English** — local translation model with
   all-languages-to-FA/EN pairs supported offline; offer cloud as opt-in. *(L)*
7. **Extract to-dos** — scan the note, convert prose obligations ("باید…",
   "remember to…") into checklist items with optional due dates. *(M)*
8. **Smart formatting** — "clean up this mess": convert pasted wall-of-text
   into headings, lists, bullet points, and simple tables. *(M)*

### Search & organization
9. **Semantic search** — search by meaning, not just words ("car prices" finds
   "قیمت خودرو"), using local embeddings (MiniLM-family via Transformers.js);
   keeps everything on device. *(L)*
10. **Smart tags & folder suggestions** — embeddings propose folders, tags,
    and colour coding when you save or open a note; one-tap accept. *(M)*
11. **Chat with your notes (local RAG)** — a sidebar Q&A over your
    collection: "what did I write about the server migration?" with quoted
    sources; fully offline with embeddings + local LLM. *(L)*
12. **Duplicate & related-note detection** — flag near-duplicates and suggest
    merges (with a diff preview before merging), plus "related notes" in the
    sidebar. *(M)*
13. **Natural-language filters** — "notes from last week about work", "my
    untagged notes" parsed into search filters instead of manual dropdowns. *(S)*

### Voice & reading
14. **Dictation** — speak → typed note using on-device speech recognition;
    pair with the existing spellchecker for FA/EN transcription. *(M)*
15. **Text-to-speech narration** — listen to a note (or selection) read aloud
    with local voices; great for proofreading. *(S)*
16. **OCR for scans & photos** — import a photo/scan of Persian or English
    text and extract it into a note (local OCR, e.g. Tesseract/TrOCR). *(M)*
17. **Smart paste from web** — paste a URL or copied article; the AI extracts
    the main content, strips ads/nav, keeps headings, and attaches the source
    link. *(M)*
18. **Writing insights** — clarity score, reading level, repeated/filler-word
    detection, average sentence length; a weekly "your writing" summary. *(S)*

### Learning & assistants
19. **Flashcards & quizzes from notes** — generate Q&A cards from study notes,
    spaced-repetition review (local scheduler), for the student audience. *(M)*
20. **Meeting minutes assistant** — record audio (or paste a transcript) to get
    timestamped highlights, decisions, and an action-item list. *(L)*

---

## Part 2b — Next wave, built on the shipped AI pipeline

The current pipeline gives us for free: a hardened proxy, reasoning-model
handling, direct-apply + undo/redo, the selection toolbar, Markdown→HTML
conversion, the sanitizer, and diagnosable errors. Every idea below is
scoped to what reuses that. Effort: **S** = days, **M** = 1–2 weeks,
**L** = a month+.

### Quick wins (S) — highest value per line of code
1. **Proofread & punctuation (فارسی‌محور)** — fix grammar, spacing and
   punctuation for the selection; the Persian half-fix (نیم‌فاصله) and
   «، ؛» spacing is a market differentiator. Direct apply + undo. *(S)*
2. **Bullet → prose & prose → bullets** — structural rewrites of the
   selection; same pipeline as tone rewrite. *(S)*
3. **Pros/cons & SWOT generator** — turn rough notes into a structured
   مزایا/معایب or SWOT table (real `<table>`). *(S)*
4. **Explain this formula** — selected `<math-block>` LaTeX → plain-language
   explanation inserted below it. *(S)*
5. **Prioritize my checklist** — reorder/label checklist tasks by priority
   and natural-language dates («پنجشنبه» → real date). *(S)*
6. **TL;DR presets** — summarize at three sizes (one-liner / paragraph /
   detailed) via a small option modal (option-based, stays modal). *(S)*
7. **Custom user prompts** — the user saves their own prompt templates
   ("دستورهای من"); they appear in the AI menu and run against the note or
   selection with direct apply. Turns every niche use case into a feature. *(S–M)*

### Writing & organization (M)
8. **Continue writing** — caret ghost-text or a "continue" action that
   drafts the next paragraph from the note's context. *(M)*
9. **Meeting minutes (text in → structured out)** — rough transcript/notes →
   decisions / action items / owners / questions. *(M)*
10. **Email & message drafts** — notes → a ready-to-send email with the tone
    picker. *(M)*
11. **Auto folder & tag suggestion** — one call that classifies the note
    into the user's existing folders/tags; accept via the toast, one tap. *(M)*
12. **Goal → subtask breakdown** — pick a checklist item, generate its
    sub-checklist. *(M)*
13. **FAQ / glossary / definitions** — extract terms and build a mini-glossary
    section. *(M)*

### Study & knowledge (M)
14. **Flashcards & quizzes** — generate Q&A pairs from a note, review UI with
    a simple scheduler, export CSV/Anki — aimed at the student audience. *(M)*
15. **Ask this note** — sidebar Q&A scoped to the current note only
    (one call per question; no multi-note index needed). *(M)*
16. **Step-by-step math solver** — inside `<math-block>`, solver-style models
    produce worked solutions (provider-dependent). *(M)*

### Tables & code (M)
17. **Text → table** — ✅ **Shipped 2026-08** (AI menu → "Convert to Table"):
    select a statistical/tabular passage and it becomes a real table.
    Double-gated rejection: non-tabular prose is refused client-side before
    any tokens are spent, and non-table / NOT_TABLE model replies are
    refused after — with one clear message either way. Persian digits and
    units are handled; the parsed table is rebuilt locally (never trusting
    model HTML) and applies directly with undo/redo.
18. **Table → analysis** — summarize/trend-find the selected table. *(S)*
19. **Code block helpers** — explain / comment / fix / convert / write tests
    for the selected code block via the selection toolbar. *(M)*

### Document-level (M–L)
20. **Changelog from backups** — diff note backups with AI-summarized
    change descriptions. *(M)*
21. **Smart templates** — generate starting structures (meeting agenda,
    weekly plan, contract outline) into a new note. *(M)*
22. **Streaming responses** — stream the proxy reply so long generations
    render progressively instead of waiting (server events through the PHP
    proxy need `flush()` care on shared hosts). *(L)*

### Bigger bets (L)
23. **Multi-note Q&A (local RAG)** — the original #11, needs on-device
    embeddings; keep it opt-in and local. *(L)*
24. **Dictation & TTS** — original #14/#15 via Web Speech API (on-device,
    no provider needed). *(M–L)*
25. **OCR / smart paste from web** — original #16/#17; image input would
    also require multimodal model support in the proxy. *(L)*

---


- **Model manager panel**: list downloaded local models, sizes, disk usage,
  one-tap delete; models live in Cache Storage / OPFS and are never bundled in
  the 96 KB app payload.
- **Hard opt-in for cloud**: any cloud AI feature is off by default, uses a
  per-feature toggle, and states what is sent (a note snippet vs. a full note)
  in plain language in the FA/EN UI.
- **Strict no-send default**: semantic search, proofreading, and summaries are
  local; the CSP `connect-src 'self'` stays intact unless the user enables a
  provider.
- **Model download UX**: show download progress, minimum device hints (RAM),
  and graceful fallback to non-AI tools on low-end phones.
- **Localization first**: verify models handle Persian + RTL before English-only
  ones; Persian quality is a differentiator for this market.

## Suggested order

1. **S items first** (checklists, status bar, RTL control, trash, templates,
   command palette, TTS) — quick wins that compound with existing features.
2. **M items** (tables, code blocks, maths, note links, version diff, dictation,
   OCR, smart titles/filters) — the visible jump in usefulness.
3. **L items** (Markdown dual mode, image blocks, self-hosted sync, local
   semantic search, chat-with-notes) — the ambitious, differentiating tier.
