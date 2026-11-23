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

## Hybrid Spacing And Icons

Each actual top-level blank line is an independent editable block. A content block retains its terminating newline on disk without exposing that terminator as an extra editable row. Internal list, callout and code spacing stays inside the enclosing block. Gutter controls occupy no document height. Moving or deleting separators can intentionally change Markdown grouping; do not invent blank lines during moves.

Use locally bundled Google Material Symbols Rounded SVGs for file, formatting and block actions. Provide accessible names and hover/focus tooltips, including shortcuts where available. Retain text for modes, dropdowns, menus and confirmations. Include the Apache 2.0 license in portable releases.

Block-type and block-action entries in Turn Into, Block Actions, Insert and slash menus show matching icons alongside their text, including distinct Heading 1, 2 and 3 symbols.

## Editing Ergonomics, Preview And Search

Visual block gutter controls sit outside text padding without overlapping content, and Turn Into separates block conversions from block actions. Visual mode exposes contextual row/column table controls inside tables and inline callout type/folding selectors. Hybrid and Source support active formatting state, toggleable inline markers, formatting clear and formatting shortcuts. A toggleable live BBCode split preview pane, cross-mode Find and Replace, word/character counts and window file drag-and-drop complete the desktop workflow.

## Notion-Style Interactions, Tables And Resizable Synced Preview

The BBCode preview pane supports a draggable resize splitter (vertical on desktop, horizontal when stacked) and bidirectional block-anchored scroll sync. The toolbar Table button opens an `8 × 8` size grid with header-row selection; the contextual table bar reflects `Header Row` state, and Visual tables expose right/bottom `+` hover rails, row/column drag handles (click for menu, drag to reorder while keeping row `0` headers normalized) and edge-only right-click menus while keeping cell interiors native. Visual and Hybrid block handles use pointer-event drag-and-drop with vertical hit-testing locked onto hovered controls; Visual lists and containers support per-item handles following nesting, drag-to-nest list items and Callouts/containers, and Shift/Ctrl+Click plus left-gutter marquee multi-block selection with a floating batch bar. Visual editing adds an active-line `/` placeholder, expanded slash/Turn Into entries and aliases (including Divider, Toggle, Spoiler, Center and Image), smart URL paste on selection across all modes, a link hover/caret popover (with validated native external URL opening), an expanded selection bubble bar (`Turn Into`, swatches, `Choose Color…`, `Clear Color`), a code block language/copy bar, an image hover pill with a two-field URL/alt dialog, cross-mode shortcuts (`Ctrl+K`, `Ctrl+Shift+X`, `Ctrl+E`, `Ctrl+Alt+0`–`6`, `Alt+Up`/`Down`), and a right-side three-state Document Outline (`Off` / `Float` / `Dock`) with scroll-tracked headings across Visual, Hybrid and Source.
