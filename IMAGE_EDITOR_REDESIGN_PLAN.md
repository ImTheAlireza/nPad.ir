# Image editor restart plan

**Status:** proposed only — no image insertion, storage, rendering, editing, or
export support is currently shipped.

**Research completed:** 26 August 2026

## 1. Decision from the start

The previous feature tried to solve five different problems in one interaction:
file ingestion, binary storage, document layout, photo adjustment, and Word/DOCX
conversion. That made a simple action — “put this picture in my note and make it
smaller” — depend on a large object model, several toolbars, pointer overlays,
and layout modes that were difficult to explain or operate without a mouse.

The reset deliberately removes that implementation first. The replacement should
be designed as a **semantic image block in a document**, not as a free-floating
canvas object:

1. An **asset** is the locally stored source file.
2. An **image block** is a small, validated document node that refers to one
   asset and records only author-facing choices such as description, caption,
   layout, width, and crop.
3. The renderer turns that node into stable semantic HTML.
4. The editor provides a small contextual control surface for the selected block.
5. Exporters translate the same block data independently; they do not infer
   state from arbitrary CSS or browser-only DOM.

This separation is the central logic of the new plan. It keeps storage, editing,
accessibility, and export concerns independently testable.

## 2. What was removed in this reset

The current change removes the old feature end-to-end:

- Insert-menu command, paste/drop file ingestion, image toolbar, right-click
  menu, property dialog, resize overlay, drag/move interactions, crop/filter
  logic, and analytics events.
- Attachment module, attachment tests, IndexedDB image store APIs, fallback
  payload APIs, and export-time data-URI/DOCX-media conversion.
- Image-specific sanitizer rules, markup, CSS, icons, translations,
  documentation, and service-worker precache entry.

The local database is upgraded to version 6. During that upgrade the retired
`images` object store is deleted, and old `npad:img:` local-storage payloads are
purged. Existing saved note HTML is normalised through the allow-list on load;
retired media markup is removed while ordinary text inside a former caption is
kept. This is intentionally destructive for the retired media payloads.

Application artwork is **not** part of the removed feature: favicon, manifest
icons, inline UI SVG icons, and the decorative spelling underline remain.

## 3. What established editors do — and what we should borrow

| Evidence | Useful pattern | NPad decision |
|---|---|---|
| [WordPress Image block](https://wordpress.org/documentation/article/image-block/) | Selecting a block exposes resize handles and a block-specific toolbar. Crop is an explicit mode with zoom, aspect ratio, rotate, and Apply. Width normally keeps height automatic. | Use selection plus a compact local toolbar; make crop a distinct Apply/Cancel workflow, never a collection of always-live sliders. |
| [CKEditor 5 image overview](https://ckeditor.com/docs/ckeditor5/latest/features/images/images-overview.html) | A configurable contextual image toolbar contains only relevant actions such as caption, alternative text, style, and edit. | Keep the global text toolbar stable; show block actions near the selected block rather than replacing the whole toolbar. |
| [TinyMCE Image plugin](https://www.tiny.cloud/docs/tinymce/latest/image/) | Image properties include description, dimensions, proportional resizing, captions, and a decorative-image choice. | Make alternative text/decorative status prominent, use a locked aspect ratio by default, and make captions optional. |
| [TinyMCE mobile guidance](https://www.tiny.cloud/docs/tinymce/latest/tinymce-for-mobile/) | In-editor resizing is not supported on touch devices; the dialog is the reliable fallback. | Never make tiny drag handles the only way to resize. Mobile uses clear size presets and a form field. |
| [Shopify rich-text editor help](https://help.shopify.com/en/manual/shopify-admin/productivity-tools/rich-text-editor) | Click to select; corner drag to resize; a dialog covers size, wrapping, alignment, spacing, and alt text. | Support the familiar click/select/corner-resize model, but start with fewer layouts and a keyboard-equivalent inspector. |
| [W3C alt-text decision tree](https://www.w3.org/WAI/tutorials/images/decision-tree/) | Informative, functional, complex, redundant, and decorative images need different text alternatives. | The UI must offer both editable alt text and an explicit “decorative” choice; captions do not substitute for alt text. |
| [WAI-ARIA Toolbar Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/) | A toolbar should have one tab stop and arrow-key navigation between controls. | Do not dynamically replace a focused toolbar’s controls. The block toolbar follows the pattern as its own stable, labelled toolbar. |
| [MDN `<img>` reference](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/img) | `alt` is the textual replacement; width and height reserve space and prevent layout shifts. | Store intrinsic dimensions and render width/height attributes where possible; do not manufacture filename-based alt text. |

A particularly important caution is the historical
[WordPress/Gutenberg keyboard regression](https://github.com/WordPress/gutenberg/issues/24766):
replacing toolbar controls while a user is navigating them can lose focus and
break roving-tabindex behaviour. The new design therefore never swaps NPad’s
main text toolbar for media controls.

## 4. Proposed author experience

### 4.1 At rest

An inserted item is a document block, visually like this:

```text
┌────────────────────────────────────────────────────┐
│                  [ rendered asset ]                │
│              Optional visible caption               │
└────────────────────────────────────────────────────┘
```

It participates in normal document flow. There is no “behind text”, “in front
of text”, fixed-page placement, or free pointer movement in the first release.
Those modes make a scrolling, responsive `contenteditable` note unpredictable,
especially on mobile and in RTL text.

### 4.2 Insert

All entry points — **Insert → Image**, paste of an allowed local file, and
drag-drop of an allowed local file — must call one `insertImage()` use case:

1. Validate the local file once.
2. Decode enough metadata to show a preview and read intrinsic dimensions.
3. Store the asset locally.
4. Insert a new semantic block at the saved document selection.
5. Select the inserted block and open the small **Describe image** panel.

The panel contains, in this order:

- **Alternative text** field, with context help;
- **This image is decorative** checkbox, which clears/disables the field;
- optional **Caption** field;
- **Insert** / **Cancel** controls.

Do not silently use the filename as alternative text. The author may defer a
description, but the block should visibly retain an “alt text needed” state until
they enter text or mark it decorative.

### 4.3 Selection and contextual toolbar

A single click selects the block and draws a high-contrast outline. A compact
anchored toolbar appears above or below it without moving focus by itself:

```text
[ Replace ] [ Layout ▾ ] [ Size ▾ ] [ Crop ] [ Alt text ] [ More ▾ ] [ Delete ]
```

Initial controls:

| Control | Initial behavior |
|---|---|
| Replace | Opens the same validated local-file flow and preserves the block’s accessible metadata until edited. |
| Layout | `Block`, `Align start`, `Align center`, `Align end`; text wrap is a later, separately tested option. |
| Size | 25%, 50%, 75%, 100%, and “Custom width…”. Height stays automatic. |
| Crop | Opens a dedicated crop session; disabled until crop ships. |
| Alt text | Opens the inspector with the alt-text field focused. |
| More | Caption toggle and link destination in a future, deliberately small menu. |
| Delete | Removes only the selected block and returns focus to a predictable nearby text position. |

The toolbar has `role="toolbar"`, an accessible label, visible focus, one Tab
stop, and Left/Right arrow navigation. **Escape** dismisses the selection and
returns focus to the block or editor. **Delete/Backspace** removes a selected
block only after the selection state is explicit, not while an author is simply
typing next to it.

### 4.4 Resize

Desktop can expose four visible corner handles after selection. Dragging a
corner maintains aspect ratio and gives live width feedback. A resize is only
committed on pointer release, is one undo step, and honours the container width.

The equivalent keyboard path is always available:

- `Size` presets;
- `Custom width…` numeric field with a labelled unit and bounds;
- `Reset size`.

On touch/coarse-pointer devices, default to size presets and Custom width. Show
handles only when they are large enough to meet the touch-target requirement;
do not rely on pinch or drag as the sole interaction.

### 4.5 Crop and rotate

Cropping is an editing mode, not a property panel full of percentage sliders:

```text
┌ Crop image ─────────────────────────────────────────┐
│ [canvas with visible crop frame and aspect guides]   │
│ [Original] [1:1] [4:3] [16:9]  [Rotate left/right]  │
│                                      [Cancel] [Apply]│
└─────────────────────────────────────────────────────┘
```

It operates non-destructively against the source asset. Crop has an explicit
preview, **Cancel** restores the prior block state, **Apply** creates one undo
entry, and the inspector provides keyboard-accessible aspect-ratio and crop
values. The crop screen must not ship until its complete keyboard and screen
reader path is tested.

### 4.6 Inspector

The inspector is a regular labelled dialog or side sheet, never an icon-only
modal. It owns the full, discoverable form:

1. Accessibility: alternative text or decorative choice.
2. Caption and optional link destination.
3. Layout and width.
4. Crop summary/reset after crop exists.
5. Metadata such as source filename and intrinsic dimensions (read-only).

Caption remains visible prose. Alternative text remains nonvisual metadata. A
complex chart or diagram needs adjacent explanatory content, per the W3C
decision tree; a short alt field is not enough.

## 5. Data model and rendering boundary

The future implementation should create a typed document record rather than
persist arbitrary style strings. A possible version-one shape is:

```js
{
  version: 1,
  id: 'block-…',
  assetId: 'asset-…',
  alt: { kind: 'informative', text: '...' }, // or { kind: 'decorative', text: '' }
  caption: '',
  display: { layout: 'block', widthPercent: 50 },
  crop: null // later: { x, y, width, height, rotation }
}
```

Rules:

- The document record contains no Blob, object URL, raw CSS, remote URL, or
  unvalidated JSON from a clipboard.
- Asset records contain the original Blob, MIME type verified from content,
  byte length, intrinsic width/height, and creation time.
- Object URLs exist only while the editor is rendering and are revoked on block
  removal, note switch, and unload.
- A renderer creates semantic `<figure>`, `<img>`, and optional `<figcaption>`
  only from validated data. Styling uses narrow classes/data attributes owned by
  the renderer, not author-supplied CSS.
- Every change goes through editor transactions so undo/redo, autosave,
  selection restoration, and export see the same state.

## 6. Security, privacy, and performance constraints

- Local files only for the first release. Do not fetch third-party URLs.
- Allow a small, explicit raster-format list; verify file signatures and decode
  bounds instead of trusting MIME type alone. Keep SVG out until it has a
  dedicated safe pipeline.
- Set both a byte limit and a decoded-pixel limit to resist decompression bombs.
- Fix EXIF orientation on ingest; do not retain or expose unnecessary EXIF data.
- Store original assets locally in IndexedDB; never place base64 payloads in
  note HTML or regular localStorage.
- Generate responsive display sizes from the asset/renderer when appropriate.
  Preserve width and height attributes to reduce layout shift.
- Use a strict schema validator at every boundary: ingest, paste, restore,
  import, export, and renderer.
- Keep all transforms non-destructive until an author explicitly exports a
  flattened result.

## 7. Delivery sequence and exit criteria

### Phase 0 — reset and foundations (this change)

- [x] Remove the old implementation, binary store, old exports, UI, strings,
  tests, analytics, and cached module.
- [x] Remove legacy payload storage on database upgrade.
- [x] Strip retired markup through the sanitizer.
- [x] Preserve platform/app icons because they are not editor content.

**Exit:** the application has no media-editing entry point or active attachment
API, and ordinary text/table behavior remains intact.

### Phase 1 — insert a safe semantic block

- One asset repository with deterministic validation and cleanup.
- One document-node schema and renderer.
- Insert from a local picker; then reuse the same command for paste/drop.
- Describe-image dialog with alternative text/decorative/caption choices.
- Block selection, replacement, deletion, undo/redo, and local persistence.

**Exit:** an author can insert, describe, replace, delete, reload, and export a
single block without losing focus, creating a remote request, or storing binary
data in note HTML.

### Phase 2 — layout and resizing

- Block/start/center/end layouts; no absolute placement.
- Width presets, custom width, corner handles on fine pointers, and complete
  keyboard/touch alternatives.
- RTL, zoom (200%), narrow viewport, dark theme, and print tests.

**Exit:** each pointer action has a keyboard path, values survive reload and
exports, and content never overflows its editor container.

### Phase 3 — crop/rotate

- Dedicated crop session with Apply/Cancel, ratio presets, keyboard controls,
  undo, and non-destructive model data.
- Export adapters consume the crop state deliberately or state a documented
  fallback for each format.

**Exit:** no partial crop state is saved after Cancel; screen-reader and
keyboard paths are manually tested.

### Phase 4 — only evidence-based additions

Consider wrapping text, linking a block, image optimization, filters, galleries,
or an advanced asset manager only after real user evidence. “Behind text”,
“in front of text”, page-fixed placement, free dragging, arbitrary CSS filters,
and a drawing canvas are explicitly out of scope until a separate design review.

## 8. Test plan

Automated tests must cover:

- allow-list sanitization and rejection of remote/unsafe markup;
- content-signature, byte, dimension, and pixel-limit validation;
- atomic asset/block creation and orphan cleanup;
- object-URL lifecycle;
- schema validation and migration;
- insert/replace/delete/undo/redo and selection restoration;
- alternative text, decorative state, caption, and complex-description guidance;
- keyboard navigation of the block toolbar and inspector;
- mouse, touch, RTL, 320 px viewport, 200% zoom, forced-colors, dark mode, and
  print behavior;
- HTML, Markdown, JSON, DOCX, RTF, and clipboard export/import fallbacks;
- no network request caused by pasted or restored document content.

Manual acceptance checks should include NVDA/Firefox or Chrome, VoiceOver/Safari,
and TalkBack where available. Automated accessibility checks can detect missing
labels; they cannot judge whether an alt description conveys the image’s purpose.

## 9. Decisions needed before implementation resumes

1. Which local raster formats, byte limit, and decoded-pixel limit are the
   product requirements?
2. Must imported/exported documents retain assets across every format, or may
   some formats deliberately emit an accessible text fallback?
3. Is text wrapping required for the first useful release, or can semantic block
   alignment ship first?
4. Does the product need a reusable asset library, or are assets owned by one
   note until duplication/backup copies them?
5. Does any crop implementation meet the keyboard and assistive-technology bar,
   or should it be deferred behind the Phase 2 release?

No new image code should be written until these choices are approved. That keeps
the second implementation small, coherent, and explainable from first principles.
