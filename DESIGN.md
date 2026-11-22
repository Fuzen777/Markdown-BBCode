# BBCode Editor Design

## Purpose

A portable Windows visual Markdown editor for Nexus mod descriptions. New documents use .mdbbcode: Markdown plus YAML metadata. The document source is authoritative; a same-stem `.bbcode` companion is generated alongside it. Steam support is deferred.

## Editing

Tauri hosts Tiptap with locally bundled assets. Tabs offer Visual and Markdown Source views. Copy BBCode converts the active document. Spoilers use `||text||`, or standalone delimiter lines around multiple paragraphs. Centered blocks use `<div style="text-align: center">`; colors use `<span style="color: #rrggbb">`. Toolbar controls manage these extensions. Spoilers remain expanded while editing.

Supported Markdown covers headings, emphasis, strikethrough, lists, quotes, code, links and web images. Unsupported Markdown remains source-editable and saved, but blocks visual conversion and BBCode export. No silent dropping of unknown HTML. Merely opening or switching tabs must not rewrite source files. Actual visual edits may normalize syntax.

## Document Metadata

A YAML header uses format: mdbbcode, version: 1 and target: nexus. In Visual view, a compact Document Properties panel edits Target through a dropdown. Steam is disabled until implemented. Format and version are managed by the app. Source displays the complete file. Preserve unknown fields/comments; exclude the header from BBCode. Invalid metadata stays saved but blocks output and remains source-editable. Unsupported target values remain visible and can be changed to Nexus.

New files and imports default to .mdbbcode. Existing .md/.markdown files still open without automatic rewriting; Save As offers conversion. The generated companion keeps the same basename. File association remains manual and applies to .mdbbcode independently of ordinary Markdown.

## Files And Recovery

Save Markdown first, then generate BBCode. Conversion or output failures must never prevent saving valid source text. Show output failure separately as BBCode Out Of Date. Existing and externally modified outputs require reviewed replacement with a revision check. Source conflicts retain the existing explicit resolution workflow. Source failures block close; output-only failures permit explicit close after warning.

New documents are recoverable drafts until named. Save As creates a separate pair. Autosave runs after 750 ms; session recovery after 250 ms. Atomic replacement and SHA-256 revision checks protect local files. Settings and recovery live beside the executable in portable-data.

## Import And Migration

BBCode import is one-time conversion, with unsupported formatting reported before acceptance. Save imported drafts to a different basename, keeping the original BBCode intact. Do not synchronize edits back from BBCode.

Legacy session documents remain pending BBCode imports until explicitly accepted. Save a version-1 session backup before writing the new session format. New portable releases use separate versioned folders.

## Interface

Use system light/dark appearance, compact file controls, tabs, formatting toolbar, Visual/Source switch and separate Markdown/output status. Highlight active formatting at the cursor or across the whole selection. The paragraph dropdown reflects headings 1–6, Paragraph, Mixed or Other Block. Recompute indicators on selection, edits and undo; source mode has no inferred formatting state. Keep standard file shortcuts and single-instance opening. Windows file association remains manual.
