# NPad — Feature Roadmap Ideas

Tailored to nPad.ir's existing architecture: PHP front-end, local-only storage
(IndexedDB/localStorage), offline PWA, bilingual FA/EN, self-hosted fonts, no
third-party requests, and a strict CSP. Effort: **S** = small (days), **M** =
medium (1–2 weeks), **L** = large (a month+).

> **Implemented 2026-08:** items 2 (Tables), 4 (Code blocks with syntax
> highlighting) and 5 (Math typesetting) are shipped.
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

All suggestions follow one rule: **local-first**. NPad's brand is privacy, so
the default path is on-device models (Transformers.js, WebLLM, Web Speech API)
downloaded on demand and cached; note content only leaves the device if the
user explicitly enables an opt-in cloud provider. Effort assumes a local-model
path unless marked "cloud" (which is much simpler to ship).

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

## Privacy guardrails for the AI work

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
