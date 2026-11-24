# Markdown BBCode Design

## App Declarations

| Declaration | Choice |
| --- | --- |
| Signature color | Warm Amber (`#b45309` fill, `#ffffff` on-fill, `#f4b570` dark text, `#9a3412` light text) |
| Density | Compact |
| Icon set | Material Symbols Rounded |
| Touch support | No |
| Themes | Dark and Light (`prefers-color-scheme`) |
| Deviations | Retains OS-matched Light Mode with matching zero-chroma neutral roles; adds blue info callouts (`#60a5fa`) and subtle amber spoiler tints for document semantics |

## Color System

Dark Mode maps directly onto the workspace shared [DESIGN](../../DESIGN.md) zero-chroma neutral ladder (`--page: #111111`, `--surface: #171717`, `--control: #262626`, `--active-fill` / `--border: #404040`, `--accent` / `--text-secondary: #a1a1a1`, `--text: #f5f5f5`, `--muted: #737373`) alongside shared status tones (`#ff6467` error, `#ffb900` warning, `#05df72` success), Surface+Border tooltips, `60%` black modal backdrops, tabular counters, and `4 px` neutral scrollbars. Hover and toggled/active controls stay strictly neutral (`--control` / `--active-fill`); Warm Amber appears sparingly only on primary actions (`.primary`, `.update-pill`), `:focus-visible` rings, the `[M↓]` monogram, prose links, active folder open-file dots, update badges, and task checkbox accents.

## Purpose

A fast Windows Markdown editor with optional Nexus Mods and Steam guide BBCode export, built with Tauri 2 and Tiptap 3 in both Portable (`portable-data` beside `Markdown BBCode.exe`) and Installed (`%APPDATA%\Markdown BBCode`) modes. Ordinary .md files are the default; .markdown and existing .mdbbcode documents remain supported.

## Documents And Saving

Autosave only the editable source after 750 ms and recovery after 250 ms. Opening, editing, saving and closing must never create, update, check or delete a BBCode companion. Existing companions remain untouched. Preserve source revision checks, atomic writes, recoverable drafts, tabs and single-instance opening.

New documents and one-time imports default to .md without mandatory metadata. Preserve ordinary YAML frontmatter without interpreting unrelated format/version/target keys as application settings. Existing explicit mdbbcode metadata remains readable; validate export target only on export. Unsupported source stays source-editable and saved.

## BBCode Export

Copy BBCode converts the current document on demand using the header `Nexus | Steam` dialect switcher (persisted globally as `bbcodeTarget` in `session.json`, or overridden by explicit legacy `.mdbbcode` `target:` YAML). Export BBCode chooses a `.bbcode` or `.txt` destination and writes once, with explicit revision-checked replacement for an existing file. Never replace the editable source or an original BBCode import. In Nexus mode, keep standard blank lines (`\n\n`) between regular paragraphs and between titles/headings and paragraphs, while collapsing separations adjacent to lists (`\n`) so lists sit tight against surrounding headings and paragraphs, preserving any extra intentional blank lines and keeping scroll-sync offsets aligned; callouts become titled quotes/spoilers, tasks become checklist text, and tables become readable text. In Steam mode (modeled on `Steam Markdown`), emit Steam guide BBCode (`[h1]`–`[h3]` with no trailing blank line and `h4`–`h6` downgrade warnings, `[b]`/`[i]`/`[strike]`/`[spoiler]`, `[code]...[/code]` glued directly to following text/blocks, bare YouTube/Steam store/Workshop URLs for standalone embeds, flattened lists with `› ` prefixes inside `[list]`/`[olist]`, `[quote]`, native `[table][tr][th]/[td]`, `[hr][/hr]`, `[noparse][[/noparse]` escaping, and warnings for unsupported color/center/callout/task/math/footnote/start-number constructs). Show conversion problems only when exporting and ask before applying lossy fallbacks without silently omitting content.

## Visual Blocks

Use the existing Tiptap document model. Support headings, text styles, lists, tasks, tables, quotes, code, links, images, spoilers, centered blocks, colors and Obsidian callouts. Provide block drag handles, an insertion menu triggered by /, and actions to change block type, duplicate and delete. Keep ordinary Markdown on disk.

Callouts use > [!type] Title, optional + or - for folding, and nested Markdown blocks. Preserve unknown callout identifiers with neutral styling. Opening or switching modes without editing preserves source. Unknown or unsafe markup remains source-editable rather than silently discarded.

## Hybrid Editing

Offer Visual, Hybrid and Source. Visual remains the default. In Hybrid, only the active top-level enclosing block mounts a CodeMirror 6 editor with Obsidian-style line/item-level Live Preview, while surrounding blocks stay rendered and untouched sibling DOM nodes are preserved incrementally across non-splitting edits. Inside the active block, cursor-touched lines reveal distinct raw syntax markers while inactive sibling lines render headings, bullets, interactive task checkboxes, callout badges/colors, dividers and inline formatting live without altering raw source on disk. Clicking a preview maps onto the nearest raw cursor offset; vertical arrow navigation crosses soft-wrapped visual lines, multi-line widget lines and adjacent block boundaries while preserving column; Backspace/Delete at block edges removes adjacent top-level blank-line separators; preview and Live Preview task checkboxes toggle directly; links expose hover popovers and `Ctrl+Click` opening; Enter continues or clears lists, tasks, quotes and callouts while Tab/Shift+Tab indent list lines; `/` triggers a live-filtering slash menu with aliases and Image insertion on any empty or command line; Block Actions provide a `Turn Into` submenu; multi-selected blocks support `Wrap In` and `Delete`/`Backspace` removal; and non-empty text selections open the shared floating bubble bar. Both Visual and Hybrid center gutter drag handles and `+` controls vertically on short horizontal rules (`---`) while locking hover across the approach band. Incomplete active Markdown remains editable and autosaved; Source remains the full-document fallback, including frontmatter.

## Interface And Preferences

Keep light/dark appearance, standard file shortcuts, middle-mouse-button tab closing (`auxclick` release to allow drag-away cancellation), source-conflict handling and selection-aware formatting controls. Retain the split Color button, last-applied color and Hex/RGB/HSL preferences across launches, plus the global header `Nexus | Steam` BBCode dialect switch, the global document-bar `Width [Page | Full]` segmented toggle (`800px` centered column across Visual, Hybrid and Source by default, or full editor width) and window size/position persistence via `tauri-plugin-window-state` (`window-state.json`) with startup off-screen and taskbar rescue. Property settings are optional and shown only for explicit legacy document metadata. No automatic system file associations.

## Validation

Check source-only saving and migration, explicit export replacement and warnings, Nexus and Steam BBCode export/import parity (including paragraph/heading blank lines vs tight list spacing and Steam tag/embed/table/glue rules), table/task/callout round trips, block actions and undo, Hybrid source fidelity and navigation, malformed source preservation, color selection/persistence and native startup/restart. Leave live Nexus/Steam publishing and Windows association changes to the user.

## Hybrid Spacing And Icons

Each actual top-level blank line is an independent editable block. A content block retains its terminating newline on disk without exposing that terminator as an extra editable row. Internal list, callout and code spacing stays inside the enclosing block. Gutter controls occupy no document height. Moving or deleting separators can intentionally change Markdown grouping; do not invent blank lines during moves.

Use locally bundled Google Material Symbols Rounded SVGs for file, formatting and block actions. Provide accessible names and hover/focus tooltips, including shortcuts where available. Retain text for modes, dropdowns, menus and confirmations. Include the Apache 2.0 license in portable releases.

Block-type and block-action entries in Turn Into, Block Actions, Insert and slash menus show matching icons alongside their text, including distinct Heading 1, 2 and 3 symbols.

## Editing Ergonomics, Preview And Search

Visual block gutter controls sit outside text padding without overlapping content, and Turn Into separates block conversions from block actions. Visual mode exposes contextual row/column table controls inside tables and inline callout type/folding selectors. Hybrid and Source support active formatting state, toggleable inline markers, formatting clear and formatting shortcuts. A toggleable live BBCode split preview pane, cross-mode Find and Replace, word/character counts, smart `.txt` format detection (opening Markdown/plain `.txt` directly in-place while routing BBCode-tagged `.txt` and `.bbcode` files through one-time Import), a resizable left Folder Browser sidebar, and window file/folder drag-and-drop complete the desktop workflow.

## Folder Browser

Provide a resizable, collapsible left-side `Files` sidebar (`Ctrl+Shift+E`, open by default on launch, with header toggle, close button and width/state persistence across launches). Zero-setup navigation auto-follows the active document's folder unless a workspace root was explicitly opened, climbed to via clickable breadcrumbs/parent navigation, or chosen from Persistent Pinned/Recent folders (keeping locked monorepo roots fixed on outside tab switches while offering one-click `Reveal Active File`). Filter listings to readable formats (`.md`, `.markdown`, `.mdbbcode`, `.txt`, plus `.bbcode` with an `Import` badge) and hide hidden/asset/empty directories by default with a `All` toggle (`Show All Folders`) plus recursive substring search. Include Light Explorer actions: inline `+ New File` (defaulting `.md`, refusing overwrites), inline `Rename` (`F2`/context menu, synchronizing open tabs), context menu (`Open`, `Import As BBCode` for `.txt`, `New File`, `Open As Root`, `Pin`/`Unpin`, `Rename`, `Reveal In Explorer`, `Copy Path`), and folder drag-and-drop.

## Notion-Style Interactions, Tables And Resizable Synced Preview

The BBCode preview pane supports a draggable resize splitter (vertical on desktop, horizontal when stacked) and bidirectional block-anchored scroll sync. The toolbar Table button opens an `8 × 8` size grid with header-row selection; the contextual table bar reflects `Header Row` state, and Visual tables expose right/bottom `+` hover rails, row/column drag handles (click for menu, drag to reorder while keeping row `0` headers normalized) and edge-only right-click menus while keeping cell interiors native. Visual and Hybrid block handles use pointer-event drag-and-drop with vertical hit-testing locked onto hovered controls; Visual lists and containers support per-item handles following nesting, drag-to-nest list items and Callouts/containers, and Shift/Ctrl+Click plus left-gutter marquee multi-block selection with a floating batch bar. Visual editing adds an active-line `/` placeholder, expanded slash/Turn Into entries and aliases (including Divider, Toggle, Spoiler, Center and Image), smart URL paste on selection across all modes, a link hover/caret popover (with validated native external URL opening), an expanded selection bubble bar (`Turn Into`, swatches, `Choose Color…`, `Clear Color`), a code block language/copy bar, an image hover pill with a two-field URL/alt dialog, cross-mode shortcuts (`Ctrl+K`, `Ctrl+Shift+X`, `Ctrl+E`, `Ctrl+Alt+0`–`6`, `Alt+Up`/`Down`), and a right-side three-state Document Outline (`Off` / `Float` / `Dock`) with scroll-tracked headings across Visual, Hybrid and Source.

## Packaging And Updates

`npm run portable` compiles `markdown-bbcode.exe` and deploys directly to `D:\Apps\Markdown BBCode\Markdown BBCode.exe`, keeping `portable-data` intact and triggering graceful close via `--graceful-close` (single-instance IPC) with a `WM_CLOSE` fallback (waiting up to `10s` and aborting safely if blocked by a save/conflict dialog) before swapping and relaunching an already-open instance in that folder. `npm run build:installer` produces a per-user signed NSIS installer (`currentUser`, storing data under `%APPDATA%\Markdown BBCode` with one-time legacy migration from `%APPDATA%\BBCode Editor`). Both modes check GitHub Releases asynchronously after startup or on demand from the footer version button (`vX.Y.Z`) and provide a one-click header `Update` pill that flushes open documents (blocking if any unresolved conflict/save error exists) before delegating to `tauri-plugin-updater` (installed) or verifying SHA-256 + Ed25519 minisign signatures and extracting non-user files safely (portable). Official GitHub Releases run only via `.github/workflows/release.yml` on manual dispatch or `release/v*` tag push.
