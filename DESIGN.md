# Markdown-First Editor Design

## Purpose

A fast portable Windows Markdown editor with optional Nexus BBCode export. Ordinary .md files are the default; .markdown and existing .mdbbcode documents remain supported. Steam export is deferred. Keep the current application name and portable directory identity for compatibility.

## Documents And Saving

Autosave only the editable source after 750 ms and recovery after 250 ms. Opening, editing, saving and closing must never create, update, check or delete a BBCode companion. Existing companions remain untouched. Preserve source revision checks, atomic writes, recoverable drafts, tabs and single-instance opening.

New documents and one-time imports default to .md without mandatory metadata. Preserve ordinary YAML frontmatter without interpreting unrelated format/version/target keys as application settings. Existing explicit mdbbcode metadata remains readable; validate export target only on export. Unsupported source stays source-editable and saved.

## BBCode Export

Copy BBCode converts the current document on demand. Export BBCode chooses a destination and writes once, with explicit revision-checked replacement for an existing file. Never replace the editable source or an original BBCode import. Show conversion problems only when exporting. Ask before applying lossy fallbacks: callouts become titled quotes/spoilers; tasks become checklist text; tables become readable text. Do not silently omit content.

## Visual Blocks

Use the existing Tiptap document model. Support headings, text styles, lists, tasks, tables, quotes, code, links, images, spoilers, centered blocks, colors and Obsidian callouts. Provide block drag handles, an insertion menu triggered by /, and actions to change block type, duplicate and delete. Keep ordinary Markdown on disk.

Callouts use > [!type] Title, optional + or - for folding, and nested Markdown blocks. Preserve unknown callout identifiers with neutral styling. Opening or switching modes without editing preserves source. Unknown or unsafe markup remains source-editable rather than silently discarded.

## Hybrid Editing

Offer Visual, Hybrid and Source. Visual remains the default. In Hybrid, only the active top-level enclosing block exposes editable Markdown with syntax markers visually distinct from text; surrounding blocks remain rendered. Entering a nested list or callout exposes the whole enclosing block, as approved. Preserve raw source for untouched blocks, including spacing. Incomplete active Markdown remains editable and autosaved. Switching blocks reparses the edited block; unsupported blocks display their raw source. Source remains the full-document fallback, including frontmatter.

## Interface And Preferences

Keep light/dark appearance, standard file shortcuts, source-conflict handling and selection-aware formatting controls. Retain the split Color button, last-applied color and Hex/RGB/HSL preferences across launches. Property settings are optional and shown only for explicit legacy document metadata. No automatic system file associations or app renaming.

## Validation

Check source-only saving and migration, explicit export replacement and warnings, table/task/callout round trips, block actions and undo, Hybrid source fidelity and navigation, malformed source preservation, color selection/persistence and native startup/restart. Leave live Nexus publishing and Windows association changes to the user.
