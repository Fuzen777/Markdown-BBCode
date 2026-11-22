# BBCode Editor Design

## Purpose

A portable Windows visual Markdown editor for Nexus mod descriptions. Markdown is the source of truth; a same-stem `.bbcode` companion is generated alongside it. Steam support is deferred.

## Editing

Tauri hosts Tiptap with locally bundled assets. Tabs offer Visual and Markdown Source views. Copy BBCode converts the active document. Spoilers use `||text||`, or standalone delimiter lines around multiple paragraphs. Centered blocks use `<div style="text-align: center">`; colors use `<span style="color: #rrggbb">`. Toolbar controls manage these extensions. Spoilers remain expanded while editing.

Supported Markdown covers headings, emphasis, strikethrough, lists, quotes, code, links and web images. Unsupported Markdown remains source-editable and saved, but blocks visual conversion and BBCode export. No silent dropping of unknown HTML. Merely opening or switching tabs must not rewrite source files. Actual visual edits may normalize syntax.

## Files And Recovery

Save Markdown first, then generate BBCode. Conversion or output failures must never prevent saving valid source text. Show output failure separately as BBCode Out Of Date. Existing and externally modified outputs require reviewed replacement with a revision check. Source conflicts retain the existing explicit resolution workflow. Source failures block close; output-only failures permit explicit close after warning.

New documents are recoverable drafts until named. Save As creates a separate pair. Autosave runs after 750 ms; session recovery after 250 ms. Atomic replacement and SHA-256 revision checks protect local files. Settings and recovery live beside the executable in portable-data.

## Import And Migration

BBCode import is one-time conversion, with unsupported formatting reported before acceptance. Save imported drafts to a different basename, keeping the original BBCode intact. Do not synchronize edits back from BBCode.

Legacy session documents remain pending BBCode imports until explicitly accepted. Save a version-1 session backup before writing the new session format. New portable releases use separate versioned folders.

## Interface

Use system light/dark appearance, compact file controls, tabs, formatting toolbar, Visual/Source switch and separate Markdown/output status. Keep standard file shortcuts and single-instance opening. Windows file association remains manual.
